import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACTIVATION_SCHEMAS } from './activation-family.mjs';
import { PRETRAINED_SCHEMA, pretrainedConfiguration, validatePretrainedManifest } from './pretrained-activation.mjs';
import { PRETRAINED_FEWSHOT_SCHEMA, fewshotConfiguration, validateFewshotManifest } from './pretrained-fewshot-activation.mjs';
import { ROUTED_ACTIVATION_SCHEMA, validateRoutedManifest, routedConfiguration } from './routed-activation.mjs';

/** Trusted startup settings only. This module never starts a server or a model. */
export function parseInferenceConfig(env = {}) {
  const enabled = env.LOCAL_GENERATOR === '1';
  if (env.LOCAL_GENERATOR !== undefined && !['0', '1'].includes(env.LOCAL_GENERATOR)) throw new Error('LOCAL_GENERATOR must be 0 or 1.');
  const draftMode = env.TRIAGE_DRAFT_MODE || 'fast';
  if (!['fast', 'native'].includes(draftMode)) throw new Error('TRIAGE_DRAFT_MODE must be fast or native.');
  if (draftMode === 'native' && !enabled) throw new Error('TRIAGE_DRAFT_MODE=native requires LOCAL_GENERATOR=1.');
  const focusMode = env.GENERATOR_FOCUS_MODE || 'deterministic';
  if (!['deterministic', 'model'].includes(focusMode)) throw new Error('GENERATOR_FOCUS_MODE must be deterministic or model.');
  if (draftMode === 'native' && focusMode !== 'model') throw new Error('Native triage drafts require GENERATOR_FOCUS_MODE=model with operator-generation activation.');
  const config = { enabled, focusMode };
  if (env.GENERATOR_TIMEOUT_MS !== undefined) {
    const timeout = Number(env.GENERATOR_TIMEOUT_MS);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000) throw new Error('GENERATOR_TIMEOUT_MS must be an integer between 1 and 60000.');
    config.timeoutMs = timeout;
  }
  for (const [key, target] of [['GENERATOR_MODEL_PATH', 'modelPath'], ['GENERATOR_RUNTIME_PATH', 'runtimePath']]) {
    if (env[key] !== undefined) {
      if (!env[key].trim()) throw new Error(`${key} must be a non-empty local path.`);
      config[target] = resolve(env[key]);
    }
  }
  if (enabled && focusMode === 'model') {
    if (!env.GENERATOR_ACTIVATION_MANIFEST) throw new Error('Model focus requires a verified local GENERATOR_ACTIVATION_MANIFEST.');
    config.activationManifestPath = resolve(env.GENERATOR_ACTIVATION_MANIFEST);
    config.requiredActivationScope = 'operator-generation';
    try {
      const stat = statSync(config.activationManifestPath);
      if (!stat.isFile() || stat.size > 256 * 1024 || stat.size < 2) throw new Error('a bounded JSON file is required');
      const manifest = JSON.parse(readFileSync(config.activationManifestPath, 'utf8'));
      if (!ACTIVATION_SCHEMAS.includes(manifest.schema_version) || manifest.scope !== 'operator-generation') throw new Error('recognized operator-generation manifest required');
      if ([PRETRAINED_SCHEMA,PRETRAINED_FEWSHOT_SCHEMA,ROUTED_ACTIVATION_SCHEMA].includes(manifest.schema_version)) {
        const globalBudget = config.timeoutMs ?? 60000;
        if (globalBudget <= 4400) throw new Error('Pretrained global budget has no bounded native phase after preparation');
        if(manifest.schema_version===ROUTED_ACTIVATION_SCHEMA)validateRoutedManifest(manifest,routedConfiguration(globalBudget-4400));
        else if(manifest.schema_version===PRETRAINED_FEWSHOT_SCHEMA)validateFewshotManifest(manifest,fewshotConfiguration(globalBudget-4400));
        else validatePretrainedManifest(manifest, pretrainedConfiguration(globalBudget - 4400));
      }
    } catch (error) { throw new Error(`GENERATOR_ACTIVATION_MANIFEST is unavailable or invalid: ${error.message}`); }
    // The runtime still verifies every identity, source hash and activation gate.
  }
  return { draftMode, generatorConfig: config };
}
