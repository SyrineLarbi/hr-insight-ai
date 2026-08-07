"""
HR Insight AI Service — FastAPI application.

Provides ML prediction, ETL pipeline, and model management endpoints.
"""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env before anything reads os.getenv — uvicorn does not do this for us,
# so without it AI_SERVICE_API_KEY and friends are invisible to the process.
load_dotenv(Path(__file__).parent.parent / ".env")

from app.models.predict import load_artifacts  # noqa: E402
from app.routes.etl import router as etl_router  # noqa: E402
from app.routes.health import router as health_router  # noqa: E402
from app.routes.prediction import router as prediction_router  # noqa: E402
from app.security import API_KEY_HEADER, validate_startup_config  # noqa: E402

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logger.info("Starting HR Insight AI Service...")

    # Fail fast on missing auth config rather than booting an open service.
    validate_startup_config()

    loaded = load_artifacts()
    if loaded:
        logger.info("Model loaded successfully — ready for predictions")
    else:
        logger.warning("Model not found — service running in degraded mode")
        logger.warning("   Train the model first: POST /model/retrain")

    yield

    logger.info("Shutting down HR Insight AI Service...")


app = FastAPI(
    title="HR Insight AI Service",
    description=(
        "ML prediction and ETL pipeline for HR analytics.\n\n"
        f"All endpoints except `/health` require an `{API_KEY_HEADER}` header. "
        "`/etl/run` and `/model/retrain` additionally accept only the admin key."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# Only the backend calls this service. Browsers never do, so the allowlist is
# narrow and the methods/headers are explicit rather than "*".
_default_origins = "http://localhost:3010"
_origins = [
    o.strip()
    for o in os.getenv("BACKEND_ORIGIN", _default_origins).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", API_KEY_HEADER],
)

app.include_router(health_router)
app.include_router(prediction_router)
app.include_router(etl_router)
