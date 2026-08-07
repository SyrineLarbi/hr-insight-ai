# Legacy verification scripts

These are the original Phase 1–5 verification scripts. They are **superseded** by
the pytest suite in the parent directory (`tests/test_*.py`) and are kept only for
reference.

Differences that matter:

| | These scripts | `tests/test_*.py` |
|---|---|---|
| Runner | `python tests/manual/verify_step3.py` | `pytest` |
| Needs a live server on `:8000` | Some do | No — in-process `TestClient` |
| Pass/fail signal | Printed output for a human to read | Assertions with exit codes |
| Runnable unattended | No | Yes |

`pytest.ini` sets `python_files = test_*.py`, so nothing in this directory is
collected by a normal `pytest` run.
