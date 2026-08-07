"""
Phase 5 Step 3 Verification — Pydantic Schemas + FastAPI Routes
Run: cd ai-service && source venv/bin/activate && python tests/verify_step5_3.py

NOTE: The AI service must be running for HTTP tests to pass:
  uvicorn app.main:app --reload --port 8000
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

PASS = "✅ PASS"
FAIL = "❌ FAIL"

AI_SERVICE_URL = "http://localhost:8000"


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
    print("Phase 5 Step 3 — Schemas + Routes Verification")
    print("=" * 60)

    # ── 1. Schema imports ──────────────────────────────────────────
    print("\n1. Schema imports:")
    try:
        from app.schemas.prediction import (
            EmployeeInput,
            TeamPredictionRequest,
            SinglePredictionResponse,
            TeamPredictionResponse,
        )
        all_passed &= check("prediction schemas import", True)
    except Exception as e:
        all_passed &= check("prediction schemas import", False, str(e))

    try:
        from app.schemas.etl import ETLRunResponse, RetrainResponse
        all_passed &= check("etl schemas import", True)
    except Exception as e:
        all_passed &= check("etl schemas import", False, str(e))

    # ── 2. Schema validation ───────────────────────────────────────
    print("\n2. Schema validation:")
    try:
        # Valid input
        emp = EmployeeInput(
            salary=75000, tenureMonths=36, engagementScore=3.2,
            performanceScore=3.5, absenteeismDays=5, overtimeHours=8,
            lastPromotionMonths=18, trainingHours=20,
        )
        all_passed &= check("Valid EmployeeInput accepted", True)

        # Invalid input (engagement > 5)
        try:
            EmployeeInput(
                salary=75000, tenureMonths=36, engagementScore=6.0,
                performanceScore=3.5, absenteeismDays=5, overtimeHours=8,
                lastPromotionMonths=18, trainingHours=20,
            )
            all_passed &= check("Invalid engagement rejected", False, "Should have raised error")
        except Exception:
            all_passed &= check("Invalid engagement (6.0) rejected", True)

        # Invalid input (negative salary)
        try:
            EmployeeInput(
                salary=-1000, tenureMonths=36, engagementScore=3.0,
                performanceScore=3.5, absenteeismDays=5, overtimeHours=8,
                lastPromotionMonths=18, trainingHours=20,
            )
            all_passed &= check("Negative salary rejected", False, "Should have raised error")
        except Exception:
            all_passed &= check("Negative salary (-1000) rejected", True)
    except Exception as e:
        all_passed &= check("Schema validation tests", False, str(e))

    # ── 3. Route imports ───────────────────────────────────────────
    print("\n3. Route imports:")
    try:
        from app.routes.health import router as health_router
        all_passed &= check("health router imports", True)
    except Exception as e:
        all_passed &= check("health router imports", False, str(e))

    try:
        from app.routes.prediction import router as prediction_router
        all_passed &= check("prediction router imports", True)
    except Exception as e:
        all_passed &= check("prediction router imports", False, str(e))

    try:
        from app.routes.etl import router as etl_router
        all_passed &= check("etl router imports", True)
    except Exception as e:
        all_passed &= check("etl router imports", False, str(e))

    # ── 4. Main app imports ────────────────────────────────────────
    print("\n4. Main app:")
    try:
        from app.main import app
        all_passed &= check("FastAPI app imports", True)

        # Check that routes are registered
        routes = [r.path for r in app.routes]
        expected_routes = ["/health", "/predict", "/predict/single", "/etl/run", "/etl/status", "/model/retrain"]
        for route in expected_routes:
            all_passed &= check(f"Route '{route}' registered", route in routes, f"Found: {routes}")
    except Exception as e:
        all_passed &= check("FastAPI app imports", False, str(e))

    # ── 5. HTTP tests (requires running server) ────────────────────
    print("\n5. HTTP tests (requires running server):")
    try:
        import httpx

        client = httpx.Client(base_url=AI_SERVICE_URL, timeout=30.0)

        # Health check
        try:
            resp = client.get("/health")
            all_passed &= check(
                f"GET /health → {resp.status_code}",
                resp.status_code == 200,
            )
            if resp.status_code == 200:
                data = resp.json()
                all_passed &= check(
                    f"  model_loaded: {data.get('model_loaded')}",
                    data.get("model_loaded") is True,
                )
        except httpx.ConnectError:
            print("  ⚠️  Server not running — skipping HTTP tests")
            print("     Start with: uvicorn app.main:app --reload --port 8000")
            client.close()
            # Don't fail the whole suite for HTTP tests
            print("\n" + "=" * 60)
            if all_passed:
                print("✅ ALL IMPORT CHECKS PASSED (HTTP tests skipped)")
            else:
                print("❌ SOME CHECKS FAILED — review issues above")
            print("=" * 60)
            sys.exit(0 if all_passed else 1)

        # Single prediction
        resp = client.post("/predict/single", json={
            "salary": 75000, "tenureMonths": 36, "engagementScore": 3.2,
            "performanceScore": 3.5, "absenteeismDays": 5, "overtimeHours": 8,
            "lastPromotionMonths": 18, "trainingHours": 20,
        })
        all_passed &= check(f"POST /predict/single → {resp.status_code}", resp.status_code == 200)
        if resp.status_code == 200:
            data = resp.json()
            all_passed &= check("  Has risk_score", "risk_score" in data)
            all_passed &= check("  Has risk_level", "risk_level" in data)
            all_passed &= check("  Has risk_drivers", "risk_drivers" in data)
            all_passed &= check(
                f"  risk_score in [0,1]: {data.get('risk_score')}",
                0 <= data.get("risk_score", -1) <= 1,
            )

        # Validation error
        resp = client.post("/predict/single", json={
            "salary": 75000, "tenureMonths": 36, "engagementScore": 6.0,
            "performanceScore": 3.5, "absenteeismDays": 5, "overtimeHours": 8,
            "lastPromotionMonths": 18, "trainingHours": 20,
        })
        all_passed &= check(
            f"POST /predict/single (invalid) → {resp.status_code}",
            resp.status_code == 422,
        )

        # Team prediction
        resp = client.post("/predict", json={
            "employees": [
                {
                    "salary": 35000, "tenureMonths": 60, "engagementScore": 1.5,
                    "performanceScore": 2.0, "absenteeismDays": 15, "overtimeHours": 45,
                    "lastPromotionMonths": 48, "trainingHours": 5,
                },
                {
                    "salary": 120000, "tenureMonths": 24, "engagementScore": 4.5,
                    "performanceScore": 4.2, "absenteeismDays": 2, "overtimeHours": 3,
                    "lastPromotionMonths": 6, "trainingHours": 40,
                },
            ],
        })
        all_passed &= check(f"POST /predict → {resp.status_code}", resp.status_code == 200)
        if resp.status_code == 200:
            data = resp.json()
            all_passed &= check(f"  employee_count: {data.get('employee_count')}", data.get("employee_count") == 2)
            all_passed &= check("  Has risk_distribution", "risk_distribution" in data)
            all_passed &= check("  Has predictions", "predictions" in data)
            dist = data.get("risk_distribution", {})
            dist_sum = dist.get("LOW", 0) + dist.get("MEDIUM", 0) + dist.get("HIGH", 0)
            all_passed &= check(f"  Distribution sums to 2: {dist_sum}", dist_sum == 2)

        # ETL status
        resp = client.get("/etl/status")
        all_passed &= check(
            f"GET /etl/status → {resp.status_code}",
            resp.status_code in (200, 404),  # 404 is OK if ETL hasn't run
        )

        # Swagger docs
        resp = client.get("/docs")
        all_passed &= check(f"GET /docs (Swagger) → {resp.status_code}", resp.status_code == 200)

        client.close()

    except ImportError:
        print("  ⚠️  httpx not installed — skipping HTTP tests")
        print("     Install with: pip install httpx")
    except Exception as e:
        all_passed &= check("HTTP tests", False, str(e))

    # ── 6. Test requests file ──────────────────────────────────────
    print("\n6. Test requests file:")
    http_path = Path(__file__).parent.parent / "test-requests" / "ai-service.http"
    all_passed &= check("ai-service.http exists", http_path.exists(), str(http_path))

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
