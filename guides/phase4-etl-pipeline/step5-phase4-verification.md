# Phase 4 - Step 5: Final Verification — ETL Pipeline End-to-End

## Why Are We Doing This?

Steps 1–4 built the four ETL modules independently and then wired them into a pipeline. Step 5 proves the entire system works together:

1. **Synthetic training data** was generated correctly (5000 rows, realistic distributions, correlated attrition)
2. **Extract** loads the raw CSV and returns a clean DataFrame
3. **Clean** handles missing values, duplicates, outliers, score ranges, and consistency
4. **Transform** creates 4 derived features and scales all 12 with StandardScaler
5. **Validate** runs 6 quality checks and produces a JSON report
6. **Pipeline** orchestrates all 4 stages in sequence with logging and intermediate saves
7. **Artifacts** are saved correctly (scaler, feature names) for use in Phase 5 (model training)

If any of these fail, the ML model in Phase 5 would be trained on bad data — and bad data in = bad predictions out.

---

## The Complete ETL File Structure After Phase 4

```
ai-service/
  app/
    etl/
      extract.py           ← loads raw CSV → DataFrame
      clean.py             ← missing values, duplicates, outliers, validation
      transform.py         ← 4 derived features + StandardScaler
      validate.py          ← 6 quality checks + JSON report
      pipeline.py          ← orchestrates extract → clean → transform → validate
    artifacts/
      scaler.joblib        ← fitted StandardScaler (used at prediction time)
      feature_names.joblib ← ordered list of 12 feature names
  data/
    raw/
      hr_training_data.csv ← 5000 synthetic employee records + attrition label
    cleaned/
      hr_cleaned.csv       ← post-cleaning output (~4500–4900 rows)
    processed/
      hr_processed.csv     ← fully processed + scaled (ready for model training)
      data_quality_report.json ← validation report with 6 checks
  tests/
    verify_step1.py        ← training data + extract verification
    verify_step2.py        ← cleaning verification
    verify_step3.py        ← feature engineering + scaling verification
    verify_step4.py        ← validation + pipeline verification
    verify_phase4.py       ← THIS — full phase verification
```

---

## The Steps

### Step A: Run all individual verification scripts

Run each step's verify script to confirm they all pass independently:

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate

echo "=== Step 1: Training Data + Extract ==="
python tests/verify_step1.py

echo ""
echo "=== Step 2: Data Cleaning ==="
python tests/verify_step2.py

echo ""
echo "=== Step 3: Feature Engineering + Scaling ==="
python tests/verify_step3.py

echo ""
echo "=== Step 4: Validation + Pipeline ==="
python tests/verify_step4.py
```

All 4 scripts should show `✅ ALL CHECKS PASSED`.

---

### Step B: Run the full pipeline from scratch

Delete all outputs and re-run the pipeline to verify it produces everything from the raw data:

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate

# Remove previous outputs (keep raw data)
rm -f data/cleaned/hr_cleaned.csv
rm -f data/processed/hr_processed.csv
rm -f data/processed/data_quality_report.json
rm -f app/artifacts/scaler.joblib
rm -f app/artifacts/feature_names.joblib

# Run full pipeline
python -c "
import logging
logging.basicConfig(level=logging.INFO, format='%(message)s')
from app.etl.pipeline import run_pipeline

result = run_pipeline()

print()
print('Pipeline result:')
print(f'  Status: {result[\"status\"]}')
print(f'  Duration: {result[\"duration_seconds\"]}s')
print(f'  Stages:')
for stage, info in result['stages'].items():
    print(f'    {stage}: {info}')
print(f'  Quality: {result[\"quality_report\"][\"summary\"]}')
"
```

Expected output flow:
```
STAGE 1/4: EXTRACT    → ~5000 rows loaded
STAGE 2/4: CLEAN      → ~4500–4900 rows (some dropped)
STAGE 3/4: TRANSFORM  → 12 features + attrition, all scaled
STAGE 4/4: VALIDATE   → 6/6 checks passed

Pipeline result:
  Status: success
  Duration: ~1-3s
  Quality: 6/6 checks passed
```

---

### Step C: Verify all outputs exist

```bash
cd /home/syrine/hr-insight-ai/ai-service

echo "=== Data Files ==="
ls -la data/raw/hr_training_data.csv
ls -la data/cleaned/hr_cleaned.csv
ls -la data/processed/hr_processed.csv
ls -la data/processed/data_quality_report.json

echo ""
echo "=== Artifacts ==="
ls -la app/artifacts/scaler.joblib
ls -la app/artifacts/feature_names.joblib
```

All 6 files should exist.

---

### Step D: Inspect the quality report

```bash
cd /home/syrine/hr-insight-ai/ai-service
python -m json.tool data/processed/data_quality_report.json
```

Verify:
- `"passed": true`
- All 6 checks have `"passed": true`
- Attrition rate between 10% and 50%
- Row drop rate under 20%
- No missing values or infinite values
- No extreme outliers

---

### Step E: Verify data flow integrity

This checks that the row counts make sense across stages:

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python -c "
import pandas as pd

raw = pd.read_csv('data/raw/hr_training_data.csv')
cleaned = pd.read_csv('data/cleaned/hr_cleaned.csv')
processed = pd.read_csv('data/processed/hr_processed.csv')

print('Data flow:')
print(f'  Raw:       {len(raw):>5} rows × {len(raw.columns):>2} columns')
print(f'  Cleaned:   {len(cleaned):>5} rows × {len(cleaned.columns):>2} columns')
print(f'  Processed: {len(processed):>5} rows × {len(processed.columns):>2} columns')

drop_rate = (len(raw) - len(cleaned)) / len(raw) * 100
print(f'  Drop rate: {drop_rate:.1f}%')
print()

# Verify cleaned and processed have same number of rows
# (transform doesn't drop rows, only adds columns)
assert len(cleaned) == len(processed), f'Row mismatch: cleaned={len(cleaned)}, processed={len(processed)}'
print('✅ Cleaned and processed row counts match (transform preserves rows)')

# Verify column counts
assert len(raw.columns) == 9, f'Raw should have 9 columns, got {len(raw.columns)}'
assert len(cleaned.columns) == 9, f'Cleaned should have 9 columns, got {len(cleaned.columns)}'
assert len(processed.columns) == 13, f'Processed should have 13 columns, got {len(processed.columns)}'
print('✅ Column counts correct: 9 → 9 → 13')
"
```

---

### Step F: Run the full Phase 4 verification script

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python tests/verify_phase4.py
```

This runs all checks from Steps 1–4 plus additional cross-step validations.

---

## How to Verify It Worked

Run `ai-service/tests/verify_phase4.py`:

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python tests/verify_phase4.py
```

### Expected results:

| Check | Expected |
|-------|----------|
| All 4 ETL modules import successfully | ✅ |
| `pipeline.py` imports and `run_pipeline` is callable | ✅ |
| Raw data: 5000 rows, 9 columns | ✅ |
| Cleaned data: ≥ 4500 rows, 9 columns, no nulls | ✅ |
| Processed data: 13 columns, means ≈ 0, stds ≈ 1 | ✅ |
| Artifacts: scaler.joblib + feature_names.joblib exist | ✅ |
| Quality report: 6/6 checks passed | ✅ |
| Cleaned and processed row counts match | ✅ |
| Scaler inverse-transform produces realistic values | ✅ |
| Feature names list has exactly 12 entries | ✅ |

---

## Checklist — Phase 4 Complete

**Step 1 — Training Data + Extract:**
- [ ] `data/raw/hr_training_data.csv` exists (5000 rows, 9 columns)
- [ ] `app/etl/extract.py` loads CSV and returns DataFrame
- [ ] `tests/verify_step1.py` passes all checks

**Step 2 — Data Cleaning:**
- [ ] `app/etl/clean.py` handles nulls, duplicates, outliers, ranges, consistency
- [ ] `data/cleaned/hr_cleaned.csv` exists (≥ 4500 rows, no nulls, no duplicates)
- [ ] `tests/verify_step2.py` passes all checks

**Step 3 — Feature Engineering + Scaling:**
- [ ] `app/etl/transform.py` creates 4 derived features + scales with StandardScaler
- [ ] `data/processed/hr_processed.csv` exists (13 columns, means ≈ 0, stds ≈ 1)
- [ ] `app/artifacts/scaler.joblib` and `feature_names.joblib` saved
- [ ] `tests/verify_step3.py` passes all checks

**Step 4 — Validation + Pipeline:**
- [ ] `app/etl/validate.py` runs 6 quality checks
- [ ] `app/etl/pipeline.py` orchestrates all 4 stages
- [ ] `data/processed/data_quality_report.json` exists with `"passed": true`
- [ ] `tests/verify_step4.py` passes all checks

**End-to-End:**
- [ ] Full pipeline runs from scratch (delete outputs → re-run → all outputs regenerated)
- [ ] Cleaned and processed row counts match (transform doesn't drop rows)
- [ ] Column counts: raw=9, cleaned=9, processed=13
- [ ] `tests/verify_phase4.py` passes all checks

---

## Phase 4 Complete!

If all checklist items pass, Phase 4 is done. You've built:

- **Training Data Generator** — 5000 synthetic employees with realistic attrition correlations
- **Extract Module** — loads CSV into pandas DataFrame with logging
- **Clean Module** — 5-step cleaning pipeline (nulls, duplicates, outliers, ranges, consistency)
- **Transform Module** — 4 derived features + StandardScaler with artifact persistence
- **Validate Module** — 6 automated quality checks with JSON report
- **Pipeline Orchestrator** — single entry point that runs all stages with logging and intermediate saves

**What's next: Phase 5 — ML Model Training + AI Service**

This is where the processed data becomes a trained model. We'll train an XGBoost classifier, evaluate it (AUC-ROC > 0.80), save model artifacts, and build FastAPI endpoints for `/predict`, `/health`, and `/model/retrain`.
