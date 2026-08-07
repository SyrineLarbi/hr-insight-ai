"""
ETL Step 4a: Validate — Data quality checks after transformation.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

REPORT_DIR = Path(__file__).parent.parent.parent / "data" / "processed"

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
    """Run all validation checks on the processed DataFrame."""
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

    # Check 1: Schema validation
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
        logger.warning(f"  FAIL Missing columns: {missing_cols}")
    else:
        logger.info(f"  OK All {len(EXPECTED_COLUMNS)} expected columns present")

    if extra_cols:
        report["warnings"].append(f"Extra columns found: {extra_cols}")
        logger.warning(f"  WARN Extra columns: {extra_cols}")

    # Check 2: Missing / infinite values
    logger.info("\nCheck 2/6: Missing and infinite values...")
    null_counts = df.isnull().sum()
    total_nulls = null_counts.sum()

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
            logger.warning(f"  FAIL {total_nulls} null values found")
        if inf_counts:
            logger.warning(f"  FAIL Infinite values in: {inf_counts}")
    else:
        logger.info("  OK No null or infinite values")

    # Check 3: Scaling verification
    logger.info("\nCheck 3/6: Scaling verification (means ~ 0, stds ~ 1)...")
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
            logger.warning(f"  FAIL {issue}")
    else:
        logger.info(f"  OK All {len(EXPECTED_FEATURES)} features properly scaled")

    # Check 4: Target variable balance
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
                logger.warning(f"  WARN Low attrition rate: {attrition_pct}% (< 10%)")
            else:
                report["warnings"].append(
                    f"High attrition rate ({attrition_pct}%) — unusually high, verify data"
                )
                logger.warning(f"  WARN High attrition rate: {attrition_pct}% (> 50%)")
        else:
            logger.info(f"  OK Attrition rate: {attrition_pct}% (healthy range)")
    else:
        report["checks"]["target_balance"] = {
            "passed": False,
            "error": "attrition column not found",
        }
        report["passed"] = False

    # Check 5: Row drop rate
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
            logger.warning(f"  WARN {drop_rate}% of rows dropped ({drop_count} rows)")
        else:
            logger.info(f"  OK Drop rate: {drop_rate}% ({drop_count} rows dropped)")
    else:
        report["checks"]["row_drop_rate"] = {
            "passed": True,
            "note": "Raw row count not provided — skipping drop rate check",
        }
        logger.info("  SKIP (raw row count not provided)")

    # Check 6: Extreme outliers after scaling
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
            logger.warning(f"  WARN {col}: {count} values with |z| > 5")
    else:
        logger.info("  OK No extreme outliers (all |z| <= 5)")

    # Summary
    logger.info("\n" + "=" * 60)
    checks_passed = sum(1 for c in report["checks"].values() if c["passed"])
    checks_total = len(report["checks"])
    report["summary"] = f"{checks_passed}/{checks_total} checks passed"

    if report["passed"]:
        logger.info(f"VALIDATION PASSED: {checks_passed}/{checks_total} checks passed")
    else:
        logger.warning(f"VALIDATION FAILED: {checks_passed}/{checks_total} checks passed")

    if report["warnings"]:
        logger.info(f"{len(report['warnings'])} warnings:")
        for w in report["warnings"]:
            logger.info(f"   - {w}")

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
