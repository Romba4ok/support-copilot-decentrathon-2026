"""Authored focus-v1/support-plan-v1 pilot; frozen contracts, separate evaluation."""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

BASE_MODEL = "Qwen/Qwen3-0.6B"
BASE_REVISION = "c1899de289a04d12100db370d81485cdf75e47ca"
PLAN_VERSION = "support-plan-v1"
FOCUS_VERSION = "focus-v1"
FOCUS_CODES = ("payment", "account", "appeal", "complaint", "technical", "question", "clarification")
RUN_BUDGET_SECONDS = 600


def choose_compute_dtype(torch_module, policy="native_bf16_else_fp16"):
    native_bf16 = bool(torch_module.cuda.is_bf16_supported(including_emulation=False))
    if policy == "bf16_allow_emulation":
        if not torch_module.cuda.is_bf16_supported(including_emulation=True):
            raise RuntimeError("Explicit BF16 retry is unsupported; do not silently repeat failed FP16")
        return torch_module.bfloat16, native_bf16
    if policy != "native_bf16_else_fp16":
        raise ValueError("Unknown precision policy")
    return (torch_module.bfloat16 if native_bf16 else torch_module.float16), native_bf16


class SuccessfulOptimizerSteps:
    """Count actual underlying nonfused AdamW.step calls, not Trainer attempts."""
    def __init__(self, updates=0):
        self.updates = updates
        self.handle = None

    def install(self, optimizer):
        seen = set()
        while hasattr(optimizer, "optimizer"):
            if id(optimizer) in seen:
                raise RuntimeError("Cyclic optimizer wrapper")
            seen.add(id(optimizer))
            optimizer = optimizer.optimizer
        if not callable(getattr(optimizer, "register_step_post_hook", None)) or getattr(optimizer, "defaults", {}).get("fused") is True:
            raise RuntimeError("Cannot verify underlying nonfused optimizer updates")
        def after_step(optimizer, args, kwargs):
            self.updates += 1
        self.handle = optimizer.register_step_post_hook(after_step)
        return type(optimizer).__name__


def record_optimizer_attempt(run, attempted_step, successful_updates, skipped):
    previous = run.get("optimizer_steps", 0)
    run.update(optimizer_attempts=attempted_step, optimizer_steps=successful_updates, training_started=True, actual_training=successful_updates > 0)
    if type(skipped) is not bool or successful_updates != previous + (0 if skipped else 1):
        raise RuntimeError("Optimizer hook/update accounting disagrees with overflow status")
    if skipped:
        run["skipped_optimizer_updates"] = run.get("skipped_optimizer_updates", 0) + 1
        raise RuntimeError("Optimizer update skipped after precision overflow; successful count was not incremented")


def sha(value):
    return hashlib.sha256(value.encode("utf-8") if isinstance(value, str) else value).hexdigest()


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def schema_valid(value, schema):
    if "const" in schema and value != schema["const"]:
        return False
    if "enum" in schema and value not in schema["enum"]:
        return False
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict) or any(key not in value for key in schema.get("required", [])):
            return False
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False and set(value) - set(properties):
            return False
        return all(schema_valid(item, properties[key]) for key, item in value.items() if key in properties)
    if kind == "array":
        if not isinstance(value, list) or not schema.get("minItems", 0) <= len(value) <= schema.get("maxItems", 100):
            return False
        if schema.get("uniqueItems") and len({compact(item) for item in value}) != len(value):
            return False
        return all(schema_valid(item, schema.get("items", {})) for item in value)
    if kind == "string":
        return isinstance(value, str) and schema.get("minLength", 0) <= len(value) <= schema.get("maxLength", 100000)
    if kind == "boolean":
        return isinstance(value, bool)
    return True


def validate_plan(plan, row):
    if not schema_valid(plan, row["schema"]):
        return False
    context = row["context"]
    if context.get("intent_mode") == "initial_clarification" and not context.get("plain_greeting") and "problem_description" not in plan.get("request_fields", []):
        return False
    return (context.get("schema_version") == PLAN_VERSION and plan.get("schema_version") == PLAN_VERSION and plan.get("needs_human") is context["needs_human"]
            and bool(plan.get("fact_ids") or plan.get("request_fields") or context.get("answer_topic") or context.get("plain_greeting") or context.get("intent_mode") == "knowledge_gap")
            and set(plan.get("fact_ids", [])) <= {fact["id"] for fact in context["facts"]}
            and set(plan.get("request_fields", [])) <= set(context["missing_fields"])
            and set(plan.get("source_ids", [])) <= {source["id"] for source in context["allowed_sources"]})


def validate_target(value, row):
    if row.get("task_type", PLAN_VERSION) == FOCUS_VERSION:
        return isinstance(value, dict) and set(value) == {"focus"} and value["focus"] in FOCUS_CODES and schema_valid(value, row["schema"])
    return validate_plan(value, row)


def ratio(numerator, denominator):
    return {"value": numerator / denominator if denominator else None, "numerator": numerator, "denominator": denominator}


def require_finite_losses(metrics):
    for name in ("loss", "train_loss", "grad_norm"):
        if name in metrics and (type(metrics[name]) not in (int, float) or not math.isfinite(metrics[name])):
            raise RuntimeError("Non-finite training metric: " + name)


def require_budget(start, now=None):
    if (time.monotonic() if now is None else now) - start > RUN_BUDGET_SECONDS:
        raise RuntimeError("Bounded 600-second generation/training budget exceeded; own checkpoints preserved")


def validate_resume(previous, identity, resume, max_steps):
    if previous and (not resume or previous.get("identity") != identity):
        raise ValueError("Existing run needs --resume and identical code/data/prompts/dependencies/hyperparameters")
    if resume and not previous:
        raise ValueError("No own run to resume")
    if previous and previous.get("status") == "completed" and previous.get("optimizer_steps", 0) >= max_steps:
        raise ValueError("Own run is already complete; preserve it rather than claim another training run")


def summarize_task(task, rows):
    """Keep denominators specific to the task; never average focus and plan quality."""
    if task == FOCUS_VERSION:
        confusion = {actual: {predicted: 0 for predicted in (*FOCUS_CODES, "invalid")} for actual in FOCUS_CODES}
        for row in rows:
            predicted = row["predicted_focus"] if row["valid_focus"] else "invalid"
            confusion[row["expected_focus"]][predicted] += 1
        f1 = []
        for code in FOCUS_CODES:
            tp = confusion[code][code]
            fp = sum(confusion[other][code] for other in FOCUS_CODES if other != code)
            fn = sum(count for predicted, count in confusion[code].items() if predicted != code)
            f1.append(2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0)
        return {"denominator": len(rows), "valid_focus": ratio(sum(row["valid_focus"] for row in rows), len(rows)), "accuracy": ratio(sum(row["focus_correct"] for row in rows), len(rows)), "macro_f1": ratio(sum(f1), len(f1)), "classes": len(FOCUS_CODES), "confusion": confusion}
    return {"denominator": len(rows), "valid_plan": ratio(sum(row["valid_plan"] for row in rows), len(rows)), "exact_authored_plan": ratio(sum(row["exact_authored_plan"] for row in rows), len(rows)), "focus_accuracy": ratio(sum(row["focus_correct"] for row in rows), len(rows)), "human_gate_accuracy": ratio(sum(row["human_gate_correct"] for row in rows), len(rows)), "request_precision": ratio(sum(row["request_true_positive"] for row in rows), sum(row["request_predicted"] for row in rows)), "request_recall": ratio(sum(row["request_true_positive"] for row in rows), sum(row["request_expected"] for row in rows))}


def load_data(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema_version") not in (2, 3) or manifest.get("plan_schema_version") != PLAN_VERSION or manifest.get("base_model") != BASE_MODEL or manifest.get("base_revision") != BASE_REVISION:
        raise ValueError("Unsupported plan dataset or base revision")
    if manifest.get("provenance") != "authored_synthetic" or manifest.get("cloud_eligible") is not True or manifest.get("contains_private_data") is not False or manifest.get("human_reviewed") is not False:
        raise ValueError("Only public authored synthetic data is accepted")
    if manifest["schema_version"] == 3 and sha(compact(manifest.get("sources", {}))) != manifest.get("source_identity_sha256"):
        raise ValueError("Joint source component identity mismatch")
    parts = {}
    for name in ("train", "holdout"):
        raw = (directory / (name + ".jsonl")).read_bytes()
        if sha(raw) != manifest["files"][name + ".jsonl"]:
            raise ValueError("Dataset SHA-256 mismatch")
        rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
        for row in rows:
            provenance = row["provenance"]
            if provenance.get("type") != "authored_synthetic" or provenance.get("contains_private_data") is not False or provenance.get("human_reviewed") is not False or provenance.get("cloud_eligible") is not True:
                raise ValueError("Private or unverified provenance rejected")
            context = row["context"]
            task = row.get("task_type", PLAN_VERSION)
            if task not in (FOCUS_VERSION, PLAN_VERSION) or context.get("schema_version") != task:
                raise ValueError("Unknown task or context schema")
            if task == PLAN_VERSION:
                if context["allowed_sources"] or row["target"]["source_ids"]:
                    raise ValueError("Pilot must not contain private rule sources")
                if not isinstance(row.get("baseline_needs_human"), bool) or (row["baseline_needs_human"] and not row["target"]["needs_human"]):
                    raise ValueError("Authored baseline human gate was lowered or lost")
                if context.get("original_human_gate") is not row["baseline_needs_human"] or context["needs_human"] is not (row["baseline_needs_human"] or context.get("contextual_human")):
                    raise ValueError("Inconsistent code-owned effective human gate")
            if not validate_target(row["target"], row) or not isinstance(row["messages"], list) or [message["role"] for message in row["messages"]] != ["system", "user"]:
                raise ValueError("Shared-factory plan contract violated")
            if manifest["schema_version"] == 3 and sha(row["messages"][0]["content"]) != manifest["prompt_sha256"].get(task):
                raise ValueError("Frozen task system prompt mismatch")
        for lang in ("ru", "en", "kk", "uz", "es", "pt"):
            for gate in (True, False):
                if not any(row.get("task_type", PLAN_VERSION) == PLAN_VERSION and row["context"]["lang"] == lang and row["target"]["needs_human"] is gate for row in rows):
                    raise ValueError("Split lacks language/human coverage")
            if manifest["schema_version"] == 3:
                for focus in FOCUS_CODES:
                    expected = 3 if name == "train" else 1
                    if sum(row.get("task_type") == FOCUS_VERSION and row["context"]["lang"] == lang and row["target"]["focus"] == focus for row in rows) != expected:
                        raise ValueError("Joint focus class/language split coverage mismatch")
        parts[name] = rows
    for key in ("id", "group_id", "duplicate_key"):
        if {row[key] for row in parts["train"]} & {row[key] for row in parts["holdout"]}:
            raise ValueError("Train/holdout leakage")
    all_rows = parts["train"] + parts["holdout"]
    if len({row["id"] for row in all_rows}) != len(all_rows):
        raise ValueError("Duplicate author row ID")
    canonical_groups = {}
    for row in all_rows:
        if row["duplicate_key"] in canonical_groups and canonical_groups[row["duplicate_key"]] != row["group_id"]:
            raise ValueError("Canonical duplicate crosses scenario groups/tasks")
        canonical_groups[row["duplicate_key"]] = row["group_id"]
    if sha(compact(parts)) != manifest["fingerprint"]:
        raise ValueError("Dataset fingerprint mismatch")
    if manifest["schema_version"] == 3 and (len(parts["train"]) != 174 or len(parts["holdout"]) != 54 or manifest.get("focus_schema_version") != FOCUS_VERSION):
        raise ValueError("Expected fixed authored joint 174/54 pilot")
    return manifest, parts["train"], parts["holdout"]


def encode_example(row, tokenizer, max_length):
    prompt = tokenizer.apply_chat_template(row["messages"], tokenize=False, add_generation_prompt=True, enable_thinking=False)
    prompt_ids = tokenizer.encode(prompt, add_special_tokens=False)
    target_ids = tokenizer.encode(compact(row["target"]) + tokenizer.eos_token, add_special_tokens=False)
    if len(prompt_ids) + len(target_ids) > max_length:
        raise ValueError("Do not truncate frozen grounding/schema or target JSON; increase bounded max-length")
    return {"input_ids": prompt_ids + target_ids, "attention_mask": [1] * (len(prompt_ids) + len(target_ids)), "labels": [-100] * len(prompt_ids) + target_ids}


def preflight():
    if not (3, 11) <= sys.version_info[:2] <= (3, 13):
        raise RuntimeError("Pilot supports Python 3.11–3.13; inspect the actual free runtime")
    probe = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,memory.free,driver_version", "--format=csv,noheader,nounits"], capture_output=True, text=True, check=True)
    free_disk = shutil.disk_usage(Path.cwd()).free
    if free_disk < 15 * 1024**3:
        raise RuntimeError("Need at least 15 GiB free disk for packages/base/checkpoints/optional merge")
    first = probe.stdout.strip().splitlines()[0].split(",")
    if len(first) < 4 or float(first[2]) < 5 * 1024:
        raise RuntimeError("Need at least 5 GiB currently free CUDA VRAM")
    return {"python": sys.version.split()[0], "platform": platform.platform(), "gpu": probe.stdout.strip(), "free_disk_bytes": free_disk}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--dry-run", action="store_true")
    modes.add_argument("--preflight", action="store_true")
    modes.add_argument("--train", action="store_true")
    parser.add_argument("--max-steps", type=int, default=20)
    parser.add_argument("--max-length", type=int, default=1536)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--method", choices=("qlora", "lora"), default="qlora")
    parser.add_argument("--precision", choices=("native_bf16_else_fp16", "bf16_allow_emulation"), default="bf16_allow_emulation")
    args = parser.parse_args()
    if not 1 <= args.max_steps <= 100 or not 512 <= args.max_length <= 2048:
        raise ValueError("Pilot bounds: steps 1–100, context 512–2048")
    manifest, train, holdout = load_data(args.data_dir)
    joint = manifest["schema_version"] == 3
    if joint and args.max_steps != 100 and args.train:
        raise ValueError("The reviewed joint experiment uses exactly 100 steps, no unreviewed horizon changes")
    if args.dry_run:
        report = {"status": "dry_run_passed", "plan_schema_version": PLAN_VERSION, "focus_schema_version": manifest.get("focus_schema_version"), "fingerprint": manifest["fingerprint"], "train_examples": len(train), "holdout_examples": len(holdout), "task_counts": {name: {task: sum(row.get("task_type", PLAN_VERSION) == task for row in part) for task in (FOCUS_VERSION, PLAN_VERSION)} for name, part in (("train", train), ("holdout", holdout))}, "actual_training": False, "model_loaded": False, "network_requests": 0}
        save(args.output / "dry-run.json", report)
        print(compact(report))
        return
    hardware = preflight()
    if args.preflight:
        save(args.output / "preflight.json", hardware)
        print(compact(hardware))
        return
    os.environ.update(HF_HUB_DISABLE_TELEMETRY="1", WANDB_DISABLED="true", TOKENIZERS_PARALLELISM="false")
    requirements_path = Path(__file__).with_name("requirements-colab.txt")
    pins = dict(line.strip().split("==", 1) for line in requirements_path.read_text(encoding="utf-8").splitlines() if "==" in line and not line.lstrip().startswith("#"))
    for name, version in pins.items():
        if importlib.metadata.version(name) != version:
            raise RuntimeError("Dependency drift: " + name)
    identity = {"source_identity_sha256": manifest.get("source_identity_sha256"), "runtime_generator_sha256": manifest.get("sources", {}).get("src/intelligence/generator.mjs"), "plan_schema_version": PLAN_VERSION, "focus_schema_version": manifest.get("focus_schema_version"), "dataset_schema_version": manifest["schema_version"], "source_sha256": manifest.get("sources", {}), "prompt_sha256": manifest.get("prompt_sha256", {}), "base_model": BASE_MODEL, "base_revision": BASE_REVISION, "dataset_fingerprint": manifest["fingerprint"], "contract_sha256": manifest["contract_sha256"], "factory_source_sha256": manifest["factory_source_sha256"], "runner_sha256": sha(Path(__file__).read_bytes()), "requirements_sha256": sha(requirements_path.read_bytes()), "dtype_policy": args.precision, "optimizer_accounting": "underlying_nonfused_step_post_hook_v1", "method": args.method, "max_length": args.max_length, "seed": 42, "rank": 8, "alpha": 16, "dropout": .05, "learning_rate": .0002, "optimizer": "adamw_torch", "batch": 1, "gradient_accumulation": 4, "joint_steps": 100 if joint else None, "run_budget_seconds": RUN_BUDGET_SECONDS}
    path = args.output / "run-manifest.json"
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    validate_resume(previous, identity, args.resume, args.max_steps)
    run = {"identity": identity, "base_model": BASE_MODEL, "base_revision": BASE_REVISION, "dataset_fingerprint": manifest["fingerprint"], "provenance": "authored_synthetic", "cloud_eligible": True, "status": "preflight_passed", "model_loaded": False, "training_started": False, "optimizer_steps": previous.get("optimizer_steps", 0) if previous else 0, "continued_from_steps": previous.get("optimizer_steps", 0) if previous else 0, "requested_horizons": (previous.get("requested_horizons", []) if previous else []) + [args.max_steps], "actual_training": bool(previous and previous.get("actual_training")), "weights_saved": False, "hardware": hardware, "dependencies": pins, "requested_max_steps": args.max_steps}
    save(path, run)
    try:
        import torch
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig, Trainer, TrainingArguments, TrainerCallback, set_seed
        from transformers.trainer_utils import get_last_checkpoint
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA unavailable after package installation")
        torch.ones(1, device="cuda").sum().item()
        set_seed(42)
        load = {"revision": BASE_REVISION, "token": False, "trust_remote_code": False, "cache_dir": str(args.data_dir.parent / "model-cache")}
        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, **load)
        tokenizer.pad_token = tokenizer.eos_token
        encoded_train = [encode_example(row, tokenizer, args.max_length) for row in train]
        encoded_holdout = [encode_example(row, tokenizer, args.max_length) for row in holdout]
        dtype, native_bf16 = choose_compute_dtype(torch, args.precision)
        model_args = {**load, "dtype": dtype, "device_map": {"": 0}, "attn_implementation": "eager", "use_safetensors": True}
        if args.method == "qlora":
            model_args["quantization_config"] = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=dtype)
        model = AutoModelForCausalLM.from_pretrained(BASE_MODEL, **model_args)
        if args.method == "qlora":
            model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
        else:
            model.enable_input_require_grads()
        model.config.use_cache = False
        modules = ["q_proj", "k_proj", "v_proj", "o_proj"]
        model = get_peft_model(model, LoraConfig(r=8, lora_alpha=16, lora_dropout=.05, target_modules=modules, bias="none", task_type="CAUSAL_LM"))
        model.peft_config["default"].base_model_name_or_path = BASE_MODEL
        model.peft_config["default"].revision = BASE_REVISION
        for parameter in model.parameters():
            if parameter.requires_grad:
                parameter.data = parameter.data.float()
        trainable = [(name, parameter) for name, parameter in model.named_parameters() if parameter.requires_grad]
        if not trainable or any(not any(module in name for module in modules) for name, _ in trainable) or any(not any(module in name for name, _ in trainable) for module in modules):
            raise RuntimeError("Unexpected adapter targets")
        def weights_hash():
            digest = hashlib.sha256()
            for name, parameter in trainable:
                if not bool(torch.isfinite(parameter).all().item()):
                    raise RuntimeError("Non-finite adapter weights")
                digest.update(name.encode()); digest.update(parameter.detach().cpu().contiguous().numpy().tobytes())
            return digest.hexdigest()
        before = weights_hash()
        run.update(status="model_loaded", model_loaded=True, trainable_parameters=sum(parameter.numel() for _, parameter in trainable), initial_adapter_sha256=before, effective_dtype=str(dtype), native_bf16_supported=native_bf16, bf16_emulated=dtype == torch.bfloat16 and not native_bf16, precision_policy=args.precision)
        save(path, run)
        budget_start = time.monotonic()
        def check_budget():
            require_budget(budget_start)
        def measure(label):
            model.eval()
            rows = []
            start = time.monotonic()
            for row in holdout:
                check_budget()
                task = row.get("task_type", PLAN_VERSION)
                prompt = tokenizer.apply_chat_template(row["messages"], tokenize=False, add_generation_prompt=True, enable_thinking=False)
                tokens = tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to("cuda")
                with torch.inference_mode():
                    generated = model.generate(**tokens, max_new_tokens=32 if task == FOCUS_VERSION else 192, do_sample=False, pad_token_id=tokenizer.pad_token_id)
                ids = generated[0, tokens["input_ids"].shape[1]:]
                text = tokenizer.decode(ids, skip_special_tokens=True).strip()
                try:
                    plan = json.loads(text); valid = validate_target(plan, row)
                except (ValueError, TypeError, KeyError):
                    plan = None; valid = False
                predicted = plan if valid and isinstance(plan, dict) else {}
                if task == FOCUS_VERSION:
                    rows.append({"id": row["id"], "lang": row["context"]["lang"], "task_type": task, "raw": text, "valid_focus": valid, "focus_correct": valid and predicted.get("focus") == row["target"]["focus"], "expected_focus": row["target"]["focus"], "predicted_focus": predicted.get("focus") if valid else None, "eos_seen": tokenizer.eos_token_id in ids.tolist()})
                    continue
                exact = valid and all(set(plan[key]) == set(row["target"][key]) for key in ("fact_ids", "request_fields", "source_ids")) and plan["focus"] == row["target"]["focus"]
                requests = predicted.get("request_fields", [])
                requests = set(item for item in requests if isinstance(item, str)) if isinstance(requests, list) else set()
                gold_requests = set(row["target"]["request_fields"])
                rows.append({"id": row["id"], "lang": row["context"]["lang"], "task_type": task, "raw": text, "valid_plan": valid, "exact_authored_plan": exact, "eos_seen": tokenizer.eos_token_id in ids.tolist(), "focus_correct": predicted.get("focus") == row["target"]["focus"], "human_gate_correct": predicted.get("needs_human") is row["target"]["needs_human"], "request_true_positive": len(requests & gold_requests), "request_predicted": len(requests), "request_expected": len(gold_requests)})
            tasks = {task: summarize_task(task, [row for row in rows if row["task_type"] == task]) for task in (FOCUS_VERSION, PLAN_VERSION) if any(row["task_type"] == task for row in rows)}
            report = {"variant": label, "denominator": len(rows), "tasks": tasks, "elapsed_seconds": time.monotonic() - start, "provenance": "authored_synthetic", "human_reviewed": False, "rows": rows}
            save(args.output / (label + "-holdout.json"), report)
            for task, summary in tasks.items():
                save(args.output / (label + "-" + task + "-holdout.json"), {"variant": label, "task_type": task, **summary, "provenance": "authored_synthetic", "human_reviewed": False, "rows": [row for row in rows if row["task_type"] == task]})
            check_budget()
            return report
        if not args.resume:
            with model.disable_adapter():
                measure("baseline")
        def collate(rows):
            width = max(len(row["input_ids"]) for row in rows)
            return {key: torch.tensor([row[key] + [pad] * (width - len(row[key])) for row in rows]) for key, pad in (("input_ids", tokenizer.pad_token_id), ("attention_mask", 0), ("labels", -100))}
        class Evidence(TrainerCallback):
            def on_train_begin(self, args, state, control, **kwargs):
                run.update(status="training_started", training_started=True, actual_training=run.get("optimizer_steps", 0) > 0, optimizer_step_hook="torch_optimizer_register_step_post_hook", underlying_optimizer_class=counter.install(kwargs["optimizer"]))
                save(path, run)
            def on_prediction_step(self, args, state, control, **kwargs):
                check_budget()
            def on_step_end(self, args, state, control, **kwargs):
                check_budget()
                run["status"] = "training"
                record_optimizer_attempt(run, state.global_step, counter.updates, trainer.accelerator.optimizer_step_was_skipped)
                save(path, run)
            def on_log(self, args, state, control, logs=None, **kwargs):
                if logs:
                    require_finite_losses(logs)
        configuration = TrainingArguments(output_dir=str(args.output / "checkpoints"), max_steps=args.max_steps, per_device_train_batch_size=1, per_device_eval_batch_size=1, gradient_accumulation_steps=4, learning_rate=.0002, warmup_ratio=.05, lr_scheduler_type="cosine", logging_steps=1, save_strategy="steps", save_steps=10, save_total_limit=2, eval_strategy="steps", eval_steps=10, fp16=dtype == torch.float16, bf16=dtype == torch.bfloat16, gradient_checkpointing=True, optim="adamw_torch", report_to=[], push_to_hub=False, seed=42, data_seed=42, remove_unused_columns=False)
        trainer = Trainer(model=model, args=configuration, train_dataset=encoded_train, eval_dataset=encoded_holdout, data_collator=collate, processing_class=tokenizer, callbacks=[Evidence()])
        checkpoint_dir = args.output / "checkpoints"
        checkpoint = get_last_checkpoint(str(checkpoint_dir)) if args.resume and checkpoint_dir.is_dir() else None
        if args.resume and checkpoint is None:
            raise ValueError("No complete own checkpoint to resume")
        checkpoint_steps = json.loads((Path(checkpoint) / "trainer_state.json").read_text(encoding="utf-8"))["global_step"] if checkpoint else 0
        run.update(optimizer_steps=checkpoint_steps, optimizer_attempts=checkpoint_steps, skipped_optimizer_updates=0, resumed_checkpoint_steps=checkpoint_steps)
        counter = SuccessfulOptimizerSteps(checkpoint_steps)
        result = trainer.train(resume_from_checkpoint=checkpoint)
        check_budget()
        require_finite_losses({"train_loss": result.metrics["train_loss"]})
        if counter.updates != args.max_steps or run["optimizer_steps"] != args.max_steps or trainer.state.global_step != args.max_steps or run["skipped_optimizer_updates"]:
            raise RuntimeError("Need exactly the reviewed number of verified actual optimizer updates")
        after = weights_hash()
        if not math.isfinite(float(result.training_loss)) or before == after:
            raise RuntimeError("No finite loss or adapter weights did not change")
        trainer.save_model(str(args.output / "adapter")); tokenizer.save_pretrained(str(args.output / "adapter"))
        run.update(status="weights_saved", weights_saved=True, optimizer_steps=counter.updates, optimizer_attempts=trainer.state.global_step, adapter_sha256=after, weights_changed=before != after, adapter_weights_finite=True, finite_training_loss=True, trainer_metrics=result.metrics)
        save(path, run)
        measure("adapter")
        run.update(status="completed", generation_training_elapsed_seconds=time.monotonic() - budget_start, adapter_files={item.name: sha(item.read_bytes()) for item in (args.output / "adapter").iterdir() if item.is_file()})
    except BaseException as error:
        run.update(status="interrupted", error=type(error).__name__, error_message=str(error)[:500])
        raise
    finally:
        save(path, run)
    print(compact({"status": run["status"], "optimizer_steps": run["optimizer_steps"], "weights_changed": run["weights_changed"], "published": False}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("plan-training: " + str(error), file=sys.stderr)
        sys.exit(1)
