"""
Phase 5 Step 1 Verification — Model Training (XGBoost)
Run: cd ai-service && source venv/bin/activate && python tests/verify_step5_1.py
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

PASS = "✅ PASS"
FAIL = "❌ FAIL"

BASE_DIR = Path(__file__).parent.parent
ARTIFACTS_DIR = BASE_DIR / "app" / "artifacts"


def check(label: str, condition: bool, detail: str = ""):
    status = PASS if condition else FAIL
    msg = f"  {status}  {label}"
    if detail and not condition:
        msg += f" — {detail}"
    print(msg)
    return condition


def main():
    all_passed = True

    print("=" * 60)
    print("Phase 5 Step 1 — Model Training Verification")
    print("=" * 60)

    # ── 1. Module import ───────────────────────────────────────────
    print("\n1. Module import:")
    try:
        import logging
        logging.basicConfig(level=logging.WARNING)
        from app.models.train import (
            train,
            train_model,
            save_model,
            load_training_data,
            MODEL_VERSION,
            DEFAULT_PARAMS,
        )
        all_passed &= check("train module imports successfully", True)
        all_passed &= check(f"MODEL_VERSION is '{MODEL_VERSION}'", MODEL_VERSION == "v1")
    except Exception as e:
        all_passed &= check("train module imports successfully", False, str(e))
        print("\n⛔ Cannot proceed without train module")
        sys.exit(1)

    # ── 2. Artifact files ──────────────────────────────────────────
    print("\n2. Artifact files:")
    model_path = ARTIFACTS_DIR / "model.joblib"
    metadata_path = ARTIFACTS_DIR / "training_metadata.json"

    all_passed &= check("model.joblib exists", model_path.exists(), str(model_path))
    all_passed &= check("training_metadata.json exists", metadata_path.exists(), str(metadata_path))

    if not model_path.exists():
        print("\n⛔ Run the training first (see step1 guide)")
        sys.exit(1)

    # ── 3. Model validation ────────────────────────────────────────
    print("\n3. Model validation:")
    import joblib
    from xgboost import XGBClassifier

    model = joblib.load(model_path)
    all_passed &= check("Model is XGBClassifier instance", isinstance(model, XGBClassifier))

    n_features = model.n_features_in_
    all_passed &= check(
        f"Model expects {n_features} features",
        n_features == 12,
        f"Expected 12, got {n_features}",
    )

    # ── 4. Training metadata ───────────────────────────────────────
    print("\n4. Training metadata:")
    with open(metadata_path) as f:
        metadata = json.load(f)

    expected_fields = ["model_version", "algorithm", "timestamp", "dataset", "metrics", "feature_importance"]
    for field in expected_fields:
        all_passed &= check(f"Metadata has '{field}'", field in metadata)

    all_passed &= check(
        f"Algorithm: {metadata.get('algorithm')}",
        metadata.get("algorithm") == "XGBClassifier",
    )
    all_passed &= check(
        f"Model version: {metadata.get('model_version')}",
        metadata.get("model_version") == "v1",
    )

    # Dataset info
    dataset = metadata.get("dataset", {})
    all_passed &= check(
        f"Dataset: {dataset.get('total_rows')} rows, {dataset.get('n_features')} features",
        dataset.get("n_features") == 12,
    )

    # ── 5. Metrics validation ──────────────────────────────────────
    print("\n5. Metrics:")
    metrics = metadata.get("metrics", {})

    auc_roc = metrics.get("auc_roc", 0)
    all_passed &= check(
        f"AUC-ROC: {auc_roc}",
        auc_roc >= 0.70,
        f"Expected ≥ 0.70, got {auc_roc}",
    )
    if auc_roc >= 0.80:
        print(f"    🎯 Target met (≥ 0.80)")
    elif auc_roc >= 0.70:
        print(f"    ⚠️  Below target (0.80) but acceptable for synthetic data")

    cv_auc = metrics.get("cv_auc_roc_mean", 0)
    all_passed &= check(
        f"CV AUC-ROC: {cv_auc}",
        cv_auc >= 0.65,
        f"Expected ≥ 0.65, got {cv_auc}",
    )

    for metric_name in ["accuracy", "precision", "recall", "f1_score"]:
        val = metrics.get(metric_name, 0)
        all_passed &= check(f"{metric_name}: {val}", 0 < val <= 1.0)

    # ── 6. Feature importance ──────────────────────────────────────
    print("\n6. Feature importance:")
    fi = metadata.get("feature_importance", {})
    all_passed &= check(
        f"Feature importance has {len(fi)} entries",
        len(fi) == 12,
        f"Expected 12, got {len(fi)}",
    )

    # All importances should sum to ~1.0
    fi_sum = sum(fi.values())
    all_passed &= check(
        f"Importances sum to ~1.0: {fi_sum:.4f}",
        0.9 < fi_sum < 1.1,
    )

    print("\n  Top 5 features:")
    for i, (feat, imp) in enumerate(fi.items()):
        if i >= 5:
            break
        print(f"    {i+1}. {feat}: {imp}")

    # ── 7. Prediction sanity check ─────────────────────────────────
    print("\n7. Prediction sanity check:")
    try:
        # Create a sample input (12 features, all zeros = mean after scaling)
        sample = np.zeros((1, 12))
        prob = model.predict_proba(sample)[0]
        pred = model.predict(sample)[0]

        all_passed &= check(
            f"Model predicts on sample: class={pred}, prob={prob[1]:.4f}",
            len(prob) == 2 and 0 <= prob[1] <= 1,
        )
    except Exception as e:
        all_passed &= check("Model predicts on sample", False, str(e))

    # ── Summary ────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    if all_passed:
        print("✅ ALL CHECKS PASSED — Step 1 complete!")
    else:
        print("❌ SOME CHECKS FAILED — review issues above")
    print("=" * 60)

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
