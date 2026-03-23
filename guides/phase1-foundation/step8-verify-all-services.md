# Phase 1 - Step 8: Verify All 3 Services Start Together

## Why Are We Doing This?

This is the final checkpoint of Phase 1. Before moving to Phase 2 (Authentication + RBAC), we need to confirm that all three services start without errors and can run simultaneously. This verifies:

1. **No port conflicts** — each service uses its own port
2. **Database connection works** — backend connects to Neon via Prisma
3. **All dependencies are installed** — no missing packages
4. **No configuration errors** — .env files, module imports, etc.

If all three services start, Phase 1 is complete and we have a solid foundation to build on.

---

## Architecture Reminder

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend    │     │  Backend    │     │  AI Service  │
│  Next.js     │────→│  NestJS     │────→│  FastAPI     │
│  port 3001   │     │  port 3000  │     │  port 8000   │
│  (antd UI)   │     │  (Prisma)   │     │  (ML model)  │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │    Neon     │
                    │  PostgreSQL │
                    │  (cloud)    │
                    └─────────────┘
```

- **Frontend** → talks to Backend via HTTP (axios)
- **Backend** → talks to AI Service via HTTP (axios), talks to Neon via Prisma
- **AI Service** → standalone Python service (will receive requests from Backend in Phase 6)

---

## The Steps

You need **3 separate terminal windows/tabs** for this. Each service runs in its own terminal.

### Terminal 1: Start the Backend (NestJS)

```bash
cd /home/syrine/hr-insight-ai/backend
npm run start:dev
```

**Expected output:**
```
[12:00:00 AM] Starting compilation in watch mode...
[12:00:02 AM] Found 0 errors. Watching for file changes.

[Nest] XXXXX  - LOG [NestFactory] Starting Nest application...
[Nest] XXXXX  - LOG [InstanceLoader] PrismaModule dependencies initialized
[Nest] XXXXX  - LOG [InstanceLoader] ConfigHostModule dependencies initialized
[Nest] XXXXX  - LOG [InstanceLoader] AppModule dependencies initialized
[Nest] XXXXX  - LOG [InstanceLoader] ConfigModule dependencies initialized
[Nest] XXXXX  - LOG [RoutesResolver] AppController {/}:
[Nest] XXXXX  - LOG [RouterExplorer] Mapped {/, GET} route
[Nest] XXXXX  - LOG [NestApplication] Nest application successfully started
```

**Key things to check:**
- "Found 0 errors" — TypeScript compilation succeeds
- "PrismaModule dependencies initialized" — database connection established
- "Nest application successfully started" — the server is running

**Quick test:**
```bash
curl http://localhost:3000
```
Should return: `Hello World!`

### Terminal 2: Start the Frontend (Next.js)

```bash
cd /home/syrine/hr-insight-ai/frontend
npm run dev
```

**Expected output:**
```
  ▲ Next.js 16.x.x
  - Local:    http://localhost:3001

  ✓ Starting...
  ✓ Ready in Xs
```

**Quick test:**
Open `http://localhost:3001` in your browser. You should see the Next.js welcome page (or the antd test page if you left it from Step 5).

### Terminal 3: Start the AI Service (FastAPI)

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

**Expected output:**
```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [XXXXX] using WatchFiles
INFO:     Started server process [XXXXX]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

**Quick test:**
```bash
curl http://localhost:8000/health
```
Should return:
```json
{"status":"ok","service":"HR Insight AI Service","model_loaded":false}
```

You can also open `http://localhost:8000/docs` in your browser to see the Swagger UI.

---

## Verification Checklist

Run these tests while all 3 services are running:

| # | Test | Command | Expected Result |
|---|------|---------|-----------------|
| 1 | Backend responds | `curl http://localhost:3000` | `Hello World!` |
| 2 | Frontend loads | Open `http://localhost:3001` in browser | Next.js page renders |
| 3 | AI Service health | `curl http://localhost:8000/health` | JSON with `"status":"ok"` |
| 4 | Swagger docs | Open `http://localhost:8000/docs` in browser | FastAPI auto-generated docs |
| 5 | No errors in any terminal | Check all 3 terminal windows | No red error messages |

---

## Troubleshooting

**"EADDRINUSE: address already in use"**
A port is already occupied. Find and kill the process:
```bash
# Find what's using the port (replace 3000 with the conflicting port)
lsof -i :3000
# Kill it
kill -9 <PID>
```

**Backend: "Cannot find module '@prisma/client'"**
Run `npx prisma generate` in the backend folder, then restart.

**AI Service: "ModuleNotFoundError"**
Make sure you activated the virtual environment: `source venv/bin/activate`

**Frontend: compilation errors**
Run `npm install` in the frontend folder to ensure all deps are present.

---

## Phase 1 Complete!

If all 3 services are running simultaneously with no errors, **Phase 1 is done**. You've built:

- A NestJS backend connected to Neon PostgreSQL with 8 tables
- A Next.js frontend with antd and all visualization libraries
- A Python FastAPI AI service ready for ML model integration
- 60 employees across 3 teams with realistic HR data
- 4 user accounts with different roles for RBAC testing

**Stop all services** with `Ctrl+C` in each terminal when done.

---

## What's Next: Phase 2 — Authentication + RBAC + Audit

Phase 2 is where we bring the backend to life. We'll build:

1. **Register endpoint** — create new users with bcrypt-hashed passwords
2. **Login endpoint** — authenticate and return JWT tokens
3. **JWT Guard** — protect all routes (must be logged in)
4. **Roles Guard** — enforce role-based access (`@Roles('ADMIN')`)
5. **Team Manager scoping** — TEAM_MANAGERs only see their assigned teams
6. **Audit interceptor** — auto-log every POST/PATCH/DELETE action
7. **Users management** — ADMIN-only user CRUD

This is where the corporate-level features really start. Ready when you are!
