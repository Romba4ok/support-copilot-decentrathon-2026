"""Inspect pinned Transformers wheel APIs using AST; no framework import/install."""
import ast
import json
from pathlib import Path
import zipfile
from pip._vendor.packaging.markers import default_environment
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.specifiers import SpecifierSet
from pip._vendor.packaging.utils import canonicalize_name

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / "runtime/training/dependency-review"
metadata = json.loads((DIRECTORY / "metadata-review.json").read_text(encoding="utf-8"))
package = next(item for item in metadata["packages"] if item["name"] == "transformers")
pins = {canonicalize_name(item["name"]): item["version"] for item in metadata["packages"]}
compatibility_errors = []
constraints_checked = 0
for python_version in ("3.11", "3.12"):
    environment = {**default_environment(), "python_version": python_version, "python_full_version": python_version + ".0", "platform_system": "Linux", "sys_platform": "linux", "os_name": "posix", "platform_machine": "x86_64", "extra": ""}
    for item in metadata["packages"]:
        if not SpecifierSet(item.get("requires_python") or "").contains(python_version):
            compatibility_errors.append(item["name"] + ": Python " + python_version)
        for requirement_text in item["requires_dist"]:
            requirement = Requirement(requirement_text)
            if requirement.marker and not requirement.marker.evaluate(environment):
                continue
            dependency = canonicalize_name(requirement.name)
            if dependency in pins:
                constraints_checked += 1
                if not requirement.specifier.contains(pins[dependency]):
                    compatibility_errors.append(item["name"] + ": " + requirement_text)
with zipfile.ZipFile(DIRECTORY / package["source_wheel"]["filename"]) as wheel:
    training_tree = ast.parse(wheel.read("transformers/training_args.py").decode("utf-8"))
    arguments_class = next(node for node in training_tree.body if isinstance(node, ast.ClassDef) and node.name == "TrainingArguments")
    fields = {node.target.id for node in arguments_class.body if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)}
    trainer_tree = ast.parse(wheel.read("transformers/trainer.py").decode("utf-8"))
    trainer_class = next(node for node in trainer_tree.body if isinstance(node, ast.ClassDef) and node.name == "Trainer")
    trainer_init = next(node for node in trainer_class.body if isinstance(node, ast.FunctionDef) and node.name == "__init__")
    trainer_parameters = {arg.arg for arg in trainer_init.args.args + trainer_init.args.kwonlyargs}
    model_tree = ast.parse(wheel.read("transformers/modeling_utils.py").decode("utf-8"))
    model_class = next(node for node in model_tree.body if isinstance(node, ast.ClassDef) and node.name == "PreTrainedModel")
    from_pretrained = next(node for node in model_class.body if isinstance(node, ast.FunctionDef) and node.name == "from_pretrained")
    model_parameters = {arg.arg for arg in from_pretrained.args.args + from_pretrained.args.kwonlyargs}
    handled_model_kwargs = {node.args[0].value for node in ast.walk(from_pretrained) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == "kwargs" and node.func.attr == "pop" and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)}
runner = ast.parse((ROOT / "training/run_lora.py").read_text(encoding="utf-8"))
training_calls = [node for node in ast.walk(runner) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "TrainingArguments"]
trainer_calls = [node for node in ast.walk(runner) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Trainer"]
training_keywords = {keyword.arg for call in training_calls for keyword in call.keywords}
trainer_keywords = {keyword.arg for call in trainer_calls for keyword in call.keywords}
unknown_training = sorted(training_keywords - fields)
unknown_trainer = sorted(trainer_keywords - trainer_parameters)
dtype_supported = "dtype" in model_parameters or "dtype" in handled_model_kwargs
report = {"transformers": package["version"], "wheel_sha256": package["source_wheel"]["sha256"], "training_argument_keywords_checked": sorted(training_keywords), "unknown_training_arguments": unknown_training, "trainer_keywords_checked": sorted(trainer_keywords), "unknown_trainer_arguments": unknown_trainer, "from_pretrained_has_dtype": dtype_supported, "processing_class_supported": "processing_class" in trainer_parameters, "direct_dependency_constraints_checked": constraints_checked, "python_targets": ["3.11", "3.12"], "compatibility_errors": compatibility_errors, "full_transitive_resolution": False, "framework_imported": False, "installed": False, "actual_training": False}
(DIRECTORY / "api-review.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
if unknown_training or unknown_trainer or not dtype_supported or compatibility_errors:
    raise SystemExit("Pinned runner API drift requires correction")
