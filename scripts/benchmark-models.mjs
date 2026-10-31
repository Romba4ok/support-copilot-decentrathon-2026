import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freemem, totalmem } from 'node:os';
import { createEngine } from '../src/core/engine.mjs';
import { createIntelligence } from '../src/intelligence/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || resolve(root, '../handout'));
const engine = createEngine({ dataDir });
const intelligence = createIntelligence({ baseline: engine, dataDir });
const cases = [
  { lang: 'ru', query: 'Меня унижали и бранили в общем чате', expected: ['30:2.1', 'kb:evidence'] },
  { lang: 'en', query: 'Another player keeps swearing at me and insulting my family', expected: ['30:2.1', '30:2.2', 'kb:evidence'] },
  { lang: 'kk', query: 'Басқа ойыншы мені чатта балағаттап отбасымды қорлады', expected: ['30:2.1', '30:2.2', 'kb:evidence'] },
  { lang: 'uz', query: "Boshqa o'yinchi chatda meni va oilamni haqorat qildi", expected: ['30:2.1', '30:2.2', 'kb:evidence'] },
  { lang: 'es', query: 'Un jugador me insulta a mí y a mi familia en el chat', expected: ['30:2.1', '30:2.2', 'kb:evidence'] },
  { lang: 'pt', query: 'Um jogador ofendeu minha família no chat', expected: ['30:2.1', '30:2.2', 'kb:evidence'] },
  { lang: 'en', query: 'A stranger entered my account and changed my password', expected: ['30:1.4', 'kb:account'] },
  { lang: 'en', query: 'My credit card was charged but the virtual currency did not arrive', expected: ['kb:payment'] },
];
const report = { created_at: new Date().toISOString(), kind: 'authored_synthetic_retrieval_smoke_not_gold', memory_before: { free: freemem(), total: totalmem(), process: process.memoryUsage() }, cases: [] };
try {
  report.status = await intelligence.initialize({ onProgress: status => console.log(JSON.stringify({ phase: status.phase, indexed: status.indexed, total: status.total })) });
  if (report.status.state !== 'ready') throw new Error(`Model unavailable: ${report.status.reason}`);
  for (const item of cases) {
    const start = performance.now();
    const result = await intelligence.search(item.query, { limit: 8 });
    const elapsed_ms = Math.round(performance.now() - start);
    const matching = result.candidates.filter(source => item.expected.includes(source.id));
    const entry = { ...item, elapsed_ms, mode: result.mode, hit_at_8: matching.length > 0, candidates: result.candidates.map(({ id, score, semantic_score, lexical_score }) => ({ id, score, semantic_score, lexical_score })) };
    report.cases.push(entry); console.log(JSON.stringify(entry));
  }
  report.memory_after = { free: freemem(), process: process.memoryUsage() };
  report.hits = report.cases.filter(item => item.hit_at_8).length;
  report.total = report.cases.length;
  console.log(JSON.stringify({ state: report.status.state, hits: report.hits, total: report.total }));
} catch (error) { report.error = error.message; process.exitCode = 1; console.error(error.message); }
finally {
  await intelligence.close();
  await mkdir(resolve(root, 'runtime/indexes'), { recursive: true });
  await writeFile(resolve(root, 'runtime/indexes/embedding-benchmark.json'), JSON.stringify(report, null, 2));
}
