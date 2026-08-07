"""
Phase 4 Step 3 Verification — Feature Engineering + Scaling
Run: cd ai-service && source venv/bin/activate && python tests/verify_step3.py
"""

import sys
from pathlib import Path

import numpy as np

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

    processed_path = Path(__file__).parent.parent / "data" / "processed" / "hr_processed.csv"
    artifacts_dir = Path(__file__).parent.parent / "app" / "artifacts"
    scaler_path = artifacts_dir / "scaler.joblib"
    features_path = artifacts_dir / "feature_names.joblib"

    print("=" * 60)
    print("Phase 4 Step 3 — Verification")
    print("=" * 60)

    # ── 1. File existence ──────────────────────────────────────────
    print("\n1. File existence:")
    all_passed &= check("Processed CSV exists", processed_path.exists(), str(processed_path))
    all_passed &= check("scaler.joblib exists", scaler_path.exists(), str(scaler_path))
    all_passed &= check("feature_names.joblib exists", features_path.exists(), str(features_path))

    if not processed_path.exists():
        print("\n⛔ Run the transform pipeline first (see step3 guide)")
        sys.exit(1)

    import joblib
    import pandas as pd

    df = pd.read_csv(processed_path)

    # ── 2. Structure ───────────────────────────────────────────────
    print("\n2. Structure:")
    all_passed &= check(
        f"Column count is 13: {len(df.columns)}",
        len(df.columns) == 13,
        f"Expected 13 (8 base + 4 derived + attrition), got {len(df.columns)}: {list(df.columns)}",
    )
    all_passed &= check(f"Row count ≥ 4500: {len(df)}", len(df) >= 4500)

    # Check all expected columns are present
    base_features = [
        "salary", "tenureMonths", "engagementScore", "performanceScore",
        "absenteeismDays", "overtimeHours", "lastPromotionMonths", "trainingHours",
    ]
    derived_features = [
        "salary_per_tenure", "engagement_performance",
        "overtime_absenteeism", "promotion_overdue",
    ]
    all_features = base_features + derived_features

    for col in all_features:
        all_passed &= check(f"Column '{col}' present", col in df.columns)

    all_passed &= check("Column 'attrition' present", "attrition" in df.columns)

    # ── 3. Scaling verification ────────────────────────────────────
    print("\n3. Scaling (feature means ≈ 0, stds ≈ 1):")
    for col in all_features:
        if col not in df.columns:
            continue
        col_mean = df[col].mean()
        col_std = df[col].std()
        all_passed &= check(
            f"{col}: mean={col_mean:.4f}, std={col_std:.4f}",
            abs(col_mean) < 0.01 and 0.9 < col_std < 1.1,
            f"mean should be ~0 (got {col_mean:.4f}), std should be ~1 (got {col_std:.4f})",
        )

    # ── 4. Attrition column NOT scaled ─────────────────────────────
    print("\n4. Attrition column:")
    if "attrition" in df.columns:
        unique_vals = sorted(df["attrition"].unique())
        all_passed &= check(
            f"Attrition is binary (0/1): {unique_vals}",
            set(unique_vals).issubset({0, 1}) or set(unique_vals).issubset({0.0, 1.0}),
        )

    # ── 5. Artifacts verification ──────────────────────────────────
    print("\n5. Artifacts:")

    if features_path.exists():
        feature_names = joblib.load(features_path)
        all_passed &= check(
            f"Feature names list has {len(feature_names)} entries",
            len(feature_names) == 12,
            f"Expected 12, got {len(feature_names)}",
        )
        all_passed &= check(
            "Feature names match expected",
            feature_names == all_features,
            f"Got: {feature_names}",
        )

    if scaler_path.exists():
        from sklearn.preprocessing import StandardScaler

        scaler = joblib.load(scaler_path)
        all_passed &= check(
            "Scaler is a StandardScaler instance",
            isinstance(scaler, StandardScaler),
        )
        all_passed &= check(
            f"Scaler fitted on {scaler.n_features_in_} features",
            scaler.n_features_in_ == 12,
            f"Expected 12, got {scaler.n_features_in_}",
        )

    # ── 6. Inverse transform sanity check ──────────────────────────
    print("\n6. Inverse transform sanity check:")
    if scaler_path.exists() and features_path.exists():
        scaler = joblib.load(scaler_path)
        # Take first row, inverse transform, check salary is realistic
        sample = df[all_features].iloc[:1].values
        original = scaler.inverse_transform(sample)
        salary_orig = original[0][0]  # first feature is salary
        all_passed &= check(
            f"Inverse-transformed salary is realistic: {salary_orig:.0f}",
            10_000 < salary_orig < 300_000,
            f"Got {salary_orig:.0f} — expected between 10K and 300K",
        )

    # ── 7. Transform module import ─────────────────────────────────
    print("\n7. Transform module:")
    try:
        import logging
        logging.basicConfig(level=logging.WARNING)
        from app.etl.transform import (
            engineer_features,
            scale_features,
            save_artifacts,
            transform,
            BASE_FEATURES,
            DERIVED_FEATURES,
            ALL_FEATURES,
        )
        all_passed &= check("transform module imports successfully", True)
        all_passed &= check(
            f"BASE_FEATURES has {len(BASE_FEATURES)} entries",
            len(BASE_FEATURES) == 8,
        )
        all_passed &= check(
            f"DERIVED_FEATURES has {len(DERIVED_FEATURES)} entries",
            len(DERIVED_FEATURES) == 4,
        )
        all_passed &= check(
            f"ALL_FEATURES has {len(ALL_FEATURES)} entries",
            len(ALL_FEATURES) == 12,
        )
    except Exception as e:
        all_passed &= check("transform module imports successfully", False, str(e))

    # ── Summary ────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    if all_passed:
        print("✅ ALL CHECKS PASSED — Step 3 complete!")
    else:
        print("❌ SOME CHECKS FAILED — review issues above")
    print("=" * 60)

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
