# Phase 4 - Step 2: Data Cleaning

## Why Are We Doing This?

Raw data is messy. Even our synthetic data is clean (we generated it), but in a real production system, data comes from multiple HR tools with inconsistencies:

- Missing fields (employee left before filling out their engagement survey)
- Duplicates (same employee imported from two systems)
- Outliers (someone entered salary as 9999999 by mistake)
- Invalid ranges (engagement score of 7 on a 1–5 scale)
- Inconsistencies (promoted 30 months ago but only been at the company for 12 months)

If we feed dirty data to the ML model, it learns the noise, not the patterns. A single outlier salary of $10M can skew the entire model. Cleaning is not optional — it's the difference between a useful model and a useless one.

---

## The 5 Cleaning Steps

```
Raw CSV (5000 rows)
    │
    ▼
1. Remove duplicates         → exact row matches removed
    │
    ▼
2. Handle missing values     → median for numeric, mode for categorical
    │
    ▼
3. Cap outliers (IQR)        → values beyond 1.5×IQR capped to boundary
    │
    ▼
4. Type validation           → scores clipped to 1-5, non-negative constraints
    │
    ▼
5. Consistency checks        → lastPromotionMonths ≤ tenureMonths
    │
    ▼
Cleaned CSV saved to data/cleaned/
```

---

## What We're Building

```
ai-service/
  app/
    etl/
      clean.py             ← all 5 cleaning steps as a pipeline
  data/
    cleaned/
      hr_cleaned.csv       ← output (clean dataset, same columns)
  tests/
    verify_step2.py        ← verification script
```

---

## The Steps

### Step A: Create the clean module

Create `ai-service/app/etl/clean.py`:

```python
"""
ETL Step 2: Clean — Handle missing values, duplicates, outliers, and validation.

Each cleaning step logs what it changed so you can audit the pipeline.
The order matters: duplicates first (cheapest), then missing values,
then outliers (depends on clean distributions), then validation.
"""

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────
# Configuration — all thresholds in one place
# ─────────────────────────────────────────────────────────────────────

# Features that are scores on a 1–5 scale
SCORE_COLUMNS = ["engagementScore", "performanceScore"]

# Features that must be non-negative (zero is valid)
NON_NEGATIVE_COLUMNS = [
    "salary",
    "tenureMonths",
    "absenteeismDays",
    "overtimeHours",
    "lastPromotionMonths",
    "trainingHours",
]

# IQR multiplier for outlier detection (1.5 is standard, 3.0 is aggressive)
IQR_MULTIPLIER = 1.5


def remove_duplicates(df: pd.DataFrame) -> pd.DataFrame:
    """Step 1: Remove exact duplicate rows."""
    before = len(df)
    df = df.drop_duplicates()
    removed = before - len(df)
    if removed > 0:
        logger.info(f"  Removed {removed} duplicate rows ({removed / before:.1%})")
    else:
        logger.info("  No duplicate rows found")
    return df


def handle_missing_values(df: pd.DataFrame) -> pd.DataFrame:
    """
    Step 2: Fill missing values.

    Strategy:
    - Numeric columns → median (robust to outliers, unlike mean)
    - Categorical columns → mode (most common value)
    - 'attrition' column → drop the row (can't guess the label)
    """
    total_missing = df.isnull().sum().sum()
    if total_missing == 0:
        logger.info("  No missing values found")
        return df

    logger.info(f"  Total missing values: {total_missing}")

    # Drop rows where the target variable is missing (can't impute labels)
    if "attrition" in df.columns and df["attrition"].isnull().any():
        before = len(df)
        df = df.dropna(subset=["attrition"])
        logger.info(f"  Dropped {before - len(df)} rows with missing attrition label")

    # Numeric columns: fill with median
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    for col in numeric_cols:
        null_count = df[col].isnull().sum()
        if null_count > 0:
            median_val = df[col].median()
            df[col] = df[col].fillna(median_val)
            logger.info(f"  Filled {null_count} missing in '{col}' with median={median_val:.2f}")

    # Categorical columns: fill with mode
    cat_cols = df.select_dtypes(include=["object", "category"]).columns
    for col in cat_cols:
        null_count = df[col].isnull().sum()
        if null_count > 0:
            mode_val = df[col].mode()[0]
            df[col] = df[col].fillna(mode_val)
            logger.info(f"  Filled {null_count} missing in '{col}' with mode='{mode_val}'")

    return df


def cap_outliers(df: pd.DataFrame) -> pd.DataFrame:
    """
    Step 3: Cap outliers using the IQR (Interquartile Range) method.

    For each numeric column:
    - Q1 = 25th percentile, Q3 = 75th percentile
    - IQR = Q3 - Q1
    - Lower bound = Q1 - 1.5 × IQR
    - Upper bound = Q3 + 1.5 × IQR
    - Values below lower → set to lower
    - Values above upper → set to upper

    We CAP (clip) rather than REMOVE outliers because:
    - Removing rows loses information (other features are valid)
    - ML models handle edge values better than missing data
    - It preserves the dataset size for training
    """
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    # Don't cap the target variable
    numeric_cols = [c for c in numeric_cols if c != "attrition"]

    total_capped = 0
    for col in numeric_cols:
        q1 = df[col].quantile(0.25)
        q3 = df[col].quantile(0.75)
        iqr = q3 - q1
        lower = q1 - IQR_MULTIPLIER * iqr
        upper = q3 + IQR_MULTIPLIER * iqr

        outlier_count = ((df[col] < lower) | (df[col] > upper)).sum()
        if outlier_count > 0:
            df[col] = df[col].clip(lower=lower, upper=upper)
            logger.info(
                f"  Capped {outlier_count} outliers in '{col}' "
                f"(bounds: [{lower:.2f}, {upper:.2f}])"
            )
            total_capped += outlier_count

    if total_capped == 0:
        logger.info("  No outliers detected")
    else:
        logger.info(f"  Total outlier values capped: {total_capped}")

    return df


def validate_types(df: pd.DataFrame) -> pd.DataFrame:
    """
    Step 4: Enforce valid ranges on specific columns.

    - Scores must be between 1.0 and 5.0
    - Non-negative columns must be >= 0
    - Tenure must be >= 1 (at least 1 month)
    """
    # Clip scores to valid 1–5 range
    for col in SCORE_COLUMNS:
        if col in df.columns:
            violations = ((df[col] < 1.0) | (df[col] > 5.0)).sum()
            if violations > 0:
                df[col] = df[col].clip(lower=1.0, upper=5.0)
                logger.info(f"  Clipped {violations} out-of-range values in '{col}' to [1.0, 5.0]")

    # Ensure non-negative values
    for col in NON_NEGATIVE_COLUMNS:
        if col in df.columns:
            violations = (df[col] < 0).sum()
            if violations > 0:
                df[col] = df[col].clip(lower=0)
                logger.info(f"  Clipped {violations} negative values in '{col}' to 0")

    # Tenure must be at least 1 month
    if "tenureMonths" in df.columns:
        violations = (df["tenureMonths"] < 1).sum()
        if violations > 0:
            df.loc[df["tenureMonths"] < 1, "tenureMonths"] = 1
            logger.info(f"  Set {violations} tenureMonths < 1 to minimum of 1")

    return df


def check_consistency(df: pd.DataFrame) -> pd.DataFrame:
    """
    Step 5: Fix logical inconsistencies between columns.

    Rule: lastPromotionMonths cannot exceed tenureMonths.
    (You can't have been promoted 30 months ago if you've only been here 12 months.)
    """
    if "lastPromotionMonths" in df.columns and "tenureMonths" in df.columns:
        violations = (df["lastPromotionMonths"] > df["tenureMonths"]).sum()
        if violations > 0:
            mask = df["lastPromotionMonths"] > df["tenureMonths"]
            df.loc[mask, "lastPromotionMonths"] = df.loc[mask, "tenureMonths"]
            logger.info(
                f"  Fixed {violations} rows where lastPromotionMonths > tenureMonths"
            )
        else:
            logger.info("  No consistency violations found")

    return df


def clean(df: pd.DataFrame) -> pd.DataFrame:
    """
    Run the full cleaning pipeline.

    Returns a new cleaned DataFrame (does NOT modify the input).
    """
    logger.info("=" * 60)
    logger.info("CLEAN: Starting data cleaning pipeline")
    logger.info("=" * 60)
    original_shape = df.shape

    # Work on a copy so we don't mutate the original
    df = df.copy()

    logger.info(f"\nStep 1/5: Removing duplicates...")
    df = remove_duplicates(df)

    logger.info(f"\nStep 2/5: Handling missing values...")
    df = handle_missing_values(df)

    logger.info(f"\nStep 3/5: Capping outliers (IQR × {IQR_MULTIPLIER})...")
    df = cap_outliers(df)

    logger.info(f"\nStep 4/5: Validating types and ranges...")
    df = validate_types(df)

    logger.info(f"\nStep 5/5: Checking cross-column consistency...")
    df = check_consistency(df)

    logger.info(f"\nCleaning complete: {original_shape} → {df.shape}")
    return df
```

**Why median instead of mean for imputation?**

```
Dataset: [50K, 55K, 60K, 65K, 70K, 1000K]  ← one outlier salary

Mean:    216K  ← pulled up by the outlier — not representative
Median:  62.5K ← unaffected by the outlier — representative
```

In HR data, salary distributions are skewed (a few executives earn 10× the average). Median is resistant to these extremes.

**Why clip outliers instead of removing them?**

If you remove a row because its salary is an outlier, you lose the employee's engagement, performance, and tenure data — all of which might be perfectly valid. Clipping keeps the row but brings the extreme value to the boundary. The model still sees a "high salary" employee, just not an impossibly high one.

---

### Step B: Run the cleaning step

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python -c "
import logging
logging.basicConfig(level=logging.INFO, format='%(message)s')
from app.etl.extract import extract
from app.etl.clean import clean

df_raw = extract('data/raw/hr_training_data.csv')
df_clean = clean(df_raw)

# Save cleaned data
df_clean.to_csv('data/cleaned/hr_cleaned.csv', index=False)
print(f'\nSaved to data/cleaned/hr_cleaned.csv')
print(f'Rows: {len(df_clean)}, Columns: {len(df_clean.columns)}')
"
```

---

## How to Verify It Worked

Run `ai-service/tests/verify_step2.py`:

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python tests/verify_step2.py
```

### Expected results:

| Check | Expected |
|-------|----------|
| `data/cleaned/hr_cleaned.csv` exists | ✅ |
| No NaN values in cleaned data | ✅ |
| No duplicate rows | ✅ |
| Engagement scores between 1–5 | ✅ |
| Performance scores between 1–5 | ✅ |
| All non-negative columns ≥ 0 | ✅ |
| `lastPromotionMonths ≤ tenureMonths` everywhere | ✅ |
| Row count similar to original (minimal loss) | ✅ |

---

## Checklist (confirm before Step 3)

- [ ] `app/etl/clean.py` created with 5 cleaning steps
- [ ] Each step logs what it changed (number of duplicates, outliers, etc.)
- [ ] `clean()` returns a copy (doesn't mutate input DataFrame)
- [ ] Ran the clean pipeline — output saved to `data/cleaned/hr_cleaned.csv`
- [ ] `tests/verify_step2.py` passes all checks

---

Once confirmed, move to **Step 3: Feature Engineering + Scaling** — derive new features and normalize values for the ML model.
