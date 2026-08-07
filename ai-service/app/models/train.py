"""
Phase 5 Step 1: Train — XGBoost classifier for employee attrition prediction.
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

ARTIFACTS_DIR = Path(__file__).parent.parent / "artifacts"
PROCESSED_DATA_PATH = (
    Path(__file__).parent.parent.parent / "data" / "processed" / "hr_processed.csv"
)

MODEL_VERSION = "v1"

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
    path = Path(data_path) if data_path else PROCESSED_DATA_PATH

    if not path.exists():
        raise FileNotFoundError(
            f"Processed data not found at {path}. "
            "Run the ETL pipeline first (Phase 4)."
        )

    df = pd.read_csv(path)
    logger.info(f"Loaded training data: {df.shape[0]} rows, {df.shape[1]} columns")

    if "attrition" not in df.columns:
        raise ValueError("'attrition' column not found in processed data")

    X = df.drop(columns=["attrition"])
    y = df["attrition"].astype(int)

    logger.info(f"Features: {list(X.columns)}")
    logger.info(f"Target distribution: {dict(y.value_counts())}")
    logger.info(f"Attrition rate: {y.mean() * 100:.1f}%")

    return X, y


def calculate_scale_pos_weight(y: pd.Series) -> float:
    n_negative = (y == 0).sum()
    n_positive = (y == 1).sum()
    weight = n_negative / max(n_positive, 1)
    logger.info(
        f"Class balance: {n_negative} stay / {n_positive} leave -> "
        f"scale_pos_weight = {weight:.2f}"
    )
    return round(weight, 2)


def train_model(
    X: pd.DataFrame,
    y: pd.Series,
    params: dict | None = None,
    test_size: float = 0.20,
) -> dict:
    start_time = time.time()
    model_params = {**DEFAULT_PARAMS, **(params or {})}

    logger.info("=" * 60)
    logger.info("MODEL TRAINING: Starting XGBoost classifier")
    logger.info("=" * 60)

    logger.info(f"\nStep 1/5: Splitting data ({1-test_size:.0%} train / {test_size:.0%} test)...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=test_size,
        random_state=42,
        stratify=y,
    )
    logger.info(f"  Train: {len(X_train)} rows ({y_train.mean()*100:.1f}% attrition)")
    logger.info(f"  Test:  {len(X_test)} rows ({y_test.mean()*100:.1f}% attrition)")

    logger.info("\nStep 2/5: Calculating class weights...")
    scale_pos_weight = calculate_scale_pos_weight(y_train)
    model_params["scale_pos_weight"] = scale_pos_weight

    logger.info("\nStep 3/5: Training XGBoost...")
    logger.info(f"  Key params: n_estimators={model_params['n_estimators']}, "
                f"max_depth={model_params['max_depth']}, "
                f"learning_rate={model_params['learning_rate']}")

    model = XGBClassifier(**model_params)
    model.fit(X_train, y_train)
    logger.info("  Training complete!")

    logger.info("\nStep 4/5: Evaluating on test set...")
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

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

    report = classification_report(y_test, y_pred, target_names=["Stay", "Leave"])
    logger.info(f"\n{report}")

    logger.info("Step 5/5: Running 5-fold cross-validation...")
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(model, X, y, cv=cv, scoring="roc_auc")
    cv_mean = round(float(cv_scores.mean()), 4)
    cv_std = round(float(cv_scores.std()), 4)
    metrics["cv_auc_roc_mean"] = cv_mean
    metrics["cv_auc_roc_std"] = cv_std
    logger.info(f"  CV AUC-ROC: {cv_mean:.4f} +/- {cv_std:.4f}")
    logger.info(f"  Per-fold:   {[round(s, 4) for s in cv_scores]}")

    feature_importance = dict(
        sorted(
            zip(X.columns, model.feature_importances_),
            key=lambda x: x[1],
            reverse=True,
        )
    )
    feature_importance = {k: round(float(v), 4) for k, v in feature_importance.items()}

    logger.info("\nFeature importance (top 5):")
    for i, (feat, imp) in enumerate(feature_importance.items()):
        if i >= 5:
            break
        logger.info(f"  {i+1}. {feat}: {imp:.4f}")

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
    """Full training pipeline: load -> train -> evaluate -> save."""
    logger.info("=" * 70)
    logger.info("FULL TRAINING PIPELINE")
    logger.info("=" * 70)

    logger.info("\nLoading processed data...")
    X, y = load_training_data(data_path)

    logger.info("\nTraining model...")
    result = train_model(X, y)

    logger.info("\nSaving model and metadata...")
    paths = save_model(result["model"], result["metadata"])

    auc = result["metrics"]["auc_roc"]
    cv_auc = result["metrics"].get("cv_auc_roc_mean", "N/A")
    logger.info("\n" + "=" * 70)
    logger.info("TRAINING COMPLETE")
    logger.info(f"  Model version: {MODEL_VERSION}")
    logger.info(f"  AUC-ROC (test):  {auc}")
    logger.info(f"  AUC-ROC (5-fold CV): {cv_auc}")
    target_met = "TARGET MET" if auc >= 0.80 else "BELOW TARGET"
    logger.info(f"  Target (>= 0.80): {target_met}")
    logger.info("=" * 70)

    return {
        "status": "success",
        "model_version": MODEL_VERSION,
        "metrics": result["metrics"],
        "feature_importance": result["feature_importance"],
        "paths": paths,
        "metadata": result["metadata"],
    }
