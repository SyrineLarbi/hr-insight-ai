# Phase 5 - Step 4: Final Verification — ML Model + AI Service End-to-End

## Why Are We Doing This?

Steps 1–3 built the model, prediction layer, and HTTP API independently. Step 4 proves they work together as a complete system — the AI service that the NestJS backend will call during report generation.

Before moving to Phase 6, we need to confirm:

1. **Model training** completes with AUC-ROC ≥ 0.80 (or ≥ 0.70 for synthetic data)
2. **Predictions** produce meaningful results (high-risk profiles score higher than low-risk)
3. **FastAPI endpoints** are all accessible and return correct response shapes
4. **ETL → Train → Predict** pipeline works end-to-end
5. **Model retraining** via API endpoint works (POST /model/retrain)
6. **Pydantic validation** rejects bad input with 422 errors
7. **Everything from Phase 4 still works** — ETL pipeline, quality report, artifacts

---

## The Complete AI Service Structure After Phase 5

```
ai-service/
  app/
    main.py                    ← FastAPI app with lifespan, CORS, routers
    etl/
      extract.py               ← load CSV → DataFrame
      clean.py                 ← 5-step cleaning pipeline
      transform.py             ← 4 derived features + StandardScaler
      validate.py              ← 6 quality checks + JSON report
      pipeline.py              ← orchestrates extract → clean → transform → validate
    models/
      train.py                 ← XGBoost training + evaluation + save
      predict.py               ← load model, predict single/team, risk drivers
    schemas/
      prediction.py            ← Pydantic models for prediction I/O
      etl.py                   ← Pydantic models for ETL I/O
    routes/
      health.py                ← GET /health
      prediction.py            ← POST /predict, POST /predict/single
      etl.py                   ← POST /etl/run, GET /etl/status, POST /model/retrain
    artifacts/
      model.joblib             ← trained XGBoost model
      scaler.joblib            ← fitted StandardScaler
      feature_names.joblib     ← ordered list of 12 feature names
      training_metadata.json   ← metrics, params, timestamp
  data/
    raw/hr_training_data.csv
    cleaned/hr_cleaned.csv
    processed/hr_processed.csv
    processed/data_quality_report.json
  test-requests/
    ai-service.http            ← REST Client test file (10 tests)
  tests/
    verify_step5_1.py
    verify_step5_2.py
    verify_step5_3.py
    verify_phase5.py           ← THIS — full phase verification
```

### API Surface After Phase 5

```
GET    /health           → Service status + model info
POST   /predict          → Team-level prediction (list of employees → risk scores)
POST   /predict/single   → Single employee prediction (risk score + drivers)
POST   /etl/run          → Run full ETL pipeline
GET    /etl/status       → Last ETL quality report
POST   /model/retrain    → ETL + retrain model + reload
GET    /docs             → Swagger documentation (auto-generated)
```

---

## The Steps

### Step A: Run all individual verification scripts

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate

echo "=== Step 1: Model Training ==="
python tests/verify_step5_1.py

echo ""
echo "=== Step 2: Prediction Module ==="
python tests/verify_step5_2.py

echo ""
echo "=== Step 3: Schemas + Routes (import checks only) ==="
python tests/verify_step5_3.py
```

All 3 scripts should show `✅ ALL CHECKS PASSED` (Step 3 HTTP tests need the server running).

---

### Step B: Start the AI service

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Expected startup output:
```
Starting HR Insight AI Service...
Loaded model, scaler, and 12 feature names
✅ Model loaded successfully — ready for predictions
INFO:     Uvicorn running on http://127.0.0.1:8000
```

---

### Step C: Test the full API surface

In another terminal, use the REST Client file `ai-service/test-requests/ai-service.http` in VS Code. Or run these curl commands:

```bash
# 1. Health check — should show model_loaded=true
curl -s http://localhost:8000/health | python -m json.tool

# 2. Single prediction — high-risk employee
curl -s -X POST http://localhost:8000/predict/single \
  -H "Content-Type: application/json" \
  -d '{"salary":35000,"tenureMonths":60,"engagementScore":1.5,"performanceScore":2.0,"absenteeismDays":15,"overtimeHours":45,"lastPromotionMonths":48,"trainingHours":5}' \
  | python -m json.tool

# 3. Single prediction — low-risk employee
curl -s -X POST http://localhost:8000/predict/single \
  -H "Content-Type: application/json" \
  -d '{"salary":120000,"tenureMonths":24,"engagementScore":4.5,"performanceScore":4.2,"absenteeismDays":2,"overtimeHours":3,"lastPromotionMonths":6,"trainingHours":40}' \
  | python -m json.tool

# 4. Team prediction
curl -s -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{"employees":[{"salary":35000,"tenureMonths":60,"engagementScore":1.5,"performanceScore":2.0,"absenteeismDays":15,"overtimeHours":45,"lastPromotionMonths":48,"trainingHours":5},{"salary":120000,"tenureMonths":24,"engagementScore":4.5,"performanceScore":4.2,"absenteeismDays":2,"overtimeHours":3,"lastPromotionMonths":6,"trainingHours":40}]}' \
  | python -m json.tool

# 5. Validation error (engagement > 5) — should return 422
curl -s -X POST http://localhost:8000/predict/single \
  -H "Content-Type: application/json" \
  -d '{"salary":75000,"tenureMonths":36,"engagementScore":6.0,"performanceScore":3.5,"absenteeismDays":5,"overtimeHours":8,"lastPromotionMonths":18,"trainingHours":20}' \
  | python -m json.tool

# 6. ETL status
curl -s http://localhost:8000/etl/status | python -m json.tool

# 7. Swagger docs (open in browser)
echo "Open http://localhost:8000/docs in your browser"
```

---

### Step D: Test the retrain flow

```bash
# This re-runs ETL + retrains the model + reloads it
curl -s -X POST http://localhost:8000/model/retrain | python -m json.tool
```

Expected: `"status": "success"` with metrics showing AUC-ROC ≥ 0.70.

After retrain, verify predictions still work:
```bash
curl -s http://localhost:8000/health | python -m json.tool
```

---

### Step E: Run the full Phase 5 verification script

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python tests/verify_phase5.py
```

**Note**: The AI service must be running for the HTTP integration tests.

---

## How to Verify It Worked

Run `ai-service/tests/verify_phase5.py`:

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python tests/verify_phase5.py
```

### Expected results:

| Check | Expected |
|-------|----------|
| All modules import successfully (train, predict, schemas, routes) | ✅ |
| Model artifact exists and is XGBClassifier | ✅ |
| Training metadata exists with AUC-ROC ≥ 0.70 | ✅ |
| Model predicts on sample data | ✅ |
| High-risk employee scores higher than low-risk | ✅ |
| Team prediction returns correct structure | ✅ |
| GET /health → 200 with model_loaded=true | ✅ |
| POST /predict/single → 200 with risk score | ✅ |
| POST /predict → 200 with team results | ✅ |
| POST /predict/single (invalid) → 422 | ✅ |
| GET /etl/status → 200 or 404 | ✅ |
| GET /docs → 200 (Swagger) | ✅ |

---

## Checklist — Phase 5 Complete

**Step 1 — Model Training:**
- [ ] `app/models/train.py` trains XGBoost with stratified split + class weighting
- [ ] `app/artifacts/model.joblib` saved
- [ ] `app/artifacts/training_metadata.json` with metrics
- [ ] AUC-ROC ≥ 0.80 (or ≥ 0.70 for synthetic data)
- [ ] `tests/verify_step5_1.py` passes

**Step 2 — Prediction Module:**
- [ ] `app/models/predict.py` with `predict_single()` and `predict_team()`
- [ ] Module-level model caching (load once)
- [ ] High-risk profile scores higher than low-risk
- [ ] Risk drivers computed per employee (top 5)
- [ ] `tests/verify_step5_2.py` passes

**Step 3 — Schemas + Routes:**
- [ ] `app/schemas/prediction.py` + `app/schemas/etl.py` with validation
- [ ] `app/routes/health.py` — GET /health
- [ ] `app/routes/prediction.py` — POST /predict + POST /predict/single
- [ ] `app/routes/etl.py` — POST /etl/run + GET /etl/status + POST /model/retrain
- [ ] `app/main.py` updated with lifespan + routers + CORS
- [ ] `test-requests/ai-service.http` with 10 tests
- [ ] Invalid input returns 422 validation error
- [ ] Swagger docs at http://localhost:8000/docs
- [ ] `tests/verify_step5_3.py` passes

**End-to-End:**
- [ ] Service starts and loads model at startup
- [ ] Health endpoint shows model_loaded=true
- [ ] Single + team predictions return valid results
- [ ] POST /model/retrain completes successfully
- [ ] Phase 4 ETL still works (pipeline.py, quality report)
- [ ] `tests/verify_phase5.py` passes all checks

---

## Phase 5 Complete!

If all checklist items pass, Phase 5 is done. You've built:

- **XGBoost Classifier** — trained on 12 features (8 base + 4 derived) with AUC-ROC target ≥ 0.80
- **Prediction Module** — single and team predictions with risk scores, levels, and drivers
- **FastAPI API** — 7 endpoints (health, predict, predict/single, etl/run, etl/status, model/retrain, docs)
- **Pydantic Validation** — type-safe request/response models with field constraints
- **Model Management** — retrain endpoint that runs ETL + training + reload

**What's next: Phase 6 — LLM Integration + Report Generation + WebSocket + PDF**

This is where the ML predictions get transformed into executive-ready reports. The NestJS backend will:
1. Fetch team employees from the database
2. Call the AI service's `/predict` endpoint
3. Send analytics + predictions to Groq LLM for executive summary generation
4. Generate structured action plans
5. Store reports + risk snapshots
6. Export professional PDFs
