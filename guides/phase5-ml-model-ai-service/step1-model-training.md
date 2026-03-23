# Phase 5 - Step 1: Model Training (XGBoost Classifier)

## Why Are We Doing This?

Phase 4 prepared the data. Now we train the model that turns employee data into risk predictions.

The model answers one question: **"Given these 12 features about an employee, what's the probability they'll leave?"**

We use **XGBoost** (eXtreme Gradient Boosting) — the industry standard for tabular data classification. It consistently outperforms simpler models (logistic regression, random forests) on structured datasets like ours, and it's what most Kaggle competitions are won with.

### Why not a deep learning model?

Deep learning (neural networks) excels at images, text, and sequences. For tabular data with 12 features and ~5000 rows, XGBoost is:
- **More accurate** — neural nets need much more data to generalize well
- **Faster to train** — seconds vs minutes/hours
- **More interpretable** — feature importance is built-in
- **Smaller** — model file is ~100KB vs multi-MB for neural nets

### What makes a good model?

We target **AUC-ROC > 0.80**. Here's what the metrics mean:

| Metric | What it measures | Why it matters |
|--------|-----------------|----------------|
| **AUC-ROC** | Overall ranking ability — how well the model separates leavers from stayers | Our primary metric. > 0.80 = good, > 0.90 = excellent |
| **Accuracy** | % of correct predictions | Can be misleading with imbalanced data (80% accuracy = useless if 80% stay) |
| **Precision** | Of those predicted to leave, how many actually leave? | High = fewer false alarms for HR |
| **Recall** | Of those who actually leave, how many did we catch? | High = fewer missed departures |
| **F1 Score** | Harmonic mean of precision and recall | Balanced measure when both matter |

---

## What We're Building

```
ai-service/
  app/
    models/
      train.py           ← load data, split, train XGBoost, evaluate, save model
    artifacts/
      model.joblib        ← saved trained XGBoost model
      scaler.joblib       ← (already exists from Phase 4)
      feature_names.joblib ← (already exists from Phase 4)
      training_metadata.json ← metrics, params, timestamp
  tests/
    verify_step5_1.py    ← verification script
```

---

## The Steps

### Step A: Create the training module

Create `ai-service/app/models/train.py`:

```python
"""
Phase 5 Step 1: Train — XGBoost classifier for employee attrition prediction.

Loads the processed (scaled) dataset from Phase 4, splits into train/test,
trains an XGBoost model with tuned hyperparameters, evaluates on the test set,
and saves the model + metadata to the artifacts directory.

The saved model is used by predict.py at inference time.
"""

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from xgboost import XGBClassifier

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────
ARTIFACTS_DIR = Path(__file__).parent.parent / "artifacts"
PROCESSED_DATA_PATH = (
    Path(__file__).parent.parent.parent / "data" / "processed" / "hr_processed.csv"
)

# ─────────────────────────────────────────────────────────────────────
# Model version — increment when retraining with new data/features
# ─────────────────────────────────────────────────────────────────────
MODEL_VERSION = "v1"

# ─────────────────────────────────────────────────────────────────────
# XGBoost hyperparameters (tuned for HR attrition datasets)
#
# These were selected based on:
# - n_estimators=200: enough trees to capture patterns without overfitting
# - max_depth=5: prevents overly complex trees (HR data isn't that complex)
# - learning_rate=0.1: standard, balances speed and accuracy
# - subsample=0.8: each tree sees 80% of data (reduces overfitting)
# - colsample_bytree=0.8: each tree sees 80% of features (diversity)
# - scale_pos_weight: auto-calculated to handle class imbalance
#   (if 20% leave, scale_pos_weight ≈ 4, telling XGBoost to weigh
#    "leave" samples 4x more than "stay" samples)
# - eval_metric='logloss': standard for binary classification
# ─────────────────────────────────────────────────────────────────────
DEFAULT_PARAMS = {
    "n_estimators": 200,
    "max_depth": 5,
    "learning_rate": 0.1,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 3,
    "gamma": 0.1,
    "reg_alpha": 0.1,
    "reg_lambda": 1.0,
    "eval_metric": "logloss",
    "random_state": 42,
    "n_jobs": -1,
}


def load_training_data(
    data_path: str | Path | None = None,
) -> tuple[pd.DataFrame, pd.Series]:
    """
    Load the processed dataset and split into features (X) and target (y).

    The processed CSV has 13 columns: 12 scaled features + 1 'attrition' target.
    """
    path = Path(data_path) if data_path else PROCESSED_DATA_PATH

    if not path.exists():
        raise FileNotFoundError(
            f"Processed data not found at {path}. "
            "Run the ETL pipeline first (Phase 4)."
        )

    df = pd.read_csv(path)
    logger.info(f"Loaded training data: {df.shape[0]} rows, {df.shape[1]} columns")

    # Separate features and target
    if "attrition" not in df.columns:
        raise ValueError("'attrition' column not found in processed data")

    X = df.drop(columns=["attrition"])
    y = df["attrition"].astype(int)

    logger.info(f"Features: {list(X.columns)}")
    logger.info(f"Target distribution: {dict(y.value_counts())}")
    logger.info(f"Attrition rate: {y.mean() * 100:.1f}%")

    return X, y


def calculate_scale_pos_weight(y: pd.Series) -> float:
    """
    Calculate the scale_pos_weight for XGBoost to handle class imbalance.

    Formula: count(negative) / count(positive)
    If 80% stay (0) and 20% leave (1): scale_pos_weight = 4.0
    This tells XGBoost to treat each "leave" sample as worth 4 "stay" samples.
    """
    n_negative = (y == 0).sum()
    n_positive = (y == 1).sum()
    weight = n_negative / max(n_positive, 1)
    logger.info(
        f"Class balance: {n_negative} stay / {n_positive} leave → "
        f"scale_pos_weight = {weight:.2f}"
    )
    return round(weight, 2)


def train_model(
    X: pd.DataFrame,
    y: pd.Series,
    params: dict | None = None,
    test_size: float = 0.20,
) -> dict:
    """
    Train an XGBoost classifier and evaluate on a held-out test set.

    Steps:
    1. Stratified train/test split (preserves class distribution)
    2. Calculate scale_pos_weight for class imbalance
    3. Train XGBoost with specified hyperparameters
    4. Evaluate on test set (accuracy, precision, recall, F1, AUC-ROC)
    5. Run 5-fold cross-validation for robust AUC estimate
    6. Save model + metadata to artifacts/

    Returns:
        Dictionary with model, metrics, and training metadata.
    """
    start_time = time.time()
    model_params = {**DEFAULT_PARAMS, **(params or {})}

    logger.info("=" * 60)
    logger.info("MODEL TRAINING: Starting XGBoost classifier")
    logger.info("=" * 60)

    # ── Step 1: Stratified train/test split ────────────────────────
    logger.info(f"\nStep 1/5: Splitting data ({1-test_size:.0%} train / {test_size:.0%} test)...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=test_size,
        random_state=42,
        stratify=y,  # Preserves attrition ratio in both sets
    )
    logger.info(f"  Train: {len(X_train)} rows ({y_train.mean()*100:.1f}% attrition)")
    logger.info(f"  Test:  {len(X_test)} rows ({y_test.mean()*100:.1f}% attrition)")

    # ── Step 2: Handle class imbalance ─────────────────────────────
    logger.info("\nStep 2/5: Calculating class weights...")
    scale_pos_weight = calculate_scale_pos_weight(y_train)
    model_params["scale_pos_weight"] = scale_pos_weight

    # ── Step 3: Train the model ────────────────────────────────────
    logger.info("\nStep 3/5: Training XGBoost...")
    logger.info(f"  Key params: n_estimators={model_params['n_estimators']}, "
                f"max_depth={model_params['max_depth']}, "
                f"learning_rate={model_params['learning_rate']}")

    model = XGBClassifier(**model_params)
    model.fit(X_train, y_train)
    logger.info("  Training complete!")

    # ── Step 4: Evaluate on test set ───────────────────────────────
    logger.info("\nStep 4/5: Evaluating on test set...")
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]  # Probability of attrition

    metrics = {
        "accuracy": round(accuracy_score(y_test, y_pred), 4),
        "precision": round(precision_score(y_test, y_pred, zero_division=0), 4),
        "recall": round(recall_score(y_test, y_pred, zero_division=0), 4),
        "f1_score": round(f1_score(y_test, y_pred, zero_division=0), 4),
        "auc_roc": round(roc_auc_score(y_test, y_prob), 4),
    }

    logger.info(f"  Accuracy:  {metrics['accuracy']:.4f}")
    logger.info(f"  Precision: {metrics['precision']:.4f}")
    logger.info(f"  Recall:    {metrics['recall']:.4f}")
    logger.info(f"  F1 Score:  {metrics['f1_score']:.4f}")
    logger.info(f"  AUC-ROC:   {metrics['auc_roc']:.4f}")

    # Classification report (detailed per-class breakdown)
    report = classification_report(y_test, y_pred, target_names=["Stay", "Leave"])
    logger.info(f"\n{report}")

    # ── Step 5: Cross-validation ───────────────────────────────────
    logger.info("Step 5/5: Running 5-fold cross-validation...")
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(model, X, y, cv=cv, scoring="roc_auc")
    cv_mean = round(float(cv_scores.mean()), 4)
    cv_std = round(float(cv_scores.std()), 4)
    metrics["cv_auc_roc_mean"] = cv_mean
    metrics["cv_auc_roc_std"] = cv_std
    logger.info(f"  CV AUC-ROC: {cv_mean:.4f} ± {cv_std:.4f}")
    logger.info(f"  Per-fold:   {[round(s, 4) for s in cv_scores]}")

    # ── Feature importance ─────────────────────────────────────────
    feature_importance = dict(
        sorted(
            zip(X.columns, model.feature_importances_),
            key=lambda x: x[1],
            reverse=True,
        )
    )
    # Round for clean output
    feature_importance = {k: round(float(v), 4) for k, v in feature_importance.items()}

    logger.info("\nFeature importance (top 5):")
    for i, (feat, imp) in enumerate(feature_importance.items()):
        if i >= 5:
            break
        logger.info(f"  {i+1}. {feat}: {imp:.4f}")

    # ── Training metadata ──────────────────────────────────────────
    duration = round(time.time() - start_time, 3)
    metadata = {
        "model_version": MODEL_VERSION,
        "algorithm": "XGBClassifier",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": duration,
        "dataset": {
            "total_rows": len(X),
            "train_rows": len(X_train),
            "test_rows": len(X_test),
            "n_features": X.shape[1],
            "feature_names": list(X.columns),
            "attrition_rate_pct": round(float(y.mean() * 100), 2),
        },
        "hyperparameters": {
            k: v for k, v in model_params.items()
            if k not in ("n_jobs", "random_state")
        },
        "metrics": metrics,
        "feature_importance": feature_importance,
    }

    logger.info(f"\nTraining complete in {duration}s")

    return {
        "model": model,
        "metrics": metrics,
        "metadata": metadata,
        "feature_importance": feature_importance,
    }


def save_model(model: XGBClassifier, metadata: dict) -> dict:
    """
    Save the trained model and training metadata to the artifacts directory.

    Saves:
    - model.joblib: the trained XGBoost model
    - training_metadata.json: metrics, params, feature importance, timestamp
    """
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    model_path = ARTIFACTS_DIR / "model.joblib"
    metadata_path = ARTIFACTS_DIR / "training_metadata.json"

    joblib.dump(model, model_path)
    logger.info(f"  Saved model to: {model_path}")

    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)
    logger.info(f"  Saved metadata to: {metadata_path}")

    return {
        "model_path": str(model_path),
        "metadata_path": str(metadata_path),
    }


def train(data_path: str | Path | None = None) -> dict:
    """
    Full training pipeline: load data → train → evaluate → save.

    This is the single entry point called by:
    - The command-line training script (Step B below)
    - The POST /model/retrain FastAPI endpoint (Step 3)

    Returns:
        Dictionary with model paths, metrics, and metadata.
    """
    logger.info("=" * 70)
    logger.info("FULL TRAINING PIPELINE")
    logger.info("=" * 70)

    # Load data
    logger.info("\n📥 Loading processed data...")
    X, y = load_training_data(data_path)

    # Train and evaluate
    logger.info("\n🏋️ Training model...")
    result = train_model(X, y)

    # Save
    logger.info("\n💾 Saving model and metadata...")
    paths = save_model(result["model"], result["metadata"])

    # Summary
    auc = result["metrics"]["auc_roc"]
    cv_auc = result["metrics"].get("cv_auc_roc_mean", "N/A")
    logger.info("\n" + "=" * 70)
    logger.info("TRAINING COMPLETE")
    logger.info(f"  Model version: {MODEL_VERSION}")
    logger.info(f"  AUC-ROC (test):  {auc}")
    logger.info(f"  AUC-ROC (5-fold CV): {cv_auc}")
    target_met = "✅ TARGET MET" if auc >= 0.80 else "❌ BELOW TARGET"
    logger.info(f"  Target (≥ 0.80): {target_met}")
    logger.info("=" * 70)

    return {
        "status": "success",
        "model_version": MODEL_VERSION,
        "metrics": result["metrics"],
        "feature_importance": result["feature_importance"],
        "paths": paths,
        "metadata": result["metadata"],
    }
```

**Why `stratify=y` in train_test_split?**

If 20% of employees leave in the full dataset but by random chance the test set gets 30%, the model looks worse than it is (or vice versa). Stratification guarantees the attrition ratio is identical in both sets — the most fair evaluation.

**Why `scale_pos_weight`?**

If 80% of employees stay, a model could just predict "stays" for everyone and get 80% accuracy — while catching zero departures. `scale_pos_weight` tells XGBoost: "Each departure case counts N times more." This forces the model to actually learn the patterns that distinguish leavers from stayers.

**Why cross-validation on top of the test set?**

A single 80/20 split can get lucky or unlucky. 5-fold cross-validation trains 5 models on 5 different splits and averages the results. If AUC-ROC is 0.85 on the test set but only 0.72 on CV, the model is overfitting. We want both numbers above 0.80.

---

### Step B: Run the training

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python -c "
import logging
logging.basicConfig(level=logging.INFO, format='%(message)s')
from app.models.train import train

result = train()
print(f'\nFinal metrics:')
for k, v in result['metrics'].items():
    print(f'  {k}: {v}')
print(f'\nTop 5 feature importance:')
for i, (feat, imp) in enumerate(result['feature_importance'].items()):
    if i >= 5: break
    print(f'  {i+1}. {feat}: {imp}')
"
```

Expected output:
```
FULL TRAINING PIPELINE
Loading processed data...
  Loaded training data: ~4800 rows, 12 features
  Attrition rate: ~20%

Training model...
  Train: ~3840 rows
  Test:  ~960 rows
  scale_pos_weight: ~4.0

  AUC-ROC:   0.85+  (target: ≥ 0.80)
  CV AUC-ROC: 0.83+ ± 0.02

Saving model and metadata...
  Saved model to: app/artifacts/model.joblib
  Saved metadata to: app/artifacts/training_metadata.json

TRAINING COMPLETE ✅ TARGET MET
```

**If AUC-ROC is below 0.80**, the synthetic data might have weak attrition signals. This is acceptable for development — the model will improve with real production data. Adjust the data generator's correlation strength if needed.

---

### Step C: Inspect the training metadata

```bash
cd /home/syrine/hr-insight-ai/ai-service
python -m json.tool app/artifacts/training_metadata.json
```

Check:
- `model_version` is `"v1"`
- `metrics.auc_roc` is ≥ 0.80
- `feature_importance` shows reasonable top features (engagement, overtime, promotion are typically strongest)
- `dataset.n_features` is 12
- `hyperparameters` match the defaults

---

## How to Verify It Worked

Run `ai-service/tests/verify_step5_1.py`:

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python tests/verify_step5_1.py
```

### Expected results:

| Check | Expected |
|-------|----------|
| `app/models/train.py` imports successfully | ✅ |
| `app/artifacts/model.joblib` exists | ✅ |
| `app/artifacts/training_metadata.json` exists | ✅ |
| Model is XGBClassifier instance | ✅ |
| Model has 12 input features | ✅ |
| AUC-ROC ≥ 0.80 (or ≥ 0.70 with warning) | ✅ |
| CV AUC-ROC ≥ 0.70 | ✅ |
| Feature importance has 12 entries | ✅ |
| Metadata has all expected fields | ✅ |
| Model can predict on sample data | ✅ |

---

## Checklist (confirm before Step 2)

- [ ] `app/models/train.py` created with `train()`, `train_model()`, `save_model()`, `load_training_data()`
- [ ] XGBoost classifier trained with tuned hyperparameters + scale_pos_weight
- [ ] Stratified train/test split (80/20)
- [ ] 5-fold cross-validation computed
- [ ] Model saved to `app/artifacts/model.joblib`
- [ ] Training metadata saved to `app/artifacts/training_metadata.json`
- [ ] AUC-ROC ≥ 0.80 on test set (or documented reason if lower)
- [ ] Feature importance computed and saved
- [ ] `tests/verify_step5_1.py` passes all checks

---

Once confirmed, move to **Step 2: Prediction Module** — load the trained model and predict employee risk scores.
