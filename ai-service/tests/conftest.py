"""
Shared pytest fixtures.

The suite runs entirely in-process against the FastAPI app via TestClient — no
uvicorn, no network, no database. The old verify_*.py scripts required a live
server on :8000; these do not, which is what makes them runnable in CI.
"""

import os
from pathlib import Path

import pandas as pd
import pytest

AI_SERVICE_ROOT = Path(__file__).parent.parent
ARTIFACTS_DIR = AI_SERVICE_ROOT / "app" / "artifacts"

TEST_API_KEY = "test-api-key-not-a-real-secret"
TEST_ADMIN_KEY = "test-admin-key-not-a-real-secret"


@pytest.fixture(scope="session", autouse=True)
def _test_env():
    """
    Pin auth keys before the app module is imported.

    app.security reads the environment on each request, and app.main calls
    load_dotenv() at import time — setting these here means the developer's real
    .env cannot leak into assertions, and the suite passes on a machine that has
    no .env at all.
    """
    os.environ["AI_SERVICE_API_KEY"] = TEST_API_KEY
    os.environ["AI_SERVICE_ADMIN_KEY"] = TEST_ADMIN_KEY
    yield


@pytest.fixture(scope="session")
def app_module(_test_env):
    from app.main import app

    return app


@pytest.fixture
def client(app_module):
    """
    TestClient without the lifespan.

    Instantiating TestClient as a context manager would run the lifespan, which
    loads the model from disk. Most tests do not need it, and skipping it keeps
    them fast and independent of whether artifacts exist.
    """
    from fastapi.testclient import TestClient

    return TestClient(app_module)


@pytest.fixture
def auth_headers():
    return {"X-API-Key": TEST_API_KEY}


@pytest.fixture
def admin_headers():
    return {"X-API-Key": TEST_ADMIN_KEY}


@pytest.fixture(scope="session")
def model_loaded():
    """
    Loads the trained artifacts once. Returns False when they are absent so
    prediction tests skip rather than fail on a fresh clone.
    """
    from app.models.predict import load_artifacts

    required = ["model.joblib", "scaler.joblib", "feature_names.joblib"]
    if not all((ARTIFACTS_DIR / f).exists() for f in required):
        return False

    return load_artifacts()


@pytest.fixture
def sample_employee() -> dict:
    """One mid-risk employee — all 8 base features the model requires."""
    return {
        "salary": 65000,
        "tenureMonths": 36,
        "engagementScore": 3.2,
        "performanceScore": 3.5,
        "absenteeismDays": 4,
        "overtimeHours": 6.0,
        "lastPromotionMonths": 18,
        "trainingHours": 20,
    }


@pytest.fixture
def high_risk_employee() -> dict:
    """Disengaged, overworked, overdue for promotion."""
    return {
        "salary": 42000,
        "tenureMonths": 48,
        "engagementScore": 1.4,
        "performanceScore": 2.1,
        "absenteeismDays": 14,
        "overtimeHours": 18.0,
        "lastPromotionMonths": 46,
        "trainingHours": 2,
    }


@pytest.fixture
def low_risk_employee() -> dict:
    """Engaged, well paid, recently promoted."""
    return {
        "salary": 95000,
        "tenureMonths": 24,
        "engagementScore": 4.8,
        "performanceScore": 4.6,
        "absenteeismDays": 1,
        "overtimeHours": 1.0,
        "lastPromotionMonths": 3,
        "trainingHours": 60,
    }


@pytest.fixture
def raw_dataframe() -> pd.DataFrame:
    """
    Deliberately dirty frame for the cleaning tests: a duplicate row, a missing
    value, an out-of-range score, a negative count, a zero tenure, and a
    lastPromotionMonths that exceeds tenure.
    """
    return pd.DataFrame(
        [
            # clean baseline
            {
                "salary": 60000, "tenureMonths": 24, "engagementScore": 3.0,
                "performanceScore": 3.0, "absenteeismDays": 3, "overtimeHours": 5.0,
                "lastPromotionMonths": 12, "trainingHours": 20, "attrition": 0,
            },
            # exact duplicate of the baseline
            {
                "salary": 60000, "tenureMonths": 24, "engagementScore": 3.0,
                "performanceScore": 3.0, "absenteeismDays": 3, "overtimeHours": 5.0,
                "lastPromotionMonths": 12, "trainingHours": 20, "attrition": 0,
            },
            # missing salary -> median imputation
            {
                "salary": None, "tenureMonths": 30, "engagementScore": 2.5,
                "performanceScore": 3.5, "absenteeismDays": 2, "overtimeHours": 8.0,
                "lastPromotionMonths": 20, "trainingHours": 15, "attrition": 1,
            },
            # engagementScore above 5 -> clipped
            {
                "salary": 70000, "tenureMonths": 40, "engagementScore": 7.5,
                "performanceScore": 3.0, "absenteeismDays": 1, "overtimeHours": 4.0,
                "lastPromotionMonths": 10, "trainingHours": 25, "attrition": 0,
            },
            # negative absenteeism -> clipped to 0
            {
                "salary": 55000, "tenureMonths": 18, "engagementScore": 3.0,
                "performanceScore": 2.0, "absenteeismDays": -5, "overtimeHours": 6.0,
                "lastPromotionMonths": 9, "trainingHours": 10, "attrition": 1,
            },
            # zero tenure -> floored to 1; promotion months exceed tenure
            {
                "salary": 80000, "tenureMonths": 0, "engagementScore": 4.0,
                "performanceScore": 4.0, "absenteeismDays": 0, "overtimeHours": 2.0,
                "lastPromotionMonths": 36, "trainingHours": 40, "attrition": 0,
            },
        ]
    )
