import { buildFocusMessages } from './generation-contract.mjs';
import { buildFewshotFocusMessages } from './focus-fewshot.mjs';
import { FEWSHOT_PROTOCOL, FEWSHOT_PROTOCOL_SHA256 } from './fewshot-proof-contract.mjs';
import { equal, requireProof } from './production-closure.mjs';
export const isPretrainedFamily = family => family === 'pretrained' || family === 'pretrained-fewshot';
export function focusProtocolForVerifiedActivation(activation) {
  if(activation.family==='pretrained-fewshot'){
    requireProof(equal(activation.focusProtocol,FEWSHOT_PROTOCOL)&&activation.focusProtocolSha256===FEWSHOT_PROTOCOL_SHA256,'fewshot_verified_protocol_required');
    return FEWSHOT_PROTOCOL;
  }
  requireProof(activation.family==='pretrained'||activation.family==='joint'||activation.family===undefined,'unknown_focus_activation_family');
  return null;
}
export function buildActivatedFocusMessages(input,activation) {
  return focusProtocolForVerifiedActivation(activation) ? buildFewshotFocusMessages(input) : buildFocusMessages(input);
}
