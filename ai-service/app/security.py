"""
Shared-secret authentication for the AI service.

This service is only ever called by the NestJS backend, never by a browser, so a
static API key in a header is the right weight — no user identities to model, no
token lifecycle to manage. The backend sends the same key on every request.

Two tiers:
  - `require_api_key` guards prediction endpoints (read-only, called per report)
  - `require_admin_key` guards /etl/run and /model/retrain, which overwrite the
    model artifacts on disk and must not be reachable by anything but an operator

If AI_SERVICE_API_KEY is unset the service refuses to start rather than silently
running open, which is how it behaved before.
"""

import hmac
import logging
import os

from fastapi import Header, HTTPException, status

logger = logging.getLogger(__name__)

API_KEY_HEADER = "X-API-Key"


class MissingApiKeyConfig(RuntimeError):
    """Raised at startup when the service has no key configured."""


def _configured_key() -> str:
    key = os.getenv("AI_SERVICE_API_KEY", "").strip()
    if not key:
        raise MissingApiKeyConfig(
            "AI_SERVICE_API_KEY is not set. The AI service will not start "
            "without it — see ai-service/.env.example."
        )
    return key


def _configured_admin_key() -> str:
    # Falls back to the main key so a single-key setup still works; set it
    # separately when the retrain endpoints should need a stronger secret.
    return os.getenv("AI_SERVICE_ADMIN_KEY", "").strip() or _configured_key()


def validate_startup_config() -> None:
    """Called from the app lifespan so a misconfigured deploy fails loudly."""
    _configured_key()

    if os.getenv("AI_SERVICE_ADMIN_KEY", "").strip():
        logger.info("Auth: separate admin key configured for ETL/retrain")
    else:
        logger.info("Auth: single API key guards all protected endpoints")


def _check(provided: str | None, expected: str, scope: str) -> None:
    if not provided:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Missing {API_KEY_HEADER} header",
            headers={"WWW-Authenticate": API_KEY_HEADER},
        )

    # compare_digest so a wrong key takes the same time to reject as a right
    # one, which keeps the comparison from leaking the prefix.
    if not hmac.compare_digest(provided, expected):
        logger.warning("Auth: rejected request with invalid %s key", scope)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key",
        )


async def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """
    Dependency for prediction endpoints.

    The admin key is a superset — it opens the read paths too, so an operator
    holding only the admin secret is not locked out of /predict.
    """
    expected = _configured_key()
    admin = _configured_admin_key()

    if x_api_key and admin != expected and hmac.compare_digest(x_api_key, admin):
        return

    _check(x_api_key, expected, "api")


async def require_admin_key(x_api_key: str | None = Header(default=None)) -> None:
    """Dependency for endpoints that rewrite model artifacts."""
    _check(x_api_key, _configured_admin_key(), "admin")
