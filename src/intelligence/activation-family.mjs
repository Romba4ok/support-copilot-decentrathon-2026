import { createActivationVerifier } from './activation.mjs';
import { createPretrainedActivationVerifier, PRETRAINED_SCHEMA } from './pretrained-activation.mjs';
import { createPretrainedFewshotActivationVerifier, PRETRAINED_FEWSHOT_SCHEMA } from './pretrained-fewshot-activation.mjs';
import { createRoutedActivationVerifier, ROUTED_ACTIVATION_SCHEMA } from './routed-activation.mjs';
import { ROUTED_FAMILY, ROUTED_PROTOCOL } from './routed-contract.mjs';
import { APP_ROOT, readTrustedJson, requireProof } from './production-closure.mjs';

export const ACTIVATION_SCHEMAS = Object.freeze(['joint-generation-activation-v1', PRETRAINED_SCHEMA, PRETRAINED_FEWSHOT_SCHEMA, ROUTED_ACTIVATION_SCHEMA]);

/** Trusted local manifest schema is the only dispatcher. No model name, HTTP
 * property, validation failure or missing receipt may downgrade another family. */
export function createActivationFamilyVerifier(config, { rootDir = APP_ROOT, canonicalSources = [], legacyFactory = createActivationVerifier, pretrainedFactory = createPretrainedActivationVerifier, fewshotFactory = createPretrainedFewshotActivationVerifier, routedFactory = createRoutedActivationVerifier } = {}) {
  let family = null, verifier = null;
  return async options => {
    requireProof(config?.enabled === true && config.focusMode === 'model', 'model_mode_not_enabled');
    requireProof(typeof config.activationManifestPath === 'string' && config.activationManifestPath.length > 0, 'Model focus is not activated: an explicit trusted startup activation manifest is required');
    const file = await readTrustedJson({ rootDir, path: config.activationManifestPath, namespace: 'runtime/models', expectedSha256: config.activationManifestSha256, maxBytes: 256 * 1024, signal: options?.signal });
    const schema = file.value.schema_version;
    requireProof(ACTIVATION_SCHEMAS.includes(schema), 'unsupported_activation_family');
    const selected = schema === ROUTED_ACTIVATION_SCHEMA ? ROUTED_FAMILY : schema === PRETRAINED_FEWSHOT_SCHEMA ? 'pretrained-fewshot' : schema === PRETRAINED_SCHEMA ? 'pretrained' : 'joint';
    if (selected === ROUTED_FAMILY) requireProof(config.adapterProtocol === ROUTED_PROTOCOL.id, 'routed_requires_sequential_router_plan_adapter');
    requireProof(family === null || family === selected, 'activation_family_changed');
    if (!verifier) { family = selected; verifier = (selected === ROUTED_FAMILY ? routedFactory : selected === 'pretrained-fewshot' ? fewshotFactory : selected === 'pretrained' ? pretrainedFactory : legacyFactory)(config, { rootDir, canonicalSources }); }
    const result = await verifier(options);
    return { ...result, family: selected };
  };
}
