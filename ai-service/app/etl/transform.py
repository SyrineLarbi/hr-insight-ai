"""
ETL Step 3: Transform — Feature engineering, scaling, and artifact saving.
"""

import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)

ARTIFACTS_DIR = Path(__file__).parent.parent / "artifacts"

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

DERIVED_FEATURES = [
    "salary_per_tenure",
    "engagement_performance",
    "overtime_absenteeism",
    "promotion_overdue",
]

ALL_FEATURES = BASE_FEATURES + DERIVED_FEATURES


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    df["salary_per_tenure"] = df["salary"] / df["tenureMonths"].clip(lower=1)

    df["engagement_performance"] = (
        df["engagementScore"] / df["performanceScore"].clip(lower=0.1)
    )

    df["overtime_absenteeism"] = (
        df["overtimeHours"] / (df["absenteeismDays"] + 1).clip(lower=1)
    )

    df["promotion_overdue"] = (
        df["lastPromotionMonths"] / df["tenureMonths"].clip(lower=1)
    )

    # Cap derived features with IQR x 1.5 — ratios can explode on edge inputs
    # (e.g. salary_per_tenure for a 1-month employee) which produces |z| > 5
    # after scaling and fails the extreme-outliers validation check.
    for feat in DERIVED_FEATURES:
        q1 = df[feat].quantile(0.25)
        q3 = df[feat].quantile(0.75)
        iqr = q3 - q1
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        df[feat] = df[feat].clip(lower=lower, upper=upper)

    logger.info("  Created 4 derived features (IQR-capped):")
    for feat in DERIVED_FEATURES:
        logger.info(f"    {feat}: mean={df[feat].mean():.2f}, std={df[feat].std():.2f}")

    return df


def scale_features(df: pd.DataFrame) -> tuple[pd.DataFrame, StandardScaler]:
    scaler = StandardScaler()

    feature_data = df[ALL_FEATURES]
    scaled_array = scaler.fit_transform(feature_data)

    df_scaled = pd.DataFrame(scaled_array, columns=ALL_FEATURES, index=df.index)

    if "attrition" in df.columns:
        df_scaled["attrition"] = df["attrition"].values

    logger.info(f"  Scaled {len(ALL_FEATURES)} features using StandardScaler")
    logger.info(f"  Feature means (should be ~0): {scaled_array.mean(axis=0).round(6).tolist()[:4]}...")
    logger.info(f"  Feature stds  (should be ~1): {scaled_array.std(axis=0).round(4).tolist()[:4]}...")

    return df_scaled, scaler


def save_artifacts(scaler: StandardScaler) -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    scaler_path = ARTIFACTS_DIR / "scaler.joblib"
    features_path = ARTIFACTS_DIR / "feature_names.joblib"

    joblib.dump(scaler, scaler_path)
    joblib.dump(ALL_FEATURES, features_path)

    logger.info(f"  Saved scaler to: {scaler_path}")
    logger.info(f"  Saved feature names to: {features_path}")


def transform(df: pd.DataFrame) -> pd.DataFrame:
    """Run the full transformation pipeline."""
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
