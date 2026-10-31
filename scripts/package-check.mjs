import { readFileSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, dirname, join, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const hostingDemoFiles = new Map([
  ['data/hosting-demo/rules.json','53887e403fe1507c3e13979f12aa93c1a034e93c99ed7228b46da719a0946fb6'],
  ['data/hosting-demo/taxonomy.json','c577c055e5e139f4c5598fcaa9ced11b4187fba7f8f3ea5692758cdc41bbd16d'],
]);
const required = ['package.json','npm-shrinkwrap.json','README.md','Makefile','Dockerfile','.dockerignore','.env.example','start-support.cmd','src/server.mjs','src/storage.mjs','src/core/engine.mjs','src/cli/predict.mjs','src/intelligence/index.mjs','src/intelligence/generator.mjs','src/intelligence/worker.mjs','src/workspace/index.mjs','public/index.html','public/styles.css','public/app.js','public/intelligence.js','data/knowledge.json','data/intents.json','fixtures/demo-tickets.json','fixtures/control.json','fixtures/retrieval-holdout-v2.json','fixtures/training-author-synthetic.jsonl','scripts/evaluate.mjs','scripts/evaluation-metrics.mjs','scripts/evaluate-v2.mjs','scripts/evaluation-v2-metrics.mjs','scripts/check-recovery-v2.mjs','scripts/package-check.mjs','scripts/setup-models.mjs','scripts/setup-generator.mjs','scripts/prepare-training.mjs','training/run_lora.py','training/merge_adapter.py','training/requirements-colab.txt','notebooks/support-copilot-author-synthetic-qlora.ipynb','tests/core.test.mjs','tests/server.test.mjs','tests/evaluation.test.mjs','docs/evaluation.md','docs/evaluation-v2.md','docs/models.md','docs/training.md','tests/runtime-ownership.test.mjs','scripts/check-docker-v2.mjs'];
const authoredFixture = 'fixtures/training-author-synthetic.jsonl';
const authoredFocusBank = 'data/focus-demonstrations-v7.json';
const authoredFocusBankSHA = 'd38c885ce3a458b039fcc4c706917d5e82df07665c982d13abead5d7dd704b08';
const authoredRoutingParts = new Map([
  ['data/routing-training-v8-alpha.json', {author:'alpha',sha256:'342b3f0ce499835d68d3bdf9f0160524cbfb0a93f07d510cad72f57a6460454d',groups_per_class:20,classes:['payment','account','technical']}],
  ['data/routing-training-v8-beta.json', {author:'beta',sha256:'468d3c4f3c21ab112b5a26e0830c0dd846e88d50267c2e63fce69547e9884bca',groups_per_class:20,classes:['appeal','complaint','question','clarification']}],
  ['data/routing-training-v9-role.json', {author:'role-training-v9',sha256:'8b677000b47e825bf39eb0701f6a4a4410ad25dc6b9bd273538c84f362d64a57',groups_per_class:4,classes:['payment','account','appeal','complaint','technical','question','clarification']}],
]);
const authoredFixtures = new Set([authoredFixture, 'fixtures/training-plan-author-synthetic.jsonl']);
const authoredPlanControl = 'fixtures/generation-plan-holdout.json';
const planControls = new Map([
  [authoredPlanControl, 'authored_synthetic_independent_plan_control'],
  ['fixtures/generation-plan-control-v3.json', 'authored_synthetic_independent_fresh_plan_control'],
  ['fixtures/generation-plan-control-v4.json', 'authored_synthetic_independent_fresh_plan_control'],
  ['fixtures/generation-plan-control-v5.json', 'authored_synthetic_independent_fresh_plan_control'],
  ['fixtures/generation-plan-control-v6.json', 'authored_synthetic_independent_fresh_plan_control'],
  ['fixtures/generation-plan-control-v7.json', 'authored_synthetic independent-plan-v7'],
  ['fixtures/generation-plan-control-v8.json', 'authored_synthetic independent-plan-v8'],
  ['fixtures/generation-plan-control-v9.json', 'authored_synthetic independent-plan-v9'],
  ['fixtures/generation-plan-control-v10.json', 'authored_synthetic independent-plan-v10'],
  ['fixtures/generation-plan-control-v11.json', 'authored_synthetic independent-plan-v11'],
  ['fixtures/generation-plan-control-v12.json', 'authored_synthetic independent-plan-v12'],
]);
const publicNotebooks = new Set(['notebooks/support-copilot-author-synthetic-qlora.ipynb', 'notebooks/support-copilot-plan-qlora.ipynb', 'notebooks/gpu-preflight.ipynb']);
required.push('src/intelligence/generation-contract.mjs', 'fixtures/training-plan-author-synthetic.jsonl', authoredPlanControl, 'training/run_plan_lora.py', 'notebooks/support-copilot-plan-qlora.ipynb', 'start-local-ai.cmd', authoredFocusBank);
required.push(...authoredRoutingParts.keys());

export function checkAuthoredRoutingPart(path,content) {
  const expected=authoredRoutingParts.get(path),errors=[];
  if(!expected)return [{path,code:'outside_authored_routing_parts'}];
  if(createHash('sha256').update(content).digest('hex')!==expected.sha256)errors.push({path,code:'authored_routing_integrity'});
  try {
    const data=JSON.parse(content.toString('utf8')),rows=data.scenarios,languages=['ru','en','kk','uz','es','pt'];
    if(data.schema_version!=='authored-routing-TRAIN-v8-part'||data.author!==expected.author||data.provenance?.type!=='authored_synthetic'||data.provenance.human_reviewed!==false||data.provenance.contains_private_data!==false)errors.push({path,code:'non_authored_routing_data'});
    if(!Array.isArray(rows)||rows.length!==expected.classes.length*expected.groups_per_class||new Set(rows.map(row=>row.group_id)).size!==rows.length||expected.classes.some(focus=>rows.filter(row=>row.focus===focus).length!==expected.groups_per_class)||rows.some(row=>!expected.classes.includes(row.focus)||typeof row.group_id!=='string'||!row.group_id||!row.texts||Object.keys(row.texts).length!==6||languages.some(lang=>typeof row.texts[lang]!=='string'||!row.texts[lang].trim())))errors.push({path,code:'invalid_authored_routing_coverage'});
  }catch{errors.push({path,code:'invalid_authored_routing_json'});}
  return errors;
}

export function checkPackagePaths(paths) {
  const errors = [];
  const seen = new Set();
  for (const raw of paths) {
    const path = String(raw).replaceAll('\\','/');
    const lower = path.toLowerCase();
    if (path !== posix.normalize(path) || path.startsWith('/') || /^[a-z]:/iu.test(path) || path.split('/').includes('..')) { errors.push({path,code:'unsafe_path'}); continue; }
    if (seen.has(path)) errors.push({path,code:'duplicate_path'});
    seen.add(path);
    if (/(?:^|\/)(?:runtime|artifacts|private|handout|node_modules|\.git|\.tmp)(?:\/|$)/u.test(lower) || /\.(?:tgz|gz|docx|log|tmp|pem|key)$/u.test(lower) || /\.jsonl$/u.test(lower) && !authoredFixtures.has(path) || /(?:^|\/)\.env(?:\.|$)/u.test(lower) && path !== '.env.example') { errors.push({path,code:'private_or_runtime_path'}); continue; }
    const allowed = ['package.json','npm-shrinkwrap.json','README.md','Makefile','Dockerfile','render.yaml','.dockerignore','.env.example','start-support.cmd','data/knowledge.json','data/intents.json','fixtures/demo-tickets.json','fixtures/control.json','fixtures/retrieval-holdout-v2.json',authoredFixture,'src/workspace/README.md','training/requirements-colab.txt','notebooks/support-copilot-author-synthetic-qlora.ipynb'].includes(path) || hostingDemoFiles.has(path)
      || path === authoredFocusBank || authoredRoutingParts.has(path) || authoredFixtures.has(path) || planControls.has(path) || publicNotebooks.has(path) || path === 'training/requirements-bootstrap.txt' || path === 'start-local-ai.cmd'
      || /^src\/[a-zA-Z0-9_./-]+\.mjs$/u.test(path)
      || /^public\/[a-zA-Z0-9_./-]+\.(?:html|css|js|svg|ico|png)$/u.test(path)
      || /^scripts\/[a-zA-Z0-9_./-]+\.mjs$/u.test(path)
      || /^tests\/[a-zA-Z0-9_.-]+\.test\.mjs$/u.test(path)
      || path === 'tests/routed-fixtures.mjs'
      || /^docs\/[a-zA-Z0-9_./-]+\.md$/u.test(path)
      || /^training\/[a-zA-Z0-9_./-]+\.(?:mjs|py)$/u.test(path);
    if (!allowed) errors.push({path,code:'outside_public_allowlist'});
  }
  for (const path of required) if (!seen.has(path)) errors.push({path,code:'required_file_missing'});
  for (const path of ['render.yaml','scripts/start-hosted.mjs','src/http-access.mjs','docs/hosting.md',...hostingDemoFiles.keys()]) if (!seen.has(path)) errors.push({path,code:'required_hosting_file_missing'});
  return errors;
}

function npmCli() {
  const candidates = [process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate) && /npm-cli\.js$/iu.test(candidate)) return realpathSync(candidate);
  throw new Error('npm CLI could not be located beside Node or in npm_execpath');
}

export function verifyPackage() {
  const manifest = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('package.files must be an explicit public allowlist');
  const output = execFileSync(process.execPath,[npmCli(),'pack','--dry-run','--json','--ignore-scripts'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
  const packs = JSON.parse(output);
  if (!Array.isArray(packs) || packs.length !== 1 || !Array.isArray(packs[0].files)) throw new Error('Unexpected npm pack metadata');
  const pack = packs[0];
  const paths = pack.files.map(file => file.path);
  const errors = checkPackagePaths(paths);
  const secrets = /(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/u;
  const accepted = [];
  for (const path of paths) {
    // Read only paths already accepted as ordinary source files.
    if (errors.some(error => error.path === path)) continue;
    const sourcePath = join(root, path);
    if (lstatSync(sourcePath).isSymbolicLink()) { errors.push({path,code:'symlink_not_allowed'}); continue; }
    const actualPath = realpathSync(sourcePath);
    if (!actualPath.startsWith(realpathSync(root) + sep)) { errors.push({path,code:'symlink_outside_root'}); continue; }
    const content = readFileSync(actualPath);
    accepted.push({path,content});
    // This exact bank was independently derived from the published authored TRAIN split.
    if (path === authoredFocusBank && createHash('sha256').update(content).digest('hex') !== authoredFocusBankSHA) errors.push({path,code:'authored_focus_bank_integrity'});
    if (authoredRoutingParts.has(path)) errors.push(...checkAuthoredRoutingPart(path,content));
    if (secrets.test(content.toString('utf8'))) errors.push({path,code:'possible_embedded_secret'});
    if (hostingDemoFiles.has(path)) {
      try {
        const data = JSON.parse(content.toString('utf8'));
        if (createHash('sha256').update(content).digest('hex') !== hostingDemoFiles.get(path) || data.provenance?.type !== 'authored_synthetic' || data.provenance.human_reviewed !== false || data.provenance.contains_private_data !== false) errors.push({path,code:'invalid_authored_hosting_demo'});
      } catch { errors.push({path,code:'invalid_authored_hosting_demo'}); }
    }
    if (authoredFixtures.has(path)) {
      try {
        const rows = content.toString('utf8').trim().split(/\r?\n/u).map(line => JSON.parse(line));
        if (!rows.length || rows.some(row => row.provenance?.type !== 'authored_synthetic' || row.provenance?.contains_private_data !== false || row.provenance?.human_reviewed !== false)) errors.push({path,code:'non_authored_training_data'});
      } catch { errors.push({path,code:'invalid_authored_training_fixture'}); }
    }
    if (planControls.has(path)) {
      try {
        if (path === 'fixtures/generation-plan-control-v7.json' && createHash('sha256').update(content).digest('hex') !== '760123129f5e3bf0c4b6bf78892a152c7f67e22823755c167853f4578f444fd8') errors.push({path,code:'authored_plan_v7_integrity'});
        if (path === 'fixtures/generation-plan-control-v8.json' && createHash('sha256').update(content).digest('hex') !== '69b47349d9316efb9d28c940a4dcb5d232dc3c68a039d0d86fc9d86c8421de57') errors.push({path,code:'authored_plan_v8_integrity'});
        if (path === 'fixtures/generation-plan-control-v9.json' && createHash('sha256').update(content).digest('hex') !== '2fa5aa51a665c8ee589edfe908fb4b7332084332e8fed5871669ecab1f8a35a4') errors.push({path,code:'authored_plan_v9_integrity'});
        if (path === 'fixtures/generation-plan-control-v10.json' && createHash('sha256').update(content).digest('hex') !== '479beb34f780c94e9f96987f99a8ba59f1ecd45267170bf24c78be954b66927f') errors.push({path,code:'authored_plan_v10_integrity'});
        if (path === 'fixtures/generation-plan-control-v11.json' && createHash('sha256').update(content).digest('hex') !== '145bf1b803f32d32a3e63fe7722b238b213a986de4603748cdf8142d9f626a95') errors.push({path,code:'authored_plan_v11_integrity'});
        if (path === 'fixtures/generation-plan-control-v12.json' && createHash('sha256').update(content).digest('hex') !== '58002f3592019b0c7f87834ff4571f6c2a9be10b62c84cb195ecc4bb7fbf7b05') errors.push({path,code:'authored_plan_v12_integrity'});
        const control = JSON.parse(content.toString('utf8'));
        if (control.provenance !== planControls.get(path) || control.human_reviewed !== false || control.contract_version !== 'support-plan-v1' || control.cases?.length !== 24) errors.push({path,code:'invalid_authored_plan_control'});
      } catch { errors.push({path,code:'invalid_authored_plan_control'}); }
    }
    if (path.endsWith('.ipynb')) {
      try {
        const notebook = JSON.parse(content.toString('utf8'));
        if (!Array.isArray(notebook.cells) || notebook.cells.some(cell => cell.execution_count != null || cell.outputs?.length)) errors.push({path,code:'executed_notebook_outputs'});
      } catch { errors.push({path,code:'invalid_notebook'}); }
    }
  }
  const sourceDigest = createHash('sha256');
  for (const {path,content} of accepted.sort((a,b)=>a.path.localeCompare(b.path))) { sourceDigest.update(path); sourceDigest.update('\0'); sourceDigest.update(content); sourceDigest.update('\0'); }
  const summary = {status:errors.length ? 'FAIL' : 'PASS',dry_run:true,published:false,filename:pack.filename,file_count:pack.entryCount ?? paths.length,unpacked_bytes:pack.unpackedSize,content_sha256:sourceDigest.digest('hex'),required_file_count:required.length,explicit_package_files:manifest.files,private_data_included:errors.some(error=>error.code==='private_or_runtime_path'),errors,files:paths};
  // The paths are source-only metadata. No file content, secret or private record is logged.
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = verifyPackage(); console.log(JSON.stringify(result,null,2)); if (result.errors.length) process.exitCode = 1; }
  catch (error) { console.error(JSON.stringify({status:'FAIL',error:'Unable to inspect package dry-run',type:error.name,code:error.code || null})); process.exitCode = 1; }
}
