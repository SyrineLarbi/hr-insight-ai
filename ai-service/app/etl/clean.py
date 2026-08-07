"""
ETL Step 2: Clean — Handle missing values, duplicates, outliers, and validation.
"""

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

SCORE_COLUMNS = ["engagementScore", "performanceScore"]

NON_NEGATIVE_COLUMNS = [
    "salary",
    "tenureMonths",
    "absenteeismDays",
    "overtimeHours",
    "lastPromotionMonths",
    "trainingHours",
]

IQR_MULTIPLIER = 1.5


def remove_duplicates(df: pd.DataFrame) -> pd.DataFrame:
    before = len(df)
    df = df.drop_duplicates()
    removed = before - len(df)
    if removed > 0:
        logger.info(f"  Removed {removed} duplicate rows ({removed / before:.1%})")
    else:
        logger.info("  No duplicate rows found")
    return df


def handle_missing_values(df: pd.DataFrame) -> pd.DataFrame:
    total_missing = df.isnull().sum().sum()
    if total_missing == 0:
        logger.info("  No missing values found")
        return df

    logger.info(f"  Total missing values: {total_missing}")

    if "attrition" in df.columns and df["attrition"].isnull().any():
        before = len(df)
        df = df.dropna(subset=["attrition"])
        logger.info(f"  Dropped {before - len(df)} rows with missing attrition label")

    numeric_cols = df.select_dtypes(include=[np.number]).columns
    for col in numeric_cols:
        null_count = df[col].isnull().sum()
        if null_count > 0:
            median_val = df[col].median()
            df[col] = df[col].fillna(median_val)
            logger.info(f"  Filled {null_count} missing in '{col}' with median={median_val:.2f}")

    cat_cols = df.select_dtypes(include=["object", "category"]).columns
    for col in cat_cols:
        null_count = df[col].isnull().sum()
        if null_count > 0:
            mode_val = df[col].mode()[0]
            df[col] = df[col].fillna(mode_val)
            logger.info(f"  Filled {null_count} missing in '{col}' with mode='{mode_val}'")

    return df


def cap_outliers(df: pd.DataFrame) -> pd.DataFrame:
    numeric_cols = df.select_dtypes(include=[np.number]).columns
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
    for col in SCORE_COLUMNS:
        if col in df.columns:
            violations = ((df[col] < 1.0) | (df[col] > 5.0)).sum()
            if violations > 0:
                df[col] = df[col].clip(lower=1.0, upper=5.0)
                logger.info(f"  Clipped {violations} out-of-range values in '{col}' to [1.0, 5.0]")

    for col in NON_NEGATIVE_COLUMNS:
        if col in df.columns:
            violations = (df[col] < 0).sum()
            if violations > 0:
                df[col] = df[col].clip(lower=0)
                logger.info(f"  Clipped {violations} negative values in '{col}' to 0")

    if "tenureMonths" in df.columns:
        violations = (df["tenureMonths"] < 1).sum()
        if violations > 0:
            df.loc[df["tenureMonths"] < 1, "tenureMonths"] = 1
            logger.info(f"  Set {violations} tenureMonths < 1 to minimum of 1")

    return df


def check_consistency(df: pd.DataFrame) -> pd.DataFrame:
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
    """Run the full cleaning pipeline."""
    logger.info("=" * 60)
    logger.info("CLEAN: Starting data cleaning pipeline")
    logger.info("=" * 60)
    original_shape = df.shape

    df = df.copy()

    logger.info(f"\nStep 1/5: Removing duplicates...")
    df = remove_duplicates(df)

    logger.info(f"\nStep 2/5: Handling missing values...")
    df = handle_missing_values(df)

    logger.info(f"\nStep 3/5: Capping outliers (IQR x {IQR_MULTIPLIER})...")
    df = cap_outliers(df)

    logger.info(f"\nStep 4/5: Validating types and ranges...")
    df = validate_types(df)

    logger.info(f"\nStep 5/5: Checking cross-column consistency...")
    df = check_consistency(df)

    logger.info(f"\nCleaning complete: {original_shape} -> {df.shape}")
    return df
