import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { percentile, classificationMetrics, groundingCheck, summarizePredictions } from '../scripts/evaluation-metrics.mjs';
import { checkPackagePaths } from '../scripts/package-check.mjs';

const source = {id:'30:2.1',section_id:30,section:'Synthetic rules',ref:'2.1',text:'Synthetic prohibition for an integrity test.',label:'ОП 2.1'};
const sourceMap = new Map([[source.id,source]]);
const categories = new Set(['complaint.insult','report.payment']);
function prediction() { return {lang:'ru',category:'complaint.insult',priority:'p2',is_spam_or_duplicate:false,extracted:{nickname:null,rule_refs:[],has_evidence:false,server:null},draft_reply:{lang:'ru',text:'Проверьте ОП 2.1.',cited:['ОП 2.1']},needs_human:true,confidence:0.5,reasons:['Synthetic test'],citations:[{...source}]}; }

test('nearest-rank latency handles empty samples, exact p95 and preserves input order',() => {
  assert.equal(percentile([],0.95),null);
  const samples = Array.from({length:100},(_,index)=>100-index);
  assert.equal(percentile(samples,0.95),95);
  assert.equal(percentile(samples,0.5),50);
  assert.equal(samples[0],100);
});

test('classification denominator excludes unlabelled rows, macro F1 includes unexpected predicted classes',() => {
  const rows = [{expected:{priority:'p0'},actual:{priority:'p0'}},{expected:{priority:'p1'},actual:{priority:'p2'}},{expected:{},actual:{priority:'p0'}}];
  const result = classificationMetrics(rows,'priority');
  assert.equal(result.labelled_count,2);
  assert.equal(result.accuracy,0.5);
  assert.equal(result.macro_f1,1/3);
  assert.deepEqual(result.classes.map(row=>row.label),['p0','p1','p2']);
  assert.equal(classificationMetrics(rows,'category').accuracy,null);
});

test('grounding rejects mismatched text, namespace and unsupported labels independently',() => {
  assert.deepEqual(groundingCheck(prediction(),sourceMap),{total:1,valid:1,errors:[]});
  const wrongText = prediction(); wrongText.citations[0].text = 'Invented text';
  assert.ok(groundingCheck(wrongText,sourceMap).errors.some(error=>error.code==='source_text_mismatch'));
  const wrongSection = prediction(); wrongSection.citations[0].section_id = 31;
  assert.ok(groundingCheck(wrongSection,sourceMap).errors.some(error=>error.code==='namespace_mismatch'));
  const wrongLabel = prediction(); wrongLabel.draft_reply.cited.push('ОП 99.99');
  assert.ok(groundingCheck(wrongLabel,sourceMap).errors.some(error=>error.code==='unbacked_cited_label'));
});

test('summary uses ticket denominator for coverage and citation denominator for integrity',() => {
  const first = prediction(); const second = prediction(); second.citations=[]; second.draft_reply.cited=[]; second.needs_human=false;
  const result = summarizePredictions([first,second],sourceMap,categories);
  assert.equal(result.count,2); assert.equal(result.citation_coverage,0.5); assert.equal(result.citation_total,1); assert.equal(result.citation_integrity_rate,1); assert.equal(result.escalation_rate,0.5);
  assert.equal(summarizePredictions([],sourceMap,categories).citation_integrity_rate,null);
});

test('mandatory human failures and invalid result types are counted instead of swallowed',() => {
  const unsafe = prediction(); unsafe.category='report.payment'; unsafe.needs_human=false;
  const malformed = prediction(); malformed.extracted.nickname={};
  const summary = summarizePredictions([unsafe,malformed],sourceMap,categories,['report.payment']);
  assert.equal(summary.mandatory_human_violations,1); assert.equal(summary.schema_failures,1);
});

test('package safety blocks private paths, env secrets, nested fixture dumps and path traversal',() => {
  const paths = ['runtime/state.json','artifacts/private/result.json','../handout/rules.json','.env.production','fixtures/real-sample.json','tests/.tmp/private.json','public/index.html'];
  const errors = checkPackagePaths(paths);
  for (const path of paths.slice(0,-1)) assert.ok(errors.some(error=>error.path===path && error.code!=='required_file_missing'),path);
  assert.ok(!errors.some(error=>error.path==='public/index.html'));
});

test('author-labelled fixture retains all fourteen categories and six languages without relying on unlabelled rows',() => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/control.json',import.meta.url),'utf8'));
  assert.ok(fixture.cases.length >= 24);
  const categoryLabels = new Set(fixture.cases.map(entry=>entry.expected.category).filter(Boolean));
  const languageLabels = new Set(fixture.cases.map(entry=>entry.expected.lang).filter(Boolean));
  assert.equal(categoryLabels.size,14);
  assert.deepEqual([...languageLabels].sort(),['en','es','kk','pt','ru','uz']);
  assert.equal(new Set(fixture.cases.map(entry=>entry.id)).size,fixture.cases.length);
});
