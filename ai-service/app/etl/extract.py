"""
ETL Step 1: Extract — Load raw data and log statistics.
"""

import logging
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

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
    """Load a CSV file into a pandas DataFrame and log basic statistics."""
    filepath = Path(filepath)
    if not filepath.exists():
        raise FileNotFoundError(f"Data file not found: {filepath}")

    logger.info("=" * 60)
    logger.info(f"EXTRACT: Loading data from {filepath}")
    logger.info("=" * 60)

    df = pd.read_csv(filepath)

    missing_cols = set(EXPECTED_COLUMNS) - set(df.columns)
    if missing_cols:
        raise ValueError(f"Missing expected columns: {missing_cols}")

    logger.info(f"Shape: {df.shape[0]} rows x {df.shape[1]} columns")
    logger.info(f"Columns: {list(df.columns)}")
    logger.info(f"Dtypes:\n{df.dtypes.to_string()}")
    logger.info(f"Missing values per column:\n{df.isnull().sum().to_string()}")
    logger.info(f"Attrition distribution:\n{df['attrition'].value_counts().to_string()}")
    logger.info(f"Memory usage: {df.memory_usage(deep=True).sum() / 1024:.1f} KB")

    return df
