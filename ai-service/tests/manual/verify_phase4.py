"""
Phase 4 Final Verification — Full ETL Pipeline End-to-End
Run: cd ai-service && source venv/bin/activate && python tests/verify_phase4.py
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

PASS = "✅ PASS"
FAIL = "❌ FAIL"

BASE_DIR = Path(__file__).parent.parent


def check(label: str, condition: bool, detail: str = ""):
    status = PASS if condition else FAIL
    msg = f"  {status}  {label}"
    if detail and not condition:
        msg += f" — {detail}"
    print(msg)
    return condition


def main():
    all_passed = True

    print("=" * 70)
    print("Phase 4 — Full ETL Pipeline Verification")
    print("=" * 70)

    # ══════════════════════════════════════════════════════════════════
    # Section 1: Module Imports
    # ══════════════════════════════════════════════════════════════════
    print("\n1. Module imports:")

    modules = {}
    for mod_name, import_path in [
        ("extract", "app.etl.extract"),
        ("clean", "app.etl.clean"),
        ("transform", "app.etl.transform"),
        ("validate", "app.etl.validate"),
        ("pipeline", "app.etl.pipeline"),
    ]:
        try:
            import logging
            logging.basicConfig(level=logging.WARNING)
            mod = __import__(import_path, fromlist=[mod_name])
            modules[mod_name] = mod
            all_passed &= check(f"{import_path} imports successfully", True)
        except Exception as e:
            all_passed &= check(f"{import_path} imports successfully", False, str(e))

    # ══════════════════════════════════════════════════════════════════
    # Section 2: File Existence
    # ══════════════════════════════════════════════════════════════════
    print("\n2. Output files:")

    files = {
        "raw CSV": BASE_DIR / "data" / "raw" / "hr_training_data.csv",
        "cleaned CSV": BASE_DIR / "data" / "cleaned" / "hr_cleaned.csv",
        "processed CSV": BASE_DIR / "data" / "processed" / "hr_processed.csv",
        "quality report": BASE_DIR / "data" / "processed" / "data_quality_report.json",
        "scaler artifact": BASE_DIR / "app" / "artifacts" / "scaler.joblib",
        "feature names artifact": BASE_DIR / "app" / "artifacts" / "feature_names.joblib",
    }

    for name, path in files.items():
        all_passed &= check(f"{name} exists", path.exists(), str(path))

    # Stop if essential files are missing
    essential = ["raw CSV", "cleaned CSV", "processed CSV"]
    if any(not files[f].exists() for f in essential):
        print("\n⛔ Essential files missing. Run the full pipeline first (see step4/step5 guide)")
        sys.exit(1)

    import joblib
    import pandas as pd

    # ══════════════════════════════════════════════════════════════════
    # Section 3: Raw Data Integrity
    # ══════════════════════════════════════════════════════════════════
    print("\n3. Raw data (Step 1):")
    df_raw = pd.read_csv(files["raw CSV"])

    all_passed &= check(f"Row count is 5000: {len(df_raw)}", len(df_raw) == 5000)
    all_passed &= check(f"Column count is 9: {len(df_raw.columns)}", len(df_raw.columns) == 9)

    expected_raw_cols = [
        "salary", "tenureMonths", "engagementScore", "performanceScore",
        "absenteeismDays", "overtimeHours", "lastPromotionMonths",
        "trainingHours", "attrition",
    ]
    for col in expected_raw_cols:
        all_passed &= check(f"  Column '{col}' in raw data", col in df_raw.columns)

    # Attrition distribution check
    attrition_rate_raw = df_raw["attrition"].mean() * 100
    all_passed &= check(
        f"  Raw attrition rate: {attrition_rate_raw:.1f}%",
        10 <= attrition_rate_raw <= 50,
        "Expected 10-50%",
    )

    # ══════════════════════════════════════════════════════════════════
    # Section 4: Cleaned Data Integrity
    # ══════════════════════════════════════════════════════════════════
    print("\n4. Cleaned data (Step 2):")
    df_cleaned = pd.read_csv(files["cleaned CSV"])

    all_passed &= check(f"Row count ≥ 4500: {len(df_cleaned)}", len(df_cleaned) >= 4500)
    all_passed &= check(f"Column count is 9: {len(df_cleaned.columns)}", len(df_cleaned.columns) == 9)

    # No nulls
    total_nulls = df_cleaned.isnull().sum().sum()
    all_passed &= check(f"No null values: {total_nulls}", total_nulls == 0)

    # No duplicates
    dup_count = df_cleaned.duplicated().sum()
    all_passed &= check(f"No duplicate rows: {dup_count}", dup_count == 0)

    # Score ranges
    all_passed &= check(
        "engagementScore in [1, 5]",
        df_cleaned["engagementScore"].between(1.0, 5.0).all(),
    )
    all_passed &= check(
        "performanceScore in [1, 5]",
        df_cleaned["performanceScore"].between(1.0, 5.0).all(),
    )

    # Non-negative
    for col in ["salary", "tenureMonths", "absenteeismDays", "overtimeHours",
                "lastPromotionMonths", "trainingHours"]:
        all_passed &= check(f"{col} ≥ 0", (df_cleaned[col] >= 0).all())

    # Consistency
    violations = (df_cleaned["lastPromotionMonths"] > df_cleaned["tenureMonths"]).sum()
    all_passed &= check(f"lastPromotionMonths ≤ tenureMonths: {violations} violations", violations == 0)

    # ══════════════════════════════════════════════════════════════════
    # Section 5: Processed Data Integrity
    # ══════════════════════════════════════════════════════════════════
    print("\n5. Processed data (Step 3):")
    df_proc = pd.read_csv(files["processed CSV"])

    all_passed &= check(f"Column count is 13: {len(df_proc.columns)}", len(df_proc.columns) == 13)

    # Row counts match between cleaned and processed
    all_passed &= check(
        f"Row count matches cleaned: {len(df_proc)} == {len(df_cleaned)}",
        len(df_proc) == len(df_cleaned),
        "Transform should not drop rows",
    )

    # Check derived features exist
    derived = ["salary_per_tenure", "engagement_performance", "overtime_absenteeism", "promotion_overdue"]
    for col in derived:
        all_passed &= check(f"Derived feature '{col}' present", col in df_proc.columns)

    # Scaling check
    all_features = [
        "salary", "tenureMonths", "engagementScore", "performanceScore",
        "absenteeismDays", "overtimeHours", "lastPromotionMonths", "trainingHours",
    ] + derived

    scaling_ok = True
    for col in all_features:
        if col not in df_proc.columns:
            continue
        col_mean = df_proc[col].mean()
        col_std = df_proc[col].std()
        if abs(col_mean) > 0.01 or not (0.9 < col_std < 1.1):
            scaling_ok = False
            break

    all_passed &= check(
        "All 12 features properly scaled (mean ≈ 0, std ≈ 1)",
        scaling_ok,
    )

    # Attrition not scaled
    if "attrition" in df_proc.columns:
        unique_vals = sorted(df_proc["attrition"].unique())
        all_passed &= check(
            f"Attrition is binary (not scaled): {unique_vals}",
            set(unique_vals).issubset({0, 1, 0.0, 1.0}),
        )

    # ══════════════════════════════════════════════════════════════════
    # Section 6: Artifacts
    # ══════════════════════════════════════════════════════════════════
    print("\n6. Artifacts:")

    if files["feature names artifact"].exists():
        feature_names = joblib.load(files["feature names artifact"])
        all_passed &= check(
            f"Feature names has 12 entries: {len(feature_names)}",
            len(feature_names) == 12,
        )
        all_passed &= check(
            "Feature names match expected order",
            feature_names == all_features,
        )

    if files["scaler artifact"].exists():
        from sklearn.preprocessing import StandardScaler

        scaler = joblib.load(files["scaler artifact"])
        all_passed &= check("Scaler is StandardScaler", isinstance(scaler, StandardScaler))
        all_passed &= check(
            f"Scaler fitted on 12 features: {scaler.n_features_in_}",
            scaler.n_features_in_ == 12,
        )

        # Inverse transform sanity check
        sample = df_proc[all_features].iloc[:1].values
        original = scaler.inverse_transform(sample)
        salary_orig = original[0][0]
        all_passed &= check(
            f"Inverse-transformed salary realistic: {salary_orig:.0f}",
            10_000 < salary_orig < 300_000,
        )

    # ══════════════════════════════════════════════════════════════════
    # Section 7: Quality Report
    # ══════════════════════════════════════════════════════════════════
    print("\n7. Quality report (Step 4):")

    if files["quality report"].exists():
        with open(files["quality report"]) as f:
            report = json.load(f)

        all_passed &= check(
            f"Report overall: passed={report.get('passed')}",
            report.get("passed") is True,
        )

        expected_checks = [
            "schema", "missing_values", "scaling",
            "target_balance", "row_drop_rate", "extreme_outliers",
        ]
        for check_name in expected_checks:
            check_data = report.get("checks", {}).get(check_name, {})
            all_passed &= check(
                f"  {check_name}: passed={check_data.get('passed')}",
                check_data.get("passed", False),
            )

        # Warnings (informational)
        warnings = report.get("warnings", [])
        if warnings:
            print(f"\n  Warnings ({len(warnings)}):")
            for w in warnings:
                print(f"    ⚠️  {w}")
    else:
        all_passed &= check("Quality report exists", False, str(files["quality report"]))

    # ══════════════════════════════════════════════════════════════════
    # Section 8: Data Flow Integrity
    # ══════════════════════════════════════════════════════════════════
    print("\n8. Data flow integrity:")

    drop_count = len(df_raw) - len(df_cleaned)
    drop_rate = (drop_count / len(df_raw)) * 100
    all_passed &= check(
        f"Row drop rate ≤ 20%: {drop_rate:.1f}% ({drop_count} rows)",
        drop_rate <= 20.0,
    )
    all_passed &= check(
        "Column flow: 9 → 9 → 13",
        len(df_raw.columns) == 9
        and len(df_cleaned.columns) == 9
        and len(df_proc.columns) == 13,
    )

    # No infinite values in processed data
    inf_count = 0
    for col in all_features:
        if col in df_proc.columns:
            inf_count += np.isinf(df_proc[col]).sum()
    all_passed &= check(f"No infinite values in processed data: {inf_count}", inf_count == 0)

    # ══════════════════════════════════════════════════════════════════
    # Section 9: Pipeline Module
    # ══════════════════════════════════════════════════════════════════
    print("\n9. Pipeline module:")
    if "pipeline" in modules:
        all_passed &= check(
            "run_pipeline function exists",
            hasattr(modules["pipeline"], "run_pipeline")
            and callable(modules["pipeline"].run_pipeline),
        )

    # ══════════════════════════════════════════════════════════════════
    # Summary
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 70)
    print("DATA FLOW SUMMARY:")
    print(f"  Raw:       {len(df_raw):>5} rows × {len(df_raw.columns):>2} columns")
    print(f"  Cleaned:   {len(df_cleaned):>5} rows × {len(df_cleaned.columns):>2} columns  ({drop_count} dropped)")
    print(f"  Processed: {len(df_proc):>5} rows × {len(df_proc.columns):>2} columns  (4 features added, scaled)")
    print(f"  Drop rate: {drop_rate:.1f}%")
    print("=" * 70)

    if all_passed:
        print("✅ ALL CHECKS PASSED — Phase 4 complete!")
        print("\nNext: Phase 5 — ML Model Training + AI Service")
    else:
        print("❌ SOME CHECKS FAILED — review issues above")
    print("=" * 70)

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
