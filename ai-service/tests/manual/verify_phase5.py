"""
Phase 5 Final Verification — ML Model + AI Service End-to-End
Run: cd ai-service && source venv/bin/activate && python tests/verify_phase5.py

NOTE: For HTTP tests, the AI service must be running:
  uvicorn app.main:app --reload --port 8000
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
AI_SERVICE_URL = "http://localhost:8000"

HIGH_RISK = {
    "salary": 35000, "tenureMonths": 60, "engagementScore": 1.5,
    "performanceScore": 2.0, "absenteeismDays": 15, "overtimeHours": 45,
    "lastPromotionMonths": 48, "trainingHours": 5,
}
LOW_RISK = {
    "salary": 120000, "tenureMonths": 24, "engagementScore": 4.5,
    "performanceScore": 4.2, "absenteeismDays": 2, "overtimeHours": 3,
    "lastPromotionMonths": 6, "trainingHours": 40,
}


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
    print("Phase 5 — Full ML Model + AI Service Verification")
    print("=" * 70)

    # ══════════════════════════════════════════════════════════════════
    # Section 1: Module Imports
    # ══════════════════════════════════════════════════════════════════
    print("\n1. Module imports:")
    import logging
    logging.basicConfig(level=logging.WARNING)

    modules_ok = True
    for mod_path in [
        "app.models.train", "app.models.predict",
        "app.schemas.prediction", "app.schemas.etl",
        "app.routes.health", "app.routes.prediction", "app.routes.etl",
        "app.etl.pipeline", "app.etl.transform",
    ]:
        try:
            __import__(mod_path, fromlist=["x"])
            all_passed &= check(f"{mod_path}", True)
        except Exception as e:
            all_passed &= check(f"{mod_path}", False, str(e))
            modules_ok = False

    if not modules_ok:
        print("\n⛔ Critical imports failed — cannot continue")
        sys.exit(1)

    # ══════════════════════════════════════════════════════════════════
    # Section 2: Artifacts
    # ══════════════════════════════════════════════════════════════════
    print("\n2. Artifacts:")
    artifacts = {
        "model.joblib": ARTIFACTS_DIR / "model.joblib",
        "scaler.joblib": ARTIFACTS_DIR / "scaler.joblib",
        "feature_names.joblib": ARTIFACTS_DIR / "feature_names.joblib",
        "training_metadata.json": ARTIFACTS_DIR / "training_metadata.json",
    }
    for name, path in artifacts.items():
        all_passed &= check(f"{name} exists", path.exists(), str(path))

    # ══════════════════════════════════════════════════════════════════
    # Section 3: Model Validation
    # ══════════════════════════════════════════════════════════════════
    print("\n3. Model validation:")
    import joblib
    from xgboost import XGBClassifier

    if artifacts["model.joblib"].exists():
        model = joblib.load(artifacts["model.joblib"])
        all_passed &= check("Model is XGBClassifier", isinstance(model, XGBClassifier))
        all_passed &= check(
            f"Model expects 12 features: {model.n_features_in_}",
            model.n_features_in_ == 12,
        )

        # Prediction sanity
        sample = np.zeros((1, 12))
        prob = model.predict_proba(sample)[0]
        all_passed &= check(
            f"Model predicts on zeros: prob={prob[1]:.4f}",
            0 <= prob[1] <= 1,
        )

    # ══════════════════════════════════════════════════════════════════
    # Section 4: Training Metrics
    # ══════════════════════════════════════════════════════════════════
    print("\n4. Training metrics:")
    if artifacts["training_metadata.json"].exists():
        with open(artifacts["training_metadata.json"]) as f:
            metadata = json.load(f)

        metrics = metadata.get("metrics", {})
        auc = metrics.get("auc_roc", 0)
        cv_auc = metrics.get("cv_auc_roc_mean", 0)

        all_passed &= check(f"AUC-ROC: {auc}", auc >= 0.70, "Target ≥ 0.70 (≥ 0.80 ideal)")
        all_passed &= check(f"CV AUC-ROC: {cv_auc}", cv_auc >= 0.65)
        all_passed &= check(f"Accuracy: {metrics.get('accuracy')}", 0 < metrics.get("accuracy", 0) <= 1)
        all_passed &= check(f"Precision: {metrics.get('precision')}", 0 < metrics.get("precision", 0) <= 1)
        all_passed &= check(f"Recall: {metrics.get('recall')}", 0 < metrics.get("recall", 0) <= 1)
        all_passed &= check(f"F1: {metrics.get('f1_score')}", 0 < metrics.get("f1_score", 0) <= 1)

        if auc >= 0.80:
            print("    🎯 AUC-ROC target met (≥ 0.80)")
        else:
            print("    ⚠️  Below ideal target (0.80) — acceptable for synthetic data")

        fi = metadata.get("feature_importance", {})
        all_passed &= check(f"Feature importance: {len(fi)} entries", len(fi) == 12)

    # ══════════════════════════════════════════════════════════════════
    # Section 5: Prediction Module
    # ══════════════════════════════════════════════════════════════════
    print("\n5. Prediction module:")
    from app.models.predict import load_artifacts, predict_single, predict_team, is_model_loaded

    loaded = load_artifacts()
    all_passed &= check("load_artifacts() succeeds", loaded)
    all_passed &= check("is_model_loaded() returns True", is_model_loaded())

    if loaded:
        # Single predictions
        result_high = predict_single(HIGH_RISK)
        result_low = predict_single(LOW_RISK)

        all_passed &= check(
            f"High-risk score: {result_high['risk_score']}",
            0 <= result_high["risk_score"] <= 1,
        )
        all_passed &= check(
            f"Low-risk score: {result_low['risk_score']}",
            0 <= result_low["risk_score"] <= 1,
        )
        all_passed &= check(
            f"High ({result_high['risk_score']:.4f}) > Low ({result_low['risk_score']:.4f})",
            result_high["risk_score"] > result_low["risk_score"],
        )

        # Team prediction
        team_result = predict_team([HIGH_RISK, LOW_RISK])
        all_passed &= check(
            f"Team employee_count: {team_result['employee_count']}",
            team_result["employee_count"] == 2,
        )
        dist = team_result["risk_distribution"]
        dist_sum = dist["LOW"] + dist["MEDIUM"] + dist["HIGH"]
        all_passed &= check(f"Distribution sums to 2: {dist_sum}", dist_sum == 2)

        # Empty team
        empty = predict_team([])
        all_passed &= check("Empty team: employee_count=0", empty["employee_count"] == 0)

    # ══════════════════════════════════════════════════════════════════
    # Section 6: Schema Validation
    # ══════════════════════════════════════════════════════════════════
    print("\n6. Schema validation:")
    from app.schemas.prediction import EmployeeInput

    # Valid input
    try:
        EmployeeInput(**LOW_RISK)
        all_passed &= check("Valid EmployeeInput accepted", True)
    except Exception as e:
        all_passed &= check("Valid EmployeeInput accepted", False, str(e))

    # Invalid inputs
    for desc, data in [
        ("engagement=6.0", {**LOW_RISK, "engagementScore": 6.0}),
        ("salary=-1000", {**LOW_RISK, "salary": -1000}),
        ("performance=0", {**LOW_RISK, "performanceScore": 0}),
    ]:
        try:
            EmployeeInput(**data)
            all_passed &= check(f"Rejects {desc}", False, "Should have raised error")
        except Exception:
            all_passed &= check(f"Rejects {desc}", True)

    # ══════════════════════════════════════════════════════════════════
    # Section 7: FastAPI App
    # ══════════════════════════════════════════════════════════════════
    print("\n7. FastAPI app:")
    from app.main import app

    routes = [r.path for r in app.routes]
    for expected in ["/health", "/predict", "/predict/single", "/etl/run", "/etl/status", "/model/retrain"]:
        all_passed &= check(f"Route '{expected}' registered", expected in routes)

    # ══════════════════════════════════════════════════════════════════
    # Section 8: HTTP Integration (requires running server)
    # ══════════════════════════════════════════════════════════════════
    print("\n8. HTTP integration tests:")
    server_running = False
    try:
        import httpx
        client = httpx.Client(base_url=AI_SERVICE_URL, timeout=30.0)

        # Quick connectivity check
        try:
            resp = client.get("/health")
            server_running = resp.status_code == 200
        except httpx.ConnectError:
            pass

        if not server_running:
            print("  ⚠️  AI service not running — skipping HTTP tests")
            print("     Start with: uvicorn app.main:app --reload --port 8000")
        else:
            # Health
            resp = client.get("/health")
            all_passed &= check(f"GET /health → {resp.status_code}", resp.status_code == 200)
            data = resp.json()
            all_passed &= check(f"  model_loaded: {data.get('model_loaded')}", data.get("model_loaded") is True)

            # Single prediction
            resp = client.post("/predict/single", json=HIGH_RISK)
            all_passed &= check(f"POST /predict/single → {resp.status_code}", resp.status_code == 200)
            if resp.status_code == 200:
                d = resp.json()
                all_passed &= check(f"  risk_score: {d.get('risk_score')}", 0 <= d.get("risk_score", -1) <= 1)

            # Team prediction
            resp = client.post("/predict", json={"employees": [HIGH_RISK, LOW_RISK]})
            all_passed &= check(f"POST /predict → {resp.status_code}", resp.status_code == 200)
            if resp.status_code == 200:
                d = resp.json()
                all_passed &= check(f"  employee_count: {d.get('employee_count')}", d.get("employee_count") == 2)

            # Validation error
            bad = {**HIGH_RISK, "engagementScore": 6.0}
            resp = client.post("/predict/single", json=bad)
            all_passed &= check(f"POST invalid → {resp.status_code}", resp.status_code == 422)

            # ETL status
            resp = client.get("/etl/status")
            all_passed &= check(f"GET /etl/status → {resp.status_code}", resp.status_code in (200, 404))

            # Swagger
            resp = client.get("/docs")
            all_passed &= check(f"GET /docs → {resp.status_code}", resp.status_code == 200)

        client.close()
    except ImportError:
        print("  ⚠️  httpx not installed — skipping HTTP tests")

    # ══════════════════════════════════════════════════════════════════
    # Section 9: Phase 4 Still Works
    # ══════════════════════════════════════════════════════════════════
    print("\n9. Phase 4 compatibility:")
    quality_report_path = BASE_DIR / "data" / "processed" / "data_quality_report.json"
    processed_path = BASE_DIR / "data" / "processed" / "hr_processed.csv"

    all_passed &= check("Quality report exists", quality_report_path.exists())
    all_passed &= check("Processed CSV exists", processed_path.exists())

    if quality_report_path.exists():
        with open(quality_report_path) as f:
            report = json.load(f)
        all_passed &= check(
            f"Quality report passed: {report.get('passed')}",
            report.get("passed") is True,
        )

    # ══════════════════════════════════════════════════════════════════
    # Summary
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 70)

    if artifacts["training_metadata.json"].exists():
        with open(artifacts["training_metadata.json"]) as f:
            m = json.load(f)
        metrics = m.get("metrics", {})
        print("MODEL SUMMARY:")
        print(f"  Version:    {m.get('model_version')}")
        print(f"  AUC-ROC:    {metrics.get('auc_roc')} (target ≥ 0.80)")
        print(f"  CV AUC-ROC: {metrics.get('cv_auc_roc_mean')} ± {metrics.get('cv_auc_roc_std')}")
        print(f"  Accuracy:   {metrics.get('accuracy')}")
        print(f"  F1 Score:   {metrics.get('f1_score')}")

        fi = m.get("feature_importance", {})
        top3 = list(fi.items())[:3]
        print(f"  Top features: {', '.join(f'{k} ({v})' for k, v in top3)}")
    print("=" * 70)

    if all_passed:
        print("✅ ALL CHECKS PASSED — Phase 5 complete!")
        print("\nNext: Phase 6 — LLM Integration + Reports + WebSocket + PDF")
    else:
        print("❌ SOME CHECKS FAILED — review issues above")
    print("=" * 70)

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
