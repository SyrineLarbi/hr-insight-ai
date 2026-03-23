# Phase 5 - Step 3: Pydantic Schemas + FastAPI Routes

## Why Are We Doing This?

Steps 1–2 built the ML engine (train + predict). Step 3 exposes it as an **HTTP API** that the NestJS backend can call.

Without this step, the model is just Python code on disk. After this step, the NestJS backend can:
- `POST /predict` → send employee data → get risk scores back
- `POST /predict/single` → send one employee → get individual risk + drivers
- `POST /etl/run` → trigger the ETL pipeline for retraining
- `GET /etl/status` → check the last ETL run's quality report
- `GET /health` → verify the service is running and model is loaded
- `POST /model/retrain` → retrain the model on fresh data

### Why Pydantic schemas?

FastAPI uses **Pydantic models** for request/response validation. They serve three purposes:
1. **Validation**: reject requests with missing fields, wrong types, out-of-range values
2. **Documentation**: auto-generate OpenAPI/Swagger docs (visit `http://localhost:8000/docs`)
3. **Serialization**: automatically convert Python objects to JSON responses

---

## What We're Building

```
ai-service/
  app/
    schemas/
      prediction.py      ← Pydantic models for prediction request/response
      etl.py             ← Pydantic models for ETL request/response
    routes/
      health.py          ← GET /health (service status + model info)
      prediction.py      ← POST /predict, POST /predict/single
      etl.py             ← POST /etl/run, GET /etl/status, POST /model/retrain
    main.py              ← MODIFIED: include routers + load model at startup
  tests/
    verify_step5_3.py    ← verification script
```

---

## The Steps

### Step A: Create prediction schemas

Create `ai-service/app/schemas/prediction.py`:

```python
"""
Pydantic models for the prediction endpoints.

These define the exact shape of request bodies and response payloads.
FastAPI uses them for automatic validation, serialization, and Swagger docs.
"""

from pydantic import BaseModel, Field


class EmployeeInput(BaseModel):
    """
    A single employee's features for prediction.

    All 8 base features that the model expects. The prediction module
    handles feature engineering (derived features) and scaling internally.
    """
    salary: float = Field(..., gt=0, description="Annual salary in currency units")
    tenureMonths: int = Field(..., ge=0, description="Months at the company")
    engagementScore: float = Field(..., ge=1.0, le=5.0, description="Engagement score (1-5)")
    performanceScore: float = Field(..., ge=1.0, le=5.0, description="Performance score (1-5)")
    absenteeismDays: int = Field(..., ge=0, description="Days absent per year")
    overtimeHours: float = Field(..., ge=0, description="Overtime hours per week")
    lastPromotionMonths: int = Field(..., ge=0, description="Months since last promotion")
    trainingHours: float = Field(..., ge=0, description="Training hours completed")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "salary": 75000,
                    "tenureMonths": 36,
                    "engagementScore": 3.2,
                    "performanceScore": 3.5,
                    "absenteeismDays": 5,
                    "overtimeHours": 8,
                    "lastPromotionMonths": 18,
                    "trainingHours": 20,
                }
            ]
        }
    }


class TeamPredictionRequest(BaseModel):
    """Request body for team-level prediction."""
    employees: list[EmployeeInput] = Field(
        ..., min_length=1, description="List of employees to predict"
    )


class RiskDriverResponse(BaseModel):
    """A single risk driver contributing to an employee's risk score."""
    feature: str
    importance: float
    scaled_value: float
    direction: str


class SinglePredictionResponse(BaseModel):
    """Response from a single employee prediction."""
    risk_score: float = Field(..., ge=0, le=1, description="Attrition probability (0-1)")
    risk_level: str = Field(..., description="LOW / MEDIUM / HIGH")
    risk_drivers: list[RiskDriverResponse]


class EmployeePrediction(BaseModel):
    """Per-employee prediction within a team result."""
    employee_index: int
    risk_score: float
    risk_level: str
    risk_drivers: list[RiskDriverResponse]


class RiskDistribution(BaseModel):
    """Count of employees per risk level."""
    LOW: int = 0
    MEDIUM: int = 0
    HIGH: int = 0


class TeamPredictionResponse(BaseModel):
    """Response from a team-level prediction."""
    team_risk_score: float
    team_risk_level: str
    employee_count: int
    risk_distribution: RiskDistribution
    high_risk_employees: list[EmployeePrediction]
    predictions: list[EmployeePrediction]
```

**Why `Field(..., gt=0)` instead of just `float`?**

FastAPI + Pydantic validate these constraints automatically. If someone sends `{"salary": -5000}`, they get a 422 error with a clear message instead of the model producing garbage predictions silently.

---

### Step B: Create ETL schemas

Create `ai-service/app/schemas/etl.py`:

```python
"""
Pydantic models for the ETL pipeline endpoints.
"""

from pydantic import BaseModel


class ETLStageResult(BaseModel):
    """Result of a single ETL stage."""
    rows: int | None = None
    columns: int | None = None
    rows_dropped: int | None = None
    duration_seconds: float | None = None
    checks_passed: str | None = None


class ETLRunResponse(BaseModel):
    """Response from POST /etl/run."""
    status: str
    source: str | None = None
    duration_seconds: float | None = None
    stages: dict[str, ETLStageResult] | None = None
    output_path: str | None = None
    error: str | None = None


class RetrainResponse(BaseModel):
    """Response from POST /model/retrain."""
    status: str
    model_version: str | None = None
    metrics: dict | None = None
    feature_importance: dict | None = None
    error: str | None = None
```

---

### Step C: Create the health route

Create `ai-service/app/routes/health.py`:

```python
"""
Health check endpoint — reports service status and model info.

This is called by:
1. Docker/K8s health probes (if deployed)
2. NestJS backend to verify the AI service is ready before sending predictions
3. Monitoring systems
"""

from fastapi import APIRouter

from app.models.predict import get_model_info, is_model_loaded

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check():
    """
    Service health check.

    Returns the service status, whether the model is loaded,
    and model metadata (version, AUC-ROC).
    """
    model_info = get_model_info()

    return {
        "status": "ok" if is_model_loaded() else "degraded",
        "service": "HR Insight AI Service",
        **model_info,
    }
```

---

### Step D: Create the prediction route

Create `ai-service/app/routes/prediction.py`:

```python
"""
Prediction endpoints — the core API that the NestJS backend calls.

POST /predict         → Team-level prediction (list of employees)
POST /predict/single  → Single employee prediction
"""

from fastapi import APIRouter, HTTPException

from app.models.predict import is_model_loaded, predict_single, predict_team
from app.schemas.prediction import (
    EmployeeInput,
    SinglePredictionResponse,
    TeamPredictionRequest,
    TeamPredictionResponse,
)

router = APIRouter(prefix="/predict", tags=["Prediction"])


@router.post("", response_model=TeamPredictionResponse)
async def predict_team_endpoint(request: TeamPredictionRequest):
    """
    Predict attrition risk for a team of employees.

    Accepts a list of employees with their 8 base features.
    Returns per-employee risk scores + team-level summary.

    This is called by the NestJS backend during report generation:
    POST /predict { employees: [...] }
    """
    if not is_model_loaded():
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Train the model first via POST /model/retrain",
        )

    try:
        employees_data = [emp.model_dump() for emp in request.employees]
        result = predict_team(employees_data)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@router.post("/single", response_model=SinglePredictionResponse)
async def predict_single_endpoint(employee: EmployeeInput):
    """
    Predict attrition risk for a single employee.

    Accepts one employee's 8 base features.
    Returns risk_score, risk_level, and top 5 risk drivers.
    """
    if not is_model_loaded():
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Train the model first via POST /model/retrain",
        )

    try:
        result = predict_single(employee.model_dump())
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")
```

**Why 503 when model isn't loaded?**

HTTP 503 = "Service Unavailable". The service itself is running, but it can't fulfill the request because the model isn't ready. The NestJS backend can check this and show a helpful message to the user: "AI service is starting up, please try again in a moment."

---

### Step E: Create the ETL route

Create `ai-service/app/routes/etl.py`:

```python
"""
ETL pipeline endpoints — run the pipeline and check status.

POST /etl/run          → Trigger the full ETL pipeline
GET  /etl/status       → Get the last ETL run's quality report
POST /model/retrain    → Re-run ETL + retrain the model
"""

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.etl.pipeline import run_pipeline
from app.models.predict import load_artifacts
from app.models.train import train
from app.schemas.etl import ETLRunResponse, RetrainResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ETL & Training"])

QUALITY_REPORT_PATH = (
    Path(__file__).parent.parent.parent / "data" / "processed" / "data_quality_report.json"
)


@router.post("/etl/run", response_model=ETLRunResponse)
async def run_etl():
    """
    Run the full ETL pipeline: extract → clean → transform → validate.

    This processes the training CSV and produces:
    - Cleaned dataset (data/cleaned/hr_cleaned.csv)
    - Processed dataset (data/processed/hr_processed.csv)
    - Quality report (data/processed/data_quality_report.json)
    - Scaler artifact (app/artifacts/scaler.joblib)
    """
    try:
        result = run_pipeline()
        # Remove the quality_report from the response (too large, use /etl/status instead)
        result.pop("quality_report", None)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ETL pipeline failed: {str(e)}")


@router.get("/etl/status")
async def etl_status():
    """
    Get the quality report from the last ETL run.

    Returns the full validation report including:
    - Schema validation results
    - Missing value check
    - Scaling verification
    - Target variable balance
    - Row drop rate
    - Extreme outlier check
    """
    if not QUALITY_REPORT_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="No ETL run found. Run POST /etl/run first.",
        )

    with open(QUALITY_REPORT_PATH) as f:
        report = json.load(f)

    return report


@router.post("/model/retrain", response_model=RetrainResponse)
async def retrain_model():
    """
    Retrain the ML model on the latest processed data.

    Steps:
    1. Run the full ETL pipeline (extract → clean → transform → validate)
    2. Train a new XGBoost model on the processed data
    3. Save the new model + metadata to artifacts/
    4. Reload the model into memory for predictions

    This is the single endpoint for "refresh everything from source data."
    """
    try:
        # Step 1: Run ETL pipeline
        logger.info("Retraining: Running ETL pipeline...")
        etl_result = run_pipeline()

        if etl_result["status"] == "failed":
            return RetrainResponse(
                status="failed",
                error="ETL pipeline failed — cannot retrain on bad data",
            )

        # Step 2: Train model
        logger.info("Retraining: Training model...")
        train_result = train()

        # Step 3: Reload artifacts into memory
        logger.info("Retraining: Reloading model...")
        load_artifacts()

        return RetrainResponse(
            status="success",
            model_version=train_result.get("model_version"),
            metrics=train_result.get("metrics"),
            feature_importance=train_result.get("feature_importance"),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Retrain failed: {str(e)}")
```

**Why `/model/retrain` runs ETL first?**

If you retrain on stale processed data, the model won't learn from recent employee changes. The retrain endpoint runs the full pipeline (extract fresh data → clean → transform → validate → train) to guarantee the model reflects the latest data.

---

### Step F: Update main.py to include routers + startup loading

Replace `ai-service/app/main.py` with:

```python
"""
HR Insight AI Service — FastAPI application.

Provides ML prediction, ETL pipeline, and model management endpoints.
The NestJS backend calls these endpoints during report generation.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.models.predict import load_artifacts
from app.routes.health import router as health_router
from app.routes.prediction import router as prediction_router
from app.routes.etl import router as etl_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application startup/shutdown events.

    On startup: load the trained model into memory so predictions are fast.
    If the model doesn't exist yet, the service starts in degraded mode
    (health returns status=degraded, predict returns 503).
    """
    # Startup
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logger.info("Starting HR Insight AI Service...")

    loaded = load_artifacts()
    if loaded:
        logger.info("✅ Model loaded successfully — ready for predictions")
    else:
        logger.warning("⚠️  Model not found — service running in degraded mode")
        logger.warning("   Train the model first: POST /model/retrain")

    yield

    # Shutdown
    logger.info("Shutting down HR Insight AI Service...")


app = FastAPI(
    title="HR Insight AI Service",
    description="ML prediction and ETL pipeline for HR analytics",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: Allow the NestJS backend to call this service
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",   # Frontend (Next.js)
        "http://localhost:3001",   # Frontend alternate
        "http://localhost:4000",   # Backend (NestJS)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register route modules
app.include_router(health_router)
app.include_router(prediction_router)
app.include_router(etl_router)
```

**Why `lifespan` instead of `@app.on_event("startup")`?**

The `on_event` approach is deprecated in FastAPI. `lifespan` is the modern replacement — it uses Python's `asynccontextmanager` pattern: everything before `yield` runs at startup, everything after runs at shutdown. Cleaner and officially supported.

**Why load the model at startup?**

If we loaded the model on the first request, that request would be slow (~100ms extra). Loading at startup means the first request is just as fast as every subsequent one. If the model doesn't exist, the service still starts (for the `/etl/run` and `/model/retrain` endpoints) but returns 503 on prediction requests.

---

### Step G: Start the service and test

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

In another terminal, test the endpoints:

```bash
# Health check
curl http://localhost:8000/health | python -m json.tool

# Single prediction
curl -X POST http://localhost:8000/predict/single \
  -H "Content-Type: application/json" \
  -d '{
    "salary": 35000,
    "tenureMonths": 60,
    "engagementScore": 1.5,
    "performanceScore": 2.0,
    "absenteeismDays": 15,
    "overtimeHours": 45,
    "lastPromotionMonths": 48,
    "trainingHours": 5
  }' | python -m json.tool

# Team prediction
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "employees": [
      {
        "salary": 35000, "tenureMonths": 60, "engagementScore": 1.5,
        "performanceScore": 2.0, "absenteeismDays": 15, "overtimeHours": 45,
        "lastPromotionMonths": 48, "trainingHours": 5
      },
      {
        "salary": 120000, "tenureMonths": 24, "engagementScore": 4.5,
        "performanceScore": 4.2, "absenteeismDays": 2, "overtimeHours": 3,
        "lastPromotionMonths": 6, "trainingHours": 40
      }
    ]
  }' | python -m json.tool

# ETL status
curl http://localhost:8000/etl/status | python -m json.tool

# Swagger docs (open in browser)
# http://localhost:8000/docs
```

Or use the **REST Client** approach (if you prefer VS Code):

Create `ai-service/test-requests/ai-service.http` and use the Send Request buttons.

---

### Step H: Create the REST Client test file

Create `ai-service/test-requests/ai-service.http`:

```http
# HR Insight AI Service — API Tests
# Requires: REST Client VS Code extension
# AI Service runs on port 8000 (uvicorn app.main:app --reload --port 8000)

@baseUrl = http://localhost:8000


# ═══════════════════════════════════════════════════════════════
# SECTION 1: HEALTH CHECK
# ═══════════════════════════════════════════════════════════════

### ✅ TEST 1 — Health check
# Verify: status is "ok", model_loaded is true, model_version is "v1"
GET {{baseUrl}}/health


# ═══════════════════════════════════════════════════════════════
# SECTION 2: SINGLE PREDICTION
# ═══════════════════════════════════════════════════════════════

### ✅ TEST 2 — High-risk employee
# Verify: risk_score > 0.5, risk_level likely "HIGH" or "MEDIUM"
POST {{baseUrl}}/predict/single
Content-Type: application/json

{
    "salary": 35000,
    "tenureMonths": 60,
    "engagementScore": 1.5,
    "performanceScore": 2.0,
    "absenteeismDays": 15,
    "overtimeHours": 45,
    "lastPromotionMonths": 48,
    "trainingHours": 5
}


### ✅ TEST 3 — Low-risk employee
# Verify: risk_score < 0.3, risk_level likely "LOW"
POST {{baseUrl}}/predict/single
Content-Type: application/json

{
    "salary": 120000,
    "tenureMonths": 24,
    "engagementScore": 4.5,
    "performanceScore": 4.2,
    "absenteeismDays": 2,
    "overtimeHours": 3,
    "lastPromotionMonths": 6,
    "trainingHours": 40
}


### ❌ TEST 4 — Invalid input (engagement > 5) → 422 Validation Error
POST {{baseUrl}}/predict/single
Content-Type: application/json

{
    "salary": 75000,
    "tenureMonths": 36,
    "engagementScore": 6.0,
    "performanceScore": 3.5,
    "absenteeismDays": 5,
    "overtimeHours": 8,
    "lastPromotionMonths": 18,
    "trainingHours": 20
}


### ❌ TEST 5 — Missing required field → 422 Validation Error
POST {{baseUrl}}/predict/single
Content-Type: application/json

{
    "salary": 75000,
    "tenureMonths": 36
}


# ═══════════════════════════════════════════════════════════════
# SECTION 3: TEAM PREDICTION
# ═══════════════════════════════════════════════════════════════

### ✅ TEST 6 — Team of 3 employees
# Verify: employee_count=3, predictions has 3 entries
# Verify: risk_distribution.LOW + MEDIUM + HIGH = 3
POST {{baseUrl}}/predict
Content-Type: application/json

{
    "employees": [
        {
            "salary": 35000, "tenureMonths": 60, "engagementScore": 1.5,
            "performanceScore": 2.0, "absenteeismDays": 15, "overtimeHours": 45,
            "lastPromotionMonths": 48, "trainingHours": 5
        },
        {
            "salary": 120000, "tenureMonths": 24, "engagementScore": 4.5,
            "performanceScore": 4.2, "absenteeismDays": 2, "overtimeHours": 3,
            "lastPromotionMonths": 6, "trainingHours": 40
        },
        {
            "salary": 75000, "tenureMonths": 36, "engagementScore": 3.0,
            "performanceScore": 3.2, "absenteeismDays": 7, "overtimeHours": 12,
            "lastPromotionMonths": 24, "trainingHours": 20
        }
    ]
}


### ❌ TEST 7 — Empty employees list → 422 (min_length=1)
POST {{baseUrl}}/predict
Content-Type: application/json

{
    "employees": []
}


# ═══════════════════════════════════════════════════════════════
# SECTION 4: ETL PIPELINE
# ═══════════════════════════════════════════════════════════════

### ✅ TEST 8 — Get ETL status (quality report)
# Verify: all 6 checks present, "passed": true
GET {{baseUrl}}/etl/status


### ⚠️  TEST 9 — Run ETL pipeline (takes a few seconds)
# Verify: status is "success", all 4 stages have results
POST {{baseUrl}}/etl/run


# ═══════════════════════════════════════════════════════════════
# SECTION 5: MODEL RETRAIN
# ═══════════════════════════════════════════════════════════════

### ⚠️  TEST 10 — Retrain model (runs ETL + training, takes ~10-30s)
# Verify: status is "success", metrics.auc_roc >= 0.70
POST {{baseUrl}}/model/retrain


# ═══════════════════════════════════════════════════════════════
# SECTION 6: SWAGGER DOCS
# Open in browser: http://localhost:8000/docs
# Verify: all endpoints visible with schemas and examples
# ═══════════════════════════════════════════════════════════════
```

---

## How to Verify It Worked

Run `ai-service/tests/verify_step5_3.py`:

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python tests/verify_step5_3.py
```

**Note**: The AI service must be running (`uvicorn app.main:app --reload --port 8000`) for the HTTP tests to pass.

### Expected results:

| Check | Expected |
|-------|----------|
| All schema modules import successfully | ✅ |
| All route modules import successfully | ✅ |
| GET /health returns status + model info | ✅ |
| POST /predict/single returns risk_score, risk_level, risk_drivers | ✅ |
| POST /predict/single with invalid data → 422 | ✅ |
| POST /predict returns team result with all fields | ✅ |
| GET /etl/status returns quality report | ✅ |
| Swagger docs accessible at /docs | ✅ |

---

## Checklist (confirm before Step 4)

- [ ] `app/schemas/prediction.py` — EmployeeInput, SinglePredictionResponse, TeamPredictionResponse
- [ ] `app/schemas/etl.py` — ETLRunResponse, RetrainResponse
- [ ] `app/routes/health.py` — GET /health with model status
- [ ] `app/routes/prediction.py` — POST /predict, POST /predict/single
- [ ] `app/routes/etl.py` — POST /etl/run, GET /etl/status, POST /model/retrain
- [ ] `app/main.py` updated — lifespan handler, CORS, routers included
- [ ] `ai-service/test-requests/ai-service.http` — 10 REST Client tests
- [ ] Service starts without errors: `uvicorn app.main:app --reload --port 8000`
- [ ] Model loads at startup (health shows model_loaded=true)
- [ ] POST /predict/single returns valid prediction
- [ ] POST /predict returns team result with correct employee_count
- [ ] POST /predict/single with bad data → 422 validation error
- [ ] Swagger docs accessible at http://localhost:8000/docs
- [ ] `tests/verify_step5_3.py` passes all checks

---

Once confirmed, move to **Step 4: Phase 5 Final Verification** — end-to-end testing of the entire AI service.
