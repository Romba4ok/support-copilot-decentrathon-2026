"""Explicit Colab-only exact-base paired F16/Q4 export; never publish or activate."""
import argparse
import gc
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from merge_adapter import inspect_run, materialize_clean_adapter, BASE_MODEL, BASE_REVISION
from notebook_tools import run_logged


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_reusable_tools(workdir, previous):
    """Use only explicitly named, hash-verified tools from our own prior export."""
    workdir = Path(workdir).resolve()
    exports = (workdir / "exports").resolve()
    previous = Path(previous).resolve()
    if not exports.is_relative_to(workdir) or previous.parent != exports or not previous.name.startswith("paired-"):
        raise ValueError("Reusable tools must belong to an explicit own exports/paired-* directory")
    proof_path = previous / "export-progress.json"
    if proof_path.is_symlink() or not proof_path.resolve().is_relative_to(previous):
        raise ValueError("Reusable proof must stay inside the prior export")
    proof = json.loads(proof_path.read_text(encoding="utf-8"))
    if proof.get("status") != "paired_gguf_ready_not_quality_verified" or proof.get("llama_tag") != "b11960":
        raise ValueError("Need a completed own b11960 export proof")
    repo = previous / "llama.cpp-b11960"
    quantizer = repo / "build/bin/llama-quantize"
    if repo.is_symlink() or not repo.resolve().is_relative_to(previous) or quantizer.is_symlink() or not quantizer.resolve().is_relative_to(repo.resolve()):
        raise ValueError("Reusable source and quantizer paths must remain inside the prior export")
    if not quantizer.is_file() or sha(quantizer) != proof.get("quantizer_sha256"):
        raise ValueError("Reusable quantizer SHA-256 mismatch")
    def git(*arguments):
        return subprocess.run(["git", "-C", str(repo), *arguments], capture_output=True, text=True, check=True).stdout.strip()
    commit = git("rev-parse", "HEAD")
    if commit != proof.get("llama_commit") or git("rev-parse", "b11960^{commit}") != commit:
        raise ValueError("Reusable source commit/tag differs from its export proof")
    if git("remote", "get-url", "--all", "origin") != "https://github.com/ggml-org/llama.cpp.git":
        raise ValueError("Reusable source must retain the official llama.cpp origin")
    if git("status", "--porcelain", "--untracked-files=no"):
        raise ValueError("Reusable source has modified tracked files")
    return repo, quantizer, {"previous_export": str(previous), "previous_proof_sha256": sha(proof_path), "llama_commit": commit, "llama_tag": "b11960", "quantizer_sha256": proof["quantizer_sha256"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workdir", type=Path, required=True)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--reuse-tools-from", type=Path, help="Explicit completed own exports/paired-* directory; verified source and quantizer only")
    args = parser.parse_args()
    workdir, run = args.workdir.resolve(), args.run.resolve()
    if not run.is_relative_to(workdir):
        raise ValueError("Run must stay inside this pilot workspace")
    manifest, adapter = inspect_run(run)
    if manifest.get("optimizer_steps", 0) < 20 or not manifest.get("weights_saved") or not manifest.get("weights_changed"):
        raise ValueError("Need a real completed >=20-step run with changed saved weights")
    if manifest.get("identity", {}).get("plan_schema_version") != "support-plan-v1":
        raise ValueError("Expected the aligned plan pilot")
    reusable = verify_reusable_tools(workdir, args.reuse_tools_from) if args.reuse_tools_from else None
    if not args.execute:
        print(json.dumps({"status": "export_prepared_not_executed", "base_revision": BASE_REVISION, "llama_tag": "b11960", "same_quantization": "Q4_K_M", "published": False}))
        return
    if sys.platform != "linux":
        raise RuntimeError("This bounded export runner targets the existing Colab Linux VM")
    if shutil.disk_usage(workdir).free < 12 * 1024**3:
        raise RuntimeError("Need 12 GiB free disk for paired float/GGUF outputs and CPU build")
    meminfo = Path("/proc/meminfo").read_text()
    available = next(int(line.split()[1]) * 1024 for line in meminfo.splitlines() if line.startswith("MemAvailable:"))
    if available < 4 * 1024**3:
        raise RuntimeError("Need 4 GiB available RAM for safe float merge; no other processes will be stopped")
    destination = workdir / "exports" / time.strftime("paired-%Y%m%d-%H%M%S", time.gmtime())
    destination.mkdir(parents=True, exist_ok=False)
    proof = {"status": "started", "base_model": BASE_MODEL, "base_revision": BASE_REVISION, "dataset_fingerprint": manifest["dataset_fingerprint"], "factory_source_sha256": manifest["identity"]["factory_source_sha256"], "run_manifest_sha256": sha(run / "run-manifest.json"), "provenance": "authored_synthetic", "human_reviewed": False, "actual_optimizer_steps": manifest["optimizer_steps"], "llama_tag": "b11960", "quantization": "Q4_K_M", "published": False, "activated": False}
    def save():
        (destination / "export-progress.json").write_text(json.dumps(proof, indent=2) + "\n")
    save()
    try:
        _, adapter = materialize_clean_adapter(run, destination / "clean-adapter")
        proof["clean_adapter_files"] = {path.name: sha(path) for path in adapter.iterdir()}
        proof["training_args_bin_policy"] = "original SHA-256 verified; never deserialized; excluded from clean PEFT copy"
        save()
        from huggingface_hub import snapshot_download
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from peft import PeftModel
        original = Path(snapshot_download(BASE_MODEL, revision=BASE_REVISION, token=False, local_files_only=True, cache_dir=str(workdir / "model-cache")))
        if original.name != BASE_REVISION:
            raise ValueError("Original cache revision mismatch")
        tokenizer = AutoTokenizer.from_pretrained(str(original), local_files_only=True, trust_remote_code=False)
        baseline = AutoModelForCausalLM.from_pretrained(str(original), dtype=torch.float16, device_map={"": "cpu"}, local_files_only=True, trust_remote_code=False, use_safetensors=True)
        baseline.save_pretrained(str(destination / "baseline-hf"), safe_serialization=True)
        tokenizer.save_pretrained(str(destination / "baseline-hf"))
        del baseline
        gc.collect()
        base = AutoModelForCausalLM.from_pretrained(str(original), dtype=torch.float32, device_map={"": "cpu"}, local_files_only=True, trust_remote_code=False, use_safetensors=True)
        merged = PeftModel.from_pretrained(base, str(adapter), local_files_only=True).merge_and_unload(safe_merge=True)
        merged.to(dtype=torch.float16).save_pretrained(str(destination / "adapter-hf"), safe_serialization=True)
        tokenizer.save_pretrained(str(destination / "adapter-hf"))
        del base, merged
        gc.collect()
        proof["status"] = "paired_float_saved"
        save()
        if reusable:
            repo, quantizer, reused_proof = verify_reusable_tools(workdir, args.reuse_tools_from)
            proof.update(llama_commit=reused_proof["llama_commit"], reused_tools=reused_proof, quantizer_sha256=reused_proof["quantizer_sha256"])
        else:
            repo = destination / "llama.cpp-b11960"
            run_logged(["git", "clone", "--depth", "1", "--branch", "b11960", "https://github.com/ggml-org/llama.cpp.git", str(repo)], "export-llama-source", workdir)
            proof["llama_commit"] = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        # Extra converter packages stay outside the unchanged training venv.
        # The old repo requirements pin older torch/transformers; retain the
        # patched candidate and test actual converter compatibility explicitly.
        converter_packages = destination / "converter-packages"
        run_logged([sys.executable, "-m", "pip", "install", "--no-deps", "--no-cache-dir", "--target", str(converter_packages), "sentencepiece==0.2.2", "protobuf==6.33.6"], "export-converter-extra", workdir)
        proof["converter_extra_pins"] = {"sentencepiece": "0.2.2", "protobuf": "6.33.6"}
        if not reusable:
            run_logged(["cmake", "-S", str(repo), "-B", str(repo / "build"), "-DGGML_CUDA=OFF", "-DGGML_NATIVE=OFF", "-DLLAMA_CURL=OFF", "-DLLAMA_BUILD_TESTS=OFF", "-DLLAMA_BUILD_SERVER=OFF", "-DCMAKE_BUILD_TYPE=Release"], "export-cmake-configure", workdir)
            run_logged(["cmake", "--build", str(repo / "build"), "--config", "Release", "--target", "llama-quantize", "-j", "2"], "export-cpu-quantizer", workdir)
            quantizer = repo / "build/bin/llama-quantize"
        proof["quantizer_sha256"] = sha(quantizer)
        save()
        environment = {"PYTHONPATH": str(converter_packages), "HF_HUB_OFFLINE": "1"}
        for variant in ("baseline", "adapter"):
            run_logged([sys.executable, str(repo / "convert_hf_to_gguf.py"), str(destination / (variant + "-hf")), "--outfile", str(destination / (variant + "-F16.gguf")), "--outtype", "f16"], "export-" + variant + "-f16", workdir, env=environment)
            run_logged([str(quantizer), str(destination / (variant + "-F16.gguf")), str(destination / (variant + "-Q4_K_M.gguf")), "Q4_K_M"], "export-" + variant + "-q4", workdir)
        proof.update(status="paired_gguf_ready_not_quality_verified", files={name: {"sha256": sha(destination / name), "bytes": (destination / name).stat().st_size} for name in ("baseline-F16.gguf", "adapter-F16.gguf", "baseline-Q4_K_M.gguf", "adapter-Q4_K_M.gguf")}, quantizer_sha256=sha(quantizer))
        save()
        download = destination / "download-pair"
        download.mkdir()
        for name in ("baseline-Q4_K_M.gguf", "adapter-Q4_K_M.gguf", "export-progress.json"):
            shutil.copy2(destination / name, download / name)
        for name in ("run-manifest.json", "baseline-holdout.json", "adapter-holdout.json"):
            shutil.copy2(run / name, download / name)
        archive = shutil.make_archive(str(destination / "support-plan-paired-Q4"), "zip", root_dir=str(download))
        print(json.dumps({"status": proof["status"], "archive": archive, "archive_sha256": sha(archive), "published": False, "activated": False}), flush=True)
    except BaseException as error:
        proof.update(status="export_failed", error=type(error).__name__, error_message=str(error)[:800])
        save()
        raise


if __name__ == "__main__":
    main()
