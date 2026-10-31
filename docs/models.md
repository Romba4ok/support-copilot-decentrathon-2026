> Исторический документ. Текущие проверки и ограничения кандидата 0.3.0 перечислены в [checkpoint-status](checkpoint-status.md); прежние числа не заменяют итоговую проверку.

# Local models

The application starts without weights. Missing embeddings use explicit lexical/baseline fallback. Unavailable, interrupted or rejected generation keeps the original safe draft. Models, indexes, runtime binaries and raw outputs stay private under `runtime/`; HTTP never downloads weights.

## Embeddings

Run `npm run models:setup`, `npm run models:benchmark`, then initialize separately in the interface. The index contains all280 canonical rule sources,10 curated entries and84 authored intent prototypes across six languages. Administrator answers, outcomes and evaluation labels do not enter inference. Prototypes are not gold labels.

[Xenova/multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small), revision`761b726dd34fb83930e26aab4e9ac3899aa1fa78`, MIT, uses ONNX q8 CPU/two threads/256-token limit. The [original model card](https://huggingface.co/intfloat/multilingual-e5-small) specifies384 dimensions, query/passage prefixes, mean pooling and normalization. Ranking is `0.85*cosine + 0.15*normalized_BM25*query_term_coverage`; candidates are separate from applicable citations.

`runtime/models/multilingual-e5-small/manifest.json` records hashes. `runtime/indexes/e5-small-v2-index.json` stores private vectors/fingerprints/checkpoints every four documents; valid partial indexes resume. Ready source count290/prototype count84. One isolated embedding child handles one operation; budget≤4.3s, with explicit busy/timeout fallback. Process isolation resolved a measured Windows ONNX Worker-termination crash.

Historical authored smoke:8/8 expected-source hits@8 across ru/en/kk/uz/es/pt, cached initialization1433ms, searches18–44ms; child RSS622047232 bytes separate from the approximately60MB parent. These are not human-labelled accuracy or HTTP p95. Private evidence: `runtime/indexes/embedding-benchmark.json`.

## Model plan and localized renderer

`support-plan-v1` constrains the topic and canonical sources in code; Qwen selects supplied facts to acknowledge and missing details to request while preserving the human gate. Reviewed code composes the answer. The model writes no arbitrary prose, new factual values or promises. Results distinguish `plan_origin=local_llm` from `text_origin=deterministic_renderer`.

`src/intelligence/generation-contract.mjs` is the shared input/prompt/schema/validator/renderer; training freezes its exact hash/messages. Legacy `{reply,source_ids,needs_human}` experiments are history, not the current training contract.

The prepared `support-field-states-v1` pipeline resolves all eleven fields before selecting a topic. Each field is supplied, unavailable, mentioned_uncertain or absent, with role/provenance and chronology. Only absent fields may be requested. Uncertain strings never become new values, and choosing a new topic cannot relabel a payment date as an incident time. Conflicting metadata or an unresolved topic conflict increases human review and fails generation safely; a correctly recognized general question with an honest knowledge gap remains a legitimate plan.

`focus-v1` is a separate training contract: exactly `{ "focus": "one of seven codes" }`. Its messages include only explicit supported input language and player messages; administrator replies, outcomes, expected targets and baseline categories are excluded. The clarified topic definition places stated loss of owned possessions or ownership transfer under account, and visual UI failure without asserted ownership loss under technical. Its prompt/schema/message hashes are frozen separately from the plan task. `focusMode='model'` remains unavailable until trained weights pass local checks and an explicit integration decision; the production default does not run this classifier.

Generation responses with a successfully prepared code context include `safety_context` with schema generation-safety-v1 and origin code_context. It carries only the code-computed human flag and one closed reason: baseline_required, unresolved_context, no_verified_answer, incident_requires_verification or not_required. It is also returned when generation is disabled, rejected or unavailable; rejected model JSON cannot supply it. Context preparation failure returns no fabricated safety context. The server may only OR a trusted true flag into human review; this does not authorize projecting a rejected draft, language or citations.

```json
{"schema_version":"support-plan-v1","focus":"payment","fact_ids":[],"request_fields":["payment_date","platform","transaction_id","amount"],"source_ids":[],"needs_human":true}
```

Account/payment categories take precedence over untrusted topic instructions. Strong appeal, technical or real-threat markers can refine weak complaint/offtopic/admin labels without changing the human gate. Canonical citations are rechecked for that refined focus: a technical issue does not inherit a DM citation. Accepted results expose retained/excluded IDs in `metrics.source_applicability`; the server keeps the matching subset of prior canonical citation cards.

An explicit player denial or retraction can release a stale payment topic. Ordered clause evidence distinguishes a reported charge from a reported purchase: denying an authorized purchase does not erase a still-reported charge. Payment-date and amount facts require an active payment role; a technical-event date is not a payment date merely because baseline routed the ticket to payment. These are attributed player statements, not verified transactions. Explicit server markers accept bounded numeric, named and quoted Unicode aliases; unknown/time words and unsafe values are rejected.

Server recognition requires a complete locale marker and an affirmative declaration shape: quoted name, explicitly labelled proper name, or bounded identifier containing digits. A predicate or grammatical suffix is not a server alias. Nominal payment declarations and a transaction date in a later sentence retain their stated roles; these parser rules remain heuristic and require independent contextual evaluation. Replaying previously inspected controls can verify regression closure but cannot establish unseen quality.

Facts are bounded player text/allowed metadata with provenance, attributed to the report rather than established as true. Ticket creation is not event time; filing times and wallet balances are distinguished from incident/payment facts. Later time/date/amount corrections can supersede earlier unknowns; later unknowns retract those older facts. Locations, labelled reproduction steps, local currency names, transaction labels and full month-name dates cover the six supported languages. Mentioning screenshots is not an attachment declaration. Negated submission means materials were not provided, not that they cannot exist; declared materials remain uninspected.

Request codes: participant, server, event_time, location, reproduction_steps, platform, transaction_id, payment_date, amount, evidence, problem_description. Provided fields cannot be requested again. A substantive incident plan must acknowledge a fact or request missing information. Initial vague help requests only problem_description; an explicit greeting or gratitude can have an empty plan. Pure procedural questions use knowledge_gap when no verified answer is available: no incident questions, no invented instructions, and a clear handoff to support. A grounded glossary answer can be complete. Canonical references remain exact and conditional. Candidates/operator instructions do not become official rules.

Player statements about evidence produce a neutral mention regardless of guessed polarity. The renderer does not assert that materials exist, are absent, prove the allegation or were examined. Attachment metadata may state only its bounded declared count and that contents were not inspected. Canonical citation candidates must intersect exact prior citations and an independent contextual applicability check; a model topic alone cannot authorize a rule reference.

Context distinguishes actual_incident, grounded_info, knowledge_gap and initial_clarification. A supported explicit input.lang controls the prompt, renderer and accepted output. Language provenance is exposed as input.lang or triage.lang. The effective human gate is original_human_gate OR contextual_human; code can conservatively escalate for an unverified incident or absent verified answer, and the model must match the effective flag exactly. Accepted output exposes lang, language_origin, intent_mode, original_human_gate, contextual_human and human_escalation alongside the selected plan. Human escalation is not evidence that an allegation is true.

## Setup

Official [Qwen3-0.6B-GGUF](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF) is Apache-2.0. The official [llama.cpp b11960 Windows CPU build](https://github.com/ggml-org/llama.cpp/releases/tag/b11960) is MIT; stable v0.8.0 resolved to b11960 when checked. CPU is measured; Vulkan was not installed/tested. No global runtime or driver changes were made.

```powershell
node scripts/setup-generator.mjs
node scripts/quantize-generator.mjs --dry-run
node scripts/quantize-generator.mjs
$env:LOCAL_GENERATOR='1'
npm start
```

| Artifact | Revision/derivation | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Qwen3-0.6B-Q8_0.gguf | 23749fefcc72300e3a2ad315e1317431b06b590a | 639446688 | 9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031 |
| llama-b11960-bin-win-cpu-x64.zip | b11960 | 24407745 | 73f962f82850d244db47eaacb9d913637027b82399124324298576d58c5f4287 |
| Local Qwen3-0.6B-Q4_K_M.gguf | Q8_0→Q4_K_M, b11960 | 396704416 | 15e434d8ddf0af38fe3f7003af6ce6eac4edada6df34324aa45979f9cc79f02e |

Setup checks published hashes. Quantization verifies Q8 size/hash before spawning and its unchanged size/hash before activation. It uses two threads,32MiB row buffer,120s timeout and256MiB free-memory guard. Relative ASCII filenames avoid the measured Windows Cyrillic-argv defect without codepage changes. Actual conversion:27.953s, exit0, sampled CPU44.375s, peak working set697528320 bytes, minimum free642031616 bytes. Dry-run is size calculation, not inference.

Q4 is local requantization, not an official Q4 release or training. The [quantizer docs](https://raw.githubusercontent.com/ggml-org/llama.cpp/b11960/tools/quantize/README.md) explain possible quality loss; requantizing already quantized weights can lose more quality than starting from BF16/F16. Prefer merged float→Q4 for a trained candidate and evaluate it separately.

Optional trusted startup settings: `GENERATOR_MODEL_PATH`, `GENERATOR_RUNTIME_PATH`, `GENERATOR_TIMEOUT_MS`(1–60000). Paths stay in project runtime/models/tools; HTTP accepts no paths/commands. Default prefers completed Q4+manifest, otherwise Q8. Metadata describes the actual file/quantization.

HTTP `/triage` and v2 batch share `TRIAGE_DRAFT_MODE=fast` by default. This mode renders a validated code-context draft without a native LLM call; supplied language, known facts, source applicability and conservative human gates are shared with the UI generation projection. Metadata identifies code rendering and does not claim model execution. `MODE=baseline` retains the explicit historical comparison path. Missing E5 weights remain an explicit semantic fallback.

`TRIAGE_DRAFT_MODE=native` is a separate, slower trusted startup option. It requires `LOCAL_GENERATOR=1`, `GENERATOR_FOCUS_MODE=model` and a verified activation manifest with `operator-generation` scope. CLI and server use the same configuration parser. The overall timeout includes bounded semantic context preparation (up to 4400ms), leaving at most 55600ms for native generation at the default 60000ms budget. Private validation receipts cannot activate the ordinary service. An unavailable or rejected native attempt is reported explicitly and keeps the safe draft. The fast-triage latency target does not apply to this opt-in native mode. Native mode remains unaccepted until its actual candidate passes independent quality and resource checks.

The joint runtime is implemented behind explicit `focusMode:'model'` and remains off by default. Its trusted startup configuration is `{enabled:true,focusMode:'model',activationManifestPath,requiredActivationScope:'operator-generation',timeoutMs:60000}`. A private benchmark instead requires scope `private-validation`. The application must supply these settings at startup; player messages and HTTP payloads cannot supply activation paths, proof flags or scope overrides. This implementation has mock lifecycle coverage; a trained pair has not yet passed local native/contextual validation.

An activation JSON under runtime/models uses schema `joint-generation-activation-v1`. Required fields are scope, root_decision, selected_variant (`baseline` or `adapter`), selected_model_path, selected_model_sha256, expected_source_identity_sha256, expected_training_generator_sha256, expected_dataset_fingerprint, import_manifest `{path,sha256}`, and runtime `{tag:'b11960',path,sha256}`. Private validation requires root_decision `approved_for_local_validation`; an explicit `bounded_mmap_trial:true` permits measurement of that selected model without inheriting another model's profile. Operator generation requires root_decision `approved_for_local_experiment`, a hash-referenced memory_profile and local_quality report. A private-validation receipt cannot enable the ordinary server. No receipt is created automatically.

The verifier streams hashes of both imported Q4 files and checks their GGUF magic, exact import layout, completed changed-weight joint training, pinned original float revision, separate 42-classification/12-plan holdouts, dataset/source/prompt identity, float→Q4 derivation, and the pinned project runner. New joint artifacts require100 actual underlying optimizer-hook updates,100 attempts, zero skipped updates and finite saved weights/training loss; Trainer attempt counts alone do not qualify. The historical training generator SHA remains historical; later runtime code does not rewrite it. An operator receipt additionally requires a measured profile for the exact selected hash and a fresh independent 24-case local two-phase report whose current runtime/evaluator/benchmark source hashes and recomputed schema/context/safety criteria pass. These receipts authorize a local experiment, not expert quality or publication.

Operator quality receipts must describe the model-focus configuration and coherent actual execution. Every accepted case requires executed=true, both stopped phases, matching tokenizer counts/usage/context budgets, raw phase bytes matching their output hashes, and raw JSON matching the accepted focus/plan. Missing or contradictory traces cannot be replaced by a generated=true flag. A receipt remains a trusted local artifact; these consistency checks are not remote compute attestation.

One owned llama process performs focus-v1 followed by support-plan-v1. Only a validated topic enum enters fresh deterministic preparation; model output cannot supply facts, field states, citations or human gates. The final code context produces safety_context even if the plan fails. No partial draft/language/citation projection is returned. Token counts use b11960's [chat input-token route](https://github.com/ggml-org/llama.cpp/blob/b11960/tools/server/server-context.cpp), with the same messages, schema and thinking parameters as the completion. There is no approximate-token fallback. Each phase must fit context1024 including output reserve: focus32 tokens, plan192 tokens. One entry deadline, at most60s, covers proof checks, resource acquisition, startup, both calls and cleanup. A late or failed cleanup returns baseline fallback and keeps the operation occupied until owned exit; embedding restoration waits for that exit.

## Memory and checks

Defaults:1024 context/192 output tokens, CPU/two threads, one active operation, no thinking. Owned llama-server uses ephemeral loopback, random per-run key, offline mode and no Web UI. Shutdown/timeout/memory abort terminate and await only the owned process. Close is idempotent. E5 unloads before generation and restores after native exit; searches during the pause use lexical fallback. Other apps remain running.

Q8/unknown candidates retain full-file conservative preflight. The exact local Q4 hash has a measured mmap/no-repack profile: logs showed CPU_Mapped372.65MiB, KV112MiB, compute1.81MiB at ctx1024; peak private237400064 bytes versus RSS589467648 bytes. Required new memory is KV117440512 + conservative scratch/runtime134217728 + unchanged reserve268435456 =520093696 bytes; full-file estimate916798112 remains diagnostic. Unknown candidates do not inherit this profile. A250ms monitor kills the owned child below256MiB free.

A later direct base-runtime diagnostic began with611934208 bytes available and stopped during mmap loading when a current sample reached149987328 bytes. The owned process exited, an exact-project-runner census returned zero processes, and no focus/plan call executed. This is a guarded resource failure, not tokenizer parity or inference validation. Earlier successful memory measurements do not guarantee enough available physical memory in a later session. Runtime metrics retain an earlier low minimum honestly; abort decisions use the current sample after resource acquisition.

A real development example acknowledged supplied participant/server/time, requested only location/materials, kept source30:2.1/human review, and completed in9.687s. The initial development candidate passed10/10, p95=9.560s, minimum free342224896 bytes. Those measurements preceded fact-role/recency fixes; they are historical development evidence, not independent control or expert quality. Corrected-candidate independent evaluation remains required.

Original free prose executed8/8 but accepted0/8. A later four-wording enum was generic selection. Both remain history. The first independent 24-case authored control reached24/24 schema acceptance but failed contextual readiness:10 known-field reasks in7 cases and75% focus agreement. A subsequent independent control also reached24/24 schema acceptance but only10/24 contextually useful cases. Both are now regression evidence and are never described as unseen again. The intent/language/human-escalation revision requires evaluation after source freeze; passing schema alone does not establish useful support behavior.

The next independently frozen v4 control likewise passed24/24 schemas but failed contextual readiness at11/24 useful cases, with9 known-field reasks,7 focus misses and2 manually identified date-role errors. Its p95 was14.446s; acceptable latency does not resolve contextual failure. It is now regression history. Source-level extraction/topic fixes and synthetic unit tests do not establish a new quality pass, and fine-tuning cannot recover context that code incorrectly forbids.

A later v5 run also failed contextual readiness. One private, pre-output-frozen Q4 topic-only pilot on that already evaluated regression selected7/24 correct topics versus12/24 for the deterministic factory. All24 JSON objects were valid; request p95 was4.435s, peak sampled RSS589111296 bytes and minimum sampled free memory453570560 bytes. The owned process exited and the route was rejected. That pilot did not activate a classifier or establish unseen or expert quality. The subsequent joint classification/plan training experiment uses authored examples and a new frozen training contract; old plan-only adapters do not establish classification ability.

For pipeline selection before the next fresh control, the frozen factory was compared on the same42 author focus-validation inputs used by the joint training report. Inputs were reconstructed only from authored language/player messages; all predictions preceded label scoring. Factory focus agreed on23/42 versus the trained model's reported30/42. The model-focus+model-plan route was therefore preregistered as primary, with the paired base pipeline diagnostic only. These are reused author-validation results, both below90%; they establish no independent quality pass. The factory, prompts and training examples were not changed from these results.

Future reports separate `schema_acceptance_passed` from `contextual_passed`. Contextual readiness requires at least90% accepted cases with authored focus agreement and no known-field reask, plus zero known human-gate/source/unsafe-link violations. Required-field recall, extra safe questions and exact author-set agreement remain separate metrics. These automated checks do not fully establish semantic fact accuracy or expert quality. Historical JSON/results are not rewritten.

```powershell
node scripts/benchmark-generator.mjs
node scripts/benchmark-generator.mjs --candidate-info
# Explicit trusted private receipt; no implicit trained-weight activation:
node scripts/benchmark-generator.mjs --focus-mode model --activation-manifest runtime/models/<private-activation>.json --candidate-info
# Old control is explicitly regression:
node scripts/benchmark-generator.mjs --control --control-kind regression --candidate-sha <frozen-sha>
# Independent evaluator supplies a fresh frozen public authored fixture:
node scripts/benchmark-generator.mjs --control --control-kind fresh-independent --fixture fixtures/<new-authored-control>.json --candidate-sha <frozen-sha>
$env:RUN_GENERATOR_RUNTIME_TESTS='1'
node --test --test-concurrency=1 tests/generator.test.mjs
```

`--fixture` accepts only bounded JSON under the project fixtures directory with explicit authored-synthetic provenance, matching contract version and human_reviewed=false. The previously evaluated control path cannot be marked fresh. Fixture labels never enter model input. New benchmark reports have unique candidate/kind/timestamp names with atomic per-case checkpoints; they do not overwrite earlier report JSON.

For a joint benchmark, pass the same `--focus-mode model --activation-manifest ...` to the frozen control command. New reports bind all five runtime modules, record both phase executions/timings/token usage and actual verified model metadata, and retain separate raw phase outputs privately. Receipt verification and the selected-model memory check run before any native process. The benchmark never promotes a receipt or changes activation scope.

Private evidence: quantization-report.json, plan-mmap-1024-production-preflight.json, timestamped plan-*-benchmark reports, source-freeze manifests and generator TAP. Runtime/real sources/indexes/raw outputs/weights are excluded from delivery. The authorized authored-data GPU pilot is documented separately; setup and requantization are not training. The historical20-step run used the previous frozen factory; a new aligned run is separate evidence.
