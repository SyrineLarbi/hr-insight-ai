# Phase 4 - Step 1: Training Data Generation + Extract

## Why Are We Doing This?

Machine learning models learn from historical data. Our XGBoost model needs to see thousands of examples of employees — some who left (attrition = 1) and some who stayed (attrition = 0) — so it can learn the patterns that lead to turnover.

In a real company, this data comes from HR systems (Workday, BambooHR, etc.). Since we're building locally, we'll **generate realistic synthetic training data** with built-in correlations — for example, employees with high overtime AND low engagement are more likely to leave.

The `extract.py` module loads raw data and logs statistics. This is the first step in any ETL pipeline: **know what you have before you clean it**.

---

## How the Training Data Relates to the App

```
Training Data (CSV, 5000 rows)            Live App Data (Neon DB, 60 rows)
  ┌──────────────────────┐                   ┌──────────────────┐
  │ Same 8 features       │                   │ Same 8 features  │
  │ + attrition column    │                   │ NO attrition     │
  │ Used to TRAIN model   │                   │ Model PREDICTS   │
  └─────────┬────────────┘                   └────────┬─────────┘
            │                                          │
            ▼                                          ▼
     ETL → XGBoost.fit()                    API → XGBoost.predict()
     (offline, once)                        (real-time, per request)
```

The training CSV has the same 8 features as our `employees` table — plus one extra column: `attrition` (the ground truth). The model trains on 5,000 examples offline, then predicts on real employees in production.

---

## What We're Building

```
ai-service/
  scripts/
    generate_training_data.py     ← creates synthetic CSV with realistic correlations
  app/
    etl/
      __init__.py                 ← already exists
      extract.py                  ← loads CSV, logs statistics, returns DataFrame
  data/
    raw/
      hr_training_data.csv        ← generated output (5000 rows, 9 columns)
  tests/
    verify_step1.py               ← verification script for this step
```

---

## The Steps

### Step A: Create the scripts folder

```bash
mkdir -p /home/syrine/hr-insight-ai/ai-service/scripts
```

---

### Step B: Generate synthetic training data

This script creates 5,000 realistic employee records with **built-in correlations** between features and attrition. This isn't random noise — it's designed to mimic real HR patterns the model can learn.

Create `ai-service/scripts/generate_training_data.py`:

```python
"""
Generate synthetic HR training data with realistic attrition patterns.

Correlations baked in:
  - High overtime + low engagement → higher attrition
  - Low salary + long time since promotion → higher attrition
  - High training + high performance → lower attrition
  - Very short or very long tenure → higher attrition (U-shape)
"""

import pandas as pd
import numpy as np
from pathlib import Path

# Reproducible results — same seed always generates the same data
np.random.seed(42)

NUM_EMPLOYEES = 5000
OUTPUT_DIR = Path(__file__).parent.parent / "data" / "raw"


def generate_features(n: int) -> pd.DataFrame:
    """Generate the 8 employee features."""
    data = {
        "salary": np.random.lognormal(mean=11.0, sigma=0.4, size=n).round(2),
        "tenureMonths": np.random.gamma(shape=3, scale=12, size=n).astype(int).clip(1, 360),
        "engagementScore": np.random.normal(loc=3.2, scale=0.8, size=n).round(2).clip(1.0, 5.0),
        "performanceScore": np.random.normal(loc=3.5, scale=0.7, size=n).round(2).clip(1.0, 5.0),
        "absenteeismDays": np.random.poisson(lam=5, size=n).clip(0, 30),
        "overtimeHours": np.random.exponential(scale=5, size=n).round(1).clip(0, 40),
        "lastPromotionMonths": np.random.gamma(shape=2, scale=10, size=n).astype(int).clip(0, 120),
        "trainingHours": np.random.gamma(shape=3, scale=12, size=n).round(1).clip(0, 200),
    }

    df = pd.DataFrame(data)

    # Constraint: lastPromotionMonths cannot exceed tenureMonths
    mask = df["lastPromotionMonths"] > df["tenureMonths"]
    df.loc[mask, "lastPromotionMonths"] = df.loc[mask, "tenureMonths"]

    return df


def generate_attrition(df: pd.DataFrame) -> np.ndarray:
    """
    Generate attrition labels based on realistic correlations.

    The 'risk score' is a weighted sum of risk factors.
    We then apply a sigmoid to convert it to a probability,
    and sample from a Bernoulli distribution.
    """
    # Normalize features to 0-1 range for weighting
    def norm(series: pd.Series) -> pd.Series:
        smin, smax = series.min(), series.max()
        if smax == smin:
            return pd.Series(np.zeros(len(series)))
        return (series - smin) / (smax - smin)

    # Risk factors (higher = more likely to leave)
    risk_score = (
        0.25 * (1 - norm(df["salary"]))               # low salary → risk
        + 0.20 * (1 - norm(df["engagementScore"]))     # low engagement → risk
        + 0.15 * norm(df["overtimeHours"])              # high overtime → risk
        + 0.10 * norm(df["lastPromotionMonths"])        # long without promotion → risk
        + 0.10 * norm(df["absenteeismDays"])            # high absenteeism → risk
        + 0.10 * (1 - norm(df["performanceScore"]))     # low performance → risk
        + 0.05 * (1 - norm(df["trainingHours"]))        # low training → risk
        + 0.05 * (1 - norm(df["tenureMonths"]).clip(0.1, 0.9))  # U-shape tenure
    )

    # Sigmoid function: maps risk score to 0-1 probability
    # Shift center to ~0.5 risk_score and scale steepness
    probability = 1 / (1 + np.exp(-8 * (risk_score - 0.45)))

    # Sample attrition: each employee is a coin flip weighted by their probability
    attrition = np.random.binomial(1, probability)

    return attrition


def main():
    print(f"Generating {NUM_EMPLOYEES} synthetic employee records...")

    # Generate features
    df = generate_features(NUM_EMPLOYEES)

    # Generate correlated attrition labels
    df["attrition"] = generate_attrition(df)

    # Print summary
    print(f"\nDataset shape: {df.shape}")
    print(f"Attrition rate: {df['attrition'].mean():.1%}")
    print(f"\nAttrition distribution:")
    print(df["attrition"].value_counts().to_string())
    print(f"\nFeature summary:")
    print(df.describe().round(2).to_string())

    # Save to CSV
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "hr_training_data.csv"
    df.to_csv(output_path, index=False)
    print(f"\nSaved to: {output_path}")
    print(f"File size: {output_path.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
```

**Why these specific distributions?**

| Feature | Distribution | Reason |
|---------|-------------|--------|
| salary | Log-normal | Salaries are skewed right (few high earners, many average) |
| tenureMonths | Gamma | Right-skewed, most people have 1–5 years, few have 20+ |
| engagement/performance | Normal | Bell curve — most cluster around 3, some extremes |
| absenteeismDays | Poisson | Count data — most have 3–7 days, some outliers |
| overtimeHours | Exponential | Most work little OT, a tail works a lot |
| trainingHours | Gamma | Similar to tenure — most moderate, some power learners |

**Why bake in correlations?**

If attrition were random, the model couldn't learn anything useful. Real attrition has patterns — we're programming those patterns so the model can discover them. The weights (0.25 for salary, 0.20 for engagement, etc.) reflect real HR research on turnover drivers.

---

### Step C: Create the Extract module

Create `ai-service/app/etl/extract.py`:

```python
"""
ETL Step 1: Extract — Load raw data and log statistics.

This module is responsible for reading raw CSV data from disk
and performing initial sanity checks before any cleaning or transformation.
"""

import logging
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

# Expected columns in the training data
EXPECTED_COLUMNS = [
    "salary",
    "tenureMonths",
    "engagementScore",
    "performanceScore",
    "absenteeismDays",
    "overtimeHours",
    "lastPromotionMonths",
    "trainingHours",
    "attrition",
]


def extract(filepath: str | Path) -> pd.DataFrame:
    """
    Load a CSV file into a pandas DataFrame and log basic statistics.

    Args:
        filepath: Path to the CSV file.

    Returns:
        Raw DataFrame, unmodified.

    Raises:
        FileNotFoundError: If the file doesn't exist.
        ValueError: If expected columns are missing.
    """
    filepath = Path(filepath)
    if not filepath.exists():
        raise FileNotFoundError(f"Data file not found: {filepath}")

    logger.info("=" * 60)
    logger.info(f"EXTRACT: Loading data from {filepath}")
    logger.info("=" * 60)

    df = pd.read_csv(filepath)

    # Validate expected columns are present
    missing_cols = set(EXPECTED_COLUMNS) - set(df.columns)
    if missing_cols:
        raise ValueError(f"Missing expected columns: {missing_cols}")

    # Log summary statistics
    logger.info(f"Shape: {df.shape[0]} rows × {df.shape[1]} columns")
    logger.info(f"Columns: {list(df.columns)}")
    logger.info(f"Dtypes:\n{df.dtypes.to_string()}")
    logger.info(f"Missing values per column:\n{df.isnull().sum().to_string()}")
    logger.info(f"Attrition distribution:\n{df['attrition'].value_counts().to_string()}")
    logger.info(f"Memory usage: {df.memory_usage(deep=True).sum() / 1024:.1f} KB")

    return df
```

**Why validate columns?**

If someone swaps the training CSV for a different file, or a column is renamed, this catches it immediately instead of producing cryptic errors 5 steps later in the pipeline.

---

### Step D: Run the generate + extract scripts

**Generate the training data:**

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python scripts/generate_training_data.py
```

Expected output:
```
Generating 5000 synthetic employee records...

Dataset shape: (5000, 9)
Attrition rate: ~25-35%

Saved to: data/raw/hr_training_data.csv
```

**Test the extract module:**

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python -c "
import logging
logging.basicConfig(level=logging.INFO)
from app.etl.extract import extract
df = extract('data/raw/hr_training_data.csv')
print(f'\nSuccess! Loaded {len(df)} rows')
print(f'Columns: {list(df.columns)}')
print(f'Attrition rate: {df[\"attrition\"].mean():.1%}')
"
```

---

## How to Verify It Worked

Run `ai-service/tests/verify_step1.py`:

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python tests/verify_step1.py
```

### Expected results:

| Check | Expected |
|-------|----------|
| `data/raw/hr_training_data.csv` exists | ✅ |
| CSV has 5000 rows and 9 columns | ✅ |
| All 9 expected columns present | ✅ |
| Attrition rate between 20%–40% | ✅ (realistic class balance) |
| No NaN values in generated data | ✅ |
| Engagement/performance scores between 1–5 | ✅ |
| All numeric values non-negative | ✅ |

---

## Checklist (confirm before Step 2)

- [ ] `scripts/generate_training_data.py` created
- [ ] Ran `python scripts/generate_training_data.py` → CSV saved to `data/raw/`
- [ ] CSV has 5000 rows, 9 columns, ~25–35% attrition rate
- [ ] `app/etl/extract.py` created with column validation
- [ ] `extract()` loads CSV and logs stats without errors
- [ ] `tests/verify_step1.py` passes all checks

---

Once confirmed, move to **Step 2: Data Cleaning** — handle missing values, duplicates, outliers, type validation, and consistency checks.
