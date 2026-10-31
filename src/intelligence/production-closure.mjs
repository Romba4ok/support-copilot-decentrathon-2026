import { readFile, readdir, lstat, realpath, open } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SELECTED17_DIRECTORY = 'runtime/models/qwen3-1.7b-90862c4b-QKVU3y';
export const IMPORT_SOURCE_FREEZE_SHA = '14219a05b4e04c8a712e98f2cc6b03bbd5a097673d27bc84cfb35cb09e15b10d';
export const SOURCE_REGISTRY_VERSION = 'selected17-production-and-helper-registry-v1';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export function requireProof(condition, reason) { if (!condition) throw new Error(reason); }
export function exactKeys(value, required, optional = []) {
  return value && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => canonical(key) + ':' + canonical(value[key])).join(',') + '}';
}
export const canonicalHash = value => hash(canonical(value));
export const equal = (left, right) => canonical(left) === canonical(right);
const within = (base, path) => { const r = relative(base, path); return r !== '' && r.split(/[\\/]/u)[0] !== '..' && !isAbsolute(r); };
const fingerprint = stat => ({ bytes: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino });

/** Bounded, streaming, project-local reads only; never starts a model/process. */
export async function verifyRegularFile({ rootDir = APP_ROOT, path, namespace = '.', maxBytes = 8 * 1024 ** 2, expectedSha256, expectedBytes, signal }) {
  signal?.throwIfAborted();
  requireProof(typeof path === 'string' && path.length > 0 && path.length <= 2048, 'trusted_local_path_required');
  const root = resolve(rootDir), base = resolve(root, namespace), absolute = resolve(root, path);
  requireProof((base === root || within(root, base)) && within(base, absolute), 'activation_path_outside_namespace');
  for (let cursor = absolute; cursor !== root; cursor = dirname(cursor)) {
    requireProof(within(root, cursor), 'activation_ancestor_outside_project');
    requireProof(!(await lstat(cursor)).isSymbolicLink(), 'activation_symbolic_ancestor');
  }
  requireProof(!(await lstat(root)).isSymbolicLink(), 'activation_symbolic_root');
  const actual = await realpath(absolute), actualBase = await realpath(base), stat = await lstat(actual);
  requireProof(within(actualBase, actual) && stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maxBytes, 'activation_file_not_regular_or_bounded');
  if (expectedBytes !== undefined) requireProof(Number.isSafeInteger(expectedBytes) && stat.size === expectedBytes, 'activation_file_size_mismatch');
  if (expectedSha256 !== undefined) requireProof(isHash(expectedSha256), 'activation_expected_sha_required');
  const digest = createHash('sha256');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw Object.assign(new TypeError('signal must be an AbortSignal'), { code: 'ERR_INVALID_ARG_TYPE' });
  const handle = await open(actual, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 ** 2);
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      signal?.throwIfAborted();
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
    }
  } finally { await handle.close(); }
  signal?.throwIfAborted();
  const sha256 = digest.digest('hex'), after = await lstat(actual);
  requireProof(equal(fingerprint(stat), fingerprint(after)), 'activation_file_changed_during_read');
  if (expectedSha256 !== undefined) requireProof(sha256 === expectedSha256, 'activation_file_sha_mismatch');
  return { path: actual, requestedPath: absolute, rootDir: root, namespace, bytes: stat.size, sha256, fingerprint: fingerprint(stat) };
}
export async function readTrustedJson(options) {
  const file = await verifyRegularFile(options);
  const value = JSON.parse(await readFile(file.path, { encoding: 'utf8', signal: options.signal }));
  requireProof(value && typeof value === 'object' && !Array.isArray(value), 'activation_json_object_required');
  requireProof(equal(file.fingerprint, fingerprint(await lstat(file.path))), 'activation_json_changed_during_read');
  return { ...file, value };
}
export async function verifyFingerprint(file) {
  for (let cursor = file.requestedPath; cursor !== file.rootDir; cursor = dirname(cursor)) {
    requireProof(within(file.rootDir, cursor) && !(await lstat(cursor)).isSymbolicLink(), 'verified_activation_symbolic_ancestor');
  }
  requireProof(!(await lstat(file.rootDir)).isSymbolicLink() && await realpath(file.requestedPath) === file.path, 'verified_activation_path_changed');
  const stat = await lstat(file.path);
  requireProof(stat.isFile() && !stat.isSymbolicLink() && equal(file.fingerprint, fingerprint(stat)), 'verified_activation_file_changed');
}

const ROOT_FILES = ['package.json', 'npm-shrinkwrap.json', '.env.example', 'Makefile', 'start-support.cmd', 'start-local-ai.cmd', 'training/focus-author-data.mjs', 'notebooks/support-copilot-plan-qlora.ipynb'];
const SOURCE10 = ['src/cli/predict.mjs', 'src/intelligence/activation.mjs', 'src/intelligence/config.mjs', 'src/intelligence/draft.mjs', 'src/intelligence/generation-contract.mjs', 'src/intelligence/generator.mjs', 'src/intelligence/index.mjs', 'src/intelligence/native-session.mjs', 'src/intelligence/two-phase.mjs', 'src/server.mjs'];
const HELPERS = [
  { path: SELECTED17_DIRECTORY + '/linux-windows-calibration-v3', required: ['driver.mjs', 'contract.mjs', 'lifecycle.mjs', 'source-seal.mjs'] },
  { path: SELECTED17_DIRECTORY + '/author42-focus-v2', required: ['cohort.mjs', 'gates.mjs', 'trial.mjs', 'driver.mjs'] },
];
const AUTHOR_DOCUMENTS = ['cohort-lineage.json', 'request.example.json', 'README.md'];

/** Inventory primitive only, not activation proof. Production callers below
 * supply the concrete registry; no manifest can select these directories. */
export async function enumerateSourceFiles({ rootDir = APP_ROOT, folders, onlyModules = false, signal } = {}) {
  const root = resolve(rootDir), names = new Set();
  async function walk(folder, depth = 0) {
    signal?.throwIfAborted();
    requireProof(depth < 16 && within(root, resolve(root, folder)), 'source_inventory_bounds');
    for (let cursor = resolve(root, folder); cursor !== root; cursor = dirname(cursor)) requireProof(!(await lstat(cursor)).isSymbolicLink(), 'source_inventory_symbolic_directory');
    const stat = await lstat(resolve(root, folder));
    requireProof(stat.isDirectory() && !stat.isSymbolicLink(), 'source_inventory_symbolic_directory');
    for (const entry of await readdir(resolve(root, folder), { withFileTypes: true })) {
      signal?.throwIfAborted();
      requireProof(!entry.isSymbolicLink(), 'source_inventory_symbolic_entry');
      const path = folder + '/' + entry.name;
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (!onlyModules || entry.name.endsWith('.mjs')) names.add(path);
      requireProof(names.size <= 2048, 'source_inventory_bounds');
    }
  }
  requireProof(Array.isArray(folders) && folders.length > 0 && folders.length <= 16, 'source_inventory_folders_required');
  for (const folder of folders) await walk(folder);
  return [...names].sort();
}

/** Concrete registry, not file paths/maps selected by HTTP or a model. Reports,
 * weights and target fixtures are excluded; helper source bytes are hashed only. */
export async function collectProductionClosure({ rootDir = APP_ROOT, signal } = {}) {
  const names = new Set(), root = resolve(rootDir);
  for (const name of await enumerateSourceFiles({ rootDir: root, folders: ['src', 'public', 'data'], signal })) names.add(name);
  for (const path of ROOT_FILES) names.add(path);
  names.add('scripts/benchmark-generator.mjs');
  const importDir = SELECTED17_DIRECTORY + '/linux-prebuilt-import-v2';
  const freeze = await readTrustedJson({ rootDir: root, path: importDir + '/source-freeze.json', namespace: 'runtime/models', expectedSha256: IMPORT_SOURCE_FREEZE_SHA, maxBytes: 1024 ** 2, signal });
  requireProof(freeze.value.schema_version === 'private-linux-prebuilt17-import-source-freeze-v2' && freeze.value.files && Object.keys(freeze.value.files).length > 0, 'approved_import_source_freeze_required');
  names.add(importDir + '/source-freeze.json');
  for (const [name, record] of Object.entries(freeze.value.files)) {
    requireProof(basename(name) === name && name !== '.' && name !== '..' && exactKeys(record, ['bytes', 'sha256']), 'import_source_record_invalid');
    await verifyRegularFile({ rootDir: root, path: importDir + '/' + name, namespace: 'runtime/models', expectedSha256: record.sha256, expectedBytes: record.bytes, signal });
    names.add(importDir + '/' + name);
  }
  for (const helper of HELPERS) {
    for (const name of await enumerateSourceFiles({ rootDir: root, folders: [helper.path], onlyModules: true, signal })) names.add(name);
    for (const name of helper.required) requireProof(names.has(helper.path + '/' + name), 'required_helper_source_missing:' + name);
  }
  // The calibration package is still authored before final qualification. Its
  // exact current source freeze is bound by the root's final closure, not by a
  // mutable hash compiled into this verifier.
  for (const [index, helper] of HELPERS.entries()) {
    const sourceFreeze = await readTrustedJson({ rootDir: root, path: helper.path + '/source-freeze.json', namespace: 'runtime/models', maxBytes: 1024 ** 2, signal });
    const schema = index === 0 ? 'private-Linux17-Windows-calibration-driver-source-freeze-v3' : 'private-author42-focus-source-freeze-v2';
    requireProof(sourceFreeze.value.schema_version === schema && sourceFreeze.value.files && Object.keys(sourceFreeze.value.files).length > 0, 'helper_source_package_required');
    names.add(helper.path + '/source-freeze.json');
    for (const [name, record] of Object.entries(sourceFreeze.value.files)) {
      requireProof(basename(name) === name && (/\.(?:mjs|md|tap)$/u.test(name) || ['request.example.json', 'fix-evidence.json', 'cohort-lineage.json'].includes(name)), 'helper_source_name_invalid');
      requireProof(exactKeys(record, ['bytes', 'sha256']), 'helper_source_record_invalid');
      await verifyRegularFile({ rootDir: root, path: helper.path + '/' + name, namespace: 'runtime/models', expectedSha256: record.sha256, expectedBytes: record.bytes, signal });
      names.add(helper.path + '/' + name);
    }
  }
  for (const name of AUTHOR_DOCUMENTS) names.add(HELPERS[1].path + '/' + name);
  const sorted = [...names].sort(), folded = new Set();
  requireProof(sorted.length <= 2048, 'source_inventory_bounds');
  const records = [];
  for (const path of sorted) {
    requireProof(!folded.has(path.toLowerCase()), 'source_inventory_case_collision'); folded.add(path.toLowerCase());
    const file = await verifyRegularFile({ rootDir: root, path, maxBytes: 8 * 1024 ** 2, signal });
    records.push({ path, bytes: file.bytes, sha256: file.sha256 });
  }
  const source10 = SOURCE10.map(path => records.find(record => record.path === path));
  requireProof(source10.every(Boolean), 'source10_diagnostic_incomplete');
  return { schema_version: 'production-generation-source-closure-v1', registry_version: SOURCE_REGISTRY_VERSION, records, sha256: canonicalHash(records), production_source10_sha256: canonicalHash(source10), factory_sha256: records.find(record => record.path === 'src/intelligence/generation-contract.mjs').sha256 };
}
export function validateProductionClosure(expected, actual) {
  requireProof(exactKeys(expected, ['schema_version', 'registry_version', 'records', 'sha256', 'production_source10_sha256', 'factory_sha256']), 'production_closure_contract');
  requireProof(expected.schema_version === 'production-generation-source-closure-v1' && expected.registry_version === SOURCE_REGISTRY_VERSION && Array.isArray(expected.records) && expected.records.length > SOURCE10.length, 'full_current_source_closure_required');
  requireProof(expected.records.every(record => exactKeys(record, ['path', 'bytes', 'sha256']) && typeof record.path === 'string' && Number.isSafeInteger(record.bytes) && record.bytes > 0 && isHash(record.sha256)), 'source_closure_record_invalid');
  requireProof(expected.sha256 === canonicalHash(expected.records) && equal(expected, actual), 'current_production_source_closure_changed');
  return actual;
}
