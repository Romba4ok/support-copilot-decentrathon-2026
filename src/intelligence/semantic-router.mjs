import {sanitizeInput} from '../core/engine.mjs';
import {FOCUS_CODES} from './generation-contract.mjs';
import {ROUTED_PINS as P,ROUTED_CLASSIFIER,ROUTED_SERIALIZER,routedPlayerText,routedQueryText} from './routed-contract.mjs';
import {equal,canonicalHash,hash,requireProof,exactKeys} from './production-closure.mjs';
export function validateRoutedHead(head){
 requireProof(head?.schema_version==='PRIVATE-expanded-TRAIN-E5-linear-head-v8'&&head.dimensions===384&&equal(head.classes,FOCUS_CODES)&&equal(head.classifier,ROUTED_CLASSIFIER)&&equal(head.serializer,ROUTED_SERIALIZER)&&head.dataset_sha256===P.dataset_sha256&&head.source_sha256===P.historical_training_source_sha256&&head.labels_encoder_input===false&&head.probabilities_calibrated===false,'routed_fixed_head_metadata');
 requireProof(head.encoder?.repo==='Xenova/multilingual-e5-small'&&head.encoder.revision===P.encoder_revision&&head.encoder.manifest_sha256===P.encoder_manifest_sha256&&head.encoder.worker_sha256===P.worker_sha256&&head.encoder.dtype==='q8'&&head.encoder.pooling==='mean'&&head.encoder.normalize===true&&head.encoder.max_length===256&&head.encoder.threads===2&&head.encoder.inter_threads===1&&head.encoder.execution_mode==='sequential'&&head.encoder.enable_cpu_mem_arena===false,'routed_fixed_head_encoder');
 requireProof(Array.isArray(head.weights)&&head.weights.length===7*384&&head.weights.every(Number.isFinite)&&Array.isArray(head.bias)&&head.bias.length===7&&head.bias.every(Number.isFinite),'routed_finite_linear_head');return head;
}
/** Exactly candidate C's per-vector normalization + learned linear argmax.
 * No fitting, prior adjustment, confidence threshold or alternate head exists. */
export function predictRoutedVector(head,vector,input){
 validateRoutedHead(head);requireProof(Array.isArray(vector)&&vector.length===384&&vector.every(Number.isFinite),'routed_finite384_vector');const norm=Math.sqrt(vector.reduce((s,x)=>s+x*x,0));requireProof(norm>0&&Math.abs(norm-1)<.02,'routed_unit_vector');const features=vector.map(x=>x/norm),scores=head.bias.map((bias,k)=>{let value=bias;for(let j=0;j<384;j++)value+=head.weights[k*384+j]*features[j];return value;});requireProof(scores.every(Number.isFinite),'routed_finite_logits');let best=0;for(let k=1;k<7;k++)if(scores[k]>scores[best])best=k;
 return{schema_version:'learned-E5-linear-route-trace-v8',input_sha256:canonicalHash(sanitizeInput(input)),player_text_sha256:hash(routedPlayerText(input)),query_text_sha256:hash(routedQueryText(input)),vector_sha256:canonicalHash(vector),vector:[...vector],head_sha256:P.head_sha256,encoder_manifest_sha256:P.encoder_manifest_sha256,encoder_revision:P.encoder_revision,worker_sha256:P.worker_sha256,focus:FOCUS_CODES[best],top1_index:best,score_type:'uncalibrated_logit',score:scores[best],scores,probabilities_calibrated:false,focus_llm_executed:false};
}
export function validateRoutedTrace(trace,{head,input}){
 requireProof(exactKeys(trace,['schema_version','input_sha256','player_text_sha256','query_text_sha256','vector_sha256','vector','head_sha256','encoder_manifest_sha256','encoder_revision','worker_sha256','focus','top1_index','score_type','score','scores','probabilities_calibrated','focus_llm_executed']),'routed_trace_closed_schema');
 const expected=predictRoutedVector(head,trace.vector,input);requireProof(equal(trace,expected),'routed_actual_vector_head_argmax_trace');return trace;
}
