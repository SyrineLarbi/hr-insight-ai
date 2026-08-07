"""
Phase 4 Step 2 Verification — Data Cleaning
Run: cd ai-service && source venv/bin/activate && python tests/verify_step2.py
"""

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
    csv_path = Path(__file__).parent.parent / "data" / "cleaned" / "hr_cleaned.csv"

    print("=" * 60)
    print("Phase 4 Step 2 — Verification")
    print("=" * 60)

    # 1. File exists
    print("\n1. File existence:")
    all_passed &= check("Cleaned CSV exists", csv_path.exists(), str(csv_path))
    if not csv_path.exists():
        print("\n⛔ Run the cleaning pipeline first (see step2 guide)")
        sys.exit(1)

    import pandas as pd

    df = pd.read_csv(csv_path)

    # 2. Structure
    print("\n2. Structure:")
    all_passed &= check(f"Row count ≥ 4500: {len(df)}", len(df) >= 4500)
    all_passed &= check(f"Column count is 9: {len(df.columns)}", len(df.columns) == 9)

    # 3. No missing values
    print("\n3. Missing values:")
    total_null = df.isnull().sum().sum()
    all_passed &= check(f"No NaN values: {total_null}", total_null == 0)

    # 4. No duplicates
    print("\n4. Duplicates:")
    dup_count = df.duplicated().sum()
    all_passed &= check(f"No duplicate rows: {dup_count}", dup_count == 0)

    # 5. Score ranges
    print("\n5. Score ranges:")
    all_passed &= check(
        "engagementScore in [1, 5]",
        df["engagementScore"].between(1.0, 5.0).all(),
        f"min={df['engagementScore'].min()}, max={df['engagementScore'].max()}",
    )
    all_passed &= check(
        "performanceScore in [1, 5]",
        df["performanceScore"].between(1.0, 5.0).all(),
        f"min={df['performanceScore'].min()}, max={df['performanceScore'].max()}",
    )

    # 6. Non-negative constraints
    print("\n6. Non-negative constraints:")
    for col in ["salary", "tenureMonths", "absenteeismDays", "overtimeHours",
                "lastPromotionMonths", "trainingHours"]:
        all_passed &= check(f"{col} ≥ 0", (df[col] >= 0).all())

    # 7. Consistency
    print("\n7. Consistency checks:")
    violations = (df["lastPromotionMonths"] > df["tenureMonths"]).sum()
    all_passed &= check(
        f"lastPromotionMonths ≤ tenureMonths: {violations} violations",
        violations == 0,
    )

    # 8. Test clean module
    print("\n8. Clean module:")
    try:
        import logging
        logging.basicConfig(level=logging.WARNING)
        from app.etl.clean import clean

        raw_path = Path(__file__).parent.parent / "data" / "raw" / "hr_training_data.csv"
        df_raw = pd.read_csv(raw_path)
        df_result = clean(df_raw)
        all_passed &= check("clean() runs successfully", True)
        all_passed &= check(
            f"clean() returns DataFrame with {len(df_result)} rows",
            len(df_result) >= 4500,
        )
    except Exception as e:
        all_passed &= check("clean() runs successfully", False, str(e))

    # Summary
    print("\n" + "=" * 60)
    if all_passed:
        print("✅ ALL CHECKS PASSED — Step 2 complete!")
    else:
        print("❌ SOME CHECKS FAILED — review issues above")
    print("=" * 60)

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
