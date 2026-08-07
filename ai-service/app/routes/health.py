"""
Health check endpoint — reports service status and model info.
"""

from fastapi import APIRouter

from app.models.predict import get_model_info, is_model_loaded

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check():
    """Service health check."""
    model_info = get_model_info()

    return {
        "status": "ok" if is_model_loaded() else "degraded",
        "service": "HR Insight AI Service",
        **model_info,
    }
