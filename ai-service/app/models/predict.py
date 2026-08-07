"""
Phase 5 Step 2: Predict — Load trained model and make risk predictions.
"""

import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from app.etl.transform import BASE_FEATURES, DERIVED_FEATURES, ALL_FEATURES, engineer_features

logger = logging.getLogger(__name__)

ARTIFACTS_DIR = Path(__file__).parent.parent / "artifacts"

RISK_THRESHOLDS = {
    "LOW": 0.3,
    "MEDIUM": 0.6,
}

_model = None
_scaler = None
_feature_names = None


def load_artifacts() -> bool:
    """Load model, scaler, and feature names from disk into module-level cache."""
    global _model, _scaler, _feature_names

    model_path = ARTIFACTS_DIR / "model.joblib"
    scaler_path = ARTIFACTS_DIR / "scaler.joblib"
    features_path = ARTIFACTS_DIR / "feature_names.joblib"

    missing = []
    if not model_path.exists():
        missing.append("model.joblib")
    if not scaler_path.exists():
        missing.append("scaler.joblib")
    if not features_path.exists():
        missing.append("feature_names.joblib")

    if missing:
        logger.error(f"Missing artifacts: {missing}")
        return False

    _model = joblib.load(model_path)
    _scaler = joblib.load(scaler_path)
    _feature_names = joblib.load(features_path)

    logger.info(f"Loaded model, scaler, and {len(_feature_names)} feature names")
    return True


def is_model_loaded() -> bool:
    return _model is not None and _scaler is not None and _feature_names is not None


def get_model_info() -> dict:
    metadata_path = ARTIFACTS_DIR / "training_metadata.json"
    info = {
        "model_loaded": is_model_loaded(),
        "model_version": None,
        "n_features": None,
        "auc_roc": None,
    }

    if metadata_path.exists():
        import json
        with open(metadata_path) as f:
            metadata = json.load(f)
        info["model_version"] = metadata.get("model_version")
        info["n_features"] = metadata.get("dataset", {}).get("n_features")
        info["auc_roc"] = metadata.get("metrics", {}).get("auc_roc")

    return info


def _classify_risk(score: float) -> str:
    if score < RISK_THRESHOLDS["LOW"]:
        return "LOW"
    elif score < RISK_THRESHOLDS["MEDIUM"]:
        return "MEDIUM"
    else:
        return "HIGH"


def _get_risk_drivers(employee_data: dict, feature_importance: dict) -> list[dict]:
    drivers = []

    for feature, importance in feature_importance.items():
        if feature in employee_data:
            value = employee_data[feature]
            if feature in ("engagementScore", "performanceScore", "trainingHours"):
                direction = "below_average" if value < 0 else "above_average"
            else:
                direction = "above_average" if value > 0 else "below_average"

            drivers.append({
                "feature": feature,
                "importance": round(float(importance), 4),
                "scaled_value": round(float(value), 4),
                "direction": direction,
            })

    drivers.sort(key=lambda d: d["importance"], reverse=True)
    return drivers[:5]


def _prepare_input(employees: list[dict]) -> pd.DataFrame:
    """Transform raw employee data into model-ready input."""
    if not is_model_loaded():
        raise RuntimeError("Model not loaded. Call load_artifacts() first.")

    df = pd.DataFrame(employees)

    missing = [f for f in BASE_FEATURES if f not in df.columns]
    if missing:
        raise ValueError(f"Missing required features: {missing}")

    df = engineer_features(df)

    feature_data = df[_feature_names]
    scaled_array = _scaler.transform(feature_data)
    df_scaled = pd.DataFrame(scaled_array, columns=_feature_names, index=df.index)

    return df_scaled


def predict_single(employee: dict) -> dict:
    """Predict attrition risk for a single employee."""
    df_scaled = _prepare_input([employee])

    prob = float(_model.predict_proba(df_scaled)[0, 1])

    feature_importance = dict(zip(_feature_names, _model.feature_importances_))

    scaled_values = dict(zip(_feature_names, df_scaled.iloc[0].values))

    return {
        "risk_score": round(prob, 4),
        "risk_level": _classify_risk(prob),
        "risk_drivers": _get_risk_drivers(scaled_values, feature_importance),
    }


def predict_team(employees: list[dict]) -> dict:
    """Predict attrition risk for a team of employees."""
    if not employees:
        return {
            "team_risk_score": 0.0,
            "team_risk_level": "LOW",
            "employee_count": 0,
            "risk_distribution": {"LOW": 0, "MEDIUM": 0, "HIGH": 0},
            "high_risk_employees": [],
            "predictions": [],
        }

    df_scaled = _prepare_input(employees)

    probs = _model.predict_proba(df_scaled)[:, 1]

    feature_importance = dict(zip(_feature_names, _model.feature_importances_))

    predictions = []
    risk_distribution = {"LOW": 0, "MEDIUM": 0, "HIGH": 0}
    high_risk = []

    for i, prob in enumerate(probs):
        prob_float = round(float(prob), 4)
        risk_level = _classify_risk(prob_float)
        risk_distribution[risk_level] += 1

        scaled_values = dict(zip(_feature_names, df_scaled.iloc[i].values))

        prediction = {
            "employee_index": i,
            "risk_score": prob_float,
            "risk_level": risk_level,
            "risk_drivers": _get_risk_drivers(scaled_values, feature_importance),
        }
        predictions.append(prediction)

        if risk_level == "HIGH":
            high_risk.append(prediction)

    team_risk = round(float(np.mean(probs)), 4)

    return {
        "team_risk_score": team_risk,
        "team_risk_level": _classify_risk(team_risk),
        "employee_count": len(employees),
        "risk_distribution": risk_distribution,
        "high_risk_employees": high_risk,
        "predictions": predictions,
    }
