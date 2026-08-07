"""
Phase 5 Step 2 Verification — Prediction Module
Run: cd ai-service && source venv/bin/activate && python tests/verify_step5_2.py
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


# Sample employee profiles for testing
HIGH_RISK_EMPLOYEE = {
    "salary": 35000,
    "tenureMonths": 60,
    "engagementScore": 1.5,
    "performanceScore": 2.0,
    "absenteeismDays": 15,
    "overtimeHours": 45,
    "lastPromotionMonths": 48,
    "trainingHours": 5,
}

LOW_RISK_EMPLOYEE = {
    "salary": 120000,
    "tenureMonths": 24,
    "engagementScore": 4.5,
    "performanceScore": 4.2,
    "absenteeismDays": 2,
    "overtimeHours": 3,
    "lastPromotionMonths": 6,
    "trainingHours": 40,
}

MEDIUM_RISK_EMPLOYEE = {
    "salary": 75000,
    "tenureMonths": 36,
    "engagementScore": 3.0,
    "performanceScore": 3.2,
    "absenteeismDays": 7,
    "overtimeHours": 12,
    "lastPromotionMonths": 24,
    "trainingHours": 20,
}


def main():
    all_passed = True

    print("=" * 60)
    print("Phase 5 Step 2 — Prediction Module Verification")
    print("=" * 60)

    # ── 1. Module import ───────────────────────────────────────────
    print("\n1. Module import:")
    try:
        import logging
        logging.basicConfig(level=logging.WARNING)
        from app.models.predict import (
            load_artifacts,
            is_model_loaded,
            predict_single,
            predict_team,
            get_model_info,
        )
        all_passed &= check("predict module imports successfully", True)
    except Exception as e:
        all_passed &= check("predict module imports successfully", False, str(e))
        print("\n⛔ Cannot proceed without predict module")
        sys.exit(1)

    # ── 2. Load artifacts ──────────────────────────────────────────
    print("\n2. Load artifacts:")
    loaded = load_artifacts()
    all_passed &= check("load_artifacts() returns True", loaded)
    all_passed &= check("is_model_loaded() returns True", is_model_loaded())

    if not loaded:
        print("\n⛔ Model not loaded. Train the model first (Step 1)")
        sys.exit(1)

    # ── 3. Model info ──────────────────────────────────────────────
    print("\n3. Model info:")
    info = get_model_info()
    all_passed &= check(f"model_loaded: {info.get('model_loaded')}", info.get("model_loaded") is True)
    all_passed &= check(f"model_version: {info.get('model_version')}", info.get("model_version") is not None)

    # ── 4. Single prediction — high risk ───────────────────────────
    print("\n4. Single prediction (high-risk employee):")
    try:
        result_high = predict_single(HIGH_RISK_EMPLOYEE)

        all_passed &= check("Returns 'risk_score'", "risk_score" in result_high)
        all_passed &= check("Returns 'risk_level'", "risk_level" in result_high)
        all_passed &= check("Returns 'risk_drivers'", "risk_drivers" in result_high)

        score = result_high["risk_score"]
        level = result_high["risk_level"]
        drivers = result_high["risk_drivers"]

        all_passed &= check(
            f"risk_score in [0, 1]: {score}",
            0 <= score <= 1,
        )
        all_passed &= check(
            f"risk_level is valid: {level}",
            level in ("LOW", "MEDIUM", "HIGH"),
        )
        all_passed &= check(
            f"risk_drivers has ≤ 5 entries: {len(drivers)}",
            len(drivers) <= 5,
        )

        # Check driver structure
        if drivers:
            d = drivers[0]
            all_passed &= check(
                "Driver has 'feature', 'importance', 'scaled_value', 'direction'",
                all(k in d for k in ("feature", "importance", "scaled_value", "direction")),
            )

        print(f"    Score: {score}, Level: {level}")
    except Exception as e:
        all_passed &= check("Single prediction works", False, str(e))

    # ── 5. Single prediction — low risk ────────────────────────────
    print("\n5. Single prediction (low-risk employee):")
    try:
        result_low = predict_single(LOW_RISK_EMPLOYEE)
        score_low = result_low["risk_score"]
        print(f"    Score: {score_low}, Level: {result_low['risk_level']}")

        all_passed &= check(
            f"risk_score in [0, 1]: {score_low}",
            0 <= score_low <= 1,
        )
    except Exception as e:
        all_passed &= check("Low-risk prediction works", False, str(e))

    # ── 6. Risk ordering check ─────────────────────────────────────
    print("\n6. Risk ordering:")
    try:
        score_high = result_high["risk_score"]
        score_low = result_low["risk_score"]
        all_passed &= check(
            f"High-risk ({score_high:.4f}) > Low-risk ({score_low:.4f})",
            score_high > score_low,
            "Model should rank high-risk employee higher than low-risk",
        )
    except Exception:
        all_passed &= check("Risk ordering comparison", False, "Could not compare scores")

    # ── 7. Team prediction ─────────────────────────────────────────
    print("\n7. Team prediction:")
    try:
        team = [HIGH_RISK_EMPLOYEE, LOW_RISK_EMPLOYEE, MEDIUM_RISK_EMPLOYEE]
        team_result = predict_team(team)

        expected_fields = [
            "team_risk_score", "team_risk_level", "employee_count",
            "risk_distribution", "predictions", "high_risk_employees",
        ]
        for field in expected_fields:
            all_passed &= check(f"Has '{field}'", field in team_result)

        all_passed &= check(
            f"employee_count: {team_result.get('employee_count')}",
            team_result.get("employee_count") == 3,
        )

        # Risk distribution sums to employee count
        dist = team_result.get("risk_distribution", {})
        dist_sum = sum(dist.values())
        all_passed &= check(
            f"Distribution sums to {dist_sum} (expected 3)",
            dist_sum == 3,
        )

        all_passed &= check(
            f"team_risk_score in [0, 1]: {team_result.get('team_risk_score')}",
            0 <= team_result.get("team_risk_score", -1) <= 1,
        )

        # Per-employee predictions
        preds = team_result.get("predictions", [])
        all_passed &= check(f"predictions has {len(preds)} entries", len(preds) == 3)

        print(f"    Team risk: {team_result['team_risk_score']}, Level: {team_result['team_risk_level']}")
        print(f"    Distribution: {dist}")
    except Exception as e:
        all_passed &= check("Team prediction works", False, str(e))

    # ── 8. Empty team ──────────────────────────────────────────────
    print("\n8. Empty team prediction:")
    try:
        empty_result = predict_team([])
        all_passed &= check(
            f"Empty team returns employee_count=0",
            empty_result.get("employee_count") == 0,
        )
        all_passed &= check(
            "Empty team returns empty predictions list",
            empty_result.get("predictions") == [],
        )
    except Exception as e:
        all_passed &= check("Empty team prediction works", False, str(e))

    # ── Summary ────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    if all_passed:
        print("✅ ALL CHECKS PASSED — Step 2 complete!")
    else:
        print("❌ SOME CHECKS FAILED — review issues above")
    print("=" * 60)

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
