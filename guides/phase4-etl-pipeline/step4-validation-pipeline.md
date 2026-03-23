# Phase 4 - Step 4: Data Validation + Pipeline Orchestration

## Why Are We Doing This?

Steps 1–3 built individual ETL stages (extract, clean, transform). Step 4 ties them together and adds a critical missing piece: **data validation**.

### Why validation matters

Without validation, you don't know if the pipeline worked correctly. Did cleaning remove too many rows? Did feature engineering create `NaN` or `inf` values? Is the target variable balanced enough for training? A model trained on bad data produces bad predictions — and you won't know until it's too late.

The validation module produces a **data quality report** — a structured summary of what the data looks like after processing. This report is:
- Logged to the console during ETL runs (for debugging)
- Saved as JSON (for automated monitoring)
- The first thing you check when a model starts performing worse

### Why a pipeline orchestrator

Right now, running the full ETL requires this manual sequence:
```python
df = extract('data/raw/hr_training_data.csv')
df = clean(df)
df = transform(df)
# ...save to CSV...
```

The `pipeline.py` module wraps this into a single function call that:
1. Runs all steps in order
2. Logs row counts at each stage (so you see "5000 rows → 4832 rows → 4832 rows")
3. Runs validation and saves the quality report
4. Saves intermediate outputs (`data/cleaned/`, `data/processed/`)
5. Returns structured results for the FastAPI endpoint to expose

---

## The Validation Checks

```
1. Schema validation
   → Are all 12 feature columns + attrition present?
   → Are all columns numeric (no strings slipped through)?

2. Missing values
   → Any NaN or inf values after transformation?
   → Count per column (should all be 0)

3. Statistical checks
   → Feature means ≈ 0 after scaling (within ±0.01)?
   → Feature stds ≈ 1 after scaling (within 0.9–1.1)?

4. Target variable balance
   → What % of employees have attrition = 1?
   → Warn if < 10% or > 50% (class imbalance affects model training)

5. Row count health
   → How many rows survived cleaning?
   → Warn if > 20% of rows were dropped (possible data quality issue)

6. Value ranges
   → Any infinite values?
   → Any extreme outliers after scaling (|z| > 5)?
```

---

## What We're Building

```
ai-service/
  app/
    etl/
      validate.py      ← data quality checks + JSON report
      pipeline.py       ← orchestrates extract → clean → transform → validate
  data/
    processed/
      data_quality_report.json   ← saved validation report
  tests/
    verify_step4.py    ← verification script
```

---

## The Steps

### Step A: Create the validation module

Create `ai-service/app/etl/validate.py`:

```python
"""
ETL Step 4a: Validate — Data quality checks after transformation.

Runs a battery of checks on the processed DataFrame and produces
a structured quality report. This report serves as:
1. A debugging tool during ETL development
2. An automated health check for the training pipeline
3. Documentation of data characteristics for model evaluation
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Where to save the quality report
REPORT_DIR = Path(__file__).parent.parent.parent / "data" / "processed"

# The 12 features the model expects (8 base + 4 derived)
EXPECTED_FEATURES = [
    "salary", "tenureMonths", "engagementScore", "performanceScore",
    "absenteeismDays", "overtimeHours", "lastPromotionMonths", "trainingHours",
    "salary_per_tenure", "engagement_performance",
    "overtime_absenteeism", "promotion_overdue",
]

EXPECTED_COLUMNS = EXPECTED_FEATURES + ["attrition"]


def validate(
    df: pd.DataFrame,
    raw_row_count: int | None = None,
    cleaned_row_count: int | None = None,
) -> dict:
    """
    Run all validation checks on the processed DataFrame.

    Parameters:
        df: The fully processed (scaled) DataFrame
        raw_row_count: Original row count before cleaning (for drop rate calculation)
        cleaned_row_count: Row count after cleaning (before scaling)

    Returns:
        A dictionary containing the full quality report with pass/fail per check.
    """
    logger.info("=" * 60)
    logger.info("VALIDATE: Running data quality checks")
    logger.info("=" * 60)

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "row_count": len(df),
        "column_count": len(df.columns),
        "checks": {},
        "warnings": [],
        "passed": True,
    }

    # ── Check 1: Schema validation ─────────────────────────────────
    logger.info("\nCheck 1/6: Schema validation...")
    missing_cols = [col for col in EXPECTED_COLUMNS if col not in df.columns]
    extra_cols = [col for col in df.columns if col not in EXPECTED_COLUMNS]

    schema_ok = len(missing_cols) == 0
    report["checks"]["schema"] = {
        "passed": schema_ok,
        "expected_columns": len(EXPECTED_COLUMNS),
        "actual_columns": len(df.columns),
        "missing_columns": missing_cols,
        "extra_columns": extra_cols,
    }

    if not schema_ok:
        report["passed"] = False
        logger.warning(f"  ❌ Missing columns: {missing_cols}")
    else:
        logger.info(f"  ✅ All {len(EXPECTED_COLUMNS)} expected columns present")

    if extra_cols:
        report["warnings"].append(f"Extra columns found: {extra_cols}")
        logger.warning(f"  ⚠️  Extra columns: {extra_cols}")

    # ── Check 2: Missing / infinite values ─────────────────────────
    logger.info("\nCheck 2/6: Missing and infinite values...")
    null_counts = df.isnull().sum()
    total_nulls = null_counts.sum()

    # Check for inf values in numeric columns
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    inf_counts = {}
    for col in numeric_cols:
        n_inf = np.isinf(df[col]).sum()
        if n_inf > 0:
            inf_counts[col] = int(n_inf)

    missing_ok = total_nulls == 0 and len(inf_counts) == 0
    report["checks"]["missing_values"] = {
        "passed": missing_ok,
        "total_nulls": int(total_nulls),
        "null_per_column": {col: int(v) for col, v in null_counts.items() if v > 0},
        "infinite_values": inf_counts,
    }

    if not missing_ok:
        report["passed"] = False
        if total_nulls > 0:
            logger.warning(f"  ❌ {total_nulls} null values found")
        if inf_counts:
            logger.warning(f"  ❌ Infinite values in: {inf_counts}")
    else:
        logger.info("  ✅ No null or infinite values")

    # ── Check 3: Scaling verification ──────────────────────────────
    logger.info("\nCheck 3/6: Scaling verification (means ≈ 0, stds ≈ 1)...")
    scaling_issues = []
    scaling_stats = {}

    for col in EXPECTED_FEATURES:
        if col not in df.columns:
            continue
        col_mean = float(df[col].mean())
        col_std = float(df[col].std())
        scaling_stats[col] = {"mean": round(col_mean, 6), "std": round(col_std, 4)}

        if abs(col_mean) > 0.01:
            scaling_issues.append(f"{col}: mean={col_mean:.6f} (expected ~0)")
        if not (0.9 < col_std < 1.1):
            scaling_issues.append(f"{col}: std={col_std:.4f} (expected ~1)")

    scaling_ok = len(scaling_issues) == 0
    report["checks"]["scaling"] = {
        "passed": scaling_ok,
        "stats": scaling_stats,
        "issues": scaling_issues,
    }

    if not scaling_ok:
        report["passed"] = False
        for issue in scaling_issues:
            logger.warning(f"  ❌ {issue}")
    else:
        logger.info(f"  ✅ All {len(EXPECTED_FEATURES)} features properly scaled")

    # ── Check 4: Target variable balance ───────────────────────────
    logger.info("\nCheck 4/6: Target variable balance...")
    if "attrition" in df.columns:
        attrition_rate = float(df["attrition"].mean())
        attrition_pct = round(attrition_rate * 100, 2)

        balance_ok = 0.10 <= attrition_rate <= 0.50
        report["checks"]["target_balance"] = {
            "passed": balance_ok,
            "attrition_rate": attrition_pct,
            "class_0_count": int((df["attrition"] == 0).sum()),
            "class_1_count": int((df["attrition"] == 1).sum()),
        }

        if not balance_ok:
            if attrition_rate < 0.10:
                report["warnings"].append(
                    f"Low attrition rate ({attrition_pct}%) — model may struggle with minority class"
                )
                logger.warning(f"  ⚠️  Low attrition rate: {attrition_pct}% (< 10%)")
            else:
                report["warnings"].append(
                    f"High attrition rate ({attrition_pct}%) — unusually high, verify data"
                )
                logger.warning(f"  ⚠️  High attrition rate: {attrition_pct}% (> 50%)")
        else:
            logger.info(f"  ✅ Attrition rate: {attrition_pct}% (healthy range)")
    else:
        report["checks"]["target_balance"] = {
            "passed": False,
            "error": "attrition column not found",
        }
        report["passed"] = False

    # ── Check 5: Row drop rate ─────────────────────────────────────
    logger.info("\nCheck 5/6: Row drop rate...")
    if raw_row_count is not None:
        drop_count = raw_row_count - len(df)
        drop_rate = round((drop_count / raw_row_count) * 100, 2)
        drop_ok = drop_rate <= 20.0

        report["checks"]["row_drop_rate"] = {
            "passed": drop_ok,
            "raw_rows": raw_row_count,
            "cleaned_rows": cleaned_row_count or len(df),
            "final_rows": len(df),
            "rows_dropped": drop_count,
            "drop_rate_pct": drop_rate,
        }

        if not drop_ok:
            report["warnings"].append(
                f"High row drop rate: {drop_rate}% ({drop_count} rows dropped)"
            )
            logger.warning(f"  ⚠️  {drop_rate}% of rows dropped ({drop_count} rows)")
        else:
            logger.info(f"  ✅ Drop rate: {drop_rate}% ({drop_count} rows dropped)")
    else:
        report["checks"]["row_drop_rate"] = {
            "passed": True,
            "note": "Raw row count not provided — skipping drop rate check",
        }
        logger.info("  ⏭️  Skipped (raw row count not provided)")

    # ── Check 6: Extreme outliers after scaling ────────────────────
    logger.info("\nCheck 6/6: Extreme outliers (|z| > 5 after scaling)...")
    outlier_counts = {}
    for col in EXPECTED_FEATURES:
        if col not in df.columns:
            continue
        extreme = (df[col].abs() > 5).sum()
        if extreme > 0:
            outlier_counts[col] = int(extreme)

    outlier_ok = len(outlier_counts) == 0
    report["checks"]["extreme_outliers"] = {
        "passed": outlier_ok,
        "columns_with_outliers": outlier_counts,
    }

    if not outlier_ok:
        total_outliers = sum(outlier_counts.values())
        report["warnings"].append(
            f"Extreme outliers found (|z| > 5): {total_outliers} values in {len(outlier_counts)} columns"
        )
        for col, count in outlier_counts.items():
            logger.warning(f"  ⚠️  {col}: {count} values with |z| > 5")
    else:
        logger.info("  ✅ No extreme outliers (all |z| ≤ 5)")

    # ── Summary ────────────────────────────────────────────────────
    logger.info("\n" + "=" * 60)
    checks_passed = sum(1 for c in report["checks"].values() if c["passed"])
    checks_total = len(report["checks"])
    report["summary"] = f"{checks_passed}/{checks_total} checks passed"

    if report["passed"]:
        logger.info(f"✅ VALIDATION PASSED: {checks_passed}/{checks_total} checks passed")
    else:
        logger.warning(f"❌ VALIDATION FAILED: {checks_passed}/{checks_total} checks passed")

    if report["warnings"]:
        logger.info(f"⚠️  {len(report['warnings'])} warnings:")
        for w in report["warnings"]:
            logger.info(f"   • {w}")

    logger.info("=" * 60)

    return report


def save_report(report: dict) -> Path:
    """Save the validation report as JSON."""
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "data_quality_report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    logger.info(f"  Saved quality report to: {report_path}")
    return report_path
```

**Why separate `validate()` from `save_report()`?**

`validate()` returns a dictionary — this lets the FastAPI endpoint call it and return the report as JSON directly (for the `GET /etl/status` endpoint). `save_report()` persists it to disk for offline review. Separating them follows the single-responsibility principle and makes both independently testable.

**Why warn on class imbalance instead of failing?**

A 16% attrition rate is typical for HR data. If only 5% of employees leave, the model will learn to always predict "stays" and still get 95% accuracy — but it will miss all the actual departures. We warn so you can consider techniques like SMOTE or class weighting during training.

---

### Step B: Create the pipeline orchestrator

Create `ai-service/app/etl/pipeline.py`:

```python
"""
ETL Pipeline Orchestrator — runs the full ETL flow in sequence.

This is the single entry point for both:
1. Initial training pipeline: CSV → clean → transform → validate → save
2. FastAPI endpoint: POST /etl/run triggers this same pipeline

Each stage logs its row count so you can trace data flow:
  "Loaded 5000 rows → Cleaned 4832 rows → Transformed 4832 rows (12 features) → Validated ✅"
"""

import logging
import time
from pathlib import Path

import pandas as pd

from app.etl.extract import extract
from app.etl.clean import clean
from app.etl.transform import transform
from app.etl.validate import save_report, validate

logger = logging.getLogger(__name__)

# Default paths
RAW_DATA_PATH = Path(__file__).parent.parent.parent / "data" / "raw" / "hr_training_data.csv"
CLEANED_DIR = Path(__file__).parent.parent.parent / "data" / "cleaned"
PROCESSED_DIR = Path(__file__).parent.parent.parent / "data" / "processed"


def run_pipeline(
    source_path: str | Path | None = None,
    save_intermediates: bool = True,
) -> dict:
    """
    Execute the full ETL pipeline: extract → clean → transform → validate.

    Parameters:
        source_path: Path to the raw CSV. Defaults to data/raw/hr_training_data.csv.
        save_intermediates: If True, saves cleaned and processed CSVs to disk.

    Returns:
        A dictionary with pipeline results:
        {
            "status": "success" | "failed",
            "duration_seconds": float,
            "stages": { stage_name: { rows, columns, duration } },
            "quality_report": { ... validation results ... },
            "output_path": str,
        }
    """
    start_time = time.time()
    source = Path(source_path) if source_path else RAW_DATA_PATH

    logger.info("=" * 70)
    logger.info("ETL PIPELINE: Starting full run")
    logger.info(f"  Source: {source}")
    logger.info("=" * 70)

    result = {
        "status": "running",
        "source": str(source),
        "stages": {},
    }

    try:
        # ── Stage 1: Extract ───────────────────────────────────────
        logger.info("\n📥 STAGE 1/4: EXTRACT")
        t0 = time.time()
        df_raw = extract(str(source))
        raw_rows = len(df_raw)
        result["stages"]["extract"] = {
            "rows": raw_rows,
            "columns": len(df_raw.columns),
            "duration_seconds": round(time.time() - t0, 3),
        }
        logger.info(f"  → {raw_rows} rows, {len(df_raw.columns)} columns")

        # ── Stage 2: Clean ─────────────────────────────────────────
        logger.info("\n🧹 STAGE 2/4: CLEAN")
        t0 = time.time()
        df_cleaned = clean(df_raw)
        cleaned_rows = len(df_cleaned)
        result["stages"]["clean"] = {
            "rows": cleaned_rows,
            "columns": len(df_cleaned.columns),
            "rows_dropped": raw_rows - cleaned_rows,
            "duration_seconds": round(time.time() - t0, 3),
        }
        logger.info(f"  → {cleaned_rows} rows ({raw_rows - cleaned_rows} dropped)")

        if save_intermediates:
            CLEANED_DIR.mkdir(parents=True, exist_ok=True)
            cleaned_path = CLEANED_DIR / "hr_cleaned.csv"
            df_cleaned.to_csv(cleaned_path, index=False)
            logger.info(f"  → Saved to {cleaned_path}")

        # ── Stage 3: Transform ─────────────────────────────────────
        logger.info("\n⚙️  STAGE 3/4: TRANSFORM")
        t0 = time.time()
        df_transformed = transform(df_cleaned)
        result["stages"]["transform"] = {
            "rows": len(df_transformed),
            "columns": len(df_transformed.columns),
            "duration_seconds": round(time.time() - t0, 3),
        }
        logger.info(f"  → {len(df_transformed)} rows, {len(df_transformed.columns)} columns")

        if save_intermediates:
            PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
            processed_path = PROCESSED_DIR / "hr_processed.csv"
            df_transformed.to_csv(processed_path, index=False)
            logger.info(f"  → Saved to {processed_path}")

        # ── Stage 4: Validate ──────────────────────────────────────
        logger.info("\n🔍 STAGE 4/4: VALIDATE")
        t0 = time.time()
        quality_report = validate(
            df_transformed,
            raw_row_count=raw_rows,
            cleaned_row_count=cleaned_rows,
        )
        result["stages"]["validate"] = {
            "duration_seconds": round(time.time() - t0, 3),
            "checks_passed": quality_report["summary"],
        }

        if save_intermediates:
            save_report(quality_report)

        # ── Done ───────────────────────────────────────────────────
        total_duration = round(time.time() - start_time, 3)
        result["status"] = "success" if quality_report["passed"] else "completed_with_warnings"
        result["duration_seconds"] = total_duration
        result["quality_report"] = quality_report
        result["output_path"] = str(PROCESSED_DIR / "hr_processed.csv")

        logger.info("\n" + "=" * 70)
        logger.info(f"ETL PIPELINE COMPLETE in {total_duration}s")
        logger.info(f"  Raw: {raw_rows} → Cleaned: {cleaned_rows} → Final: {len(df_transformed)} rows")
        logger.info(f"  Features: {len(df_transformed.columns) - 1} + 1 target")
        logger.info(f"  Status: {result['status']}")
        logger.info("=" * 70)

        return result

    except Exception as e:
        total_duration = round(time.time() - start_time, 3)
        result["status"] = "failed"
        result["duration_seconds"] = total_duration
        result["error"] = str(e)
        logger.error(f"\n❌ PIPELINE FAILED after {total_duration}s: {e}")
        raise
```

**Why `save_intermediates=True` as default?**

During development and initial training, you want to inspect the output at each stage. But when the FastAPI endpoint runs the pipeline for retraining, it might skip saving intermediates (just needs the final DataFrame + model). The flag makes this flexible.

**Why `run_pipeline` returns a dictionary?**

The FastAPI endpoint (`POST /etl/run`) will return this dictionary as JSON directly. The frontend or admin can see:
- How many rows survived each stage
- How long each stage took
- Whether validation passed
- Any warnings (class imbalance, high drop rate, etc.)

---

### Step C: Run the full pipeline

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python -c "
import logging
logging.basicConfig(level=logging.INFO, format='%(message)s')
from app.etl.pipeline import run_pipeline

result = run_pipeline()
print(f'\nFinal status: {result[\"status\"]}')
print(f'Duration: {result[\"duration_seconds\"]}s')
for stage, info in result['stages'].items():
    print(f'  {stage}: {info}')
"
```

Expected output should show all 4 stages completing with row counts and validation passing.

---

### Step D: Verify the quality report

```bash
cd /home/syrine/hr-insight-ai/ai-service
cat data/processed/data_quality_report.json | python -m json.tool
```

You should see a structured JSON with:
- `"passed": true`
- All 6 checks with `"passed": true`
- Attrition rate between 10% and 50%
- Drop rate under 20%
- No extreme outliers

---

## How to Verify It Worked

Run `ai-service/tests/verify_step4.py`:

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python tests/verify_step4.py
```

### Expected results:

| Check | Expected |
|-------|----------|
| `validate.py` imports successfully | ✅ |
| `pipeline.py` imports successfully | ✅ |
| `data/processed/data_quality_report.json` exists | ✅ |
| Quality report has all 6 checks | ✅ |
| All 6 checks passed | ✅ |
| Quality report `"passed": true` | ✅ |
| Pipeline returns structured result with all 4 stages | ✅ |
| Pipeline status is "success" | ✅ |
| `data/cleaned/hr_cleaned.csv` exists (intermediate) | ✅ |
| `data/processed/hr_processed.csv` exists (final) | ✅ |

---

## Checklist (confirm before Step 5)

- [ ] `app/etl/validate.py` created with 6 validation checks
- [ ] `app/etl/pipeline.py` created with `run_pipeline()` orchestrator
- [ ] Pipeline runs all 4 stages: extract → clean → transform → validate
- [ ] Quality report saved to `data/processed/data_quality_report.json`
- [ ] Report shows `"passed": true` and all checks green
- [ ] Intermediate outputs saved: `data/cleaned/hr_cleaned.csv`, `data/processed/hr_processed.csv`
- [ ] Artifacts saved: `app/artifacts/scaler.joblib`, `app/artifacts/feature_names.joblib`
- [ ] `tests/verify_step4.py` passes all checks

---

Once confirmed, move to **Step 5: Phase 4 Final Verification** — full end-to-end ETL pipeline validation.
