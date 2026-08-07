# Notebooks

Analysis companions to the ML service. Run them from the repo root or from `ai-service/` —
each resolves its own paths.

```bash
cd ai-service
venv/bin/python -m jupyter lab notebooks/
```

| Notebook | What it answers |
|---|---|
| `01_eda.ipynb` | What does the raw data look like, and which features carry signal? |
| `02_etl_exploration.ipynb` | Does each ETL stage do what it claims? (visual companion to `tests/test_etl.py`) |
| `03_model_experiments.ipynb` | Why XGBoost with these hyperparameters, and why is AUC-ROC 0.729 rather than 0.80? |

They are committed **unexecuted** (no stored outputs) to keep diffs readable and the repo small.
Run them locally to populate the charts.
