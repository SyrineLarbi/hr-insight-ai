"""
Prediction tests — model contract and API surface.

Replaces verify_step5_*.py / verify_phase5.py. Tests that need the trained
artifacts skip cleanly when they are absent, so a fresh clone still gets a green
run for everything else.
"""

import pytest

from app.models.predict import (
    RISK_THRESHOLDS,
    _classify_risk,
    _prepare_input,
    get_model_info,
    is_model_loaded,
    predict_single,
    predict_team,
)
from app.etl.transform import ALL_FEATURES

needs_model = pytest.mark.needs_model


@pytest.fixture(autouse=True)
def _require_model(request, model_loaded):
    """Skip anything marked needs_model when artifacts are missing."""
    if request.node.get_closest_marker("needs_model") and not model_loaded:
        pytest.skip("trained artifacts not present in app/artifacts/")


class TestRiskClassification:
    """Thresholds are shared with the frontend's getRiskLevel — keep them aligned."""

    def test_below_low_threshold_is_low(self):
        assert _classify_risk(0.0) == "LOW"
        assert _classify_risk(RISK_THRESHOLDS["LOW"] - 0.001) == "LOW"

    def test_at_low_threshold_is_medium(self):
        """Boundary is exclusive-below: 0.3 is MEDIUM, not LOW."""
        assert _classify_risk(RISK_THRESHOLDS["LOW"]) == "MEDIUM"

    def test_below_medium_threshold_is_medium(self):
        assert _classify_risk(RISK_THRESHOLDS["MEDIUM"] - 0.001) == "MEDIUM"

    def test_at_medium_threshold_is_high(self):
        assert _classify_risk(RISK_THRESHOLDS["MEDIUM"]) == "HIGH"

    def test_top_of_range_is_high(self):
        assert _classify_risk(1.0) == "HIGH"


class TestPrepareInput:
    @needs_model
    def test_rejects_missing_base_feature(self, sample_employee):
        incomplete = {k: v for k, v in sample_employee.items() if k != "salary"}
        with pytest.raises(ValueError, match="Missing required features"):
            _prepare_input([incomplete])

    @needs_model
    def test_produces_all_twelve_features_in_order(self, sample_employee):
        df = _prepare_input([sample_employee])
        assert list(df.columns) == ALL_FEATURES

    @needs_model
    def test_row_count_matches_input(self, sample_employee):
        df = _prepare_input([sample_employee] * 5)
        assert len(df) == 5


class TestPredictSingle:
    @needs_model
    def test_returns_the_documented_shape(self, sample_employee):
        result = predict_single(sample_employee)
        assert set(result) == {"risk_score", "risk_level", "risk_drivers"}

    @needs_model
    def test_score_is_a_probability(self, sample_employee):
        score = predict_single(sample_employee)["risk_score"]
        assert 0.0 <= score <= 1.0

    @needs_model
    def test_level_agrees_with_score(self, sample_employee):
        result = predict_single(sample_employee)
        assert result["risk_level"] == _classify_risk(result["risk_score"])

    @needs_model
    def test_returns_at_most_five_drivers(self, sample_employee):
        drivers = predict_single(sample_employee)["risk_drivers"]
        assert 0 < len(drivers) <= 5

    @needs_model
    def test_drivers_are_sorted_by_importance(self, sample_employee):
        drivers = predict_single(sample_employee)["risk_drivers"]
        importances = [d["importance"] for d in drivers]
        assert importances == sorted(importances, reverse=True)

    @needs_model
    def test_identical_input_gives_identical_output(self, sample_employee):
        """Prediction must be deterministic — reports are compared over time."""
        first = predict_single(sample_employee)
        second = predict_single(dict(sample_employee))
        assert first["risk_score"] == second["risk_score"]

    @needs_model
    def test_disengaged_overworked_scores_above_engaged_wellpaid(
        self, high_risk_employee, low_risk_employee
    ):
        """
        A directional sanity check on the model, not an accuracy claim: the
        profile that is disengaged, underpaid, and 46 months without promotion
        must not score below the engaged, well-paid, recently-promoted one.
        """
        high = predict_single(high_risk_employee)["risk_score"]
        low = predict_single(low_risk_employee)["risk_score"]
        assert high > low, f"high-risk {high} did not exceed low-risk {low}"


class TestPredictTeam:
    def test_empty_team_returns_zeroed_result_without_a_model(self):
        """The empty-team short circuit runs before any model access."""
        result = predict_team([])
        assert result["employee_count"] == 0
        assert result["team_risk_score"] == 0.0
        assert result["team_risk_level"] == "LOW"
        assert result["predictions"] == []
        assert result["high_risk_employees"] == []

    @needs_model
    def test_returns_the_documented_shape(self, sample_employee):
        result = predict_team([sample_employee] * 3)
        assert set(result) == {
            "team_risk_score",
            "team_risk_level",
            "employee_count",
            "risk_distribution",
            "high_risk_employees",
            "predictions",
        }

    @needs_model
    def test_one_prediction_per_employee(self, sample_employee):
        result = predict_team([sample_employee] * 7)
        assert result["employee_count"] == 7
        assert len(result["predictions"]) == 7

    @needs_model
    def test_distribution_sums_to_headcount(self, sample_employee, high_risk_employee):
        result = predict_team([sample_employee, high_risk_employee] * 4)
        assert sum(result["risk_distribution"].values()) == result["employee_count"]

    @needs_model
    def test_team_score_is_the_mean_of_members(
        self, sample_employee, high_risk_employee, low_risk_employee
    ):
        employees = [sample_employee, high_risk_employee, low_risk_employee]
        result = predict_team(employees)
        mean = sum(p["risk_score"] for p in result["predictions"]) / len(employees)
        assert result["team_risk_score"] == pytest.approx(mean, abs=0.001)

    @needs_model
    def test_high_risk_list_matches_the_high_bucket(self, sample_employee, high_risk_employee):
        result = predict_team([sample_employee, high_risk_employee] * 3)
        assert len(result["high_risk_employees"]) == result["risk_distribution"]["HIGH"]
        assert all(e["risk_level"] == "HIGH" for e in result["high_risk_employees"])

    @needs_model
    def test_employee_index_maps_back_to_input_order(self, sample_employee):
        result = predict_team([sample_employee] * 4)
        assert [p["employee_index"] for p in result["predictions"]] == [0, 1, 2, 3]

    @needs_model
    def test_single_member_team_score_equals_that_member(self, sample_employee):
        team = predict_team([sample_employee])
        single = predict_single(sample_employee)
        assert team["team_risk_score"] == pytest.approx(single["risk_score"], abs=0.001)


class TestModelInfo:
    def test_reports_load_state(self):
        info = get_model_info()
        assert info["model_loaded"] == is_model_loaded()

    @needs_model
    def test_exposes_version_and_feature_count(self):
        info = get_model_info()
        assert info["model_version"] is not None
        assert info["n_features"] == len(ALL_FEATURES)


class TestPredictionApi:
    """End-to-end through FastAPI, with auth."""

    @needs_model
    def test_team_prediction_returns_200(self, client, auth_headers, sample_employee):
        res = client.post(
            "/predict",
            json={"employees": [sample_employee] * 3},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["employee_count"] == 3

    @needs_model
    def test_single_prediction_returns_200(self, client, auth_headers, sample_employee):
        res = client.post("/predict/single", json=sample_employee, headers=auth_headers)
        assert res.status_code == 200
        assert 0.0 <= res.json()["risk_score"] <= 1.0

    def test_malformed_body_is_422_not_500(self, client, auth_headers):
        """Pydantic should reject bad input before it reaches the model."""
        res = client.post(
            "/predict/single",
            json={"salary": "not-a-number"},
            headers=auth_headers,
        )
        assert res.status_code == 422

    def test_out_of_range_score_is_rejected(self, client, auth_headers, sample_employee):
        bad = {**sample_employee, "engagementScore": 99}
        res = client.post("/predict/single", json=bad, headers=auth_headers)
        assert res.status_code == 422
