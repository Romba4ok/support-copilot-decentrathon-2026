"""Explicit, synthetic-only LoRA/QLoRA experiment. --dry-run uses stdlib only."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import sys
import time

BASE_MODEL = "Qwen/Qwen3-0.6B"
BASE_REVISION = "c1899de289a04d12100db370d81485cdf75e47ca"
TARGET_KEYS = {"reply", "source_ids", "needs_human"}
UNSAFE = re.compile(r"https?://|www\.|\b\d{1,2}(?:\.\d{1,3}){1,3}\b|(?:will|guarantee).{0,25}(?:ban|refund|unban|punish|restore)|верн[её]м|разбаним|накажем|забаним|reembolsaremos|desbanearemos|baniremos|puniremos|қайтарамыз|жазалаймыз|qaytaramiz|jazolaymiz", re.I)


def sha(data):
    return hashlib.sha256(data.encode("utf-8") if isinstance(data, str) else data).hexdigest()


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def save_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


def validate_target(target, prompt):
    if not isinstance(target, dict) or set(target) != TARGET_KEYS:
        raise ValueError("Target must have exactly reply, source_ids, needs_human")
    if not isinstance(target["reply"], str) or not target["reply"].strip() or len(target["reply"]) > 4000 or UNSAFE.search(target["reply"]):
        raise ValueError("Unsafe or invalid reply")
    if not isinstance(target["source_ids"], list) or target["source_ids"] != []:
        raise ValueError("This synthetic-only experiment supplies no official citations")
    if not isinstance(target["needs_human"], bool) or (prompt["needs_human"] and not target["needs_human"]):
        raise ValueError("Target cannot lower a human gate")


def prompt_text(row, tokenizer, system_prompt):
    return tokenizer.apply_chat_template([{"role": "system", "content": system_prompt}, {"role": "user", "content": compact(row["input"])}], tokenize=False, add_generation_prompt=True, enable_thinking=False)


def encode_example(row, tokenizer, system_prompt, max_length):
    prompt = tokenizer.encode(prompt_text(row, tokenizer, system_prompt), add_special_tokens=False)
    completion = tokenizer.encode(compact(row["target"]) + tokenizer.eos_token, add_special_tokens=False)
    if len(prompt) + len(completion) > max_length:
        raise ValueError("Example exceeds max-length; do not truncate grounding or supervised JSON")
    return {"input_ids": prompt + completion, "attention_mask": [1] * (len(prompt) + len(completion)), "labels": [-100] * len(prompt) + completion}


def load_data(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1 or manifest.get("base_model") != BASE_MODEL or manifest.get("base_revision") != BASE_REVISION:
        raise ValueError("Unsupported dataset/model revision")
    if manifest.get("cloud_eligible") is not True or manifest.get("provenance") != "authored_synthetic" or manifest.get("human_reviewed") is not False or manifest.get("official_citation_training") is not False:
        raise ValueError("Only explicitly cloud-eligible author synthetic data is accepted")
    datasets = {}
    for name in ("train", "holdout"):
        raw = (directory / (name + ".jsonl")).read_bytes()
        if sha(raw) != manifest.get("files", {}).get(name + ".jsonl"):
            raise ValueError("Dataset SHA-256 mismatch: " + name)
        rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
        if not rows:
            raise ValueError("Empty " + name)
        for row in rows:
            if set(row) != {"id", "group_id", "scenario_group", "provenance", "input", "target", "duplicate_key"}:
                raise ValueError("Row allowlist violation")
            provenance = row.get("provenance", {})
            if provenance.get("type") != "authored_synthetic" or provenance.get("contains_private_data") is not False or provenance.get("human_reviewed") is not False or provenance.get("cloud_eligible") is not True:
                raise ValueError("Non-synthetic or private row rejected")
            prompt = row.get("input", {})
            if set(prompt) != {"kind", "lang", "player_messages", "guidance", "sources", "needs_human"} or prompt["sources"] != [] or not isinstance(prompt["needs_human"], bool):
                raise ValueError("Prompt allowlist violation")
            if not isinstance(prompt["player_messages"], list) or not prompt["player_messages"] or any(not isinstance(text, str) or not text.strip() for text in prompt["player_messages"]):
                raise ValueError("Invalid player-only messages")
            validate_target(row["target"], prompt)
        datasets[name] = rows
    train, holdout = datasets["train"], datasets["holdout"]
    for key in ("id", "group_id", "scenario_group", "duplicate_key"):
        if {row[key] for row in train} & {row[key] for row in holdout}:
            raise ValueError("Train/holdout leakage in " + key)
    if sha(compact({"train": train, "holdout": holdout})) != manifest.get("fingerprint"):
        raise ValueError("Dataset fingerprint mismatch")
    if len(train) != manifest.get("train_examples") or len(holdout) != manifest.get("holdout_examples"):
        raise ValueError("Dataset count mismatch")
    return manifest, train, holdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--train", action="store_true")
    parser.add_argument("--method", choices=["qlora", "lora"], default="qlora")
    parser.add_argument("--max-steps", type=int, default=20)
    parser.add_argument("--max-length", type=int, default=1024)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--local-model", type=Path)
    args = parser.parse_args()
    if not 1 <= args.max_steps <= 10000 or not 256 <= args.max_length <= 2048:
        raise ValueError("Bounds: max-steps 1–10000, max-length 256–2048")
    manifest, train, holdout = load_data(args.data_dir)
    identity = {"base_model": BASE_MODEL, "base_revision": BASE_REVISION, "dataset_fingerprint": manifest["fingerprint"], "method": args.method, "max_length": args.max_length, "seed": args.seed, "lora_rank": 8, "lora_alpha": 16, "target_modules": ["q_proj", "k_proj", "v_proj", "o_proj"], "max_steps": args.max_steps}
    args.output.mkdir(parents=True, exist_ok=True)
    if args.dry_run:
        report = {**identity, "status": "dry_run_passed", "actual_training": False, "train_examples": len(train), "holdout_examples": len(holdout), "provenance": "authored_synthetic", "human_reviewed": False, "official_citation_training": False, "network_requests": 0, "model_loaded": False, "purpose": manifest["purpose"]}
        save_json(args.output / "dry-run.json", report)
        print(json.dumps(report, ensure_ascii=False))
        return
    if sys.version_info[:2] < (3, 11) or sys.version_info[:2] > (3, 12):
        raise RuntimeError("GPU experiment expects Python 3.11–3.12; dry-run supports newer stdlib Python")
    if args.local_model and args.local_model.resolve().name != BASE_REVISION:
        raise ValueError("--local-model must name the exact original base revision snapshot directory")
    os.environ.update({"HF_HUB_DISABLE_TELEMETRY": "1", "WANDB_DISABLED": "true", "TOKENIZERS_PARALLELISM": "false"})
    pinned = dict(line.strip().split("==", 1) for line in Path(__file__).with_name("requirements-colab.txt").read_text(encoding="utf-8").splitlines() if "==" in line and not line.lstrip().startswith("#"))
    for package, version in pinned.items():
        if importlib.metadata.version(package) != version:
            raise RuntimeError("Dependency drift: install training/requirements-colab.txt in an isolated environment")
    import torch
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, Trainer, TrainingArguments, set_seed
    from transformers.trainer_utils import get_last_checkpoint
    if not torch.cuda.is_available():
        raise RuntimeError("No CUDA GPU is available; Colab allocation is not guaranteed")
    if torch.cuda.get_device_properties(0).total_memory < 5 * 1024**3:
        raise RuntimeError("At least 5 GiB CUDA VRAM is required for this bounded experiment")
    state_path = args.output / "run-manifest.json"
    if state_path.exists():
        previous = json.loads(state_path.read_text(encoding="utf-8"))
        if previous.get("identity") != identity or not args.resume:
            raise ValueError("Existing run requires --resume and identical model/data/training identity")
    elif args.resume:
        raise ValueError("No existing run manifest to resume")
    set_seed(args.seed)
    source = str(args.local_model) if args.local_model else BASE_MODEL
    load_args = {"revision": BASE_REVISION, "trust_remote_code": False, "local_files_only": bool(args.local_model), "token": False, "cache_dir": str(args.data_dir.parent / "model-cache")}
    tokenizer = AutoTokenizer.from_pretrained(source, **load_args)
    tokenizer.pad_token = tokenizer.eos_token
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    model_args = {**load_args, "dtype": dtype, "device_map": {"": 0}, "attn_implementation": "eager", "use_safetensors": True}
    if args.method == "qlora":
        model_args["quantization_config"] = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=dtype)
    model = AutoModelForCausalLM.from_pretrained(source, **model_args)
    if args.method == "qlora":
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    else:
        model.enable_input_require_grads()
    model.config.use_cache = False
    model = get_peft_model(model, LoraConfig(r=8, lora_alpha=16, lora_dropout=.05, target_modules=identity["target_modules"], bias="none", task_type="CAUSAL_LM"))
    model.peft_config["default"].base_model_name_or_path = BASE_MODEL
    model.peft_config["default"].revision = BASE_REVISION
    model.print_trainable_parameters()

    def collate(rows):
        width = max(len(row["input_ids"]) for row in rows)
        return {key: torch.tensor([row[key] + [padding] * (width - len(row[key])) for row in rows], dtype=torch.long) for key, padding in (("input_ids", tokenizer.pad_token_id), ("attention_mask", 0), ("labels", -100))}

    train_encoded = [encode_example(row, tokenizer, manifest["system_prompt"], args.max_length) for row in train]
    holdout_encoded = [encode_example(row, tokenizer, manifest["system_prompt"], args.max_length) for row in holdout]
    def generate_metrics(label):
        model.eval()
        outputs = []
        start = time.monotonic()
        for row in holdout:
            tokens = tokenizer(prompt_text(row, tokenizer, manifest["system_prompt"]), return_tensors="pt", add_special_tokens=False).to("cuda")
            with torch.inference_mode():
                produced = model.generate(**tokens, max_new_tokens=160, do_sample=False, pad_token_id=tokenizer.pad_token_id)
            reply = tokenizer.decode(produced[0, tokens["input_ids"].shape[1]:], skip_special_tokens=True).strip()
            valid_json = False
            safe = False
            try:
                parsed = json.loads(reply)
                valid_json = True
                validate_target(parsed, row["input"])
                safe = True
            except (ValueError, TypeError, KeyError):
                pass
            outputs.append({"id": row["id"], "raw_output": reply, "json_valid": valid_json, "contract_and_basic_safety_valid": safe})
        report = {"variant": label, "provenance": "authored_synthetic", "human_reviewed": False, "denominator": len(outputs), "json_valid": sum(row["json_valid"] for row in outputs), "contract_and_basic_safety_valid": sum(row["contract_and_basic_safety_valid"] for row in outputs), "elapsed_seconds": time.monotonic() - start, "outputs": outputs, "limitations": "Format/hard-gate smoke checks only; not human response relevance or official citation evaluation"}
        save_json(args.output / (label + "-holdout.json"), report)
        return report

    run = {"identity": identity, "status": "running", "actual_training": True, "provenance": "authored_synthetic", "cloud_eligible": True, "human_reviewed": False, "base_model": BASE_MODEL, "base_revision": BASE_REVISION, "dataset_fingerprint": manifest["fingerprint"], "dependencies": pinned, "gpu": torch.cuda.get_device_name(0), "python": sys.version.split()[0]}
    save_json(state_path, run)
    if not args.resume:
        with model.disable_adapter():
            generate_metrics("baseline")
    training_args = TrainingArguments(output_dir=str(args.output / "checkpoints"), per_device_train_batch_size=1, per_device_eval_batch_size=1, gradient_accumulation_steps=4, max_steps=args.max_steps, learning_rate=2e-4, warmup_ratio=.05, lr_scheduler_type="cosine", logging_steps=1, eval_strategy="steps", eval_steps=10, save_strategy="steps", save_steps=10, save_total_limit=2, fp16=dtype == torch.float16, bf16=dtype == torch.bfloat16, gradient_checkpointing=True, optim="adamw_torch", report_to=[], push_to_hub=False, seed=args.seed, data_seed=args.seed, remove_unused_columns=False, dataloader_num_workers=0)
    trainer = Trainer(model=model, args=training_args, train_dataset=train_encoded, eval_dataset=holdout_encoded, data_collator=collate, processing_class=tokenizer)
    checkpoint = get_last_checkpoint(str(args.output / "checkpoints")) if args.resume else None
    if args.resume and checkpoint is None:
        raise ValueError("No complete Trainer checkpoint; keep the old run and choose a fresh output directory")
    try:
        result = trainer.train(resume_from_checkpoint=checkpoint)
        trainer.save_model(str(args.output / "adapter"))
        tokenizer.save_pretrained(str(args.output / "adapter"))
        metrics = generate_metrics("adapter")
        adapter_files = {item.name: sha(item.read_bytes()) for item in (args.output / "adapter").iterdir() if item.is_file()}
        run.update(status="completed", trainer_metrics=result.metrics, holdout_metrics={key: value for key, value in metrics.items() if key != "outputs"}, adapter_files=adapter_files)
    except BaseException as error:
        run.update(status="interrupted", error=type(error).__name__, resume_instruction="Repeat identical command with --resume; only complete checkpoint-* directories can resume")
        raise
    finally:
        save_json(state_path, run)
    print(json.dumps({"status": run["status"], "output": str(args.output), "actual_training": True, "published": False}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("training: " + str(error), file=sys.stderr)
        sys.exit(1)
