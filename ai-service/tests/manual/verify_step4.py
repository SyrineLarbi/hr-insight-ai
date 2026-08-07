"""
Phase 4 Step 4 Verification — Validation + Pipeline Orchestration
Run: cd ai-service && source venv/bin/activate && python tests/verify_step4.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

PASS = "✅ PASS"
FAIL = "❌ FAIL"


def check(label: str, condition: bool, detail: str = ""):
    status = PASS if condition else FAIL
    msg = f"  {status}  {label}"
    if detail and not condition:
        msg += f" — {detail}"
    print(msg)
    return condition


def main():
    all_passed = True

    base_dir = Path(__file__).parent.parent
    report_path = base_dir / "data" / "processed" / "data_quality_report.json"
    cleaned_path = base_dir / "data" / "cleaned" / "hr_cleaned.csv"
    processed_path = base_dir / "data" / "processed" / "hr_processed.csv"
    scaler_path = base_dir / "app" / "artifacts" / "scaler.joblib"
    features_path = base_dir / "app" / "artifacts" / "feature_names.joblib"

    print("=" * 60)
    print("Phase 4 Step 4 — Verification")
    print("=" * 60)

    # ── 1. Module imports ──────────────────────────────────────────
    print("\n1. Module imports:")
    try:
        from app.etl.validate import validate, save_report, EXPECTED_FEATURES, EXPECTED_COLUMNS
        all_passed &= check("validate module imports successfully", True)
    except Exception as e:
        all_passed &= check("validate module imports successfully", False, str(e))

    try:
        from app.etl.pipeline import run_pipeline, RAW_DATA_PATH
        all_passed &= check("pipeline module imports successfully", True)
    except Exception as e:
        all_passed &= check("pipeline module imports successfully", False, str(e))

    # ── 2. File existence ──────────────────────────────────────────
    print("\n2. File existence:")
    all_passed &= check("Quality report JSON exists", report_path.exists(), str(report_path))
    all_passed &= check("Cleaned CSV exists (intermediate)", cleaned_path.exists(), str(cleaned_path))
    all_passed &= check("Processed CSV exists (final)", processed_path.exists(), str(processed_path))
    all_passed &= check("scaler.joblib exists", scaler_path.exists(), str(scaler_path))
    all_passed &= check("feature_names.joblib exists", features_path.exists(), str(features_path))

    if not report_path.exists():
        print("\n⛔ Run the pipeline first (see step4 guide)")
        sys.exit(1)

    # ── 3. Quality report structure ────────────────────────────────
    print("\n3. Quality report structure:")
    with open(report_path) as f:
        report = json.load(f)

    all_passed &= check("Report has 'timestamp'", "timestamp" in report)
    all_passed &= check("Report has 'row_count'", "row_count" in report)
    all_passed &= check("Report has 'checks'", "checks" in report)
    all_passed &= check("Report has 'passed'", "passed" in report)
    all_passed &= check("Report has 'summary'", "summary" in report)

    expected_checks = [
        "schema", "missing_values", "scaling",
        "target_balance", "row_drop_rate", "extreme_outliers",
    ]
    for check_name in expected_checks:
        all_passed &= check(
            f"Check '{check_name}' present in report",
            check_name in report.get("checks", {}),
        )

    # ── 4. All checks passed ──────────────────────────────────────
    print("\n4. Check results:")
    all_passed &= check(
        f"Overall report passed: {report.get('passed')}",
        report.get("passed") is True,
    )

    for check_name in expected_checks:
        check_data = report.get("checks", {}).get(check_name, {})
        check_passed = check_data.get("passed", False)
        all_passed &= check(f"  {check_name}: passed={check_passed}", check_passed)

    # ── 5. Specific validations from report ────────────────────────
    print("\n5. Specific validations:")

    # Schema
    schema = report.get("checks", {}).get("schema", {})
    all_passed &= check(
        f"No missing columns: {schema.get('missing_columns', [])}",
        len(schema.get("missing_columns", ["?"])) == 0,
    )

    # Missing values
    missing = report.get("checks", {}).get("missing_values", {})
    all_passed &= check(
        f"Total nulls: {missing.get('total_nulls', '?')}",
        missing.get("total_nulls", -1) == 0,
    )

    # Target balance
    balance = report.get("checks", {}).get("target_balance", {})
    attrition_rate = balance.get("attrition_rate", 0)
    all_passed &= check(
        f"Attrition rate: {attrition_rate}%",
        10 <= attrition_rate <= 50 if attrition_rate else False,
        "Expected between 10% and 50%",
    )

    # Row drop rate
    drop = report.get("checks", {}).get("row_drop_rate", {})
    drop_rate = drop.get("drop_rate_pct", None)
    if drop_rate is not None:
        all_passed &= check(
            f"Row drop rate: {drop_rate}%",
            drop_rate <= 20.0,
            "Expected ≤ 20%",
        )

    # ── 6. Warnings ────────────────────────────────────────────────
    print("\n6. Warnings:")
    warnings = report.get("warnings", [])
    if warnings:
        for w in warnings:
            print(f"  ⚠️  {w}")
    else:
        print("  No warnings — clean run!")

    # ── 7. Pipeline module test ────────────────────────────────────
    print("\n7. Pipeline module:")
    try:
        from app.etl.pipeline import run_pipeline
        all_passed &= check("run_pipeline function exists", callable(run_pipeline))
    except Exception as e:
        all_passed &= check("run_pipeline function exists", False, str(e))

    # ── Summary ────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    if all_passed:
        print("✅ ALL CHECKS PASSED — Step 4 complete!")
    else:
        print("❌ SOME CHECKS FAILED — review issues above")
    print("=" * 60)

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
