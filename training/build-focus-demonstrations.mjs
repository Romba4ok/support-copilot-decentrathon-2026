import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { focusAuthorRecords } from './focus-author-data.mjs';
import { parsePublishedFocusTrainNotebook, selectFocusDemonstrations, FOCUS_FEWSHOT_PROTOCOL_ID, FOCUS_TRAIN_PINS } from '../src/intelligence/focus-demonstrations.mjs';
import { canonicalHash, equal, hash, requireProof } from '../src/intelligence/production-closure.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const SELECTOR_PATH = 'src/intelligence/focus-demonstrations.mjs';
const COMPILER_PATH = 'training/build-focus-demonstrations.mjs';
const CANONICAL_PATH = 'src/intelligence/production-closure.mjs';
export async function compileFocusDemonstrations() {
  const published = parsePublishedFocusTrainNotebook(await readFile(resolve(root, 'notebooks/support-copilot-plan-qlora.ipynb')));
  const authorBytes = await readFile(resolve(root, 'training/focus-author-data.mjs'));
  requireProof(hash(authorBytes) === FOCUS_TRAIN_PINS.author_source_sha256, 'focus_train_original_author_source_required');
  // Match only TRAIN IDs. The original public source carries raw inputs; its
  // pinned hash and exact equality prove the lossless reconstruction above.
  const originals = new Map(focusAuthorRecords().map(record => [record.id, record]));
  requireProof(published.rows.every(row => {
    const original = originals.get(row.id);
    return original && original.group_id === row.group_id && original.expected_focus === row.target.focus && equal(original.input, row.input) && equal(original.provenance, row.provenance);
  }), 'focus_train_original_raw_input_identity_required');
  const sources = Object.fromEntries(await Promise.all([SELECTOR_PATH, COMPILER_PATH, CANONICAL_PATH, 'src/intelligence/generation-contract.mjs'].map(async path => [path, hash(await readFile(resolve(root, path)))])));
  const records = selectFocusDemonstrations(published);
  return {
    schema_version: 'focus-demonstration-bank-v7', protocol_id: FOCUS_FEWSHOT_PROTOCOL_ID,
    provenance: 'authored_synthetic_train_only', human_reviewed: false, real_gold: false, contains_private_data: false,
    selection: { language: 'en', per_class: 1, class_order: records.map(row => row.target.focus), measure: 'Buffer.byteLength(canonical(player_payload),utf8)', tie_break: 'original_id_code_unit_ascending' },
    lineage: published.lineage, sources,
    membership: published.rows.map(row => ({ id: row.id, group_id: row.group_id, input_sha256: canonicalHash(row.input), player_payload_sha256: canonicalHash(row.payload), target_sha256: canonicalHash(row.target), original_row_sha256: row.original_row_sha256 })),
    records, records_sha256: canonicalHash(records),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bank = await compileFocusDemonstrations();
  const destination = resolve(root, 'data/focus-demonstrations-v7.json');
  const bytes = JSON.stringify(bank, null, 2) + '\n';
  if (process.argv.includes('--write')) {
    let existing; try { existing = await readFile(destination, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    requireProof(existing === undefined || existing === bytes, 'focus_bank_exists_with_different_bytes_preserve_history');
    if (existing === undefined) await writeFile(destination, bytes, { flag: 'wx' });
  } else requireProof(await readFile(destination, 'utf8') === bytes, 'focus_bank_reproduction_failed');
  console.log(JSON.stringify({ status: process.argv.includes('--write') ? 'compiled_or_identical' : 'reproduced', count: bank.records.length, train_count: bank.membership.length, bank_sha256: hash(bytes), protocol_id: bank.protocol_id }));
}
