# Phase 6 - Step 5: Final Verification — LLM + Reports + WebSocket + PDF End-to-End

## Why Are We Doing This?

Steps 1–4 built the LLM integration, WebSocket gateway, report orchestration pipeline, and PDF export independently. Step 5 proves they work together as a **complete system** — the intelligence engine that transforms raw employee data into executive-ready reports.

Before moving to Phase 7 (Frontend), we need to confirm:

1. **LLM Module** generates meaningful executive summaries and structured action plans
2. **WebSocket Gateway** authenticates connections and emits progress events
3. **Reports Pipeline** orchestrates all steps: DB → AI Service → LLM → Save → WebSocket
4. **Risk Snapshots** are saved per employee on each report generation
5. **PDF Export** produces a valid, professional PDF document
6. **Audit Logging** records both GENERATE_REPORT and EXPORT_PDF actions
7. **RBAC** correctly restricts access (TEAM_MANAGER scoped, VIEWER limited)
8. **Error handling** works — failed reports are marked FAILED, WebSocket emits errors

---

## The Complete Backend Structure After Phase 6

```
backend/src/
  app.module.ts                    ← imports all modules
  main.ts                          ← bootstrap with ValidationPipe
  auth/
    auth.module.ts                 ← JWT + Passport
    auth.controller.ts             ← login, register
    auth.service.ts
    guards/
      jwt-auth.guard.ts
      roles.guard.ts
    decorators/
      roles.decorator.ts
      public.decorator.ts
    strategies/
      jwt.strategy.ts
  prisma/
    prisma.module.ts               ← global DB module
    prisma.service.ts              ← PrismaClient with adapter
  users/
    users.module.ts
    users.controller.ts
    users.service.ts
  llm/                             ← NEW (Step 1)
    llm.module.ts
    llm.service.ts                 ← Groq SDK, prompts, retry, fallbacks
    interfaces/
      report-context.interface.ts
  reports/                         ← NEW (Steps 2–4)
    reports.module.ts
    reports.controller.ts          ← POST /generate, GET /, GET /:id, GET /:id/pdf
    reports.service.ts             ← orchestration pipeline (16 steps)
    reports.gateway.ts             ← WebSocket /ws/reports
    ai-client.service.ts           ← HTTP client for AI service
    pdf.service.ts                 ← pdfmake PDF generation
    dto/
      generate-report.dto.ts
  risk-snapshots/                  ← NEW (Step 3)
    risk-snapshots.module.ts
    risk-snapshots.controller.ts   ← GET /employee/:employeeId
    risk-snapshots.service.ts
```

### API Surface After Phase 6

```
── Auth (Phase 2) ──────────────────────────────────────
POST   /auth/register         → Create new user account
POST   /auth/login            → JWT token

── Reports (Phase 6) ──────────────────────────────────
POST   /reports/generate      → Generate full report (pipeline)
GET    /reports               → List reports (RBAC-scoped)
GET    /reports/:id           → Get report with action plan
GET    /reports/:id/pdf       → Download PDF

── Risk Snapshots (Phase 6) ────────────────────────────
GET    /risk-snapshots/employee/:id → Employee risk history

── WebSocket (Phase 6) ─────────────────────────────────
WS     /ws/reports            → Real-time progress events

── AI Service (Phase 5, port 8000) ─────────────────────
GET    /health                → Service status
POST   /predict               → Team prediction
POST   /predict/single        → Single employee prediction
POST   /etl/run               → Run ETL pipeline
GET    /etl/status            → ETL status
POST   /model/retrain         → Retrain model
```

---

## The Steps

### Step A: Pre-flight checks

Before running the full verification, confirm all services are ready.

**Terminal 1 — AI Service:**

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Verify it's ready:
```bash
curl -s http://localhost:8000/health | python3 -m json.tool
```

Expected: `"model_loaded": true`

**Terminal 2 — Backend:**

```bash
cd /home/syrine/hr-insight-ai/backend
npm run start:dev
```

Check the startup logs for:
```
[NestFactory] Starting Nest application...
LLM initialized — model: llama-3.3-70b-versatile
AI Client initialized — baseURL: http://localhost:8000
[NestApplication] Nest application successfully started
```

All modules should load without errors.

---

### Step B: Test the full report generation pipeline

This is the most important test — it exercises the entire stack.

```bash
# 1. Login as admin
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hrinsight.com","password":"admin123"}' \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")

echo "JWT Token acquired: ${TOKEN:0:20}..."

# 2. Get the first team ID
TEAM_ID=$(curl -s http://localhost:3000/teams \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys, json; data=json.load(sys.stdin); print(data[0]['id'] if data else 'NO_TEAMS')")

echo "Team ID: $TEAM_ID"

# 3. Generate a report (this takes 15–30 seconds)
echo ""
echo "Generating report... (this will take 15-30 seconds)"
echo ""

REPORT=$(curl -s -X POST http://localhost:3000/reports/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"teamId\":\"$TEAM_ID\",\"dateRangeStart\":\"2026-01-01\",\"dateRangeEnd\":\"2026-03-01\"}")

echo "$REPORT" | python3 -m json.tool
```

**What to look for in the response:**

```json
{
  "id": "clxxx...",
  "teamId": "clxxx...",
  "generatedBy": "clxxx...",
  "riskScore": 42,                    // ← should be > 0
  "summaryText": "The Engineering...", // ← should be several paragraphs
  "status": "COMPLETED",              // ← NOT "GENERATING" or "FAILED"
  "modelVersion": "v1",
  "team": { "name": "Engineering", "department": "Technology" },
  "generatedByUser": { "email": "admin@hrinsight.com" },
  "actionPlan": {
    "planJson": {
      "priorities": [...],            // ← should have 3-5 items
      "retentionStrategies": [...],
      "projectedRoi": { ... }
    }
  },
  "riskSnapshotCount": 20            // ← should match employee count
}
```

**Check the backend logs** (Terminal 2) — you should see the full pipeline:
```
Report generation started — team: clxxx, user: clxxx
Fetched 20 employees for team Engineering
Predicting team risk for 20 employees...
Prediction complete — team risk: 42.3%
Summary generated (1247 chars)
Action plan generated (4 priorities)
Saved: report, action plan, 20 risk snapshots
Report clxxx completed — risk: 42%, team: Engineering
```

---

### Step C: Test the read endpoints

```bash
# List all reports
echo "=== All Reports ==="
curl -s http://localhost:3000/reports \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool

# Get the report ID from the previous step
REPORT_ID=$(echo "$REPORT" | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])")

# Get single report with action plan
echo ""
echo "=== Report Detail ==="
curl -s http://localhost:3000/reports/$REPORT_ID \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

---

### Step D: Test risk snapshots

```bash
# Get an employee ID from the team
EMPLOYEE_ID=$(curl -s http://localhost:3000/reports/$REPORT_ID \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys, json; r=json.load(sys.stdin); print(r['team']['employees'][0]['id'])")

echo "Employee ID: $EMPLOYEE_ID"

# Get risk history
echo ""
echo "=== Risk Snapshot History ==="
curl -s http://localhost:3000/risk-snapshots/employee/$EMPLOYEE_ID \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

Expected: At least 1 snapshot with `riskScore`, `riskLevel`, and `snapshotDate`.

**Pro tip:** Generate a second report for the same team and check again — you should now see 2 snapshots per employee, showing the risk trend over time.

---

### Step E: Test PDF export

```bash
# Download PDF
curl -s http://localhost:3000/reports/$REPORT_ID/pdf \
  -H "Authorization: Bearer $TOKEN" \
  -o /tmp/hr-insight-report.pdf

# Verify file type
file /tmp/hr-insight-report.pdf

# Check file size (should be 15-50KB typically)
ls -la /tmp/hr-insight-report.pdf

echo ""
echo "PDF saved to /tmp/hr-insight-report.pdf"
echo "Open it to verify the content!"
```

Expected:
```
/tmp/hr-insight-report.pdf: PDF document, version 1.3
-rw-r--r-- 1 syrine syrine 28456 Mar  5 12:00 /tmp/hr-insight-report.pdf
```

Open the PDF and verify all sections:
- [ ] Title: "Workforce Risk Assessment Report"
- [ ] Team name and department
- [ ] Risk score with color (red/orange/green)
- [ ] Executive summary (multiple paragraphs of professional text)
- [ ] Action plan priorities table
- [ ] Retention strategies
- [ ] Employee risk details table (sorted by risk, highest first)
- [ ] Page numbers
- [ ] "Confidential" footer

---

### Step F: Test WebSocket progress

This test verifies that WebSocket progress events fire during report generation.

**Option 1: Using a quick Node.js script**

Create a temporary test file `backend/test/ws-test.mjs`:

```javascript
import { io } from 'socket.io-client';

// Replace with a valid JWT token
const TOKEN = process.argv[2];

if (!TOKEN) {
  console.log('Usage: node ws-test.mjs <JWT_TOKEN>');
  process.exit(1);
}

const socket = io('http://localhost:3000/ws/reports', {
  auth: { token: TOKEN },
});

socket.on('connect', () => {
  console.log('✅ WebSocket connected (id:', socket.id, ')');
  console.log('Listening for events... (generate a report in another terminal)\n');
});

socket.on('progress', (event) => {
  const bar = '█'.repeat(Math.floor(event.percentage / 5)) +
              '░'.repeat(20 - Math.floor(event.percentage / 5));
  console.log(`[${bar}] ${event.percentage}% — ${event.message}`);
});

socket.on('report:complete', ({ reportId }) => {
  console.log(`\n✅ Report complete! ID: ${reportId}`);
  socket.disconnect();
  process.exit(0);
});

socket.on('report:error', ({ message }) => {
  console.log(`\n❌ Report error: ${message}`);
  socket.disconnect();
  process.exit(1);
});

socket.on('connect_error', (err) => {
  console.log(`❌ Connection failed: ${err.message}`);
  process.exit(1);
});

// Timeout after 60s
setTimeout(() => {
  console.log('\n⏰ Timeout — no events received in 60s');
  socket.disconnect();
  process.exit(1);
}, 60000);
```

Run in one terminal:
```bash
cd /home/syrine/hr-insight-ai/backend
node test/ws-test.mjs YOUR_JWT_TOKEN
```

In another terminal, generate a report:
```bash
curl -s -X POST http://localhost:3000/reports/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"TEAM_ID","dateRangeStart":"2026-01-01","dateRangeEnd":"2026-03-01"}'
```

Expected WebSocket output:
```
✅ WebSocket connected (id: abc123)
Listening for events...

[██░░░░░░░░░░░░░░░░░░] 10% — Fetching team data...
[█████░░░░░░░░░░░░░░░] 25% — Running AI predictions...
[████████░░░░░░░░░░░░] 40% — Analyzing results...
[██████████░░░░░░░░░░] 50% — Generating executive summary...
[██████████████░░░░░░] 70% — Creating action plan...
[█████████████████░░░] 85% — Saving results...
[████████████████████] 100% — Report ready!

✅ Report complete! ID: clxxx...
```

**Option 2: Browser DevTools (quick alternative)**

Open browser console at `http://localhost:3000`:
```javascript
const { io } = await import('https://cdn.socket.io/4.7.4/socket.io.esm.min.js');
const socket = io('http://localhost:3000/ws/reports', { auth: { token: 'YOUR_TOKEN' } });
socket.on('connect', () => console.log('Connected'));
socket.on('progress', (e) => console.log(`${e.percentage}% — ${e.message}`));
socket.on('report:complete', (e) => console.log('Done:', e));
```

---

### Step G: Test RBAC enforcement

```bash
# Register a viewer user (if not already exists)
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"viewer@test.com","password":"test123","firstName":"Test","lastName":"Viewer"}'

# Login as viewer
VIEWER_TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"viewer@test.com","password":"test123"}' \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")

# Viewer tries to generate a report → should be 403 Forbidden
echo "=== Viewer generating report (should fail) ==="
curl -s -X POST http://localhost:3000/reports/generate \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"teamId\":\"$TEAM_ID\",\"dateRangeStart\":\"2026-01-01\",\"dateRangeEnd\":\"2026-03-01\"}" \
  | python3 -m json.tool

# Viewer tries to export PDF → should be 403 Forbidden
echo ""
echo "=== Viewer exporting PDF (should fail) ==="
curl -s http://localhost:3000/reports/$REPORT_ID/pdf \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -w "\nHTTP Status: %{http_code}\n"

# Unauthenticated → should be 401
echo ""
echo "=== No auth token (should fail) ==="
curl -s http://localhost:3000/reports \
  -w "\nHTTP Status: %{http_code}\n"
```

Expected:
- Viewer → 403 on generate and PDF export
- No token → 401 on all endpoints

---

### Step H: Test audit logging

```bash
# Check audit logs (as admin)
echo "=== Recent Audit Logs ==="
curl -s http://localhost:3000/audit-logs \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

Look for:
- `"action": "GENERATE_REPORT"` entries with report metadata
- `"action": "EXPORT_PDF"` entries

If audit-logs endpoint isn't built yet (Phase 2 incomplete), verify directly in the database:

```bash
cd /home/syrine/hr-insight-ai/backend
npx tsx -e "
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 })
  .then(logs => { console.log(JSON.stringify(logs, null, 2)); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
"
```

---

## Complete Verification Matrix

| # | Check | Command/Method | Expected |
|---|-------|---------------|----------|
| 1 | AI Service healthy | `curl localhost:8000/health` | `model_loaded: true` |
| 2 | Backend starts clean | `npm run start:dev` | No errors in console |
| 3 | LlmModule loaded | Check startup logs | "LLM initialized" message |
| 4 | AI Client loaded | Check startup logs | "AI Client initialized" message |
| 5 | Generate report | `POST /reports/generate` | status: COMPLETED, riskScore > 0 |
| 6 | Summary not empty | Check report response | summaryText > 100 chars |
| 7 | Action plan has priorities | Check report response | priorities array with 3+ items |
| 8 | Action plan has ROI | Check report response | projectedRoi object exists |
| 9 | Risk snapshots saved | `GET /risk-snapshots/employee/:id` | 1+ snapshots per employee |
| 10 | List reports | `GET /reports` | Array with 1+ reports |
| 11 | Get single report | `GET /reports/:id` | Report with ActionPlan included |
| 12 | PDF downloads | `GET /reports/:id/pdf` | Valid PDF file (15-50KB) |
| 13 | PDF content correct | Open PDF | All sections present |
| 14 | WebSocket connects | ws-test.mjs script | "Connected" message |
| 15 | WebSocket progress | Generate report while WS connected | 6 progress events received |
| 16 | WebSocket complete | After report finishes | "report:complete" event |
| 17 | RBAC: Viewer blocked | Viewer tries generate | 403 Forbidden |
| 18 | RBAC: No auth blocked | No token on any endpoint | 401 Unauthorized |
| 19 | Audit: GENERATE_REPORT | Check audit_logs table | Entry exists with metadata |
| 20 | Audit: EXPORT_PDF | Check audit_logs table | Entry exists after PDF download |
| 21 | Error handling | Stop AI service, try generate | Report marked FAILED, WS error event |

---

## Troubleshooting

### "Connection refused" on AI service call

The AI service (port 8000) must be running before generating reports. Check:
```bash
curl -s http://localhost:8000/health
```

If it fails, start the AI service:
```bash
cd /home/syrine/hr-insight-ai/ai-service && source venv/bin/activate && uvicorn app.main:app --reload --port 8000
```

### "GROQ_API_KEY" error

Verify the key is in `backend/.env`:
```bash
grep GROQ backend/.env
```

Verify the key works:
```bash
curl -s https://api.groq.com/openai/v1/models \
  -H "Authorization: Bearer $(grep GROQ_API_KEY backend/.env | cut -d= -f2)"
```

### Report stuck in GENERATING status

This means the pipeline crashed without hitting the catch block (very rare). Check backend logs for the error. You can manually fix it:
```bash
# Find stuck reports
npx tsx -e "... prisma.report.updateMany({ where: { status: 'GENERATING' }, data: { status: 'FAILED' } }) ..."
```

### WebSocket won't connect

- Verify the JWT token is valid (not expired)
- Check the socket.io namespace matches: `/ws/reports`
- Check CORS settings if testing from a different origin

### PDF is empty or corrupt

- Ensure the report has `status: COMPLETED` (GENERATING/FAILED reports have no data)
- Check that `pdfmake` is installed: `cd backend && npm ls pdfmake`
- Look at backend logs for PDF generation errors

### LLM returns fallback templates

This is expected behavior when:
- GROQ_API_KEY is invalid or missing
- Groq API is down or rate-limited beyond max retries
- The response has `_generatedBy: "fallback-template"` in the action plan

To fix: verify your API key, wait a few seconds, and regenerate the report.

---

## Checklist — Phase 6 Complete

**Step 1 — LLM Module:**
- [ ] `llm.service.ts` with `generateSummary()` and `generateActionPlan()`
- [ ] Groq SDK with `llama-3.3-70b-versatile` model
- [ ] Retry logic (exponential backoff on 429)
- [ ] Fallback templates when LLM is unavailable
- [ ] Professional prompt engineering for both outputs
- [ ] `GROQ_API_KEY` in `backend/.env`

**Step 2 — WebSocket Gateway:**
- [ ] `reports.gateway.ts` with JWT-authenticated connections
- [ ] Room-based progress scoping (`user:{userId}`)
- [ ] `emitProgress()`, `emitComplete()`, `emitError()` methods
- [ ] Unauthorized connections are rejected

**Step 3 — Reports Module:**
- [ ] `reports.service.ts` with full orchestration pipeline
- [ ] `ai-client.service.ts` for AI service HTTP calls
- [ ] `generate-report.dto.ts` with validation
- [ ] `reports.controller.ts` with POST /generate, GET /, GET /:id
- [ ] RBAC: TEAM_MANAGER scoped to assigned teams
- [ ] Reports track status: GENERATING → COMPLETED / FAILED
- [ ] Risk snapshots saved per employee per report
- [ ] Audit log: GENERATE_REPORT action
- [ ] `risk-snapshots.controller.ts` with GET /employee/:id
- [ ] Both modules registered in `app.module.ts`

**Step 4 — PDF Export:**
- [ ] `pdf.service.ts` with pdfmake document generation
- [ ] GET /reports/:id/pdf endpoint
- [ ] PDF has: title, metadata, summary, action plan table, employee table
- [ ] Risk-based color coding (red/orange/green)
- [ ] Page numbers and confidentiality footer
- [ ] Audit log: EXPORT_PDF action

**End-to-End:**
- [ ] Full pipeline: generate → summary → action plan → save → PDF
- [ ] WebSocket progress events fire at each step (10% → 25% → 40% → 50% → 70% → 85% → 100%)
- [ ] Multiple report generations produce accumulating risk snapshots
- [ ] RBAC blocks unauthorized users
- [ ] Error handling marks failed reports correctly
- [ ] All 21 verification checks pass

---

## Phase 6 Complete!

If all checklist items pass, Phase 6 is done. You've built:

- **LLM Intelligence Layer** — Groq-powered executive summaries and structured action plans with retry logic and fallbacks
- **WebSocket Real-Time Progress** — JWT-authenticated, room-scoped progress events during report generation
- **Report Orchestration Pipeline** — 16-step pipeline coordinating DB, AI Service, LLM, and WebSocket
- **Risk Snapshot Tracking** — Historical risk scores per employee across report generations
- **PDF Export** — Professional, downloadable reports with tables, color-coded risk scores, and proper formatting
- **Audit Trail** — GENERATE_REPORT and EXPORT_PDF actions logged for compliance

**What's next: Phase 7 — Frontend with Ant Design**

This is where users finally interact with everything you've built. The Next.js frontend will:
1. Login/Register pages with JWT authentication
2. Dashboard with team selector and "Generate Insight" button
3. Real-time progress bar powered by the WebSocket gateway
4. Report viewer with executive summary and action plan cards
5. Employee risk timeline charts
6. PDF download button
7. Teams and employees CRUD pages
8. Audit log viewer for administrators
