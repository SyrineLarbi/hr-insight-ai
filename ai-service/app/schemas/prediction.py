"""
Pydantic models for the prediction endpoints.
"""

from pydantic import BaseModel, Field


class EmployeeInput(BaseModel):
    """A single employee's features for prediction."""
    salary: float = Field(..., gt=0, description="Annual salary in currency units")
    tenureMonths: int = Field(..., ge=0, description="Months at the company")
    engagementScore: float = Field(..., ge=1.0, le=5.0, description="Engagement score (1-5)")
    performanceScore: float = Field(..., ge=1.0, le=5.0, description="Performance score (1-5)")
    absenteeismDays: int = Field(..., ge=0, description="Days absent per year")
    overtimeHours: float = Field(..., ge=0, description="Overtime hours per week")
    lastPromotionMonths: int = Field(..., ge=0, description="Months since last promotion")
    trainingHours: float = Field(..., ge=0, description="Training hours completed")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "salary": 75000,
                    "tenureMonths": 36,
                    "engagementScore": 3.2,
                    "performanceScore": 3.5,
                    "absenteeismDays": 5,
                    "overtimeHours": 8,
                    "lastPromotionMonths": 18,
                    "trainingHours": 20,
                }
            ]
        }
    }


class TeamPredictionRequest(BaseModel):
    """Request body for team-level prediction."""
    employees: list[EmployeeInput] = Field(
        ..., min_length=1, description="List of employees to predict"
    )


class RiskDriverResponse(BaseModel):
    feature: str
    importance: float
    scaled_value: float
    direction: str


class SinglePredictionResponse(BaseModel):
    risk_score: float = Field(..., ge=0, le=1, description="Attrition probability (0-1)")
    risk_level: str = Field(..., description="LOW / MEDIUM / HIGH")
    risk_drivers: list[RiskDriverResponse]


class EmployeePrediction(BaseModel):
    employee_index: int
    risk_score: float
    risk_level: str
    risk_drivers: list[RiskDriverResponse]


class RiskDistribution(BaseModel):
    LOW: int = 0
    MEDIUM: int = 0
    HIGH: int = 0


class TeamPredictionResponse(BaseModel):
    team_risk_score: float
    team_risk_level: str
    employee_count: int
    risk_distribution: RiskDistribution
    high_risk_employees: list[EmployeePrediction]
    predictions: list[EmployeePrediction]
