import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runner = readFileSync(new URL('./run_plan_lora.py', import.meta.url));
const runnerSha = hash(runner);
const manifest = readFileSync(new URL('../runtime/training/joint-author-6bc4-56a4/manifest.json', import.meta.url));
const data = JSON.parse(manifest);
const oldRunner = '2944e533ba085de9cf78e4815735f83d4d98262b045db5f31f4f1412568a662e';
const oldRun = 'joint-eba0c985bd60-6bc4d603-5c0ea248-2944e533';
const newRun = `joint-${data.fingerprint.slice(0,12)}-${data.factory_source_sha256.slice(0,8)}-${data.source_identity_sha256.slice(0,8)}-${runnerSha.slice(0,8)}-bf16retry`;
const patch = `# Only our runner is changed. No training/model download starts in this cell.
import base64, hashlib, json, os, zlib
from pathlib import Path
WORKDIR = Path(globals().get('WORKDIR', os.environ.get('SUPPORT_TRAINING_WORKDIR', '/content/support-plan-pilot'))).resolve()
DATA = WORKDIR / 'data'
OLD_RUN = WORKDIR / 'runs' / ${JSON.stringify(oldRun)}
NEW_RUN = WORKDIR / 'runs' / ${JSON.stringify(newRun)}
NEW_RUNNER_SHA256 = ${JSON.stringify(runnerSha)}
runner_path = (WORKDIR / 'training/run_plan_lora.py').resolve()
assert runner_path.is_relative_to(WORKDIR)
original = runner_path.read_bytes()
assert hashlib.sha256(original).hexdigest() == ${JSON.stringify(oldRunner)}, 'Unexpected runner; do not overwrite'
manifest_raw = (DATA / 'manifest.json').read_bytes()
assert hashlib.sha256(manifest_raw).hexdigest() == ${JSON.stringify(hash(manifest))}, 'Frozen dataset manifest changed'
failed_path = OLD_RUN / 'run-manifest.json'
failed_raw = failed_path.read_bytes()
failed = json.loads(failed_raw)
assert failed.get('status') == 'interrupted' and failed.get('weights_saved') is False
assert 'grad_norm' in failed.get('error_message', '')
assert failed['identity']['runner_sha256'] == ${JSON.stringify(oldRunner)}
assert not NEW_RUN.exists(), 'Retry must use a new exclusive run path'
payload = zlib.decompress(base64.b64decode(${JSON.stringify(deflateSync(runner).toString('base64'))}))
assert hashlib.sha256(payload).hexdigest() == NEW_RUNNER_SHA256
backup = WORKDIR / 'source-history' / ${JSON.stringify(oldRunner)} / 'run_plan_lora.py'
backup.parent.mkdir(parents=True, exist_ok=True)
if backup.exists():
    assert backup.read_bytes() == original
else:
    backup.write_bytes(original)
runner_path.write_bytes(payload)
assert failed_path.read_bytes() == failed_raw and (DATA / 'manifest.json').read_bytes() == manifest_raw
RUN = NEW_RUN
PYTHON = WORKDIR / 'venv/bin/python'
RUN_TRAINING = False
RESUME = False
MAX_STEPS = 100
print({'runner_sha256': NEW_RUNNER_SHA256, 'new_run': str(RUN), 'precision': 'bf16_allow_emulation', 'native_bf16_claimed': False, 'old_failed_run_preserved': True, 'old_successful_optimizer_updates': 'unknown; old field counted Trainer attempts', 'training_started_by_patch': False}, flush=True)
`;
writeFileSync(new URL('./colab-bf16-retry-patch.py', import.meta.url), patch);
console.log(JSON.stringify({ patch: 'training/colab-bf16-retry-patch.py', patch_sha256: hash(patch), patch_bytes: Buffer.byteLength(patch), old_runner_sha256: oldRunner, new_runner_sha256: runnerSha, new_run: `/content/support-plan-pilot/runs/${newRun}`, frozen_manifest_sha256: hash(manifest) }));
