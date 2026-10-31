import { mkdir, rename, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { freemem } from 'node:os';
import { GENERATOR_MODEL } from './setup-generator.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = resolve(root, 'runtime/models/qwen3-0.6b');
const input = resolve(dir, 'Qwen3-0.6B-Q8_0.gguf');
const output = resolve(dir, 'Qwen3-0.6B-Q4_K_M.gguf');
const executable = resolve(root, 'runtime/tools/llama-b11960-cpu/llama-quantize.exe');
const reserve = 256 * 1024 * 1024;
async function digest(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
export function verifyQuantizationSource({ bytes, sha256 }) {
  if (bytes !== GENERATOR_MODEL.bytes || sha256 !== GENERATOR_MODEL.sha256) throw new Error('Quantization source does not match the pinned official Qwen Q8 size/SHA-256');
  return true;
}
export async function quantizeGenerator({ dryRun = false } = {}) {
  await mkdir(dir, { recursive: true });
  const sourceBytes = (await stat(input)).size;
  const sourceHash = await digest(input);
  verifyQuantizationSource({ bytes: sourceBytes, sha256: sourceHash });
  const report = { started_at: new Date().toISOString(), action: dryRun ? 'quantizer_dry_run_not_inference' : 'local_requantization_not_training', input, output, runtime: 'llama.cpp b11960', quantization: 'Q4_K_M', input_quantization: 'Q8_0', allow_requantize: true, quality_warning: 'Requantization may lose more quality than quantizing original BF16/F16. Preserve original Q8; evaluate the derived candidate independently.', max_buffer_mib: 32, threads: 2, reserve_bytes: reserve, free_before: freemem(), minimum_free_bytes: freemem(), exit_code: null };
  report.input_verified = { bytes: sourceBytes, sha256: sourceHash, expected_revision: GENERATOR_MODEL.revision, checked_before_spawn: true };
  if (report.free_before < reserve + 96 * 1024 * 1024) throw new Error('Not enough free memory for bounded quantization buffers plus reserve');
  // This quantizer's Windows argv mishandles Cyrillic model paths. Passing ASCII
  // filenames relative to a Unicode-aware process cwd avoids global codepage changes.
  const args = [...(dryRun ? ['--dry-run'] : []), '--allow-requantize', '--max-buffer-size', '32', basename(input), `${basename(output)}.partial`, 'Q4_K_M', '2'];
  const log = [];
  let abortReason = null;
  const child = spawn(executable, args, { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  report.pid = child.pid;
  let sampling = null;
  const sample = () => {
    if (sampling || !child.pid) return;
    sampling = new Promise(accept => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process -Id ([int]$env:SUPPORT_QUANTIZER_PID) -ErrorAction Stop | Select-Object WorkingSet64,PeakWorkingSet64,CPU | ConvertTo-Json -Compress'], { windowsHide: true, env: { ...process.env, SUPPORT_QUANTIZER_PID: String(child.pid) } }, (error, stdout) => {
      if (!error) try { const value = JSON.parse(stdout); report.peak_sampled_rss_bytes = Math.max(report.peak_sampled_rss_bytes || 0, value.WorkingSet64); report.peak_working_set_bytes = Math.max(report.peak_working_set_bytes || 0, value.PeakWorkingSet64); report.sampled_cpu_seconds = Math.max(report.sampled_cpu_seconds || 0, value.CPU || 0); } catch {}
      accept();
    })).finally(() => { sampling = null; });
  };
  const sampleTimer = setInterval(sample, 400);
  const exitHook = () => child.kill(); process.once('exit', exitHook);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { if (log.join('').length < 1024 * 1024) log.push(chunk.toString()); });
  const timer = setTimeout(() => { abortReason = 'quantization_timeout_120000ms'; child.kill(); }, 120000);
  const memory = setInterval(() => { report.minimum_free_bytes = Math.min(report.minimum_free_bytes, freemem()); if (report.minimum_free_bytes < reserve) { abortReason = 'free_memory_below_reserve'; child.kill(); } }, 100);
  try {
    report.exit_code = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
    report.elapsed_ms = Date.now() - Date.parse(report.started_at);
    report.abort_reason = abortReason;
    report.log = log.join('');
    report.free_after = freemem();
    if (report.exit_code === 0 && !abortReason && !dryRun) {
      const input_sha256 = await digest(input);
      verifyQuantizationSource({ bytes: (await stat(input)).size, sha256: input_sha256 });
      if (input_sha256 !== sourceHash) throw new Error('Q8 source changed during quantization; output was not activated');
      report.input_unchanged = true;
      const sha256 = await digest(`${output}.partial`);
      const bytes = (await stat(`${output}.partial`)).size;
      await rename(`${output}.partial`, output);
      report.model = { id: 'Qwen/Qwen3-0.6B:Q4_K_M-local-requant', filename: 'Qwen3-0.6B-Q4_K_M.gguf', quantization: 'Q4_K_M', bytes, sha256, source: { repo: 'Qwen/Qwen3-0.6B-GGUF', revision: '23749fefcc72300e3a2ad315e1317431b06b590a', quantization: 'Q8_0', sha256: input_sha256 }, license: 'Apache-2.0', derivation: 'project-local llama.cpp b11960 Q8_0 to Q4_K_M requantization; not fine-tuned', complete: true };
      await writeFile(`${output}.manifest.json`, JSON.stringify(report.model, null, 2));
    }
    report.success = report.exit_code === 0 && !abortReason;
    await writeFile(resolve(dir, dryRun ? 'quantization-dry-run.json' : 'quantization-report.json'), JSON.stringify(report, null, 2));
    await writeFile(resolve(dir, `quantization-${dryRun ? 'dry-run' : 'report'}-${report.started_at.replace(/[^0-9TZ]/gu, '')}.json`), JSON.stringify(report, null, 2));
    return report;
  } finally { clearTimeout(timer); clearInterval(memory); clearInterval(sampleTimer); if (sampling) await sampling; process.removeListener('exit', exitHook); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const report = await quantizeGenerator({ dryRun: process.argv.includes('--dry-run') }); const { log, ...summary } = report; console.log(JSON.stringify(summary)); if (!report.success) process.exitCode = 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
