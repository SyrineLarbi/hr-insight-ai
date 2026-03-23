# Phase 4 - Step 3: Feature Engineering + Scaling

## Why Are We Doing This?

The raw 8 features capture individual metrics, but the most powerful attrition signals come from **combinations** of features. For example:

- An employee with 40 hours overtime AND 1.5 engagement score is more at risk than someone with 40 hours overtime AND 4.5 engagement — but the model can't learn this easily from raw features alone
- An employee who's been at the company 5 years with no promotion is more at risk than a new hire with no promotion — the raw `lastPromotionMonths` alone doesn't capture this

**Feature engineering** creates new columns that encode these relationships explicitly, making it easier for the model to learn the patterns.

**Scaling** (StandardScaler) normalizes all numeric values to have mean=0 and std=1. This is critical because:
- Salary ranges from 30K–200K
- Engagement ranges from 1–5
- Without scaling, salary would dominate the model simply because its numbers are bigger

---

## The 4 Derived Features

```
1. salary_per_tenure       = salary / max(tenureMonths, 1)
   → How fast is the employee's pay growing? Low = underpaid for their experience

2. engagement_performance  = engagementScore / max(performanceScore, 0.1)
   → Are they engaged relative to their output? Low = quiet quitting

3. overtime_absenteeism    = overtimeHours / max(absenteeismDays + 1, 1)
   → Are they burning out? High overtime + high absence = red flag

4. promotion_overdue       = lastPromotionMonths / max(tenureMonths, 1)
   → What fraction of their tenure has been without promotion? High = stagnating
```

---

## What We're Building

```
ai-service/
  app/
    etl/
      transform.py          ← feature engineering + StandardScaler + save artifacts
  app/
    artifacts/
      scaler.joblib          ← saved fitted scaler (used at prediction time)
      feature_names.joblib   ← saved list of feature names (column order matters)
  data/
    processed/
      hr_processed.csv       ← fully processed dataset ready for model training
  tests/
    verify_step3.py          ← verification script
```

---

## The Steps

### Step A: Create the transform module

Create `ai-service/app/etl/transform.py`:

```python
"""
ETL Step 3: Transform — Feature engineering, scaling, and artifact saving.

Creates 4 derived features, then scales all numeric features using StandardScaler.
The fitted scaler is saved to disk so the prediction service can apply
the exact same transformation to new employees at inference time.
"""

import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────
# Artifacts directory — where the scaler and feature names are saved
# ─────────────────────────────────────────────────────────────────────
ARTIFACTS_DIR = Path(__file__).parent.parent / "artifacts"

# The 8 original features used by the ML model
# (order matters — must match what the model was trained on)
BASE_FEATURES = [
    "salary",
    "tenureMonths",
    "engagementScore",
    "performanceScore",
    "absenteeismDays",
    "overtimeHours",
    "lastPromotionMonths",
    "trainingHours",
]

# The 4 derived features we engineer
DERIVED_FEATURES = [
    "salary_per_tenure",
    "engagement_performance",
    "overtime_absenteeism",
    "promotion_overdue",
]

# All features the model will see (base + derived)
ALL_FEATURES = BASE_FEATURES + DERIVED_FEATURES


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Create 4 derived features from the base 8.

    Each derived feature captures a relationship between two or more
    raw features that the model would otherwise have to learn implicitly.
    """
    df = df.copy()

    # 1. Salary growth rate — how well compensated relative to tenure
    #    Low values → underpaid for their experience
    df["salary_per_tenure"] = df["salary"] / df["tenureMonths"].clip(lower=1)

    # 2. Engagement-performance alignment
    #    Low values → doing the work but checked out (quiet quitting)
    #    High values → highly engaged but low output (might be frustrated)
    df["engagement_performance"] = (
        df["engagementScore"] / df["performanceScore"].clip(lower=0.1)
    )

    # 3. Overtime vs absenteeism ratio
    #    High overtime + high absenteeism = burnout signal
    #    The +1 prevents division by zero when absenteeism is 0
    df["overtime_absenteeism"] = (
        df["overtimeHours"] / (df["absenteeismDays"] + 1).clip(lower=1)
    )

    # 4. Promotion overdue ratio
    #    What fraction of their tenure has been without a promotion?
    #    Values close to 1.0 = never promoted (high stagnation risk)
    df["promotion_overdue"] = (
        df["lastPromotionMonths"] / df["tenureMonths"].clip(lower=1)
    )

    logger.info("  Created 4 derived features:")
    for feat in DERIVED_FEATURES:
        logger.info(f"    {feat}: mean={df[feat].mean():.2f}, std={df[feat].std():.2f}")

    return df


def scale_features(df: pd.DataFrame) -> tuple[pd.DataFrame, StandardScaler]:
    """
    Fit a StandardScaler on the feature columns and transform them.

    StandardScaler: for each column, subtract mean and divide by std deviation.
    Result: every column has mean ≈ 0 and std ≈ 1.

    Returns:
        - DataFrame with scaled features + original 'attrition' column
        - The fitted scaler (to be saved and reused at prediction time)
    """
    scaler = StandardScaler()

    # Only scale the feature columns, not the target variable
    feature_data = df[ALL_FEATURES]
    scaled_array = scaler.fit_transform(feature_data)

    # Rebuild DataFrame with same column names
    df_scaled = pd.DataFrame(scaled_array, columns=ALL_FEATURES, index=df.index)

    # Add back the target variable (unscaled — it's 0/1, not a feature)
    if "attrition" in df.columns:
        df_scaled["attrition"] = df["attrition"].values

    logger.info(f"  Scaled {len(ALL_FEATURES)} features using StandardScaler")
    logger.info(f"  Feature means (should be ~0): {scaled_array.mean(axis=0).round(6).tolist()[:4]}...")
    logger.info(f"  Feature stds  (should be ~1): {scaled_array.std(axis=0).round(4).tolist()[:4]}...")

    return df_scaled, scaler


def save_artifacts(scaler: StandardScaler) -> None:
    """
    Save the fitted scaler and feature names to disk.

    These are loaded by the prediction service to transform new employee
    data the EXACT same way as the training data. If the scaler is different,
    predictions are meaningless (model expects specific distributions).
    """
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    scaler_path = ARTIFACTS_DIR / "scaler.joblib"
    features_path = ARTIFACTS_DIR / "feature_names.joblib"

    joblib.dump(scaler, scaler_path)
    joblib.dump(ALL_FEATURES, features_path)

    logger.info(f"  Saved scaler to: {scaler_path}")
    logger.info(f"  Saved feature names to: {features_path}")


def transform(df: pd.DataFrame) -> pd.DataFrame:
    """
    Run the full transformation pipeline:
    1. Engineer 4 derived features
    2. Scale all 12 features with StandardScaler
    3. Save scaler + feature names to artifacts/

    Returns the scaled DataFrame.
    """
    logger.info("=" * 60)
    logger.info("TRANSFORM: Starting feature engineering + scaling")
    logger.info("=" * 60)

    logger.info("\nStep 1/3: Engineering derived features...")
    df = engineer_features(df)

    logger.info("\nStep 2/3: Scaling features (StandardScaler)...")
    df_scaled, scaler = scale_features(df)

    logger.info("\nStep 3/3: Saving artifacts...")
    save_artifacts(scaler)

    logger.info(f"\nTransform complete: {df_scaled.shape}")
    return df_scaled
```

**Why save the scaler with `joblib`?**

When a real employee's data comes in for prediction (Phase 5), we need to transform it the same way as the training data. If the training data had `mean(salary) = 85,000` and `std(salary) = 25,000`, then a new employee with salary `100,000` should be scaled as `(100,000 - 85,000) / 25,000 = 0.6`. Without the saved scaler, we'd compute different mean/std from the production data (only 60 rows) — giving completely wrong scaled values.

**Why `joblib` instead of `pickle`?**

`joblib` is optimized for NumPy arrays (which is what sklearn uses internally). It's faster and produces smaller files than pickle. It's also the recommended serialization format in the sklearn documentation.

---

### Step B: Run the transformation

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python -c "
import logging
logging.basicConfig(level=logging.INFO, format='%(message)s')
from app.etl.extract import extract
from app.etl.clean import clean
from app.etl.transform import transform

df = extract('data/raw/hr_training_data.csv')
df = clean(df)
df = transform(df)

df.to_csv('data/processed/hr_processed.csv', index=False)
print(f'\nSaved to data/processed/hr_processed.csv')
print(f'Shape: {df.shape}')
print(f'Columns: {list(df.columns)}')
"
```

Expected output should show 13 columns (8 base + 4 derived + 1 attrition) and feature means near 0.

---

## How to Verify It Worked

Run `ai-service/tests/verify_step3.py`:

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python tests/verify_step3.py
```

### Expected results:

| Check | Expected |
|-------|----------|
| `data/processed/hr_processed.csv` exists | ✅ |
| 13 columns (8 base + 4 derived + attrition) | ✅ |
| Feature means ≈ 0 (within ±0.01) | ✅ |
| Feature stds ≈ 1 (within 0.9–1.1) | ✅ |
| `artifacts/scaler.joblib` exists | ✅ |
| `artifacts/feature_names.joblib` exists | ✅ |
| Saved feature names list has 12 entries | ✅ |
| Scaler can inverse-transform correctly | ✅ |

---

## Checklist (confirm before Step 4)

- [ ] `app/etl/transform.py` created with `engineer_features`, `scale_features`, `save_artifacts`
- [ ] 4 derived features computed: salary_per_tenure, engagement_performance, overtime_absenteeism, promotion_overdue
- [ ] StandardScaler fitted on 12 features (8 base + 4 derived)
- [ ] Scaler saved to `app/artifacts/scaler.joblib`
- [ ] Feature names saved to `app/artifacts/feature_names.joblib`
- [ ] Processed CSV saved to `data/processed/hr_processed.csv`
- [ ] Feature means are approximately 0 after scaling
- [ ] `tests/verify_step3.py` passes all checks

---

Once confirmed, move to **Step 4: Validation + Pipeline Orchestration** — data quality report and the master pipeline script.
