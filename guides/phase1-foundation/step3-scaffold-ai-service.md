# Phase 1 - Step 3: Create the Python FastAPI AI Service

## Why Are We Doing This?

The AI service is the **intelligence engine** of the platform. It handles two things that Node.js/TypeScript can't do well:

1. **Machine Learning** — Training and running an XGBoost model to predict employee turnover risk. Python is the dominant language for ML because libraries like scikit-learn, pandas, and XGBoost are Python-native. There is no equivalent in JavaScript.

2. **Data Processing (ETL)** — Cleaning, transforming, and validating raw data using pandas. Pandas gives you Excel-like data manipulation in code: filter rows, compute averages, detect outliers, handle missing values — all in a few lines.

**Why FastAPI specifically (and not Flask or Django)?**
- **FastAPI is the fastest Python web framework** — it's async by default and benchmarks close to Go/Node.js.
- **Automatic API documentation** — it generates interactive Swagger docs at `/docs` automatically. You'll test your ML endpoints right in the browser.
- **Pydantic validation** — request/response schemas are defined as Python classes. If someone sends bad data, FastAPI rejects it with a clear error before your code even runs.
- **Type hints** — FastAPI uses Python type hints, similar to TypeScript. This makes the code self-documenting.
- Used by Microsoft, Netflix, Uber — production-proven.

**Why is this a separate service from NestJS?**
This is called **microservice architecture**. Each service does one thing well:
- NestJS: business logic, auth, database, orchestration
- FastAPI: ML predictions, data processing

They communicate via HTTP (NestJS sends employee data → FastAPI returns risk scores). Benefits:
- **Different languages**: Use Python for ML (best ecosystem) and TypeScript for business logic (best for web).
- **Independent scaling**: If ML predictions are slow, you can scale the AI service without touching the backend.
- **Fault isolation**: If the ML model crashes, the rest of the app still works (backend returns a fallback message).

---

## What You Need Before Starting

Check that Python 3 is installed:

```bash
# Check Python version (need 3.10+)
python3 --version

# Check pip (Python's package manager)
pip3 --version
```

If Python is not installed, run:
```bash
sudo apt update && sudo apt install python3 python3-pip python3-venv
```

---

## The Commands

Unlike NestJS and Next.js, Python doesn't have a scaffolder CLI. We create the structure manually. This is actually a good thing — you'll understand every file and folder.

### Step A: Create the folder structure

```bash
cd /home/syrine/hr-insight-ai

mkdir -p ai-service/app/etl
mkdir -p ai-service/app/models
mkdir -p ai-service/app/routes
mkdir -p ai-service/app/schemas
mkdir -p ai-service/app/artifacts
mkdir -p ai-service/data/raw
mkdir -p ai-service/data/cleaned
mkdir -p ai-service/data/processed
mkdir -p ai-service/notebooks
```

**Breaking down the structure:**

| Folder | Purpose |
|--------|---------|
| `app/etl/` | ETL pipeline — the data cleaning modules (extract, clean, transform, validate) |
| `app/models/` | ML model code — training script, prediction logic |
| `app/routes/` | API endpoints — FastAPI route handlers |
| `app/schemas/` | Pydantic models — request/response data validation |
| `app/artifacts/` | Saved ML files — trained model (.joblib), scaler, feature names |
| `data/raw/` | Original unprocessed data (CSV for initial training) |
| `data/cleaned/` | Output of the cleaning step |
| `data/processed/` | Final training-ready features |
| `notebooks/` | Jupyter notebooks for exploration and experimentation |

### Step B: Create a Python virtual environment

```bash
cd /home/syrine/hr-insight-ai/ai-service
python3 -m venv venv
```

**What is a virtual environment and why do we need it?**

A virtual environment is an **isolated Python installation** inside your project folder. Without it, every Python project on your computer shares the same packages. This causes problems:
- Project A needs `pandas 2.0`, Project B needs `pandas 1.5` → conflict
- You install something globally that breaks another project

With a virtual environment:
- Each project has its own `venv/` folder with its own packages
- Installing `pandas` in this project doesn't affect any other project
- It's the Python equivalent of `node_modules/` in JavaScript

The `venv/` folder is created inside `ai-service/`. It contains a local copy of the Python interpreter and an empty `site-packages/` directory where pip will install packages.

### Step C: Activate the virtual environment

```bash
source /home/syrine/hr-insight-ai/ai-service/venv/bin/activate
```

**What does activation do?**
- It modifies your terminal's `PATH` so that `python` and `pip` point to the virtual environment, not the system Python.
- You'll see `(venv)` at the beginning of your terminal prompt — this confirms you're inside the virtual environment.
- **Important**: You need to run this activation command every time you open a new terminal to work on the AI service.

To deactivate later (go back to system Python):
```bash
deactivate
```

### Step D: Create the `__init__.py` files

In Python, `__init__.py` files mark a folder as a **Python package** — this allows you to import modules from that folder. They can be empty.

```bash
touch /home/syrine/hr-insight-ai/ai-service/app/__init__.py
touch /home/syrine/hr-insight-ai/ai-service/app/etl/__init__.py
touch /home/syrine/hr-insight-ai/ai-service/app/models/__init__.py
touch /home/syrine/hr-insight-ai/ai-service/app/routes/__init__.py
touch /home/syrine/hr-insight-ai/ai-service/app/schemas/__init__.py
```

**Why do we need `__init__.py`?**
Without these files, Python won't recognize the folders as importable packages. For example, `from app.models.predict import PredictionService` would fail because Python doesn't know `app/models/` is a package.

### Step E: Create the main FastAPI app file

Create the file `ai-service/app/main.py` with this content:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="HR Insight AI Service",
    description="ML prediction and ETL pipeline for HR analytics",
    version="1.0.0",
)

# CORS: Allow the NestJS backend to call this service
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # NestJS backend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "HR Insight AI Service",
        "model_loaded": False,  # Will become True once we train the model
    }
```

**What each part does:**

- `FastAPI(...)` — Creates the app instance. The `title` and `description` appear in the auto-generated docs.
- `CORSMiddleware` — **Cross-Origin Resource Sharing**. Without this, the NestJS backend (running on port 3000) would be blocked from calling the AI service (port 8000). Browsers enforce this security policy. CORS tells the browser "it's okay, port 3000 is allowed to talk to me."
- `@app.get("/health")` — A health check endpoint. It returns a simple JSON confirming the service is alive. Every production API has one — monitoring tools ping it to detect outages.

### Step F: Create the requirements file

Create the file `ai-service/requirements.txt` with this content:

```
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
pydantic>=2.10.0
scikit-learn>=1.6.0
xgboost>=2.1.0
pandas>=2.2.3
numpy>=2.1.0
joblib>=1.4.0
python-dotenv>=1.0.0
psycopg2-binary>=2.9.10
sqlalchemy>=2.0.36
matplotlib>=3.9.0
seaborn>=0.13.0
jupyter>=1.1.0
httpx>=0.28.0
```

> **Note about Python 3.13 compatibility**: We use `>=` (minimum version) instead of `==` (exact version) here. Your system runs Python 3.13 which is very new — some older pinned versions can't compile their C extensions on 3.13. Using `>=` lets pip find the newest compatible version. In a corporate team environment, you'd pin exact versions AND lock the Python version (e.g., Python 3.12) using Docker or pyenv. Since we're local-only, `>=` is the pragmatic choice.

**What each package does:**

| Package | Purpose |
|---------|---------|
| `fastapi` | The web framework (handles HTTP requests) |
| `uvicorn` | The ASGI server (actually runs the FastAPI app — like `node` runs Express) |
| `pydantic` | Data validation (request/response schemas) |
| `scikit-learn` | ML utilities: train/test split, metrics, preprocessing |
| `xgboost` | The ML algorithm we'll use for turnover prediction |
| `pandas` | Data manipulation: DataFrames, cleaning, aggregation |
| `numpy` | Numerical computing (pandas and scikit-learn depend on it) |
| `joblib` | Save/load trained ML models to disk |
| `python-dotenv` | Load `.env` files (database URLs, API keys) |
| `psycopg2-binary` | PostgreSQL driver (to connect to Neon DB from Python) |
| `sqlalchemy` | SQL toolkit (alternative to writing raw SQL queries) |
| `matplotlib` | Charts and plots (for Jupyter notebooks / EDA) |
| `seaborn` | Statistical visualizations (builds on matplotlib, prettier defaults) |
| `jupyter` | Jupyter notebooks (interactive coding for data exploration) |
| `httpx` | Async HTTP client (if the AI service needs to call external APIs) |

**Why pin versions (e.g., `fastapi==0.115.0`)?**
Without pinning, `pip install fastapi` installs the latest version. If a new version has breaking changes, your code breaks. Pinning ensures everyone gets the exact same version — this is called **reproducible builds** and is mandatory in professional projects.

### Step G: Install the packages

Make sure your virtual environment is activated (you should see `(venv)` in the prompt), then:

```bash
cd /home/syrine/hr-insight-ai/ai-service
pip install -r requirements.txt
```

This downloads and installs all packages listed in `requirements.txt`. It takes 2-5 minutes (some packages like `numpy` and `scikit-learn` are large).

**Note**: If any package fails to install due to version issues, you can try removing the version pin for that specific package (change `==` to `>=`).

---

## How to Verify It Worked

**Step A: Start the FastAPI server**

Make sure the virtual environment is active, then:

```bash
cd /home/syrine/hr-insight-ai/ai-service
uvicorn app.main:app --reload --port 8000
```

**Breaking down the command:**

| Part | What it does |
|------|-------------|
| `uvicorn` | The ASGI server that runs FastAPI apps |
| `app.main:app` | Path to the app: file `app/main.py`, variable name `app` |
| `--reload` | Hot reload on code changes (like `npm run start:dev`) |
| `--port 8000` | Listen on port 8000 |

**Expected terminal output:**
```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [xxxxx] using WatchFiles
INFO:     Started server process [xxxxx]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

**Step B: Test the health endpoint**

In a new terminal:
```bash
curl http://localhost:8000/health
```

**Expected response:**
```json
{"status":"ok","service":"HR Insight AI Service","model_loaded":false}
```

**Step C: Check the auto-generated docs**

Open your browser and go to: **http://localhost:8000/docs**

You should see **Swagger UI** — an interactive API documentation page. It shows your `/health` endpoint and lets you test it right in the browser by clicking "Try it out". This is auto-generated by FastAPI from your code — no extra work needed.

**Step D: Stop the server**
Press `Ctrl+C` in the terminal.

---

## What Your Project Looks Like Now

After completing this step, you have 3 services:

```
/home/syrine/hr-insight-ai/
  backend/        ← NestJS (port 3000)   — "Hello World!"
  frontend/       ← Next.js (port 3001)  — Welcome page
  ai-service/     ← FastAPI (port 8000)  — Health check ✓
  docs/           ← Progress tracker + guides
```

Three services, three different languages/frameworks, three different ports. This is a real microservice architecture.

---


1. Open VS Code
2. Press `Ctrl+Shift+P` (Command Palette)
3. Type: **Python: Select Interpreter**
4. Choose the one that shows your venv path:
   `./ai-service/venv/bin/python` or `/home/syrine/hr-insight-ai/ai-service/venv/bin/python`

After selecting it, the red import underlines should disappear within a few seconds. This tells Pylance "look for packages in this virtual environment, not the system Python."

**Why does this happen?**
VS Code doesn't automatically know which Python environment to use. Your system Python doesn't have fastapi installed — only the venv does. By pointing VS Code to the venv interpreter, it finds all installed packages.


---

## Checklist (confirm before moving to Step 4)

- [ ] `ai-service/` folder exists with all subfolders (app/etl, app/models, app/routes, app/schemas, app/artifacts, data/raw, data/cleaned, data/processed, notebooks)
- [ ] Virtual environment created (`venv/` folder exists inside ai-service)
- [ ] Virtual environment activates (`source venv/bin/activate` shows `(venv)` prompt)
- [ ] All `__init__.py` files created (in app/, app/etl/, app/models/, app/routes/, app/schemas/)
- [ ] `app/main.py` created with FastAPI health endpoint
- [ ] `requirements.txt` created with all packages listed
- [ ] `pip install -r requirements.txt` completed without errors
- [ ] `uvicorn app.main:app --reload --port 8000` starts without errors
- [ ] `curl http://localhost:8000/health` returns `{"status":"ok",...}`
- [ ] Browser shows Swagger docs at `http://localhost:8000/docs`

---

Once you've confirmed all checkboxes, tell me and I'll generate **Step 4: Install Backend Dependencies**.
