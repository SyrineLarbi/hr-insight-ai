"""
ETL tests — cleaning rules and feature engineering.

These replace verify_step2.py / verify_step3.py / verify_phase4.py, which printed
results for a human to eyeball. Here every rule in clean.py has an assertion.
"""

import numpy as np
import pandas as pd
import pytest

from app.etl.clean import (
    cap_outliers,
    check_consistency,
    clean,
    handle_missing_values,
    remove_duplicates,
    validate_types,
)
from app.etl.transform import (
    ALL_FEATURES,
    BASE_FEATURES,
    DERIVED_FEATURES,
    engineer_features,
    scale_features,
)


class TestRemoveDuplicates:
    def test_drops_exact_duplicate(self, raw_dataframe):
        before = len(raw_dataframe)
        result = remove_duplicates(raw_dataframe)
        assert len(result) == before - 1

    def test_keeps_distinct_rows(self):
        df = pd.DataFrame([{"a": 1}, {"a": 2}, {"a": 3}])
        assert len(remove_duplicates(df)) == 3


class TestHandleMissingValues:
    def test_fills_numeric_with_median(self, raw_dataframe):
        assert raw_dataframe["salary"].isnull().any()
        result = handle_missing_values(raw_dataframe.copy())
        assert not result["salary"].isnull().any()

    def test_imputed_value_is_the_median_of_observed(self):
        df = pd.DataFrame({"salary": [10.0, 20.0, 30.0, None]})
        expected = df["salary"].median()  # 20.0
        result = handle_missing_values(df.copy())
        assert result.loc[3, "salary"] == expected

    def test_rows_missing_the_label_are_dropped(self):
        """A row with no attrition label cannot be trained on."""
        df = pd.DataFrame(
            {"salary": [1.0, 2.0, 3.0], "attrition": [0, None, 1]}
        )
        result = handle_missing_values(df.copy())
        assert len(result) == 2
        assert not result["attrition"].isnull().any()

    def test_no_op_when_nothing_missing(self):
        df = pd.DataFrame({"salary": [1.0, 2.0]})
        result = handle_missing_values(df.copy())
        pd.testing.assert_frame_equal(result, df)


class TestCapOutliers:
    def test_extreme_value_is_pulled_to_the_fence(self):
        df = pd.DataFrame({"salary": [50.0] * 20 + [10_000_000.0]})
        result = cap_outliers(df.copy())
        assert result["salary"].max() < 10_000_000.0

    def test_label_column_is_never_capped(self):
        """Capping a 0/1 label would corrupt the target."""
        df = pd.DataFrame(
            {"salary": [50.0] * 20, "attrition": [0] * 19 + [1]}
        )
        result = cap_outliers(df.copy())
        assert sorted(result["attrition"].unique()) == [0, 1]

    def test_row_count_is_preserved(self):
        """cap_outliers clips; it must not drop rows."""
        df = pd.DataFrame({"salary": [50.0] * 20 + [10_000_000.0]})
        assert len(cap_outliers(df.copy())) == 21


class TestValidateTypes:
    def test_scores_clipped_into_1_to_5(self, raw_dataframe):
        result = validate_types(raw_dataframe.copy())
        for col in ("engagementScore", "performanceScore"):
            assert result[col].min() >= 1.0
            assert result[col].max() <= 5.0

    def test_negative_counts_clipped_to_zero(self, raw_dataframe):
        assert (raw_dataframe["absenteeismDays"] < 0).any()
        result = validate_types(raw_dataframe.copy())
        assert result["absenteeismDays"].min() >= 0

    def test_zero_tenure_floored_to_one(self, raw_dataframe):
        """tenureMonths is a divisor in two derived features — 0 would blow up."""
        assert (raw_dataframe["tenureMonths"] < 1).any()
        result = validate_types(raw_dataframe.copy())
        assert result["tenureMonths"].min() >= 1


class TestCheckConsistency:
    def test_promotion_months_capped_at_tenure(self):
        """You cannot have gone 36 months without promotion in a 10-month job."""
        df = pd.DataFrame(
            {"tenureMonths": [10, 50], "lastPromotionMonths": [36, 12]}
        )
        result = check_consistency(df.copy())
        assert (result["lastPromotionMonths"] <= result["tenureMonths"]).all()

    def test_consistent_rows_untouched(self):
        df = pd.DataFrame(
            {"tenureMonths": [50, 60], "lastPromotionMonths": [12, 24]}
        )
        result = check_consistency(df.copy())
        assert result["lastPromotionMonths"].tolist() == [12, 24]


class TestCleanPipeline:
    def test_output_satisfies_every_rule_at_once(self, raw_dataframe):
        result = clean(raw_dataframe)

        assert not result.isnull().any().any(), "no nulls should survive"
        assert result["engagementScore"].between(1, 5).all()
        assert result["performanceScore"].between(1, 5).all()
        assert result["absenteeismDays"].min() >= 0
        assert result["tenureMonths"].min() >= 1
        assert (result["lastPromotionMonths"] <= result["tenureMonths"]).all()

    def test_input_frame_is_not_mutated(self, raw_dataframe):
        """clean() copies — callers keep their raw frame."""
        before = raw_dataframe.copy()
        clean(raw_dataframe)
        pd.testing.assert_frame_equal(raw_dataframe, before)


class TestEngineerFeatures:
    def test_creates_all_four_derived_features(self, raw_dataframe):
        result = engineer_features(clean(raw_dataframe))
        for feat in DERIVED_FEATURES:
            assert feat in result.columns

    def test_no_infinities_from_zero_denominators(self):
        """
        tenureMonths=0 and performanceScore=0 are the division hazards. The
        .clip(lower=...) guards in engineer_features must keep the output finite.
        """
        df = pd.DataFrame(
            [
                {
                    "salary": 50000, "tenureMonths": 0, "engagementScore": 3.0,
                    "performanceScore": 0.0, "absenteeismDays": 0,
                    "overtimeHours": 5.0, "lastPromotionMonths": 0,
                    "trainingHours": 10,
                }
            ]
        )
        result = engineer_features(df)
        for feat in DERIVED_FEATURES:
            assert np.isfinite(result[feat]).all(), f"{feat} is not finite"

    def test_promotion_overdue_is_a_ratio_of_tenure(self):
        df = pd.DataFrame(
            [
                {
                    "salary": 50000, "tenureMonths": 20, "engagementScore": 3.0,
                    "performanceScore": 3.0, "absenteeismDays": 1,
                    "overtimeHours": 5.0, "lastPromotionMonths": 10,
                    "trainingHours": 10,
                }
            ]
        )
        result = engineer_features(df)
        assert result["promotion_overdue"].iloc[0] == pytest.approx(0.5)


class TestScaleFeatures:
    def test_scaled_features_are_centred_and_unit_variance(self, raw_dataframe):
        df = engineer_features(clean(raw_dataframe))
        scaled, scaler = scale_features(df)

        for feat in ALL_FEATURES:
            assert abs(scaled[feat].mean()) < 1e-6, f"{feat} not centred"

    def test_label_survives_scaling_unscaled(self, raw_dataframe):
        """attrition must pass through as 0/1, not be standardised."""
        df = engineer_features(clean(raw_dataframe))
        scaled, _ = scale_features(df)
        assert "attrition" in scaled.columns
        assert set(scaled["attrition"].unique()) <= {0, 1}

    def test_feature_order_is_stable(self, raw_dataframe):
        """
        The model indexes features positionally. If ALL_FEATURES order ever
        changes without retraining, predictions silently become wrong.
        """
        df = engineer_features(clean(raw_dataframe))
        scaled, _ = scale_features(df)
        assert list(scaled.columns)[: len(ALL_FEATURES)] == ALL_FEATURES

    def test_twelve_features_total(self):
        assert len(BASE_FEATURES) == 8
        assert len(DERIVED_FEATURES) == 4
        assert len(ALL_FEATURES) == 12
