"""
Pydantic models for the ETL pipeline endpoints.
"""

from pydantic import BaseModel


class ETLStageResult(BaseModel):
    rows: int | None = None
    columns: int | None = None
    rows_dropped: int | None = None
    duration_seconds: float | None = None
    checks_passed: str | None = None


class ETLRunResponse(BaseModel):
    status: str
    source: str | None = None
    duration_seconds: float | None = None
    stages: dict[str, ETLStageResult] | None = None
    output_path: str | None = None
    error: str | None = None


class RetrainResponse(BaseModel):
    status: str
    model_version: str | None = None
    metrics: dict | None = None
    feature_importance: dict | None = None
    error: str | None = None
