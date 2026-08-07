"""
ETL Pipeline Orchestrator — runs the full ETL flow in sequence.
"""

import logging
import time
from pathlib import Path

import pandas as pd

from app.etl.extract import extract
from app.etl.clean import clean
from app.etl.transform import transform
from app.etl.validate import save_report, validate

logger = logging.getLogger(__name__)

RAW_DATA_PATH = Path(__file__).parent.parent.parent / "data" / "raw" / "hr_training_data.csv"
CLEANED_DIR = Path(__file__).parent.parent.parent / "data" / "cleaned"
PROCESSED_DIR = Path(__file__).parent.parent.parent / "data" / "processed"


def run_pipeline(
    source_path: str | Path | None = None,
    save_intermediates: bool = True,
) -> dict:
    """Execute the full ETL pipeline: extract -> clean -> transform -> validate."""
    start_time = time.time()
    source = Path(source_path) if source_path else RAW_DATA_PATH

    logger.info("=" * 70)
    logger.info("ETL PIPELINE: Starting full run")
    logger.info(f"  Source: {source}")
    logger.info("=" * 70)

    result = {
        "status": "running",
        "source": str(source),
        "stages": {},
    }

    try:
        # Stage 1: Extract
        logger.info("\nSTAGE 1/4: EXTRACT")
        t0 = time.time()
        df_raw = extract(str(source))
        raw_rows = len(df_raw)
        result["stages"]["extract"] = {
            "rows": raw_rows,
            "columns": len(df_raw.columns),
            "duration_seconds": round(time.time() - t0, 3),
        }
        logger.info(f"  -> {raw_rows} rows, {len(df_raw.columns)} columns")

        # Stage 2: Clean
        logger.info("\nSTAGE 2/4: CLEAN")
        t0 = time.time()
        df_cleaned = clean(df_raw)
        cleaned_rows = len(df_cleaned)
        result["stages"]["clean"] = {
            "rows": cleaned_rows,
            "columns": len(df_cleaned.columns),
            "rows_dropped": raw_rows - cleaned_rows,
            "duration_seconds": round(time.time() - t0, 3),
        }
        logger.info(f"  -> {cleaned_rows} rows ({raw_rows - cleaned_rows} dropped)")

        if save_intermediates:
            CLEANED_DIR.mkdir(parents=True, exist_ok=True)
            cleaned_path = CLEANED_DIR / "hr_cleaned.csv"
            df_cleaned.to_csv(cleaned_path, index=False)
            logger.info(f"  -> Saved to {cleaned_path}")

        # Stage 3: Transform
        logger.info("\nSTAGE 3/4: TRANSFORM")
        t0 = time.time()
        df_transformed = transform(df_cleaned)
        result["stages"]["transform"] = {
            "rows": len(df_transformed),
            "columns": len(df_transformed.columns),
            "duration_seconds": round(time.time() - t0, 3),
        }
        logger.info(f"  -> {len(df_transformed)} rows, {len(df_transformed.columns)} columns")

        if save_intermediates:
            PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
            processed_path = PROCESSED_DIR / "hr_processed.csv"
            df_transformed.to_csv(processed_path, index=False)
            logger.info(f"  -> Saved to {processed_path}")

        # Stage 4: Validate
        logger.info("\nSTAGE 4/4: VALIDATE")
        t0 = time.time()
        quality_report = validate(
            df_transformed,
            raw_row_count=raw_rows,
            cleaned_row_count=cleaned_rows,
        )
        result["stages"]["validate"] = {
            "duration_seconds": round(time.time() - t0, 3),
            "checks_passed": quality_report["summary"],
        }

        if save_intermediates:
            save_report(quality_report)

        # Done
        total_duration = round(time.time() - start_time, 3)
        result["status"] = "success" if quality_report["passed"] else "completed_with_warnings"
        result["duration_seconds"] = total_duration
        result["quality_report"] = quality_report
        result["output_path"] = str(PROCESSED_DIR / "hr_processed.csv")

        logger.info("\n" + "=" * 70)
        logger.info(f"ETL PIPELINE COMPLETE in {total_duration}s")
        logger.info(f"  Raw: {raw_rows} -> Cleaned: {cleaned_rows} -> Final: {len(df_transformed)} rows")
        logger.info(f"  Features: {len(df_transformed.columns) - 1} + 1 target")
        logger.info(f"  Status: {result['status']}")
        logger.info("=" * 70)

        return result

    except Exception as e:
        total_duration = round(time.time() - start_time, 3)
        result["status"] = "failed"
        result["duration_seconds"] = total_duration
        result["error"] = str(e)
        logger.error(f"\nPIPELINE FAILED after {total_duration}s: {e}")
        raise
