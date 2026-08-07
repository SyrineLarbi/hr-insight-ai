"""
ETL pipeline endpoints — run the pipeline and check status.
"""

import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.etl.pipeline import run_pipeline
from app.models.predict import load_artifacts
from app.models.train import train
from app.schemas.etl import ETLRunResponse, RetrainResponse
from app.security import require_admin_key

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["ETL & Training"],
    dependencies=[Depends(require_admin_key)],
)

QUALITY_REPORT_PATH = (
    Path(__file__).parent.parent.parent / "data" / "processed" / "data_quality_report.json"
)


@router.post("/etl/run", response_model=ETLRunResponse)
async def run_etl():
    """Run the full ETL pipeline: extract -> clean -> transform -> validate."""
    try:
        result = run_pipeline()
        result.pop("quality_report", None)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ETL pipeline failed: {str(e)}")


@router.get("/etl/status")
async def etl_status():
    """Get the quality report from the last ETL run."""
    if not QUALITY_REPORT_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="No ETL run found. Run POST /etl/run first.",
        )

    with open(QUALITY_REPORT_PATH) as f:
        report = json.load(f)

    return report


@router.post("/model/retrain", response_model=RetrainResponse)
async def retrain_model():
    """Retrain the ML model on the latest processed data."""
    try:
        logger.info("Retraining: Running ETL pipeline...")
        etl_result = run_pipeline()

        if etl_result["status"] == "failed":
            return RetrainResponse(
                status="failed",
                error="ETL pipeline failed — cannot retrain on bad data",
            )

        logger.info("Retraining: Training model...")
        train_result = train()

        logger.info("Retraining: Reloading model...")
        load_artifacts()

        return RetrainResponse(
            status="success",
            model_version=train_result.get("model_version"),
            metrics=train_result.get("metrics"),
            feature_importance=train_result.get("feature_importance"),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Retrain failed: {str(e)}")
