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

    mask = df["lastPromotionMonths"] > df["tenureMonths"]
    df.loc[mask, "lastPromotionMonths"] = df.loc[mask, "tenureMonths"]

    return df


def generate_attrition(df: pd.DataFrame) -> np.ndarray:
    """
    Generate attrition labels based on realistic correlations.
    """
    def norm(series: pd.Series) -> pd.Series:
        smin, smax = series.min(), series.max()
        if smax == smin:
            return pd.Series(np.zeros(len(series)))
        return (series - smin) / (smax - smin)

    risk_score = (
        0.30 * (1 - norm(df["engagementScore"]))
        + 0.25 * norm(df["overtimeHours"])
        + 0.20 * (1 - norm(df["salary"]))
        + 0.10 * norm(df["lastPromotionMonths"])
        + 0.05 * norm(df["absenteeismDays"])
        + 0.05 * (1 - norm(df["performanceScore"]))
        + 0.03 * (1 - norm(df["trainingHours"]))
        + 0.02 * (1 - norm(df["tenureMonths"]).clip(0.1, 0.9))
    )

    probability = 1 / (1 + np.exp(-14 * (risk_score - 0.52)))
    attrition = np.random.binomial(1, probability)

    return attrition


def main():
    print(f"Generating {NUM_EMPLOYEES} synthetic employee records...")

    df = generate_features(NUM_EMPLOYEES)
    df["attrition"] = generate_attrition(df)

    print(f"\nDataset shape: {df.shape}")
    print(f"Attrition rate: {df['attrition'].mean():.1%}")
    print(f"\nAttrition distribution:")
    print(df["attrition"].value_counts().to_string())
    print(f"\nFeature summary:")
    print(df.describe().round(2).to_string())

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "hr_training_data.csv"
    df.to_csv(output_path, index=False)
    print(f"\nSaved to: {output_path}")
    print(f"File size: {output_path.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
