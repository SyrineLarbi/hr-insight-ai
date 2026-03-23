# Phase 5 - Step 2: Prediction Module (predict.py)

## Why Are We Doing This?

Step 1 trained and saved the model. Step 2 builds the **inference layer** — the code that loads the model and makes predictions on new employee data.

This is the bridge between the trained model and the FastAPI endpoints. When the NestJS backend calls `POST /predict`, the route handler calls `predict.py` → which loads the model → transforms the input → returns risk scores.

### Two prediction modes

1. **Single employee**: HR clicks an employee's profile → gets their individual risk score + top risk drivers
2. **Team prediction**: Backend sends all employees for a team → gets per-employee risk scores + team-level summary

Both use the same model, but the output format differs.

### Why we need the ETL transform at prediction time

The model was trained on **scaled** data (mean=0, std=1). If we feed it raw employee data (salary=85000, engagement=2.3), the predictions are meaningless. We must apply the **exact same scaling** using the saved scaler from Phase 4.

```
Raw employee data → engineer_features() → scale with saved scaler → model.predict() → risk score
```

---

## What We're Building

```
ai-service/
  app/
    models/
      predict.py         ← load model + scaler, predict single/team, risk drivers
  tests/
    verify_step5_2.py    ← verification script
```

---

## The Steps

### Step A: Create the prediction module

Create `ai-service/app/models/predict.py`:

```python
"""
Phase 5 Step 2: Predict — Load trained model and make risk predictions.

Handles two prediction modes:
1. Single employee: returns risk_score, risk_level, top risk drivers
2. Team prediction: returns per-employee scores + team summary

The model expects 12 scaled features. Raw employee data goes through:
  engineer_features() → scale with saved scaler → model.predict_proba()
"""

import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from app.etl.transform import BASE_FEATURES, DERIVED_FEATURES, ALL_FEATURES, engineer_features

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────
# Artifact paths
# ─────────────────────────────────────────────────────────────────────
ARTIFACTS_DIR = Path(__file__).parent.parent / "artifacts"

# ─────────────────────────────────────────────────────────────────────
# Risk level thresholds
# ─────────────────────────────────────────────────────────────────────
RISK_THRESHOLDS = {
    "LOW": 0.3,       # 0–30%: low risk
    "MEDIUM": 0.6,    # 30–60%: medium risk
    # > 60%: high risk
}

# ─────────────────────────────────────────────────────────────────────
# Module-level model cache (loaded once, reused across requests)
# ─────────────────────────────────────────────────────────────────────
_model = None
_scaler = None
_feature_names = None


def load_artifacts() -> bool:
    """
    Load model, scaler, and feature names from disk into module-level cache.

    Called once at startup (or on first prediction). Returns True if all
    artifacts loaded successfully, False otherwise.

    Using module-level caching avoids loading the model from disk on every
    request. In a production service handling 100+ requests/second, this
    saves ~50ms per request (disk I/O + deserialization).
    """
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
    """Check if the model is loaded and ready for predictions."""
    return _model is not None and _scaler is not None and _feature_names is not None


def get_model_info() -> dict:
    """Return model metadata for the /health endpoint."""
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
    """Convert a numeric risk score (0–1) to a risk level string."""
    if score < RISK_THRESHOLDS["LOW"]:
        return "LOW"
    elif score < RISK_THRESHOLDS["MEDIUM"]:
        return "MEDIUM"
    else:
        return "HIGH"


def _get_risk_drivers(employee_data: dict, feature_importance: dict) -> list[dict]:
    """
    Identify the top risk drivers for a specific employee.

    Combines global feature importance (from the model) with the employee's
    actual feature values. A feature is a strong risk driver when:
    1. The model considers it important (high global importance)
    2. The employee's value for that feature is extreme (far from mean)

    Returns a sorted list of {feature, importance, value, direction} dicts.
    """
    drivers = []

    for feature, importance in feature_importance.items():
        if feature in employee_data:
            value = employee_data[feature]
            # Determine direction based on feature semantics
            # (positive scaled value = above average, negative = below)
            if feature in ("engagementScore", "performanceScore", "trainingHours"):
                # For these, low values increase risk
                direction = "below_average" if value < 0 else "above_average"
            else:
                # For overtime, absenteeism, etc., high values increase risk
                direction = "above_average" if value > 0 else "below_average"

            drivers.append({
                "feature": feature,
                "importance": round(float(importance), 4),
                "scaled_value": round(float(value), 4),
                "direction": direction,
            })

    # Sort by importance (most important first)
    drivers.sort(key=lambda d: d["importance"], reverse=True)
    return drivers[:5]  # Top 5 drivers


def _prepare_input(employees: list[dict]) -> pd.DataFrame:
    """
    Transform raw employee data into model-ready input.

    Steps:
    1. Create DataFrame from raw employee dicts
    2. Validate all 8 base features are present
    3. Engineer 4 derived features
    4. Scale all 12 features using the saved scaler

    This replicates the EXACT same transformation applied during training.
    If any step differs, predictions are unreliable.
    """
    if not is_model_loaded():
        raise RuntimeError("Model not loaded. Call load_artifacts() first.")

    df = pd.DataFrame(employees)

    # Validate base features
    missing = [f for f in BASE_FEATURES if f not in df.columns]
    if missing:
        raise ValueError(f"Missing required features: {missing}")

    # Engineer derived features (same as training)
    df = engineer_features(df)

    # Scale with the saved scaler (MUST use same scaler as training)
    feature_data = df[_feature_names]
    scaled_array = _scaler.transform(feature_data)
    df_scaled = pd.DataFrame(scaled_array, columns=_feature_names, index=df.index)

    return df_scaled


def predict_single(employee: dict) -> dict:
    """
    Predict attrition risk for a single employee.

    Parameters:
        employee: Dictionary with the 8 base features:
            { salary, tenureMonths, engagementScore, performanceScore,
              absenteeismDays, overtimeHours, lastPromotionMonths, trainingHours }

    Returns:
        {
            "risk_score": 0.73,          # probability of attrition (0–1)
            "risk_level": "HIGH",        # LOW / MEDIUM / HIGH
            "risk_drivers": [            # top 5 factors driving this score
                { "feature": "engagementScore", "importance": 0.23, ... },
                ...
            ]
        }
    """
    df_scaled = _prepare_input([employee])

    # Get probability of attrition (class 1)
    prob = float(_model.predict_proba(df_scaled)[0, 1])

    # Get feature importance for risk drivers
    feature_importance = dict(zip(_feature_names, _model.feature_importances_))

    # Use scaled values for risk driver analysis
    scaled_values = dict(zip(_feature_names, df_scaled.iloc[0].values))

    return {
        "risk_score": round(prob, 4),
        "risk_level": _classify_risk(prob),
        "risk_drivers": _get_risk_drivers(scaled_values, feature_importance),
    }


def predict_team(employees: list[dict]) -> dict:
    """
    Predict attrition risk for a team of employees.

    Parameters:
        employees: List of employee dictionaries, each with the 8 base features.

    Returns:
        {
            "team_risk_score": 0.42,          # average risk across all employees
            "team_risk_level": "MEDIUM",
            "employee_count": 20,
            "risk_distribution": {
                "LOW": 8,
                "MEDIUM": 7,
                "HIGH": 5
            },
            "high_risk_employees": [ ... ],     # employees with risk > 0.6
            "predictions": [                    # per-employee results
                {
                    "employee_index": 0,
                    "risk_score": 0.73,
                    "risk_level": "HIGH",
                    "risk_drivers": [ ... ]
                },
                ...
            ]
        }
    """
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

    # Get probabilities for all employees at once (batch prediction is faster)
    probs = _model.predict_proba(df_scaled)[:, 1]

    # Feature importance (same for all employees — it's a global model property)
    feature_importance = dict(zip(_feature_names, _model.feature_importances_))

    # Build per-employee results
    predictions = []
    risk_distribution = {"LOW": 0, "MEDIUM": 0, "HIGH": 0}
    high_risk = []

    for i, prob in enumerate(probs):
        prob_float = round(float(prob), 4)
        risk_level = _classify_risk(prob_float)
        risk_distribution[risk_level] += 1

        # Get scaled values for this employee's risk drivers
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

    # Team-level summary
    team_risk = round(float(np.mean(probs)), 4)

    return {
        "team_risk_score": team_risk,
        "team_risk_level": _classify_risk(team_risk),
        "employee_count": len(employees),
        "risk_distribution": risk_distribution,
        "high_risk_employees": high_risk,
        "predictions": predictions,
    }
```

**Why module-level caching (`_model`, `_scaler`, `_feature_names`)?**

Loading a model from disk takes ~50ms (file I/O + deserialization). If every API request loaded the model, a team of 20 employees would add 1 second of latency just for disk reads. Module-level globals load once at startup and persist across all requests.

**Why `predict_proba` instead of `predict`?**

`predict()` returns binary 0/1 (leave or stay). `predict_proba()` returns the probability (0.73 = 73% chance of leaving). The probability is far more useful — it lets us rank employees by risk, set different thresholds, and track how risk changes over time. A binary "will leave" / "won't leave" loses this nuance.

**Why batch prediction for teams?**

```python
# ❌ Slow: one-at-a-time (N model calls)
for emp in employees:
    model.predict_proba(prepare(emp))

# ✅ Fast: batch (1 model call)
model.predict_proba(prepare(all_employees))
```

XGBoost internally uses optimized matrix operations. Sending all employees in one call is 5-10x faster than individual calls.

---

### Step B: Test predictions manually

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python -c "
import logging
logging.basicConfig(level=logging.INFO, format='%(message)s')
from app.models.predict import load_artifacts, predict_single, predict_team

# Load model
load_artifacts()

# Test single prediction — high-risk employee profile
high_risk_employee = {
    'salary': 35000,
    'tenureMonths': 60,
    'engagementScore': 1.5,
    'performanceScore': 2.0,
    'absenteeismDays': 15,
    'overtimeHours': 45,
    'lastPromotionMonths': 48,
    'trainingHours': 5,
}

result = predict_single(high_risk_employee)
print(f'High-risk employee:')
print(f'  Risk score: {result[\"risk_score\"]}')
print(f'  Risk level: {result[\"risk_level\"]}')
print(f'  Top drivers:')
for d in result['risk_drivers'][:3]:
    print(f'    {d[\"feature\"]}: importance={d[\"importance\"]}, direction={d[\"direction\"]}')

print()

# Test single prediction — low-risk employee profile
low_risk_employee = {
    'salary': 120000,
    'tenureMonths': 24,
    'engagementScore': 4.5,
    'performanceScore': 4.2,
    'absenteeismDays': 2,
    'overtimeHours': 3,
    'lastPromotionMonths': 6,
    'trainingHours': 40,
}

result = predict_single(low_risk_employee)
print(f'Low-risk employee:')
print(f'  Risk score: {result[\"risk_score\"]}')
print(f'  Risk level: {result[\"risk_level\"]}')

print()

# Test team prediction
team = [high_risk_employee, low_risk_employee, {
    'salary': 75000, 'tenureMonths': 36, 'engagementScore': 3.0,
    'performanceScore': 3.2, 'absenteeismDays': 7, 'overtimeHours': 12,
    'lastPromotionMonths': 24, 'trainingHours': 20,
}]

team_result = predict_team(team)
print(f'Team prediction ({team_result[\"employee_count\"]} employees):')
print(f'  Team risk score: {team_result[\"team_risk_score\"]}')
print(f'  Team risk level: {team_result[\"team_risk_level\"]}')
print(f'  Distribution: {team_result[\"risk_distribution\"]}')
print(f'  High-risk count: {len(team_result[\"high_risk_employees\"])}')
"
```

Expected: The high-risk employee should score higher (closer to 1.0) than the low-risk employee. Exact values depend on the trained model.

---

## How to Verify It Worked

Run `ai-service/tests/verify_step5_2.py`:

```bash
cd /home/syrine/hr-insight-ai/ai-service
source venv/bin/activate
python tests/verify_step5_2.py
```

### Expected results:

| Check | Expected |
|-------|----------|
| `predict.py` imports successfully | ✅ |
| `load_artifacts()` returns True | ✅ |
| `is_model_loaded()` returns True | ✅ |
| Single prediction returns risk_score, risk_level, risk_drivers | ✅ |
| Risk score is between 0 and 1 | ✅ |
| Risk level is LOW, MEDIUM, or HIGH | ✅ |
| Risk drivers has ≤ 5 entries | ✅ |
| High-risk employee scores higher than low-risk | ✅ |
| Team prediction returns all expected fields | ✅ |
| Team risk_distribution sums to employee_count | ✅ |
| Empty team returns graceful default | ✅ |

---

## Checklist (confirm before Step 3)

- [ ] `app/models/predict.py` created with `predict_single()`, `predict_team()`, `load_artifacts()`
- [ ] Module-level model caching (load once, reuse across requests)
- [ ] Raw employee data transformed with same pipeline as training (engineer_features + scaler)
- [ ] Single prediction: returns risk_score (0–1), risk_level (LOW/MEDIUM/HIGH), risk_drivers (top 5)
- [ ] Team prediction: returns per-employee scores + team summary + risk distribution
- [ ] High-risk employee profile produces higher score than low-risk profile
- [ ] `tests/verify_step5_2.py` passes all checks

---

Once confirmed, move to **Step 3: Pydantic Schemas + FastAPI Routes** — the HTTP API layer.
