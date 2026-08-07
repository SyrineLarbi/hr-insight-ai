"""
Auth tests — the AI service used to accept every request from anyone who could
reach the port, including POST /model/retrain, which overwrites the artifacts on
disk. These tests are the regression guard for that.
"""

import pytest
from fastapi import HTTPException

from app.security import (
    MissingApiKeyConfig,
    _check,
    validate_startup_config,
)
from tests.conftest import TEST_ADMIN_KEY, TEST_API_KEY


class TestHealthIsPublic:
    def test_health_needs_no_key(self, client):
        """Probes must work without credentials or they are useless."""
        res = client.get("/health")
        assert res.status_code == 200
        assert "model_loaded" in res.json()


class TestPredictionRequiresKey:
    def test_missing_key_is_401(self, client, sample_employee):
        res = client.post("/predict", json={"employees": [sample_employee]})
        assert res.status_code == 401
        assert "X-API-Key" in res.json()["detail"]

    def test_wrong_key_is_403(self, client, sample_employee):
        res = client.post(
            "/predict",
            json={"employees": [sample_employee]},
            headers={"X-API-Key": "wrong-key"},
        )
        assert res.status_code == 403

    def test_single_prediction_also_guarded(self, client, sample_employee):
        res = client.post("/predict/single", json=sample_employee)
        assert res.status_code == 401

    def test_admin_key_also_accepted_for_prediction(self, client, sample_employee):
        """Admin key is a superset — it must not be rejected on read paths."""
        res = client.post(
            "/predict",
            json={"employees": [sample_employee]},
            headers={"X-API-Key": TEST_ADMIN_KEY},
        )
        # 403 would mean the admin key was rejected outright. 200 (model loaded)
        # and 503 (no model) both prove auth passed.
        assert res.status_code != 403


class TestDestructiveEndpointsRequireAdminKey:
    """
    /etl/run and /model/retrain rewrite model artifacts. A leaked read key must
    not be enough to trigger them.
    """

    def test_retrain_rejects_missing_key(self, client):
        assert client.post("/model/retrain").status_code == 401

    def test_retrain_rejects_plain_api_key(self, client):
        res = client.post("/model/retrain", headers={"X-API-Key": TEST_API_KEY})
        assert res.status_code == 403

    def test_etl_run_rejects_plain_api_key(self, client):
        res = client.post("/etl/run", headers={"X-API-Key": TEST_API_KEY})
        assert res.status_code == 403

    def test_etl_status_rejects_plain_api_key(self, client):
        res = client.get("/etl/status", headers={"X-API-Key": TEST_API_KEY})
        assert res.status_code == 403


class TestKeyComparison:
    def test_empty_provided_key_raises_401(self):
        with pytest.raises(HTTPException) as exc:
            _check(None, "expected", "api")
        assert exc.value.status_code == 401

    def test_mismatch_raises_403(self):
        with pytest.raises(HTTPException) as exc:
            _check("nope", "expected", "api")
        assert exc.value.status_code == 403

    def test_exact_match_passes(self):
        _check("expected", "expected", "api")  # must not raise

    def test_prefix_of_valid_key_is_rejected(self):
        """Guards against a truncated-comparison bug."""
        with pytest.raises(HTTPException):
            _check("expect", "expected", "api")


class TestStartupConfig:
    def test_missing_key_refuses_startup(self, monkeypatch):
        """
        The service must fail loudly rather than boot with no auth — that silent
        open state was the original vulnerability.
        """
        monkeypatch.delenv("AI_SERVICE_API_KEY", raising=False)
        monkeypatch.delenv("AI_SERVICE_ADMIN_KEY", raising=False)
        with pytest.raises(MissingApiKeyConfig):
            validate_startup_config()

    def test_blank_key_also_refuses_startup(self, monkeypatch):
        monkeypatch.setenv("AI_SERVICE_API_KEY", "   ")
        with pytest.raises(MissingApiKeyConfig):
            validate_startup_config()

    def test_configured_key_passes(self, monkeypatch):
        monkeypatch.setenv("AI_SERVICE_API_KEY", "some-key")
        validate_startup_config()  # must not raise

    def test_admin_key_falls_back_to_api_key(self, monkeypatch):
        """Single-key setups must still guard the destructive endpoints."""
        from app.security import _configured_admin_key

        monkeypatch.setenv("AI_SERVICE_API_KEY", "only-key")
        monkeypatch.delenv("AI_SERVICE_ADMIN_KEY", raising=False)
        assert _configured_admin_key() == "only-key"
