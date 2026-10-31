"""Merge a verified synthetic-only adapter into its original local float base."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

BASE_MODEL = "Qwen/Qwen3-0.6B"
BASE_REVISION = "c1899de289a04d12100db370d81485cdf75e47ca"


def inspect_run(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "run-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("status") != "completed" or manifest.get("actual_training") is not True or manifest.get("base_model") != BASE_MODEL or manifest.get("base_revision") != BASE_REVISION:
        raise ValueError("Only a completed run from the exact pinned base can be merged")
    if manifest.get("provenance") != "authored_synthetic" or manifest.get("cloud_eligible") is not True:
        raise ValueError("This import flow only handles the authored synthetic experiment")
    files = manifest.get("adapter_files", {})
    if "adapter_config.json" not in files or "adapter_model.safetensors" not in files:
        raise ValueError("Expected a PEFT config and safetensors weights")
    adapter = directory / "adapter"
    for filename, expected in files.items():
        if Path(filename).name != filename or "\\" in filename or (filename.endswith((".bin", ".pth", ".pt", ".pkl", ".pickle")) and filename != "training_args.bin"):
            raise ValueError("Unsafe adapter file name or pickle weights")
        path = adapter / filename
        if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError("Adapter SHA-256 mismatch")
        # Trainer's exact training_args.bin sidecar is HASH-ONLY. Never load,
        # unpickle, or pass it to PEFT; any other pickle/weights binary is rejected.
    config = json.loads((adapter / "adapter_config.json").read_text(encoding="utf-8"))
    if config.get("peft_type") != "LORA" or config.get("task_type") != "CAUSAL_LM" or config.get("r") != 8 or config.get("base_model_name_or_path") != BASE_MODEL:
        raise ValueError("Adapter is not the expected Qwen causal LoRA")
    if set(config.get("target_modules", [])) != {"q_proj", "k_proj", "v_proj", "o_proj"}:
        raise ValueError("Unexpected LoRA target modules")
    return manifest, adapter


def materialize_clean_adapter(directory, destination):
    """Verify the full original evidence, copy only PEFT JSON + safetensors."""
    manifest, original = inspect_run(directory)
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    for filename in ("adapter_config.json", "adapter_model.safetensors"):
        path = destination / filename
        shutil.copyfile(original / filename, path)
        if hashlib.sha256(path.read_bytes()).hexdigest() != manifest["adapter_files"][filename]:
            raise ValueError("Clean adapter copy SHA-256 mismatch")
    return manifest, destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--inspect-only", action="store_true")
    args = parser.parse_args()
    manifest, adapter = inspect_run(args.run)
    # Use a snapshot whose directory name is the recorded immutable revision.
    if args.base.resolve().name != BASE_REVISION:
        raise ValueError("--base must name the local snapshot directory of the exact recorded revision")
    config = json.loads((args.base / "config.json").read_text(encoding="utf-8"))
    if config.get("model_type") != "qwen3":
        raise ValueError("Base architecture must be qwen3")
    if args.inspect_only:
        print(json.dumps({"status": "metadata_and_adapter_hashes_verified", "merged": False, "base_revision": BASE_REVISION}))
        return
    if args.output.exists():
        raise ValueError("Choose a new output directory to preserve previous merged artifacts")
    manifest, adapter = materialize_clean_adapter(args.run, args.output.with_name(args.output.name + "-clean-adapter"))
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer
    # Reload the original float base; do not merge into the 4-bit training copy
    # or apply this adapter blindly to a differently revised official GGUF.
    base = AutoModelForCausalLM.from_pretrained(str(args.base), dtype=torch.float32, device_map={"": "cpu"}, local_files_only=True, trust_remote_code=False, use_safetensors=True)
    model = PeftModel.from_pretrained(base, str(adapter), local_files_only=True)
    merged = model.merge_and_unload(safe_merge=True)
    merged.save_pretrained(str(args.output), safe_serialization=True)
    tokenizer = AutoTokenizer.from_pretrained(str(args.base), local_files_only=True, trust_remote_code=False)
    tokenizer.save_pretrained(str(args.output))
    export = {"base_model": BASE_MODEL, "base_revision": BASE_REVISION, "dataset_fingerprint": manifest["dataset_fingerprint"], "provenance": manifest["provenance"], "stage": "float_merged_not_gguf", "inference_quality_verified": False, "files": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in args.output.iterdir() if path.is_file()}}
    (args.output / "merge-manifest.json").write_text(json.dumps(export, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "merged", "output": str(args.output), "quality_verified": False}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("merge-adapter: " + str(error), file=sys.stderr)
        sys.exit(1)
