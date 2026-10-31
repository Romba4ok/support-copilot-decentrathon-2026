import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRetriever, tokens } from '../core/retrieval.mjs';

const model = 'Xenova/multilingual-e5-small';
const parentPort = { postMessage: message => process.send?.(message) };
let modelDir, cacheDir, sources, intents, prototypes, documents, fingerprint, cacheFile, retrieve;
function configure(config) {
  ({ modelDir, cacheDir, sources, intents } = config);
  prototypes = intents.categories.flatMap(item => Object.entries(item.examples).map(([lang, text]) => ({ category: item.category, lang, text })));
  documents = [...sources.map(source => `passage: ${source.section}. ${source.label}. ${source.text}`), ...prototypes.map(item => `query: ${item.text}`)];
  let modelManifest = null;
  try { modelManifest = JSON.parse(readFileSync(join(modelDir, 'manifest.json'), 'utf8')); } catch {}
  fingerprint = createHash('sha256').update(JSON.stringify({ documents, model, modelManifest, dtype: 'q8', pooling: 'mean', normalize: true, max_length: 256 })).digest('hex');
  cacheFile = join(cacheDir, 'e5-small-v2-index.json');
  retrieve = createRetriever(sources);
}
let extractor, vectors = [];
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const valid = vector => Array.isArray(vector) && vector.length === 384 && vector.every(Number.isFinite) && Math.abs(dot(vector, vector) - 1) < 0.02;
async function embed(text) {
  const tensor = await extractor(text.slice(0, 12000), { pooling: 'mean', normalize: true, truncation: true, max_length: 256 });
  const vector = Array.from(tensor.data);
  if (!valid(vector)) throw new Error('Embedding must contain 384 normalized finite dimensions');
  return vector;
}
async function initialize(id, config) {
  configure(config);
  const start = performance.now();
  await mkdir(cacheDir, { recursive: true });
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useFSCache = false;
  parentPort.postMessage({ id, progress: { phase: 'loading_model', indexed: 0, total: documents.length } });
  extractor = await pipeline('feature-extraction', modelDir, {
    local_files_only: true, dtype: 'q8', device: 'cpu',
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1, executionMode: 'sequential', enableCpuMemArena: false },
  });
  try {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    if (cached.fingerprint === fingerprint && cached.vectors.every(valid) && cached.vectors.length <= documents.length) vectors = cached.vectors;
  } catch { /* Missing/invalid cache is safely rebuilt from canonical source text. */ }
  for (let index = vectors.length; index < documents.length; index++) {
    vectors.push(await embed(documents[index]));
    if (vectors.length % 4 === 0 || vectors.length === documents.length) {
      const temp = `${cacheFile}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify({ version: 2, model, fingerprint, dimensions: 384, total: documents.length, vectors, complete: vectors.length === documents.length, updated_at: new Date().toISOString() }));
      await rename(temp, cacheFile);
      parentPort.postMessage({ id, progress: { phase: 'indexing', indexed: vectors.length, total: documents.length, progress: vectors.length / documents.length } });
    }
  }
  return { indexed: sources.length, prototype_count: prototypes.length, index_fingerprint: fingerprint, initialize_ms: Math.round(performance.now() - start), worker_memory: process.memoryUsage(), runtime: 'isolated-node-process', phase: 'ready', total: documents.length, progress: 1 };
}
async function search(query, limit) {
  if (!extractor || vectors.length !== documents.length) throw new Error('Embedding index is not ready');
  const vector = await embed(`query: ${query}`);
  const lexical = retrieve(query, { limit: sources.length });
  const bm25 = new Map(lexical.map(item => [item.id, item.score]));
  const maxBm25 = Math.max(1, ...bm25.values());
  const queryTerms = [...new Set(tokens(query))];
  const candidates = sources.map((source, index) => {
    const semantic_score = Math.max(-1, Math.min(1, dot(vector, vectors[index])));
    const lexical_score = bm25.get(source.id) || 0;
    const terms = new Set(tokens(`${source.section} ${source.text}`));
    const lexical_coverage = queryTerms.filter(term => terms.has(term)).length / Math.max(1, queryTerms.length);
    // A single incidental English word in Russian rules must not dominate E5.
    return { ...source, score: 0.85 * semantic_score + 0.15 * lexical_score / maxBm25 * lexical_coverage, semantic_score, lexical_score, lexical_coverage };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  const bestByCategory = new Map();
  prototypes.forEach((prototype, index) => {
    const score = Math.max(-1, Math.min(1, dot(vector, vectors[sources.length + index])));
    if (score > (bestByCategory.get(prototype.category)?.score || -1)) bestByCategory.set(prototype.category, { category: prototype.category, score, prototype_lang: prototype.lang });
  });
  return { mode: 'semantic-hybrid', model, candidates, intents: [...bestByCategory.values()].sort((a, b) => b.score - a.score) };
}
process.on('message', async ({ id, type, query, limit, config }) => {
  try {
    const result = type === 'initialize' ? await initialize(id, config) : await search(query, limit);
    parentPort.postMessage({ id, result });
  } catch (error) { parentPort.postMessage({ id, error: String(error?.message || error) }); }
});
process.on('disconnect', () => process.exit(0));
