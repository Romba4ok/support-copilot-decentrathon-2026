import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createEngine } from '../src/core/engine.mjs';
import { splitExamples, normalizeExample, validateTarget, hash } from '../training/contract.mjs';
import { prepareTraining } from '../scripts/prepare-training.mjs';
import { preparePlanTraining } from '../training/prepare-plan.mjs';
import { preparePlanExamples } from '../training/plan-contract.mjs';
import { focusAuthorRecords, FOCUS_AUTHOR_LANGUAGES } from '../training/focus-author-data.mjs';
import { prepareFocusExamples, prepareJointExamples } from '../training/joint-contract.mjs';
import { prepareJointTraining } from '../training/prepare-joint.mjs';
import { buildGenerationInput, buildPlanMessages, buildPlanSchema, validatePlan, FOCUS_CODES, FOCUS_SYSTEM_PROMPT, buildFocusMessages, buildFocusSchema, validateFocus } from '../src/intelligence/generation-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = resolve(root, 'runtime/training');
mkdirSync(temporaryRoot, { recursive: true });
// Contract preparation needs source-presence shapes for its existing baseline
// gates, never private rule text. These public canonical IDs occur in engine.mjs;
// their test-only markers assert no gameplay policy and never enter cloud rows.
const baselineMarker = 'AUTHOR_ONLY_BASELINE_MARKER_NOT_POLICY';
const dataDir = mkdtempSync(join(temporaryRoot, '.test-authored-source-'));
writeFileSync(join(dataDir,'rules.json'),JSON.stringify({provenance:'authored_synthetic_structural_test_stub_not_official_policy',rules:[
  {id:43,category:baselineMarker,points:[{ref:'DM',text:baselineMarker},{ref:'RP',text:baselineMarker}]},
  {id:31,category:baselineMarker,points:[{ref:'1.3.1',text:baselineMarker},{ref:'1.3.2',text:baselineMarker}]},
]}));
writeFileSync(join(dataDir,'taxonomy.json'),JSON.stringify({categories:JSON.parse(readFileSync(join(root,'data/intents.json'),'utf8')).categories.map(row=>({code:row.category})),priorities:['p0','p1','p2','p3']}));
after(()=>{const absolute=resolve(dataDir);assert.ok(absolute.startsWith(temporaryRoot+sep));rmSync(absolute,{recursive:true,force:true});});
const baseline = createEngine({ dataDir });
const rows = readFileSync(join(root, 'fixtures/training-author-synthetic.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const python = process.env.PYTHON || 'python';
function temporary(t) {
  const directory = mkdtempSync(join(temporaryRoot, '.test-'));
  t.after(() => { const absolute = resolve(directory); assert.ok(absolute.startsWith(temporaryRoot + sep)); rmSync(absolute, { recursive: true, force: true }); });
  return directory;
}
function runPython(args, options = {}) { return spawnSync(python, args, { cwd: root, encoding: 'utf8', timeout: 30000, ...options, env: { ...process.env, PYTHONUTF8: '1', ...options.env } }); }

test('authored fixture has explicit synthetic provenance, six languages and independent scenario groups', () => {
  assert.equal(rows.length, 24);
  assert.equal(new Set(rows.map(row => row.group_id)).size, 12);
  assert.deepEqual([...new Set(rows.map(row => row.input.lang))].sort(), ['en', 'es', 'kk', 'pt', 'ru', 'uz']);
  for (const row of rows) {
    assert.equal(row.provenance.type, 'authored_synthetic'); assert.equal(row.provenance.human_reviewed, false);
    assert.equal(row.provenance.contains_private_data, false); assert.equal(row.provenance.cloud_eligible, true);
    assert.deepEqual(Object.keys(row.target).sort(), ['needs_human', 'reply', 'source_ids']);
    assert.deepEqual(row.target.source_ids, []);
  }
});

test('seeded split keeps translations, paraphrases and normalized duplicate prompts out of the opposite split', () => {
  const first = splitExamples(rows, { baseline }), second = splitExamples(rows, { baseline });
  assert.deepEqual(first, second); assert.equal(first.train.length, 18); assert.equal(first.holdout.length, 6);
  for (const field of ['group_id', 'scenario_group', 'duplicate_key']) {
    const train = new Set(first.train.map(row => row[field])); assert.ok(first.holdout.every(row => !train.has(row[field])));
  }
  const extended = structuredClone(rows);
  extended.push({ ...structuredClone(rows[0]), id: 'duplicate-other-group', group_id: 'different-label', input: { ...rows[0].input, messages: [{ role: 'player', text: rows[0].input.messages[0].text.toUpperCase().replace('.', '!!!') }] } });
  extended.push({ ...structuredClone(rows[0]), id: 'near-duplicate-other-group', group_id: 'third-label', input: { ...rows[0].input, messages: [{ role: 'player', text: rows[0].input.messages[0].text + ' Сегодня.' }] } });
  const split = splitExamples(extended, { baseline });
  const partition = id => split.train.some(row => row.id === id) ? 'train' : 'holdout';
  assert.equal(partition('duplicate-other-group'), partition(rows[0].id));
  assert.equal(partition('near-duplicate-other-group'), partition(rows[0].id));
});

test('preparation strips admin/outcomes from input and never accepts them as a target or human provenance', () => {
  const contaminated = structuredClone(rows[0]);
  contaminated.input.outcome = 'PRIVATE_OUTCOME'; contaminated.input.labels = { category: 'report.account' };
  contaminated.input.messages.push({ role: 'admin', text: 'PRIVATE_ADMIN_REPLY' });
  const clean = normalizeExample(contaminated, baseline);
  assert.doesNotMatch(JSON.stringify(clean), /PRIVATE_OUTCOME|PRIVATE_ADMIN_REPLY|"labels"|"outcome"/);
  const wrong = structuredClone(rows[0]); wrong.provenance.type = 'human';
  assert.throws(() => normalizeExample(wrong, baseline), /authored synthetic/);
  assert.throws(() => validateTarget({ ...rows[0].target, admin_reply: 'secret' }), /unsupported/);
  assert.throws(() => validateTarget({ ...rows[0].target, needs_human: false }, { needsHuman: true }), /human gate/);
  assert.throws(() => validateTarget({ ...rows[0].target, source_ids: ['30:1.4'] }), /supplied canonical/);
  for (const reply of ['Мы вернём деньги.', 'We will unban the player.', 'Reembolsaremos el pago.', 'Puniremos o jogador.', 'Ақшаны қайтарамыз.', 'Pulni qaytaramiz.']) assert.throws(() => validateTarget({ reply, source_ids: [], needs_human: true }), /unsupported promise/);
});

test('local preparation writes checksum manifests, preserves a conflicting split and rejects output outside runtime', t => {
  const directory = temporary(t), outputDir = join(directory, 'prepared');
  const report = prepareTraining({ outputDir, dataDir });
  const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.actual_training, 'not_run'); assert.equal(manifest.cloud_eligible, true); assert.equal(manifest.human_reviewed, false);
  for (const [name, digest] of Object.entries(manifest.files)) assert.equal(hash(readFileSync(join(outputDir, name), 'utf8')), digest);
  assert.equal(report.fingerprint, manifest.fingerprint);
  assert.throws(() => prepareTraining({ outputDir, dataDir, seed: 'different-partition' }), /different split/);
  assert.equal(JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8')).fingerprint, report.fingerprint);
  assert.throws(() => prepareTraining({ outputDir: join(root, 'training/forbidden-output'), dataDir }), /inside this project runtime/);
  assert.equal(existsSync(join(root, 'training/forbidden-output')), false);
});

test('stdlib dry-run executes without model loading or network and rejects tampered or private datasets', t => {
  const directory = temporary(t), data = join(directory, 'data'), output = join(directory, 'run');
  prepareTraining({ outputDir: data, dataDir });
  const args = [join(root, 'training/run_lora.py'), '--data-dir', data, '--output', output, '--dry-run'];
  const result = runPython(args);
  assert.equal(result.status, 0, result.stderr); const report = JSON.parse(result.stdout);
  assert.equal(report.actual_training, false); assert.equal(report.model_loaded, false); assert.equal(report.network_requests, 0);
  assert.equal(report.train_examples, 18); assert.equal(report.holdout_examples, 6);
  const manifestPath = join(data, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const trainFile = join(data, 'train.jsonl'), original = readFileSync(trainFile, 'utf8');
  writeFileSync(trainFile, original + ' ');
  assert.match(runPython(args).stderr, /SHA-256 mismatch/);
  writeFileSync(trainFile, original); manifest.cloud_eligible = false; writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.match(runPython(args).stderr, /cloud-eligible author synthetic/);
});

test('notebook schema/code syntax and checksum-verified bootstrap/dry-run execute locally with training disabled', t => {
  const directory = temporary(t), notebook = JSON.parse(readFileSync(join(root, 'notebooks/support-copilot-author-synthetic-qlora.ipynb'), 'utf8'));
  assert.equal(notebook.nbformat, 4); assert.equal(notebook.nbformat_minor, 5);
  assert.equal(notebook.metadata.support_copilot.actual_training, 'not_run');
  const cells = notebook.cells.filter(cell => cell.cell_type === 'code');
  for (const cell of cells) { assert.equal(cell.execution_count, null); assert.deepEqual(cell.outputs, []); }
  const script = 'import ast,json,sys\nnb=json.load(sys.stdin)\nfor cell in nb["cells"]:\n if cell["cell_type"]=="code": ast.parse("".join(cell["source"]))\nnamespace={}\nfor cell in [c for c in nb["cells"] if c["cell_type"]=="code"][:2]: exec(compile("".join(cell["source"]),"notebook-cell","exec"),namespace)\nprint("notebook_schema_syntax_bootstrap_dry_run_passed")\n';
  const result = runPython(['-c', script], { input: JSON.stringify(notebook), env: { ...process.env, SUPPORT_TRAINING_WORKDIR: join(directory, 'notebook') } });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /notebook_schema_syntax_bootstrap_dry_run_passed/);
  const allCode = cells.map(cell => cell.source.join('')).join('\n');
  assert.match(allCode, /INSTALL_DEPENDENCIES = False/); assert.match(allCode, /RUN_TRAINING = False/); assert.match(allCode, /DOWNLOAD_RESULTS = False/);
  assert.doesNotMatch(allCode, /drive\.mount|files\.upload|push_to_hub=True|huggingface_hub\.login/);
  const report = JSON.parse(readFileSync(join(directory, 'notebook/runs/dry-run/dry-run.json'), 'utf8'));
  assert.equal(report.actual_training, false); assert.equal(report.model_loaded, false);
});

test('Python runner source parses and loss masks only the prompt while preserving complete supervised JSON', () => {
  const code = `import ast,importlib.util,json,pathlib,sys\nroot=pathlib.Path(sys.argv[1])\nfor name in ['run_lora.py','merge_adapter.py']: ast.parse((root/'training'/name).read_text(encoding='utf-8'))\nspec=importlib.util.spec_from_file_location('run_lora',root/'training/run_lora.py')\nmodule=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)\nclass Tokenizer:\n eos_token='<eos>'\n def apply_chat_template(self,messages,**kwargs):\n  assert kwargs['enable_thinking'] is False and kwargs['add_generation_prompt'] is True\n  assert len(messages)==2 and messages[0]['role']=='system' and messages[1]['role']=='user'\n  return 'PROMPT'\n def encode(self,text,**kwargs): return list(text.encode('utf-8'))\nrow={'input':{'needs_human':True},'target':{'reply':'Safe clarification','source_ids':[],'needs_human':True}}\nencoded=module.encode_example(row,Tokenizer(),'system',1000)\nassert encoded['labels'][:6]==[-100]*6\nassert encoded['labels'][6:]==list((module.compact(row['target'])+'<eos>').encode('utf-8'))\nassert encoded['input_ids'][:6]==list(b'PROMPT')\ntry: module.encode_example(row,Tokenizer(),'system',10)\nexcept ValueError: pass\nelse: raise AssertionError('Truncated supervised contract')\nprint('syntax_and_prompt_masking_passed')\n`;
  const result = runPython(['-B', '-c', code, root]);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /syntax_and_prompt_masking_passed/);
});

const planRows = readFileSync(join(root, 'fixtures/training-plan-author-synthetic.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
test('plan pilot freezes exact production factory messages/schema and stratified whole multilingual groups', () => {
  const split = preparePlanExamples(planRows, { baseline });
  assert.doesNotMatch(JSON.stringify(split),new RegExp(baselineMarker),'Authored baseline source markers must not enter training data');
  assert.equal(split.train.length + split.holdout.length, planRows.length); assert.equal(split.holdout.length, 12);
  assert.equal(split.manifest.plan_schema_version, 'support-plan-v1');
  for (const name of ['train','holdout']) {
    const counts = split.manifest.split_counts[name];
    assert.equal(counts.total,split[name].length); assert.equal(counts.human_true + counts.human_false,counts.total);
    for (const lang of ['ru','en','kk','uz','es','pt']) {
      const members = split[name].filter(row => row.context.lang === lang);
      assert.equal(counts.languages[lang].total,members.length);
      assert.equal(counts.languages[lang].human_true,members.filter(row => row.target.needs_human).length);
    }
  }
  for (const part of [split.train, split.holdout]) for (const lang of ['ru','en','kk','uz','es','pt']) for (const flag of [true,false]) assert.ok(part.some(row => row.context.lang === lang && row.target.needs_human === flag));
  const heldGroups = new Set(split.holdout.map(row => row.group_id));
  assert.ok(split.train.every(row => !heldGroups.has(row.group_id)));
  for (const row of [...split.train, ...split.holdout]) {
    const original = planRows.find(record => record.id === row.id);
    const context = buildGenerationInput(original.input, baseline.triage(original.input), []);
    assert.deepEqual(row.messages, buildPlanMessages(context)); assert.deepEqual(row.schema, buildPlanSchema(context));
    assert.equal(validatePlan(row.target, context).ok, true); assert.equal(row.context.allowed_sources.length, 0);
    assert.equal(row.baseline_needs_human, original.expected_needs_human);
    assert.equal(row.target.needs_human, context.needs_human);
    assert.equal(row.context.lang, original.input.lang);
    assert.ok(!row.baseline_needs_human || row.target.needs_human, 'factory cannot lower the authored baseline gate');
    assert.equal(row.provenance.human_reviewed, false); assert.ok(!Object.hasOwn(row.target, 'reply'));
  }
  assert.equal(rows.length, 24, 'legacy fixture is preserved separately');
});

test('plan preparation strips admin/outcome content and rejects cross-group duplicates/private provenance', () => {
  const dirty = structuredClone(planRows);
  dirty[0].input.outcome = 'PRIVATE_OUTCOME'; dirty[0].input.messages.push({role:'admin',text:'PRIVATE_ADMIN'});
  const split = preparePlanExamples(dirty, { baseline });
  assert.doesNotMatch(JSON.stringify(split), /PRIVATE_OUTCOME|PRIVATE_ADMIN/);
  const duplicate = structuredClone(planRows[0]); duplicate.id = 'cross-group-copy'; duplicate.group_id = 'other-group';
  assert.throws(() => preparePlanExamples([...planRows, duplicate], { baseline }), /Exact duplicate/);
  dirty[0].provenance.cloud_eligible = false;
  assert.throws(() => preparePlanExamples(dirty, { baseline }), /authored synthetic/);
  const wrongGate = structuredClone(planRows);
  wrongGate[0].expected_needs_human = !wrongGate[0].expected_needs_human;
  assert.throws(() => preparePlanExamples(wrongGate, { baseline }), /authored human gate differs/);
});

test('authored plan targets preserve baseline provenance while following effective intent and explicit language', () => {
  const split = preparePlanExamples(planRows, { baseline });
  const all = [...split.train, ...split.holdout];
  for (const lang of ['ru','en','kk','uz','es','pt']) {
    const greeting = all.find(row => row.group_id === 'gratitude-only' && row.context.lang === lang);
    assert.equal(greeting.target.needs_human,false); assert.deepEqual(greeting.target.request_fields,[]);
    const vague = all.find(row => row.group_id === 'initial-clarification' && row.context.lang === lang);
    assert.equal(vague.context.intent_mode,'initial_clarification');
    assert.deepEqual(vague.target.request_fields,['problem_description']);
    const unknown = all.find(row => row.group_id === 'dm-meaning' && row.context.lang === lang);
    assert.equal(unknown.baseline_needs_human,false); assert.equal(unknown.target.needs_human,true);
    assert.equal(unknown.context.intent_mode,'knowledge_gap');
    assert.equal(unknown.context.human_escalation.reason,'no_verified_answer');
    assert.deepEqual(unknown.target.request_fields,[]); assert.deepEqual(unknown.target.source_ids,[]);
    const raw = {kind:'report',lang,messages:[{role:'player',text:'Что такое DM?'}]};
    const context = buildGenerationInput(raw, baseline.triage(raw), []);
    assert.equal(context.lang,lang); assert.equal(context.language_origin,'input.lang');
  }
});

test('plan Python dry-run and validator match shared factory on valid and invalid plans', t => {
  const directory = temporary(t), outputDir = join(directory, 'plan-data');
  const manifest = preparePlanTraining({ outputDir, dataDir });
  const result = runPython([join(root, 'training/run_plan_lora.py'), '--data-dir', outputDir, '--output', join(directory, 'dry-run'), '--dry-run']);
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).actual_training, false);
  const data = ['train','holdout'].flatMap(name => readFileSync(join(outputDir, name + '.jsonl'), 'utf8').trim().split('\n').map(JSON.parse));
  const cases = [];
  for (const row of data) {
    for (const plan of [row.target, {...row.target, fact_ids:[],request_fields:[]}, {...row.target, needs_human: !row.target.needs_human}, {...row.target, fact_ids:['invented_fact']}, {...row.target, request_fields:['password']}, {...row.target, request_fields:['problem_description']}, {...row.target, source_ids:['fake:1']}, {...row.target, reply:'untrusted prose'}]) cases.push({ row, plan, expected:validatePlan(plan, row.context).ok });
  }
  const script = "import importlib.util,json,pathlib,sys\nspec=importlib.util.spec_from_file_location('plan_runner',pathlib.Path(sys.argv[1])/'training/run_plan_lora.py')\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nfor case in json.load(sys.stdin): assert m.validate_plan(case['plan'],case['row']) is case['expected']\nprint('factory_validator_parity_passed')\n";
  const parity = runPython(['-B','-c',script,root],{input:JSON.stringify(cases)});
  assert.equal(parity.status,0,parity.stderr); assert.match(parity.stdout,/factory_validator_parity_passed/);
  assert.equal(manifest.factory_source_sha256, hash(readFileSync(join(root,'src/intelligence/generation-contract.mjs'),'utf8')));
  const trainPath = join(outputDir,'train.jsonl');
  const altered = readFileSync(trainPath,'utf8').trim().split('\n').map(JSON.parse);
  altered[0].baseline_needs_human = !altered[0].baseline_needs_human;
  const text = altered.map(row => JSON.stringify(row)).join('\n') + '\n';
  writeFileSync(trainPath,text);
  const saved = JSON.parse(readFileSync(join(outputDir,'manifest.json'),'utf8'));
  saved.files['train.jsonl'] = hash(text);
  writeFileSync(join(outputDir,'manifest.json'),JSON.stringify(saved));
  const rejected = runPython([join(root,'training/run_plan_lora.py'),'--data-dir',outputDir,'--output',join(directory,'altered-dry-run'),'--dry-run']);
  assert.notEqual(rejected.status,0); assert.match(rejected.stderr,/human gate/);
});

test('joint notebook binds declared historical provenance to its embedded data and stdlib bootstrap', t => {
  const directory = temporary(t), notebookText = readFileSync(join(root,'notebooks/support-copilot-plan-qlora.ipynb'),'utf8'), notebook = JSON.parse(notebookText);
  assert.equal(hash(notebookText),'f4ff582201fc224120e52ff89d0352f7f7ebaa9a1f4972c796f351fb83e2f35d','The actual frozen notebook is preserved');
  assert.equal(notebook.metadata.support_copilot.plan_schema_version,'support-plan-v1');
  assert.equal(notebook.metadata.support_copilot.focus_schema_version,'focus-v1');
  assert.equal(notebook.metadata.support_copilot.dataset_schema_version,3);
  const cells=notebook.cells.filter(cell=>cell.cell_type==='code');
  for(const cell of cells){assert.equal(cell.execution_count,null);assert.deepEqual(cell.outputs,[]);}
  const script="import ast,hashlib,json,sys\nnb=json.load(sys.stdin)\nfor c in nb['cells']:\n if c['cell_type']=='code': ast.parse(''.join(c['source']))\nns={}\nfor c in [c for c in nb['cells'] if c['cell_type']=='code'][:2]: exec(''.join(c['source']),ns)\nprint('NOTEBOOK_PAYLOAD_PROOF:'+json.dumps({'bundle_sha256':hashlib.sha256(ns['BUNDLE_JSON'].encode('utf-8')).hexdigest(),'files':sorted(json.loads(ns['BUNDLE_JSON']))}))\nprint('plan_notebook_passed')\n";
  const executed=runPython(['-B','-c',script],{input:JSON.stringify(notebook),env:{...process.env,SUPPORT_TRAINING_WORKDIR:join(directory,'plan-notebook')}});
  assert.equal(executed.status,0,executed.stderr);assert.match(executed.stdout,/plan_notebook_passed/);
  for(const name of ['run_plan_lora.py','merge_adapter.py','export_plan_pair.py','requirements-colab.txt','requirements-bootstrap.txt','notebook_tools.py'])assert.equal(readFileSync(join(directory,'plan-notebook/training',name),'utf8'),readFileSync(join(root,'training',name),'utf8'),'Notebook embeds stale '+name);
  const payload=JSON.parse(executed.stdout.split('\n').find(line=>line.startsWith('NOTEBOOK_PAYLOAD_PROOF:')).slice('NOTEBOOK_PAYLOAD_PROOF:'.length));
  assert.deepEqual(payload.files,['data/holdout.jsonl','data/manifest.json','data/train.jsonl','training/export_plan_pair.py','training/merge_adapter.py','training/notebook_tools.py','training/requirements-bootstrap.txt','training/requirements-colab.txt','training/run_plan_lora.py']);
  assert.equal(payload.bundle_sha256,'fe6f1ca67b32eef2568beee84091c0196372e91d6b4eb586e5367f7c9e44cc15');
  assert.equal(notebook.metadata.support_copilot.bundle_sha256,payload.bundle_sha256);
  // These are declared training-source identities, not embedded factory or
  // generator bytes. Current application parity is tested with fresh data below.
  const frozenText=readFileSync(join(directory,'plan-notebook/data/manifest.json'),'utf8'), frozen=JSON.parse(frozenText);
  const embeddedData=Object.fromEntries(['train','holdout'].map(name=>[name,readFileSync(join(directory,'plan-notebook/data',name+'.jsonl'),'utf8')]));
  const historicalReference={manifest_sha256:'d1599db986a777b7d5438d1ef09ab898c11b14084d07c91c019b36fcf3c1322c',generator_sha256:'56a4a2e8f3d077db34af0bc5cd148ecd8b4c5a1d4e74f17fe865fff132ac4ac5',source_identity_sha256:'5c0ea2489487a40b37cb0b5595b2954690b986ebbb39b2d09dcd9eeb0f1fe5f5'};
  function checkHistoricalReference(metadata,parts=embeddedData){
    assert.deepEqual(metadata.frozen_training_reference,historicalReference,'Exact historical reference must remain present');
    assert.equal(metadata.factory_source_sha256,'6bc4d60353c0eaaabb4d70894aa15eb1b42602be0025211c4e97056cedbf721b','Declared historical factory must not be replaced by the current factory');
    assert.equal(metadata.factory_source_sha256,frozen.factory_source_sha256);
    assert.equal(frozen.sources['src/intelligence/generation-contract.mjs'],metadata.factory_source_sha256);
    assert.equal(frozen.sources['src/intelligence/generator.mjs'],historicalReference.generator_sha256);
    assert.equal(hash(frozenText),historicalReference.manifest_sha256);
    assert.equal(frozen.source_identity_sha256,hash(frozen.sources));
    assert.equal(metadata.source_identity_sha256,historicalReference.source_identity_sha256);
    assert.equal(metadata.source_identity_sha256,frozen.source_identity_sha256);
    assert.equal(frozen.base_model,'Qwen/Qwen3-0.6B');
    assert.equal(metadata.base_revision,'c1899de289a04d12100db370d81485cdf75e47ca','Exact frozen base revision');
    assert.equal(frozen.base_revision,metadata.base_revision);
    assert.equal(metadata.fingerprint,'eba0c985bd60c10d704aa14f8de42bc815f7b31698cdc4ab40c7f49e8b7640cf');
    assert.equal(metadata.fingerprint,frozen.fingerprint);
    for(const [name,count] of [['train',174],['holdout',54]]){
      assert.equal(hash(parts[name]),frozen.files[name+'.jsonl'],'Embedded '+name+' checksum');
      const records=parts[name].trim().split('\n').map(JSON.parse);
      assert.equal(records.length,count);
      assert.equal(records.filter(row=>row.task_type==='focus-v1').length,name==='train'?126:42);
      for(const row of records){
        assert.equal(hash(row.messages[0].content),frozen.prompt_sha256[row.task_type],'Embedded historical task prompt');
        assert.equal(row.provenance.type,'authored_synthetic');assert.equal(row.provenance.human_reviewed,false);
      }
    }
  }
  checkHistoricalReference(notebook.metadata.support_copilot);
  const changedFactory=structuredClone(notebook.metadata.support_copilot);changedFactory.factory_source_sha256='0'.repeat(64);
  assert.throws(()=>checkHistoricalReference(changedFactory),/Declared historical factory/);
  const missingReference=structuredClone(notebook.metadata.support_copilot);delete missingReference.frozen_training_reference;
  assert.throws(()=>checkHistoricalReference(missingReference),/Exact historical reference/);
  const changedBase=structuredClone(notebook.metadata.support_copilot);changedBase.base_revision='0'.repeat(40);
  assert.throws(()=>checkHistoricalReference(changedBase),/Exact frozen base/);
  assert.throws(()=>checkHistoricalReference(notebook.metadata.support_copilot,{...embeddedData,train:embeddedData.train+' '}),/Embedded train checksum/);
  const install=cells.find(cell=>cell.source.join('').includes('INSTALL_DEPENDENCIES = False')).source.join('');
  assert.ok(install.indexOf("'--preflight'")<install.indexOf("'pip', 'install'"));
  assert.doesNotMatch(cells.map(cell=>cell.source.join('')).join('\n'),/drive\.mount|files\.upload|push_to_hub=True/);
  const download=cells.find(cell=>cell.source.join('').includes('DOWNLOAD_RESULTS = False')).source.join('');
  assert.match(download,/RUN\.name \+ '-raw-' \+ uuid\.uuid4/); assert.match(download,/exist_ok=False/);
  assert.doesNotMatch(download,/dirs_exist_ok=True|support-plan-pilot-results|export-pilot/);
  const train=cells.find(cell=>cell.source.join('').includes('RUN_TRAINING = False')).source.join('');
  assert.match(train,/MAX_STEPS = 100/);assert.match(train,/MAX_STEPS == 100/);
  assert.match(train,/bf16_allow_emulation/);
});

test('notebook logging captures both streams and exposes failures without claiming training', t => {
  const directory=temporary(t);
  const script="import importlib.util,pathlib,sys\np=pathlib.Path(sys.argv[1])\nspec=importlib.util.spec_from_file_location('tools',p/'training/notebook_tools.py')\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nwork=pathlib.Path(sys.argv[2])\nm.run_logged([sys.executable,'-u','-c',\"import sys;print('STDOUT_PROOF');print('STDERR_PROOF',file=sys.stderr)\"],'success',work)\ntry: m.run_logged([sys.executable,'-c','raise SystemExit(7)'],'failure',work)\nexcept RuntimeError: print('EXPECTED_FAILURE_CAPTURED')\nelse: raise AssertionError('Failure hidden')\nfor name in ['run_plan_lora.py','notebook_tools.py','export_plan_pair.py']: compile((p/'training'/name).read_text(encoding='utf-8'),name,'exec')\n";
  const result=runPython(['-B','-c',script,root,directory]);
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/STDOUT_PROOF/);assert.match(result.stdout,/STDERR_PROOF/);assert.match(result.stdout,/EXPECTED_FAILURE_CAPTURED/);
  assert.match(readFileSync(join(directory,'logs/success.log'),'utf8'),/STDERR_PROOF/);
  assert.equal(existsSync(join(directory,'runs/pilot-20/run-manifest.json')),false);
});

test('Trainer training_args.bin is hash-only and clean PEFT copy excludes pickle sidecars', t => {
  const directory=temporary(t);
  const script="import hashlib,importlib.util,json,pathlib,sys\nroot=pathlib.Path(sys.argv[1]);work=pathlib.Path(sys.argv[2])\nspec=importlib.util.spec_from_file_location('merge',root/'training/merge_adapter.py')\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nrun=work/'mock-run';adapter=run/'adapter';adapter.mkdir(parents=True)\nconfig={'peft_type':'LORA','task_type':'CAUSAL_LM','r':8,'base_model_name_or_path':m.BASE_MODEL,'target_modules':['q_proj','k_proj','v_proj','o_proj']}\n(adapter/'adapter_config.json').write_text(json.dumps(config))\n(adapter/'adapter_model.safetensors').write_bytes(b'MOCK_HASH_FIXTURE_NOT_REAL_WEIGHTS')\n(adapter/'training_args.bin').write_bytes(b'NOT_A_PICKLE_MUST_NEVER_DESERIALIZE')\nmanifest={'status':'completed','actual_training':True,'base_model':m.BASE_MODEL,'base_revision':m.BASE_REVISION,'provenance':'authored_synthetic','cloud_eligible':True,'adapter_files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in adapter.iterdir()}}\nmanifest_path=run/'run-manifest.json';manifest_path.write_text(json.dumps(manifest));original=manifest_path.read_bytes()\nm.inspect_run(run)\n_,clean=m.materialize_clean_adapter(run,work/'clean-adapter')\nassert {p.name for p in clean.iterdir()}=={'adapter_config.json','adapter_model.safetensors'}\nassert manifest_path.read_bytes()==original and (adapter/'training_args.bin').is_file()\n(adapter/'training_args.bin').write_bytes(b'tampered')\ntry: m.inspect_run(run)\nexcept ValueError: pass\nelse: raise AssertionError('Sidecar hash was ignored')\n(adapter/'training_args.bin').write_bytes(b'NOT_A_PICKLE_MUST_NEVER_DESERIALIZE')\n(adapter/'adapter_model.bin').write_bytes(b'UNSUPPORTED_PICKLE_WEIGHTS')\nmanifest['adapter_files']['adapter_model.bin']=hashlib.sha256((adapter/'adapter_model.bin').read_bytes()).hexdigest();manifest_path.write_text(json.dumps(manifest))\ntry: m.inspect_run(run)\nexcept ValueError: pass\nelse: raise AssertionError('Pickle model weights were accepted')\nprint('hash_only_clean_adapter_passed')\n";
  const result=runPython(['-B','-c',script,root,directory]);
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/hash_only_clean_adapter_passed/);
});

test('future pilot dtype requires native BF16 and falls back to FP16 without emulation', () => {
  const script="import importlib.util,pathlib,sys,types\nspec=importlib.util.spec_from_file_location('plan',pathlib.Path(sys.argv[1])/'training/run_plan_lora.py')\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nfor native in [False,True]:\n calls=[]\n def supported(**kwargs):\n  calls.append(kwargs);return native\n fake=types.SimpleNamespace(cuda=types.SimpleNamespace(is_bf16_supported=supported),bfloat16='bf16',float16='fp16')\n dtype,observed=m.choose_compute_dtype(fake)\n assert observed is native and dtype==('bf16' if native else 'fp16')\n assert calls==[{'including_emulation':False}]\nprint('native_dtype_policy_passed')\n";
  const result=runPython(['-B','-c',script,root]);
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/native_dtype_policy_passed/);
});


test('paired export reuses only explicit own tools with matching binary, official clean source and tag proof', t => {
  const directory = temporary(t);
  const script = String.raw`
import importlib.util,json,pathlib,subprocess,sys
root=pathlib.Path(sys.argv[1]);work=pathlib.Path(sys.argv[2]);sys.path.insert(0,str(root/'training'))
spec=importlib.util.spec_from_file_location('export_pair',root/'training/export_plan_pair.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
prior=work/'exports/paired-own-test';repo=prior/'llama.cpp-b11960';repo.mkdir(parents=True)
def git(*args):
 return subprocess.run(['git','-C',str(repo),*args],check=True,capture_output=True,text=True).stdout.strip()
git('init');git('config','core.autocrlf','false')
source=repo/'convert_hf_to_gguf.py';source.write_text('# authored test source, no real conversion\n')
git('add',source.name);git('-c','user.name=TrainingTest','-c','user.email=training-test@example.invalid','commit','-m','authored test proof')
git('tag','b11960');git('remote','add','origin','https://github.com/ggml-org/llama.cpp.git')
quantizer=repo/'build/bin/llama-quantize';quantizer.parent.mkdir(parents=True);quantizer.write_bytes(b'AUTHORED_FAKE_EXECUTABLE_NEVER_RUN')
proof={'status':'paired_gguf_ready_not_quality_verified','llama_tag':'b11960','llama_commit':git('rev-parse','HEAD'),'quantizer_sha256':m.sha(quantizer)}
(prior/'export-progress.json').write_text(json.dumps(proof))
_,_,observed=m.verify_reusable_tools(work,prior);assert observed['quantizer_sha256']==proof['quantizer_sha256']
def rejected(path,phrase):
 try:m.verify_reusable_tools(work,path)
 except ValueError as error:assert phrase in str(error),str(error)
 else:raise AssertionError('Unverified reusable tools accepted')
quantizer.write_bytes(b'TAMPERED');rejected(prior,'SHA-256');quantizer.write_bytes(b'AUTHORED_FAKE_EXECUTABLE_NEVER_RUN')
source.write_text('# modified tracked file\n');rejected(prior,'modified tracked');git('checkout','--',source.name)
git('remote','set-url','origin','https://example.invalid/untrusted.git');rejected(prior,'official');git('remote','set-url','origin','https://github.com/ggml-org/llama.cpp.git')
git('tag','-d','b11960');git('tag','b11960','HEAD');proof['llama_commit']='0'*40;(prior/'export-progress.json').write_text(json.dumps(proof));rejected(prior,'commit/tag')
rejected(work/'outside','explicit own')
print('verified_own_tools_reuse_passed')
`;
  const result = runPython(['-B','-c',script,root,directory]);
  assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/verified_own_tools_reuse_passed/);
});


test('local paired import verifies bounded archive/provenance and rejects malicious ZIPs without activating fake GGUF', t => {
  const directory = temporary(t);
  const script = String.raw`
import copy,hashlib,importlib.util,json,pathlib,stat,struct,sys,zipfile
root=pathlib.Path(sys.argv[1]);work=pathlib.Path(sys.argv[2]);project=work/'isolated-project'
spec=importlib.util.spec_from_file_location('pair_import',root/'training/import_plan_pair.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def raw(value):return json.dumps(value,separators=(',',':')).encode()
def h(value):return hashlib.sha256(value).hexdigest()
run={'status':'completed','actual_training':True,'weights_saved':True,'weights_changed':True,'base_model':m.BASE_MODEL,'base_revision':m.BASE_REVISION,'provenance':'authored_synthetic','cloud_eligible':True,'optimizer_steps':20,'dataset_fingerprint':'a'*64,'initial_adapter_sha256':'1'*64,'adapter_sha256':'2'*64,'trainer_metrics':{'train_loss':0.2},'identity':{'plan_schema_version':'support-plan-v1','base_model':m.BASE_MODEL,'base_revision':m.BASE_REVISION,'dataset_fingerprint':'a'*64,'factory_source_sha256':'b'*64}}
weights={name:b'GGUF'+b'AUTHORED_FAKE_NOT_A_REAL_MODEL_'+name.encode() for name in m.WEIGHTS}
proof={'status':'paired_gguf_ready_not_quality_verified','base_model':m.BASE_MODEL,'base_revision':m.BASE_REVISION,'llama_tag':'b11960','quantization':'Q4_K_M','llama_commit':'c'*40,'quantizer_sha256':'d'*64,'provenance':'authored_synthetic','human_reviewed':False,'published':False,'activated':False,'actual_optimizer_steps':20,'dataset_fingerprint':'a'*64,'factory_source_sha256':'b'*64,'run_manifest_sha256':h(raw(run)),'files':{name:{'sha256':h(body),'bytes':len(body)} for name,body in weights.items()}}
for name in ['baseline-F16.gguf','adapter-F16.gguf']:proof['files'][name]={'sha256':'e'*64,'bytes':100}
contents={**weights,'run-manifest.json':raw(run),'export-progress.json':raw(proof)}
for variant in ['baseline','adapter']:contents[variant+'-holdout.json']=raw({'variant':variant,'denominator':2,'provenance':'authored_synthetic','human_reviewed':False,'rows':[{'id':'own-one','lang':'en'},{'id':'own-two','lang':'ru'}]})
serial=0
def pack(items,link=None):
 global serial
 serial+=1;path=work/('pair-'+str(serial)+'.zip')
 with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_STORED) as z:
  for name,body in items:
   if name==link:
    info=zipfile.ZipInfo(name);info.create_system=3;info.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(info,body)
   else:z.writestr(name,body)
 return path
attempt=0
def invoke(path,destination=None,execute=False,expected=None):
 global attempt
 attempt+=1
 return m.import_pair(path,expected or h(path.read_bytes()),destination or project/('runtime/models/check-'+str(attempt)),execute,project_root=project)
def reject(path,**kwargs):
 try:invoke(path,**kwargs)
 except (ValueError,zipfile.BadZipFile):pass
 else:raise AssertionError('Unsafe import accepted')
archive=pack(list(contents.items()));before=archive.read_bytes();prepared=invoke(archive)
assert prepared['integrity_verified'] and prepared['quality_verified'] is False and prepared['model_loaded'] is False and not project.exists()
assert prepared['derivation']['remote_f16_content_verified_locally'] is False
destination=project/'runtime/models/new-candidate';imported=invoke(archive,destination=destination,execute=True)
assert imported['status']=='imported_integrity_verified_not_quality_verified' and imported['activated'] is False
assert {p.name for p in destination.iterdir()}==m.ALLOWED|{'import-manifest.json'}
assert all((destination/name).read_bytes()==body for name,body in contents.items()) and archive.read_bytes()==before
joint_run=copy.deepcopy(run);joint_run['optimizer_steps']=100;joint_run['identity'].update(dataset_schema_version=3,focus_schema_version='focus-v1',joint_steps=100)
joint_proof=copy.deepcopy(proof);joint_proof['actual_optimizer_steps']=100;joint_proof['run_manifest_sha256']=h(raw(joint_run))
joint_contents={**contents,'run-manifest.json':raw(joint_run),'export-progress.json':raw(joint_proof)}
for variant in ['baseline','adapter']:
 task_metrics={'focus-v1':{'denominator':1,'accuracy':{'value':1,'numerator':1,'denominator':1}},'support-plan-v1':{'denominator':1,'valid_plan':{'value':1,'numerator':1,'denominator':1}}}
 joint_contents[variant+'-holdout.json']=raw({'variant':variant,'denominator':2,'provenance':'authored_synthetic','human_reviewed':False,'tasks':task_metrics,'rows':[{'id':'own-focus','lang':'en','task_type':'focus-v1'},{'id':'own-plan','lang':'ru','task_type':'support-plan-v1'}]})
joint_archive=pack(list(joint_contents.items()));joint_destination=project/'runtime/models/joint-candidate';joint_import=invoke(joint_archive,destination=joint_destination,execute=True)
assert joint_import['actual_optimizer_steps']==100 and joint_import['quality_verified'] is False
assert json.loads((joint_destination/'run-manifest.json').read_text())['identity']['focus_schema_version']=='focus-v1'
assert json.loads((joint_destination/'adapter-holdout.json').read_text())['tasks']==task_metrics
reject(archive,destination=destination);reject(archive,destination=work/'outside');reject(archive,destination=project/'runtime/models/nested/candidate');reject(archive,destination=project/'runtime/models/other',expected='0'*64)
reject(pack(list(contents.items())+[('secret.txt',b'NO_PRIVATE_DATA')]))
reject(pack(list(contents.items())+[('baseline-F16.gguf',b'GGUF')]))
reject(pack(list(contents.items())+[('BASELINE-Q4_K_M.GGUF',weights['baseline-Q4_K_M.gguf'])]))
reject(pack([('../'+name if name=='baseline-Q4_K_M.gguf' else name,body) for name,body in contents.items()]))
reject(pack(list(contents.items()),link='baseline-Q4_K_M.gguf'))
malformed=dict(contents);malformed['export-progress.json']=raw(proof)[:-1]+b',"published":false}';reject(pack(list(malformed.items())))
for key,value in [('factory_source_sha256','f'*64),('run_manifest_sha256','0'*64),('base_revision','different-base'),('actual_optimizer_steps',19)]:
 changed=copy.deepcopy(proof);changed[key]=value;malformed={**contents,'export-progress.json':raw(changed)};reject(pack(list(malformed.items())))
changed=copy.deepcopy(proof);changed['files']['baseline-Q4_K_M.gguf']['sha256']='0'*64;reject(pack(list({**contents,'export-progress.json':raw(changed)}.items())))
changed=copy.deepcopy(run);changed['weights_changed']=False;changedproof=copy.deepcopy(proof);changedproof['run_manifest_sha256']=h(raw(changed));reject(pack(list({**contents,'run-manifest.json':raw(changed),'export-progress.json':raw(changedproof)}.items())))
changed=json.loads(contents['adapter-holdout.json']);changed['rows'][0]['id']='not-paired';reject(pack(list({**contents,'adapter-holdout.json':raw(changed)}.items())))
reject(pack(list({**contents,'adapter-Q4_K_M.gguf':b'PICKLE_NOT_GGUF'}.items())))
old=m.MAX_WEIGHT;m.MAX_WEIGHT=4
try:reject(archive,destination=project/'runtime/models/size-test')
finally:m.MAX_WEIGHT=old
corrupt=pack(list(contents.items()))
with zipfile.ZipFile(corrupt) as z:info=z.getinfo('baseline-Q4_K_M.gguf')
data=bytearray(corrupt.read_bytes());start=info.header_offset;name_len,extra_len=struct.unpack_from('<HH',data,start+26);data[start+30+name_len+extra_len+5]^=1;corrupt.write_bytes(data);reject(corrupt,destination=project/'runtime/models/crc-test')
print('safe_fake_pair_import_passed_quality_not_verified')
`;
  const result = runPython(['-B','-c',script,root,directory]);
  assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/safe_fake_pair_import_passed_quality_not_verified/);
});


test('authored focus task has four independent whole multilingual groups per class and exact shared messages', () => {
  const records=focusAuthorRecords(), split=prepareFocusExamples(records);
  assert.equal(records.length,168); assert.equal(new Set(records.map(row=>row.group_id)).size,28);
  assert.equal(records.filter(row=>row.input.messages.length>1).length,42);
  assert.equal(split.train.length,126); assert.equal(split.holdout.length,42);
  const held=new Set(split.holdout.map(row=>row.group_id));
  assert.ok(split.train.every(row=>!held.has(row.group_id)));
  for(const [name,part] of [['train',split.train],['holdout',split.holdout]])for(const focus of FOCUS_CODES)for(const lang of FOCUS_AUTHOR_LANGUAGES)assert.equal(part.filter(row=>row.target.focus===focus&&row.context.lang===lang).length,name==='train'?3:1);
  for(const row of [...split.train,...split.holdout]){
    const authored=records.find(item=>item.id===row.id);
    assert.deepEqual(row.messages,buildFocusMessages(authored.input));assert.deepEqual(row.schema,buildFocusSchema());
    assert.equal(row.messages[0].content,FOCUS_SYSTEM_PROMPT);assert.equal(validateFocus(row.target).ok,true);
    assert.deepEqual(Object.keys(row.target),['focus']);assert.equal(row.provenance.human_reviewed,false);
  }
  const dirty=structuredClone(records);dirty[0].input.messages.push({role:'admin',text:'PRIVATE_ADMIN_FOCUS'});dirty[0].input.outcome='PRIVATE_FOCUS_OUTCOME';dirty[0].input.category='SECRET_BASELINE_LABEL';
  const prepared=prepareFocusExamples(dirty);assert.doesNotMatch(JSON.stringify(prepared),/PRIVATE_ADMIN_FOCUS|PRIVATE_FOCUS_OUTCOME|SECRET_BASELINE_LABEL/);
  const duplicate=structuredClone(records);duplicate[1].input=structuredClone(duplicate[30].input);assert.throws(()=>prepareFocusExamples(duplicate),/Canonical duplicate/);
  const privateRows=structuredClone(records);privateRows[0].provenance.cloud_eligible=false;assert.throws(()=>prepareFocusExamples(privateRows),/authored synthetic/);
});

test('joint preparation preserves independent task targets, fixed grouped splits and no cross-task canonical copies', () => {
  const split=prepareJointExamples({baseline,planRecords:planRows});
  assert.equal(split.train.length,174);assert.equal(split.holdout.length,54);
  assert.equal(split.manifest.schema_version,3);
  for(const [name,part] of [['train',split.train],['holdout',split.holdout]]){
    assert.equal(part.filter(row=>row.task_type==='focus-v1').length,name==='train'?126:42);
    assert.equal(part.filter(row=>row.task_type==='support-plan-v1').length,name==='train'?48:12);
    for(const lang of FOCUS_AUTHOR_LANGUAGES)assert.equal(part.filter(row=>row.context.lang===lang).length,name==='train'?29:9);
  }
  for(const key of ['id','group_id','duplicate_key']){
    const held=new Set(split.holdout.map(row=>row[key]));assert.ok(split.train.every(row=>!held.has(row[key])));
  }
  for(const row of [...split.train,...split.holdout].filter(row=>row.task_type==='support-plan-v1')){
    const authored=planRows.find(item=>item.id===row.id);
    const context=buildGenerationInput(authored.input,baseline.triage(authored.input),[],{proposedFocus:authored.intent.focus,focusOrigin:'authored_synthetic'});
    assert.deepEqual(row.messages,buildPlanMessages(context));assert.deepEqual(row.schema,buildPlanSchema(context));
    assert.equal(validatePlan(row.target,context).ok,true);
    for(const field of row.target.request_fields)assert.equal(context.field_states[field].state,'absent');
    assert.equal(row.target.needs_human,context.needs_human);assert.equal(row.baseline_needs_human,authored.expected_needs_human);
  }
});

test('joint Python stdlib dry-run validates both contracts and exact task prompts without model access', t => {
  const directory=temporary(t),outputDir=join(directory,'joint-data');const manifest=prepareJointTraining({outputDir,dataDir});
  const dry=runPython([join(root,'training/run_plan_lora.py'),'--data-dir',outputDir,'--output',join(directory,'dry'),'--dry-run']);
  assert.equal(dry.status,0,dry.stderr);const report=JSON.parse(dry.stdout);assert.equal(report.actual_training,false);assert.deepEqual(report.task_counts,{train:{'focus-v1':126,'support-plan-v1':48},holdout:{'focus-v1':42,'support-plan-v1':12}});
  for(const [path,expected]of Object.entries(manifest.sources))assert.equal(hash(readFileSync(join(root,path),'utf8')),expected);
  const rows=['train','holdout'].flatMap(name=>readFileSync(join(outputDir,name+'.jsonl'),'utf8').trim().split('\n').map(JSON.parse));
  const cases=[];for(const row of rows){
    const targets=row.task_type==='focus-v1'?[row.target,{},null,{focus:'invented'}, {...row.target,needs_human:false},{...row.target,reply:'free prose'}]:[row.target,{...row.target,needs_human:!row.target.needs_human},{...row.target,request_fields:['password']},{...row.target,fact_ids:[],request_fields:[]}];
    for(const value of targets)cases.push({row,value,expected:row.task_type==='focus-v1'?validateFocus(value).ok:validatePlan(value,row.context).ok});
  }
  const script="import importlib.util,json,pathlib,sys\nspec=importlib.util.spec_from_file_location('joint',pathlib.Path(sys.argv[1])/'training/run_plan_lora.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nfor case in json.load(sys.stdin):assert m.validate_target(case['value'],case['row']) is case['expected'],case['row']['id']\nprint('joint_task_parity_passed')\n";
  const parity=runPython(['-B','-c',script,root],{input:JSON.stringify(cases)});assert.equal(parity.status,0,parity.stderr);assert.match(parity.stdout,/joint_task_parity_passed/);
  for(const steps of ['20','200']){const rejected=runPython([join(root,'training/run_plan_lora.py'),'--data-dir',outputDir,'--output',join(directory,'no-model'),'--train','--max-steps',steps]);assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/100|steps/);assert.equal(existsSync(join(directory,'no-model')),false);}
  const trainPath=join(outputDir,'train.jsonl'),altered=readFileSync(trainPath,'utf8').trim().split('\n').map(JSON.parse);altered[0].messages[0].content+=' hidden drift';const text=altered.map(row=>JSON.stringify(row)).join('\n')+'\n';writeFileSync(trainPath,text);const saved=JSON.parse(readFileSync(join(outputDir,'manifest.json'),'utf8'));saved.files['train.jsonl']=hash(text);writeFileSync(join(outputDir,'manifest.json'),JSON.stringify(saved));
  const rejected=runPython([join(root,'training/run_plan_lora.py'),'--data-dir',outputDir,'--output',join(directory,'drift'),'--dry-run']);assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/prompt mismatch/);
});

test('joint task metrics keep separate denominators and reject nonfinite loss or a budget overrun', () => {
  const script=String.raw`
import importlib.util,pathlib,sys
spec=importlib.util.spec_from_file_location('joint',pathlib.Path(sys.argv[1])/'training/run_plan_lora.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
focus=m.summarize_task(m.FOCUS_VERSION,[{'expected_focus':'payment','predicted_focus':'payment','valid_focus':True,'focus_correct':True},{'expected_focus':'account','predicted_focus':'payment','valid_focus':True,'focus_correct':False}])
assert focus['denominator']==2 and focus['accuracy']['value']==0.5 and focus['macro_f1']['denominator']==7 and abs(focus['macro_f1']['numerator']-2/3)<1e-9
plan=m.summarize_task(m.PLAN_VERSION,[{'valid_plan':False,'exact_authored_plan':False,'focus_correct':False,'human_gate_correct':False,'request_true_positive':0,'request_predicted':0,'request_expected':2}])
assert plan['denominator']==1 and plan['valid_plan']['value']==0 and plan['request_precision']['value'] is None and plan['request_recall']['value']==0
m.require_finite_losses({'loss':0.1,'train_loss':0.2,'grad_norm':2.0});m.require_budget(100,700)
identity={'dataset':'authored','factory':'frozen','source':'fixed','tasks':['focus-v1','support-plan-v1']}
m.validate_resume(None,identity,False,100);m.validate_resume({'identity':identity,'status':'interrupted','optimizer_steps':10},identity,True,100)
for previous,resume in [(None,True),({'identity':identity,'status':'completed','optimizer_steps':100},True),({'identity':{'source':'different'}},True),({'identity':identity},False)]:
 try:m.validate_resume(previous,identity,resume,100)
 except ValueError:pass
 else:raise AssertionError('Unsafe or already complete resume accepted')
for metrics in [{'loss':float('nan')},{'train_loss':float('inf')},{'grad_norm':float('-inf')}]:
 try:m.require_finite_losses(metrics)
 except RuntimeError:pass
 else:raise AssertionError('Nonfinite loss accepted')
try:m.require_budget(100,700.01)
except RuntimeError:pass
else:raise AssertionError('Budget overrun accepted')
print('separate_task_metrics_and_bounds_passed')
`;
  const result=runPython(['-B','-c',script,root]);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/separate_task_metrics_and_bounds_passed/);
});


test('BF16 retry labels emulation and counts real underlying steps rather than GradScaler-skipped Trainer attempts', () => {
 const script=String.raw`
import importlib.util,pathlib,sys,types
spec=importlib.util.spec_from_file_location('retry',pathlib.Path(sys.argv[1])/'training/run_plan_lora.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
calls=[]
def supported(**kw):calls.append(kw);return kw['including_emulation']
torch=types.SimpleNamespace(cuda=types.SimpleNamespace(is_bf16_supported=supported),bfloat16='bf16',float16='fp16')
dtype,native=m.choose_compute_dtype(torch,'bf16_allow_emulation');assert dtype=='bf16' and native is False and calls==[{'including_emulation':False},{'including_emulation':True}]
torch.cuda.is_bf16_supported=lambda **kw:False
try:m.choose_compute_dtype(torch,'bf16_allow_emulation')
except RuntimeError:pass
else:raise AssertionError('Explicit BF16 silently fell back to failed FP16')
class RawAdamW:
 def __init__(self):self.defaults={'fused':False};self.hooks=[]
 def register_step_post_hook(self,hook):self.hooks.append(hook);return object()
 def step(self):
  for hook in self.hooks:hook(self,(),{})
class Accelerated:
 def __init__(self,raw):self.optimizer=raw
 def step(self,overflow=False):
  if not overflow:self.optimizer.step()
raw=RawAdamW();wrapped=Accelerated(raw);counter=m.SuccessfulOptimizerSteps();assert counter.install(wrapped)=='RawAdamW'
run={'optimizer_steps':0}
for i in range(1,101):wrapped.step();m.record_optimizer_attempt(run,i,counter.updates,False)
assert run['optimizer_steps']==100 and run['optimizer_attempts']==100 and run['actual_training'] is True
raw=RawAdamW();wrapped=Accelerated(raw);counter=m.SuccessfulOptimizerSteps();counter.install(wrapped);run={'optimizer_steps':0};wrapped.step(overflow=True)
try:m.record_optimizer_attempt(run,1,counter.updates,True)
except RuntimeError:pass
else:raise AssertionError('GradScaler skipped update was counted as a successful step')
assert run['optimizer_attempts']==1 and run['optimizer_steps']==0 and run['actual_training'] is False and run['skipped_optimizer_updates']==1
try:m.record_optimizer_attempt({'optimizer_steps':0},1,0,False)
except RuntimeError:pass
else:raise AssertionError('Missing actual optimizer hook accepted')
print('bf16_emulation_actual_step_hook_passed')
`;
 const result=runPython(['-B','-c',script,root]);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/bf16_emulation_actual_step_hook_passed/);
});


test('BF16 UI patch retains strict pins with public bundled data and an explicit synthetic test-only old-pin adapter', t => {
 const directory=temporary(t);
 const script=String.raw`
import ast,copy,hashlib,json,os,pathlib,runpy,sys
root=pathlib.Path(sys.argv[1]);work=pathlib.Path(sys.argv[2]);runner=work/'training/run_plan_lora.py';runner.parent.mkdir(parents=True)
old='2944e533ba085de9cf78e4815735f83d4d98262b045db5f31f4f1412568a662e'
original=b'# Authored synthetic unit-test prepatch bytes, NOT historical runner2944.\n'
synthetic_sha=hashlib.sha256(original).hexdigest();assert synthetic_sha!=old;runner.write_bytes(original)
nb=json.loads((root/'notebooks/support-copilot-plan-qlora.ipynb').read_text(encoding='utf-8'))
bootstrap=ast.parse(''.join(next(c['source'] for c in nb['cells'] if c['cell_type']=='code')))
bundle=json.loads(next(ast.literal_eval(n.value) for n in bootstrap.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='BUNDLE_JSON' for t in n.targets)))
frozen=bundle['data/manifest.json'].encode('utf-8');assert hashlib.sha256(frozen).hexdigest()=='d1599db986a777b7d5438d1ef09ab898c11b14084d07c91c019b36fcf3c1322c'
data=work/'data/manifest.json';data.parent.mkdir();data.write_bytes(frozen)
failed=work/'runs/joint-eba0c985bd60-6bc4d603-5c0ea248-2944e533/run-manifest.json';failed.parent.mkdir(parents=True);failed.write_text(json.dumps({'provenance':'authored_synthetic_unit_fixture_not_actual_run','status':'interrupted','weights_saved':False,'error_message':'Non-finite training metric: grad_norm','optimizer_steps':1,'identity':{'runner_sha256':synthetic_sha}}));proof=failed.read_bytes()
patch=root/'training/colab-bf16-retry-patch.py';production_bytes=patch.read_bytes();production_tree=ast.parse(production_bytes)
def snapshot():return {str(p.relative_to(work)):p.read_bytes() if p.is_file() else None for p in work.rglob('*')}
os.environ['SUPPORT_TRAINING_WORKDIR']=str(work);before=snapshot()
# The actual unchanged production patch MUST reject our synthetic bytes.
try:runpy.run_path(str(patch))
except AssertionError as error:assert 'Unexpected runner' in str(error)
else:raise AssertionError('Production historical SHA guard accepted synthetic bytes')
assert snapshot()==before
# Positive algorithm exercise: change only the three exact old-SHA constants
# in an in-memory test AST. No production guard, payload or source is changed.
class RetargetExactPin(ast.NodeTransformer):
 def __init__(self,source,target):self.source=source;self.target=target;self.count=0
 def visit_Constant(self,node):
  if node.value==self.source:node.value=self.target;self.count+=1
  return node
adapted=copy.deepcopy(production_tree);retarget=RetargetExactPin(old,synthetic_sha);retarget.visit(adapted);assert retarget.count==3
restored=copy.deepcopy(adapted);undo=RetargetExactPin(synthetic_sha,old);undo.visit(restored);assert undo.count==3
assert ast.dump(restored,include_attributes=False)==ast.dump(production_tree,include_attributes=False),'Test adapter altered something other than exact old-SHA literals'
result={};exec(compile(adapted,'synthetic-test-only-old-pin-adapter','exec'),result)
assert runner.read_bytes()==(root/'training/run_plan_lora.py').read_bytes() and failed.read_bytes()==proof and data.read_bytes()==frozen
assert result['RUN']!=failed.parent and not result['RUN'].exists() and result['RESUME'] is False and result['MAX_STEPS']==100 and result['RUN_TRAINING'] is False
assert (work/'source-history'/synthetic_sha/'run_plan_lora.py').read_bytes()==original
after_first=snapshot()
try:exec(compile(adapted,'synthetic-test-only-old-pin-adapter','exec'),{})
except AssertionError:pass
else:raise AssertionError('Patch overwrote already patched runner')
assert snapshot()==after_first and patch.read_bytes()==production_bytes
print('portable_synthetic_adapter_preserved_strict_patch_guards_passed')
`;
 const result=runPython(['-B','-c',script,root,directory]);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/portable_synthetic_adapter_preserved_strict_patch_guards_passed/);
});
