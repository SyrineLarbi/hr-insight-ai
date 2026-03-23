# HR Insight AI - Project Progress Tracker

> **Last Updated**: 2026-02-16
> **Current Phase**: Phase 1 - Foundation
> **Overall Progress**: 0%

---

## 1. Project Summary

### What is HR Insight AI?

HR Insight AI is a **corporate-grade predictive workforce analytics platform** that transforms HR from a manual reporting department into a strategic intelligence unit. It uses machine learning to predict employee turnover risk and large language models to generate executive-ready reports with actionable recommendations.

The platform is **database-driven** — no CSV uploads, no spreadsheets. HR professionals log in, select a team, choose a date range, and click "Generate Insight." The system then:

1. **Aggregates** real employee data from the database
2. **Predicts** turnover risk using a trained XGBoost ML model
3. **Generates** an executive summary using an LLM (Groq API)
4. **Creates** a structured action plan with priorities, retention strategies, and risk mitigations
5. **Stores** the report for historical tracking and comparison
6. **Exports** professional PDF reports for stakeholders

### The Business Problems It Solves

**Problem 1: Manual Reporting Overload**
HR teams spend 10-20 hours weekly building reports manually — extracting data from multiple tools, cleaning spreadsheets, creating slides. This drains time from strategic work. HR Insight AI automates the entire reporting pipeline, reducing report generation from hours to seconds.

**Problem 2: No Early Warning System**
Companies only discover attrition risk when an employee resigns — by then, the damage is done. Turnover costs 1.5x-2x an employee's annual salary (hiring, onboarding, lost productivity, team morale impact). HR Insight AI provides **predictive early warnings**, identifying at-risk employees months before they leave, giving HR time to intervene.

**Problem 3: Static Reports Without Action**
Typical HR reports show averages and trends but provide no decision guidance. They answer "what happened" but not "what should we do." HR Insight AI converts raw data into: **Risk Analysis → Executive Summary → Prioritized Action Plan → ROI Projection**. Every report comes with specific, actionable steps.

### What the Platform Offers

| Capability | Description |
|-----------|-------------|
| **ML Risk Prediction** | XGBoost model predicts turnover probability per employee (0-100%) with risk drivers |
| **LLM Executive Summaries** | AI-generated professional reports with key findings and recommendations |
| **Structured Action Plans** | JSON-based plans with priorities, timelines, cost estimates, and impact projections |
| **PDF Report Export** | Downloadable, stakeholder-ready PDF reports |
| **Real-time Progress** | WebSocket-powered progress bar during report generation |
| **Employee Risk Timeline** | Track how an employee's risk score changes over time |
| **Audit Trail** | Every action logged — who generated what, when, what changed |
| **Granular RBAC** | 4 roles (Admin, HR Manager, Team Manager, Viewer) with scoped access |
| **ETL Data Pipeline** | Professional data cleaning — missing values, outliers, feature engineering |
| **Analytics Dashboard** | Interactive charts, team metrics, risk heatmaps |

### Tech Stack

```
Frontend:     Next.js + TypeScript + Ant Design (antd)     → Port 3000
Backend:      NestJS + TypeScript + Prisma ORM             → Port 3001
AI Service:   Python FastAPI + scikit-learn + XGBoost      → Port 8000
Database:     Neon PostgreSQL (cloud, free tier)
LLM:          Groq API (llama-3.3-70b-versatile, free tier)
```

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js + antd)                 │
│                         localhost:3000                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  Login/   │  │Dashboard │  │  Teams/  │  │  Reports/Audit   │ │
│  │ Register  │  │(Generate)│  │Employees │  │  Logs/PDF Export  │ │
│  └──────────┘  └────┬─────┘  └──────────┘  └──────────────────┘ │
└─────────────────────┼────────────────────────────────────────────┘
                      │ HTTP + WebSocket (JWT Auth)
┌─────────────────────┼────────────────────────────────────────────┐
│                   BACKEND (NestJS)                                │
│                    localhost:3001                                 │
│  ┌──────┐ ┌──────┐ ┌──────────┐ ┌─────┐ ┌───────┐ ┌──────────┐ │
│  │ Auth │ │ RBAC │ │ Reports  │ │ LLM │ │ Audit │ │WebSocket │ │
│  │(JWT) │ │Guard │ │(Pipeline)│ │(Groq)│ │ Log   │ │ Gateway  │ │
│  └──────┘ └──────┘ └────┬─────┘ └─────┘ └───────┘ └──────────┘ │
│                          │ HTTP                                   │
│  ┌───────────────────────┼──────────────────────────────────┐    │
│  │              Prisma ORM (PostgreSQL Client)               │    │
│  └───────────────────────┼──────────────────────────────────┘    │
└──────────────────────────┼───────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────┐
        │                  │              │
┌───────▼────────┐  ┌──────▼──────┐  ┌───▼───────────────────────┐
│  Neon PostgreSQL│  │  AI Service │  │      Groq API (LLM)       │
│  (8 tables)     │  │  (FastAPI)  │  │  llama-3.3-70b-versatile  │
│  - users        │  │  port 8000  │  └───────────────────────────┘
│  - teams        │  │             │
│  - employees    │  │  ┌───────┐  │
│  - reports      │  │  │  ETL  │  │
│  - action_plans │  │  │Pipeline│ │
│  - audit_logs   │  │  └───┬───┘  │
│  - risk_snapshots│ │      │      │
│  - team_assign. │  │  ┌───▼───┐  │
│                  │  │  │XGBoost│  │
│                  │  │  │ Model │  │
└──────────────────┘  │  └───────┘  │
                      └─────────────┘
```

### Data Flow (Production — No CSV Uploads)

```
HR User Action → CRUD API → Neon DB (employees table)
                                    │
Generate Insight Click ─────────────┤
                                    ▼
                        Backend fetches employees
                                    │
                                    ▼
                        AI Service (FastAPI)
                        ├── ETL Transform (clean/scale in-memory)
                        └── XGBoost Predict → risk_score per employee
                                    │
                                    ▼
                        Groq LLM API
                        ├── Executive Summary (markdown)
                        └── Action Plan (structured JSON)
                                    │
                                    ▼
                        Store in Neon: Report + ActionPlan + RiskSnapshots
                                    │
                                    ▼
                        WebSocket → Frontend renders report
```

---

## 2. Phase Breakdown

### Phase 1: Foundation (Week 1) — Scaffolding + Database
- [x] Create project progress tracker (docs/progress.md) ✅ 2026-02-16
- [x] Scaffold NestJS backend (`nest new backend`) ✅ 2026-02-17
- [x] Scaffold Next.js frontend (`create-next-app` + antd) ✅ 2026-02-17
- [x] Create Python FastAPI AI service structure + virtual environment ✅ 2026-02-17
- [x] Install all AI service dependencies (FastAPI, scikit-learn, pandas, etc.) ✅ 2026-02-17
- [x] Install all backend dependencies (Prisma, JWT, bcrypt, WebSocket, etc.) ✅ 2026-02-17
- [x] Install all frontend dependencies (antd, charts, axios, socket.io-client, react-markdown, file-saver) ✅ 2026-02-17
- [x] Write Prisma schema (8 tables: users, teams, employees, reports, action_plans, audit_logs, risk_snapshots, team_assignments) ✅ 2026-02-17
- [x] Connect to Neon PostgreSQL + run migration ✅ 2026-02-17
- [x] Write seed script (3 teams, 20 employees each, 4 users, 1 team assignment) ✅ 2026-02-20
- [x] Run seed + verify data in Neon (4 users, 3 teams, 60 employees) ✅ 2026-02-20
- [x] Verify all 3 services start (backend:3000, frontend:3001, ai-service:8000) ✅ 2026-02-20

### Phase 2: Auth + RBAC + Audit (Week 2)
- [x] AuthModule: register endpoint (bcrypt password hash, default VIEWER role) ✅ 2026-02-24
- [x] AuthModule: login endpoint (JWT signing with user payload) ✅ 2026-02-24
- [x] JWT Strategy + Auth Guard (passport-jwt) ✅ 2026-02-24
- [x] @Roles() decorator + RolesGuard (checks user.role) ✅ 2026-03-07
- [x] RBAC: TEAM_MANAGER scoping via team_assignments table ✅ 2026-03-07
- [x] UsersModule: ADMIN-only CRUD (list users, change roles) ✅ 2026-03-07
- [x] POST /users/:id/assign-teams endpoint ✅ 2026-03-07
- [x] GET /auth/profile endpoint (returns user + permissions) ✅ 2026-03-07
- [x] Verify: test all roles with curl ✅ 2026-03-09
- [x] AuditInterceptor: auto-log all POST/PATCH/DELETE to audit_logs ✅ 2026-03-09
- [x] GET /audit-logs endpoint with filtering + pagination ✅ 2026-03-09

### Phase 3: CRUD APIs + Analytics (Week 3)
- [x] TeamsModule: GET /teams (RBAC-scoped), POST, PATCH, DELETE ✅ 2026-03-09
- [x] EmployeesModule: GET /employees?teamId= (RBAC-scoped), POST, PATCH, DELETE ✅ 2026-03-09
- [x] Validation DTOs (class-validator) for all endpoints ✅ 2026-03-09
- [x] AnalyticsModule: GET /analytics/team/:teamId — aggregated metrics ✅ 2026-03-09
- [x] Analytics: averages (salary, tenure, engagement, performance, etc.) ✅ 2026-03-09
- [x] Analytics: distributions/buckets (low/medium/high engagement & performance) ✅ 2026-03-09
- [x] Verify: curl all CRUD endpoints, confirm RBAC scoping works ✅ 2026-03-09

### Phase 4: ETL Pipeline + Data Cleaning (Week 4)
- [ ] Download/generate training data (IBM HR Attrition CSV or synthetic)
- [ ] extract.py: load CSV into pandas, log basic stats
- [ ] clean.py: handle missing values (median/mode imputation)
- [ ] clean.py: detect & remove duplicates
- [ ] clean.py: detect outliers (IQR method), cap extreme values
- [ ] clean.py: type validation (scores 1-5, non-negative days/hours)
- [ ] clean.py: consistency checks (tenure >= promotion months)
- [ ] transform.py: feature engineering (4 derived features)
- [ ] transform.py: StandardScaler + save fitted scaler
- [ ] transform.py: encoding (categorical → one-hot if needed)
- [ ] validate.py: data quality report (% missing, outlier counts, distributions)
- [ ] pipeline.py: orchestrate full ETL flow with logging
- [ ] Create Jupyter notebook: 01_eda.ipynb (exploratory data analysis)
- [ ] Create Jupyter notebook: 02_etl_exploration.ipynb
- [ ] Verify: data/processed/ has clean, scaled dataset

### Phase 5: ML Model + AI Service (Week 5)
- [ ] train.py: load processed data, train/test split (80/20, stratified)
- [ ] train.py: train XGBoost classifier with hyperparameter tuning
- [ ] train.py: evaluate (accuracy, precision, recall, F1, AUC-ROC > 0.80)
- [ ] train.py: save model + scaler + feature names to artifacts/
- [ ] predict.py: load model, predict single employee risk
- [ ] predict.py: predict team-level risk (aggregate per-employee scores)
- [ ] predict.py: return top risk drivers (feature importance)
- [ ] FastAPI main.py: app setup with CORS
- [ ] routes/health.py: GET /health (status + model version)
- [ ] routes/prediction.py: POST /predict (team), POST /predict/single
- [ ] routes/etl.py: POST /etl/run, GET /etl/status
- [ ] Pydantic schemas for request/response validation
- [ ] Create Jupyter notebook: 03_model_experiments.ipynb
- [ ] Verify: POST /predict returns valid risk scores

### Phase 6: LLM + Reports + WebSocket + PDF (Week 6)
- [ ] LlmModule: Groq SDK setup with API key from config
- [ ] LlmService: generateSummary() — executive summary prompt
- [ ] LlmService: generateActionPlan() — structured JSON prompt
- [ ] LLM error handling: retry on 429, fallback on persistent failure
- [ ] WebSocket gateway: /ws/reports with JWT auth
- [ ] WebSocket: emit progress events (10%, 25%, 40%, 60%, 80%, 100%)
- [ ] ReportsService: full orchestration pipeline (16 steps)
- [ ] Report: save risk_snapshots per employee on each generation
- [ ] GET /reports (list, RBAC-scoped) + GET /reports/:id (with action plans)
- [ ] GET /risk-snapshots/employee/:id (risk history)
- [ ] PDF export service: generate PDF from report data (pdfmake)
- [ ] GET /reports/:id/pdf endpoint
- [ ] Audit logging: GENERATE_REPORT + EXPORT_PDF actions
- [ ] Verify: full pipeline works, WebSocket progress fires, PDF downloads

### Phase 7: Frontend — antd Dashboard (Week 7)
- [x] Next.js project setup with Ant Design configuration ✅ 2026-03-09
- [x] Auth pages: Login + Register (antd Form, Input, Button) ✅ 2026-03-09
- [x] Auth context: useAuth hook (JWT storage, interceptor, role info) ✅ 2026-03-09
- [x] Layout: antd Layout (Sider + Header + Content), Menu navigation ✅ 2026-03-09
- [x] Role-based menu rendering (different items per role) ✅ 2026-03-09
- [x] Dashboard: Team selector (antd Select), Date range picker (antd DatePicker.RangePicker) ✅ 2026-03-09
- [x] Dashboard: Team metrics (averages, distributions, risk indicators) ✅ 2026-03-09
- [x] Dashboard: Risk score display (antd Card + Progress, color-coded) ✅ 2026-03-09
- [x] Dashboard: Executive summary display (react-markdown) ✅ 2026-03-09
- [x] Teams page: antd Table (sortable), create/edit team modal ✅ 2026-03-09
- [x] Team detail: employee antd Table + add/edit/delete modals ✅ 2026-03-09
- [x] Employee detail: all 8 metrics + risk timeline table ✅ 2026-03-09
- [x] Reports page: report list with antd Table + risk tags ✅ 2026-03-09
- [x] Report detail: full report view with markdown summary + action plans ✅ 2026-03-09
- [x] Audit log page: antd Table with action/entity filters + pagination (ADMIN/HR_MANAGER) ✅ 2026-03-09
- [x] RoleGate component for frontend RBAC enforcement ✅ 2026-03-09
- [x] Verify: build passes, all 10 routes respond ✅ 2026-03-09

### Phase 8: Polish + Testing (Week 8)
- [ ] Error handling: antd message/notification for all API errors
- [ ] Loading states: antd Skeleton components
- [ ] Form validation: all forms with proper rules + error messages
- [ ] RBAC enforcement on frontend (hide/disable per role)
- [ ] Responsive layout adjustments
- [ ] Color-coded risk indicators throughout (green/yellow/red)
- [ ] End-to-end smoke test with ADMIN role
- [ ] End-to-end smoke test with HR_MANAGER role
- [ ] End-to-end smoke test with TEAM_MANAGER role
- [ ] End-to-end smoke test with VIEWER role

### Phase 9: Advanced Features (Week 9) — Pick 2-3
- [ ] ROI Calculator: estimate savings from reduced turnover
- [ ] Risk Heatmap: color-coded team grid (@ant-design/charts Heatmap)
- [ ] Simulation Mode: adjust metrics via antd Slider → re-predict
- [ ] Team Comparison: side-by-side analytics of 2 teams

---

## 3. Current Status

| Metric | Value |
|--------|-------|
| **Current Phase** | Phase 8: Polish + Testing |
| **Phase Progress** | Phases 1-3 + 7 COMPLETE |
| **Overall Progress** | ~55% (47/83 tasks done) |
| **Blockers** | None |
| **Next Step** | Phase 4: ETL pipeline, or Phase 8: Polish the frontend |

### Recent Completions
- ✅ 2026-03-09: **PHASE 7 COMPLETE** (17/17) — Full frontend: auth, dashboard, teams CRUD, employees CRUD, reports, audit logs, role-based UI
- ✅ 2026-03-09: **PHASE 3 COMPLETE** (7/7) — TeamsModule, EmployeesModule, AnalyticsModule, all RBAC-scoped, all tested
- ✅ 2026-03-09: **PHASE 2 COMPLETE** (11/11) — AuditInterceptor + GET /audit-logs with filtering + pagination
- ✅ 2026-03-07: @Roles() decorator, RolesGuard, UsersModule CRUD, assign-teams, profile endpoint
- ✅ 2026-02-24: Auth register, login, JWT strategy + guard
- ✅ 2026-02-20: **PHASE 1 COMPLETE** (12/12 tasks) — All 3 services running, DB seeded, foundation ready

### Active Blockers
_None_

### Notes & Decisions
- Using Neon PostgreSQL (free tier) — user's existing account
- Using Groq API for LLM (free tier, ~14K requests/day)
- No git, no Docker — pure local development
- Ant Design (antd) for enterprise-grade UI components
- ETL pipeline works on database data, not CSV uploads (CSV only for initial model training)


#### Improvement : 
- AI Internal Talent Mobility System

Instead of hiring externally:

AI suggests internal employees for open roles

Detect hidden skill matches

🔥 WOW:
“Hidden Talent Finder”