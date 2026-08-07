"""
Phase 4 Step 1 Verification — Training Data + Extract
Run: cd ai-service && source venv/bin/activate && python tests/verify_step1.py
"""

import sys
from pathlib import Path

# Add project root to path
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
    csv_path = Path(__file__).parent.parent / "data" / "raw" / "hr_training_data.csv"

    print("=" * 60)
    print("Phase 4 Step 1 — Verification")
    print("=" * 60)

    # 1. Check file exists
    print("\n1. File existence:")
    all_passed &= check("CSV file exists", csv_path.exists(), f"Expected: {csv_path}")
    if not csv_path.exists():
        print("\n⛔ Cannot continue — generate training data first:")
        print("   python scripts/generate_training_data.py")
        sys.exit(1)

    # 2. Load with pandas
    print("\n2. CSV structure:")
    import pandas as pd

    df = pd.read_csv(csv_path)

    all_passed &= check("Row count is 5000", len(df) == 5000, f"Got {len(df)}")
    all_passed &= check("Column count is 9", len(df.columns) == 9, f"Got {len(df.columns)}")

    expected_cols = [
        "salary", "tenureMonths", "engagementScore", "performanceScore",
        "absenteeismDays", "overtimeHours", "lastPromotionMonths",
        "trainingHours", "attrition",
    ]
    missing = set(expected_cols) - set(df.columns)
    all_passed &= check("All expected columns present", len(missing) == 0, f"Missing: {missing}")

    # 3. Data quality
    print("\n3. Data quality:")
    all_passed &= check("No NaN values", df.isnull().sum().sum() == 0)

    attrition_rate = df["attrition"].mean()
    all_passed &= check(
        f"Attrition rate is 20-40%: {attrition_rate:.1%}",
        0.2 <= attrition_rate <= 0.4,
    )

    all_passed &= check(
        "Engagement scores 1-5",
        df["engagementScore"].between(1.0, 5.0).all(),
    )
    all_passed &= check(
        "Performance scores 1-5",
        df["performanceScore"].between(1.0, 5.0).all(),
    )
    all_passed &= check("Salary > 0", (df["salary"] > 0).all())
    all_passed &= check("Tenure > 0", (df["tenureMonths"] > 0).all())
    all_passed &= check(
        "lastPromotionMonths <= tenureMonths",
        (df["lastPromotionMonths"] <= df["tenureMonths"]).all(),
    )

    # 4. Test extract module
    print("\n4. Extract module:")
    try:
        import logging

        logging.basicConfig(level=logging.WARNING)  # suppress verbose logs
        from app.etl.extract import extract

        result = extract(csv_path)
        all_passed &= check("extract() loads successfully", True)
        all_passed &= check(
            f"extract() returns {len(result)} rows",
            len(result) == 5000,
        )
    except Exception as e:
        all_passed &= check("extract() loads successfully", False, str(e))

    # Summary
    print("\n" + "=" * 60)
    if all_passed:
        print("✅ ALL CHECKS PASSED — Step 1 complete!")
    else:
        print("❌ SOME CHECKS FAILED — review issues above")
    print("=" * 60)

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
