"""Inspect/import an explicitly trusted own paired GGUF archive; never activate it."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import stat
import sys
import zipfile

BASE_MODEL = "Qwen/Qwen3-0.6B"
BASE_REVISION = "c1899de289a04d12100db370d81485cdf75e47ca"
WEIGHTS = {"baseline-Q4_K_M.gguf", "adapter-Q4_K_M.gguf"}
JSON_FILES = {"export-progress.json", "run-manifest.json", "baseline-holdout.json", "adapter-holdout.json"}
ALLOWED = WEIGHTS | JSON_FILES
MAX_ARCHIVE = 2 * 1024**3
MAX_WEIGHT = 1024**3
MAX_JSON = 8 * 1024**2
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def digest(stream):
    result = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        result.update(chunk)
    return result.hexdigest()


def valid_sha(value, length=64):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{" + str(length) + r"}", value) is not None


def object_no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def parse_json(raw):
    def reject_constant(_):
        raise ValueError("Non-finite JSON constant")
    def finite_float(raw_number):
        number = float(raw_number)
        if not math.isfinite(number):
            raise ValueError("Non-finite JSON number")
        return number
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=object_no_duplicates, parse_constant=reject_constant, parse_float=finite_float)
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON proof object")
    return value


def inspect_members(archive):
    members, seen = {}, set()
    total = 0
    for info in archive.infolist():
        name = info.filename
        if name.casefold() in seen:
            raise ValueError("Duplicate or case-colliding ZIP entry")
        seen.add(name.casefold())
        if name not in ALLOWED or info.orig_filename != name or "/" in name or "\\" in name or ":" in name or info.is_dir():
            raise ValueError("ZIP contains an unexpected or unsafe path")
        kind = stat.S_IFMT(info.external_attr >> 16)
        if kind not in (0, stat.S_IFREG) or info.flag_bits & 1:
            raise ValueError("ZIP links, special files and encrypted entries are rejected")
        maximum = MAX_WEIGHT if name in WEIGHTS else MAX_JSON
        if not 0 < info.file_size <= maximum or info.compress_size > MAX_ARCHIVE:
            raise ValueError("ZIP member exceeds bounded size")
        total += info.file_size
        if total > MAX_ARCHIVE:
            raise ValueError("ZIP uncompressed total exceeds 2 GiB")
        members[name] = info
    if set(members) != ALLOWED:
        raise ValueError("Expected exactly two Q4 GGUF and four JSON proof files")
    return members, total


def inspect_pair(archive, members):
    # Full reads validate every member CRC without unpickling or loading a model.
    hashes, documents = {}, {}
    for name in sorted(members):
        with archive.open(members[name]) as stream:
            if name in WEIGHTS:
                magic = stream.read(4)
                if magic != b"GGUF":
                    raise ValueError("Expected GGUF magic; this is not a quality/model-load check")
                result = hashlib.sha256(magic)
                while chunk := stream.read(1024 * 1024):
                    result.update(chunk)
                hashes[name] = result.hexdigest()
            else:
                raw = stream.read(MAX_JSON + 1)
                hashes[name] = hashlib.sha256(raw).hexdigest()
                documents[name] = parse_json(raw)
    proof, run = documents["export-progress.json"], documents["run-manifest.json"]
    identity = run.get("identity", {})
    if (proof.get("status") != "paired_gguf_ready_not_quality_verified" or proof.get("base_model") != BASE_MODEL or proof.get("base_revision") != BASE_REVISION
            or proof.get("llama_tag") != "b11960" or proof.get("quantization") != "Q4_K_M" or not valid_sha(proof.get("llama_commit"), 40) or not valid_sha(proof.get("quantizer_sha256"))):
        raise ValueError("Unsupported exact-base/llama/quantization export proof")
    if proof.get("provenance") != "authored_synthetic" or proof.get("human_reviewed") is not False or proof.get("published") is not False or proof.get("activated") is not False:
        raise ValueError("Expected an unpublished authored synthetic export")
    if (run.get("status") != "completed" or run.get("actual_training") is not True or run.get("weights_saved") is not True or run.get("weights_changed") is not True
            or run.get("base_model") != BASE_MODEL or run.get("base_revision") != BASE_REVISION or run.get("provenance") != "authored_synthetic" or run.get("cloud_eligible") is not True):
        raise ValueError("Need a completed own authored training run with changed saved weights")
    steps = run.get("optimizer_steps")
    if type(steps) is not int or not 20 <= steps <= 100 or proof.get("actual_optimizer_steps") != steps:
        raise ValueError("Expected matching bounded 20–100 actual optimizer steps")
    if (identity.get("plan_schema_version") != "support-plan-v1" or identity.get("base_model") != BASE_MODEL or identity.get("base_revision") != BASE_REVISION
            or not valid_sha(identity.get("factory_source_sha256")) or proof.get("factory_source_sha256") != identity.get("factory_source_sha256")
            or not valid_sha(run.get("dataset_fingerprint")) or proof.get("dataset_fingerprint") != run.get("dataset_fingerprint") or identity.get("dataset_fingerprint") != run.get("dataset_fingerprint")
            or proof.get("run_manifest_sha256") != hashes["run-manifest.json"]):
        raise ValueError("Factory/dataset/run identity proof mismatch")
    if not valid_sha(run.get("initial_adapter_sha256")) or not valid_sha(run.get("adapter_sha256")) or run["initial_adapter_sha256"] == run["adapter_sha256"]:
        raise ValueError("Changed adapter weight hashes are missing")
    loss = run.get("trainer_metrics", {}).get("train_loss")
    if type(loss) not in (int, float) or not math.isfinite(loss):
        raise ValueError("Finite observed training loss is required")
    records = proof.get("files", {})
    if set(records) != WEIGHTS | {"baseline-F16.gguf", "adapter-F16.gguf"}:
        raise ValueError("Expected paired F16→Q4 derivation records")
    for name, record in records.items():
        if not isinstance(record, dict) or not valid_sha(record.get("sha256")) or type(record.get("bytes")) is not int or not 0 < record["bytes"] <= 4 * 1024**3:
            raise ValueError("Invalid derivation file metadata")
        if name in WEIGHTS and (record["sha256"] != hashes[name] or record["bytes"] != members[name].file_size):
            raise ValueError("Included Q4 size/SHA-256 does not match export proof")
    paired_ids = []
    for variant in ("baseline", "adapter"):
        report = documents[variant + "-holdout.json"]
        rows = report.get("rows", [])
        if report.get("variant") != variant or report.get("provenance") != "authored_synthetic" or report.get("human_reviewed") is not False or not isinstance(rows, list) or not 0 < len(rows) <= 500 or report.get("denominator") != len(rows):
            raise ValueError("Expected small authored paired holdout reports")
        keys = [(row.get("id"), row.get("lang")) for row in rows if isinstance(row, dict)]
        if len(keys) != len(rows) or any(not isinstance(identifier, str) or not 0 < len(identifier) <= 200 or lang not in ("ru", "en", "kk", "uz", "es", "pt") for identifier, lang in keys) or len(set(keys)) != len(keys):
            raise ValueError("Invalid paired holdout row identities")
        paired_ids.append(keys)
    if paired_ids[0] != paired_ids[1]:
        raise ValueError("Baseline and adapter reports are not paired on the same authored inputs")
    return proof, run, hashes


def import_pair(archive_path, expected_archive_sha256, destination, execute=False, *, project_root=PROJECT_ROOT):
    expected = expected_archive_sha256.lower()
    if not valid_sha(expected):
        raise ValueError("An explicit expected archive SHA-256 is required")
    if Path(destination).is_symlink():
        raise ValueError("Destination symlinks are rejected")
    archive_path, destination, project_root = Path(archive_path), Path(destination).resolve(), Path(project_root).resolve()
    models = (project_root / "runtime/models").resolve()
    if not models.is_relative_to(project_root) or destination.parent != models or destination.exists() or destination.is_symlink():
        raise ValueError("Choose a new direct project runtime/models directory; no overwrite or outside destination")
    if archive_path.is_symlink() or not archive_path.is_file() or not 0 < archive_path.stat().st_size <= MAX_ARCHIVE:
        raise ValueError("Expected a regular bounded paired archive")
    with archive_path.open("rb") as stream:
        if digest(stream) != expected:
            raise ValueError("Archive SHA-256 mismatch")
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            members, total = inspect_members(archive)
            proof, run, hashes = inspect_pair(archive, members)
            stream.seek(0)
            if digest(stream) != expected:
                raise ValueError("Archive changed during integrity verification")
            result = {"status": "integrity_verified_not_imported", "archive_integrity_verified": True, "integrity_verified": True, "quality_verified": False, "model_loaded": False, "activated": False, "published": False,
                      "archive_sha256": expected, "archive_path": str(archive_path.resolve()), "destination": str(destination), "base_model": BASE_MODEL, "base_revision": BASE_REVISION,
                      "factory_source_sha256": proof["factory_source_sha256"], "dataset_fingerprint": proof["dataset_fingerprint"], "run_manifest_sha256": hashes["run-manifest.json"],
                      "actual_optimizer_steps": run["optimizer_steps"], "provenance": "authored_synthetic", "human_reviewed": False,
                      "derivation": {"float_base_revision": BASE_REVISION, "safe_adapter_merge": True, "intermediate_type": "F16", "quantization": "Q4_K_M", "llama_tag": "b11960", "llama_commit": proof["llama_commit"], "quantizer_sha256": proof["quantizer_sha256"], "remote_f16_records": {name: record for name, record in proof["files"].items() if name not in WEIGHTS}, "remote_f16_content_verified_locally": False},
                      "files": {name: {"sha256": hashes[name], "bytes": members[name].file_size, "local_path": str(destination / name)} for name in sorted(members)}}
            if execute:
                models.mkdir(parents=True, exist_ok=True)
                if shutil.disk_usage(models).free < total + 50 * 1024**2:
                    raise ValueError("Insufficient free disk for bounded paired import")
                destination.mkdir(exist_ok=False)
                try:
                    for name in sorted(members):
                        with archive.open(members[name]) as source, (destination / name).open("xb") as output:
                            shutil.copyfileobj(source, output, 1024 * 1024)
                        with (destination / name).open("rb") as copied:
                            if digest(copied) != hashes[name]:
                                raise ValueError("Extracted file SHA-256 mismatch")
                    result["status"] = "imported_integrity_verified_not_quality_verified"
                except BaseException:
                    result["status"] = "import_failed_partial_directory_preserved"
                    result["integrity_verified"] = False
                    (destination / "import-manifest.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
                    raise
                (destination / "import-manifest.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
            return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--expected-archive-sha256", required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    print(json.dumps(import_pair(args.archive, args.expected_archive_sha256, args.destination, args.execute), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("import-pair: " + str(error), file=sys.stderr)
        sys.exit(1)
