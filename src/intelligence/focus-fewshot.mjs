import { readFileSync } from 'node:fs';
import { buildFocusMessages, FOCUS_CODES, FOCUS_SYSTEM_PROMPT } from './generation-contract.mjs';
import { FOCUS_FEWSHOT_PROTOCOL_ID, freezeFocusValue } from './focus-demonstrations.mjs';
import { canonicalHash, equal, hash, requireProof } from './production-closure.mjs';

export const FOCUS_DEMONSTRATION_BANK_SHA256 = 'd38c885ce3a458b039fcc4c706917d5e82df07665c982d13abead5d7dd704b08';
const bankBytes = readFileSync(new URL('../../data/focus-demonstrations-v7.json', import.meta.url));
requireProof(hash(bankBytes) === FOCUS_DEMONSTRATION_BANK_SHA256, 'fewshot_fixed_bank_bytes_required');
const bank = JSON.parse(bankBytes);
requireProof(bank.schema_version === 'focus-demonstration-bank-v7' && bank.protocol_id === FOCUS_FEWSHOT_PROTOCOL_ID && bank.records.length === 7 && equal(bank.records.map(row => row.target.focus), FOCUS_CODES) && canonicalHash(bank.records) === bank.records_sha256, 'fewshot_fixed_bank_contract_required');
for (const row of bank.records) {
  requireProof(row.input.lang === 'en' && row.input.messages.every(message => message.role === 'player') && equal(JSON.parse(buildFocusMessages(row.input).at(-1).content.slice(0, -'\n/no_think'.length)), row.payload), 'fewshot_original_demo_payload_required');
}
export const FOCUS_DEMONSTRATION_BANK = freezeFocusValue(bank);
export const FOCUS_FEWSHOT_METADATA = freezeFocusValue({
  protocol_id: FOCUS_FEWSHOT_PROTOCOL_ID, bank_sha256: FOCUS_DEMONSTRATION_BANK_SHA256,
  count: 7, messages: 16, class_order: [...FOCUS_CODES],
  source_scope: 'exact_original_published_train126_only',
  lineage: structuredClone(bank.lineage), sources: structuredClone(bank.sources),
  records_sha256: bank.records_sha256,
  project_finetuned: false, quality_qualified: false, operator_activation_allowed: false,
});

/** Classifier prompt only. The current user is formatted independently with
 * the unchanged player-only factory. This module never constructs a plan,
 * extracts facts, selects citations, changes human gates or enables a route. */
export function buildFewshotFocusMessages(input) {
  const current = buildFocusMessages(input).at(-1);
  return freezeFocusValue([
    { role: 'system', content: FOCUS_SYSTEM_PROMPT },
    ...FOCUS_DEMONSTRATION_BANK.records.flatMap(row => [
      buildFocusMessages(row.input).at(-1),
      { role: 'assistant', content: JSON.stringify({ focus: row.target.focus }) },
    ]),
    current,
  ]);
}
