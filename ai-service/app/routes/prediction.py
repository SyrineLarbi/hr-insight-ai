"""
Prediction endpoints — the core API that the NestJS backend calls.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.models.predict import is_model_loaded, predict_single, predict_team
from app.security import require_api_key
from app.schemas.prediction import (
    EmployeeInput,
    SinglePredictionResponse,
    TeamPredictionRequest,
    TeamPredictionResponse,
)

router = APIRouter(
    prefix="/predict",
    tags=["Prediction"],
    dependencies=[Depends(require_api_key)],
)


@router.post("", response_model=TeamPredictionResponse)
async def predict_team_endpoint(request: TeamPredictionRequest):
    """Predict attrition risk for a team of employees."""
    if not is_model_loaded():
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Train the model first via POST /model/retrain",
        )

    try:
        employees_data = [emp.model_dump() for emp in request.employees]
        result = predict_team(employees_data)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@router.post("/single", response_model=SinglePredictionResponse)
async def predict_single_endpoint(employee: EmployeeInput):
    """Predict attrition risk for a single employee."""
    if not is_model_loaded():
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Train the model first via POST /model/retrain",
        )

    try:
        result = predict_single(employee.model_dump())
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")
