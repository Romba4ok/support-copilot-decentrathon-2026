"""Visible Colab subprocess logs and ensurepip-independent local bootstrap."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def run_logged(command, label, workdir, env=None):
    workdir = Path(workdir)
    logs = workdir / "logs"
    logs.mkdir(exist_ok=True, parents=True)
    logfile = logs / (label + ".log")
    child_env = {**os.environ, "PYTHONUNBUFFERED": "1", "PIP_PROGRESS_BAR": "off", **(env or {})}
    print("Running", label, "log:", str(logfile), flush=True)
    previous_tail = ""
    last_update = 0
    with logfile.open("w", encoding="utf-8") as output:
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, text=True, env=child_env)
        while process.poll() is None:
            if time.monotonic() - last_update >= 10:
                tail = logfile.read_text(encoding="utf-8", errors="replace")[-2500:]
                print(tail if tail != previous_tail else label + " still running; log retained.", flush=True)
                previous_tail = tail
                last_update = time.monotonic()
            time.sleep(.25)
    tail = logfile.read_text(encoding="utf-8", errors="replace")[-5000:]
    print(tail, flush=True)
    for manifest in sorted((workdir / "runs").glob("*/run-manifest.json")):
        state = json.loads(manifest.read_text(encoding="utf-8"))
        print(json.dumps({"manifest": str(manifest), **{key: state.get(key) for key in ("status", "model_loaded", "training_started", "optimizer_steps", "weights_saved", "actual_training", "error_message")}}), flush=True)
    print(label, "exit:", process.returncode, flush=True)
    if process.returncode:
        raise RuntimeError(label + " failed; inspect " + str(logfile))
    return logfile


def bootstrap_environment(workdir, base_python=None):
    workdir = Path(workdir)
    base_python = base_python or sys.executable
    bootstrap = workdir / "bootstrap-virtualenv"
    run_logged([base_python, "-m", "pip", "--isolated", "install", "--ignore-installed", "--no-cache-dir", "--index-url", "https://pypi.org/simple", "--target", str(bootstrap), "-r", str(workdir / "training/requirements-bootstrap.txt")], "bootstrap-packages", workdir)
    # The builtin creator seeds its bundled pip, without calling ensurepip.
    virtual_env = workdir / "venv"
    environment = {"PYTHONPATH": str(bootstrap), "VIRTUALENV_CONFIG_FILE": os.devnull}
    run_logged([base_python, "-m", "virtualenv", "--creator", "builtin", "--python", base_python, "--app-data", str(workdir / "bootstrap-cache"), "--no-periodic-update", "--no-download", str(virtual_env)], "bootstrap-venv", workdir, env=environment)
    executable = virtual_env / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    run_logged([str(executable), "-m", "pip", "--version"], "venv-pip-version", workdir)
    return executable
