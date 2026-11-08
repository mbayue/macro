/**
 * Manual harness (task 4.12): run ONE hand-written Stage against the Demo_Target
 * through the real Sandbox_Runner and Egress_Proxy, then print the raw k6 summary.
 *
 * Run on the `macro` VM (needs the Docker daemon, the `macro-proxy:latest` image and
 * gVisor). DATA_DIR must be the same path inside and outside this process:
 *
 *   docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
 *     -v /var/lib/macro:/var/lib/macro -v /opt/macro-dev:/app -w /app \
 *     oven/bun:1.4 bun scripts/run-stage.ts
 *
 * Optional environment: HARNESS_VUS (default 5), HARNESS_DURATION_SEC (default 30),
 * SANDBOX_RUNTIME (default runsc), DATA_DIR (default /var/lib/macro).
 * Secrets are dummies: this harness never calls the inference API or Turnstile.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseConfig } from '../src/config.ts';
import { generateStageScript } from '../src/k6/script.ts';
import { ORDER_PRODUCT_ID, PRODUCT_IDS } from '../src/plan/catalog.ts';
import { DockerClient } from '../src/sandbox/docker.ts';
import { DockerStageExecutor, SandboxRunner } from '../src/sandbox/runner.ts';
import type { ContainmentEvent } from '../src/sandbox/runner.ts';
import type { TestPlan } from '../src/types.ts';

const RAW_SUMMARY_PRINT_LINES = 200;

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}

const parsed = parseConfig({
  VULTR_INFERENCE_API_KEY: 'dummy',
  TURNSTILE_SECRET_KEY: 'dummy',
  TURNSTILE_SITE_KEY: 'dummy',
  ...(process.env['SANDBOX_RUNTIME'] !== undefined ? { SANDBOX_RUNTIME: process.env['SANDBOX_RUNTIME'] } : {}),
  ...(process.env['DATA_DIR'] !== undefined ? { DATA_DIR: process.env['DATA_DIR'] } : {}),
});
if (!parsed.ok) {
  for (const e of parsed.errors) console.error(`config error: ${e.setting} ${e.reason}`);
  process.exit(1);
}
const config = parsed.config;

const vus = intFromEnv('HARNESS_VUS', 5);
const durationSec = intFromEnv('HARNESS_DURATION_SEC', 30);
const journey: TestPlan['journey'] = [
  { route: 'store_home', probability: 100, thinkMs: 0 },
  { route: 'catalog_list', probability: 100, thinkMs: 0 },
  { route: 'product_detail', probability: 60, thinkMs: 0 },
  { route: 'ledger', probability: 40, thinkMs: 500 },
];

const runId = `harness-stage-${Date.now()}`;
const events: ContainmentEvent[] = [];
const docker = new DockerClient();
const runner = new SandboxRunner({
  docker,
  config,
  emit: (event) => {
    events.push(event);
    console.log(`[event] ${JSON.stringify(event)}`);
  },
  log: (message) => console.log(`[runner] ${message}`),
});
const executor = new DockerStageExecutor(runner);

console.log(`runtime=${config.sandbox.runtime} k6Image=${config.sandbox.k6Image}`);
console.log(`dataDir=${config.dataDir} runId=${runId} vus=${vus} durationSec=${durationSec}`);
console.log(`origins web=${config.target.webOrigin} api=${config.target.apiOrigin}`);

let exitCode = 0;
try {
  await runner.ensureEgress();
  await runner.ensureProxyImage();
  await runner.assertRuntimeUsable();

  const script = generateStageScript({
    runId,
    stageIndex: 1,
    vus,
    durationSec,
    journey,
    origins: { web: config.target.webOrigin, api: config.target.apiOrigin },
    productIds: PRODUCT_IDS,
    orderProductId: ORDER_PRODUCT_ID,
  });

  const net = await executor.openRun(runId);
  console.log(`run network ${net.networkName} proxy ${net.proxyUrl}`);

  const started = Date.now();
  const result = await executor.run(
    { runId, stageIdx: 1, script, durationSec, kind: 'stage' },
    new AbortController().signal,
  );
  console.log(`stage finished in ${((Date.now() - started) / 1000).toFixed(1)} s: status=${result.status}`
    + ` reason=${result.reason ?? '-'} oomKilled=${result.oomKilled} killed=${result.killed}`);

  if (result.logs !== undefined) {
    console.log('--- k6 stdout (tail) ---');
    console.log(result.logs.stdout);
    console.log('--- k6 stderr (tail) ---');
    console.log(result.logs.stderr);
  }

  // Denial lines are only readable while the Run directory exists (before closeRun).
  const denialsPath = `${net.runDir}/proxy/denials.jsonl`;
  const denials = await readFile(denialsPath, 'utf8').catch(() => '');
  console.log(`--- denials (${denialsPath}) ---`);
  console.log(denials.trim() === '' ? '(none)' : denials.trim());

  if (result.summaryJson === undefined) {
    console.log('no summary.json was produced');
    exitCode = 1;
  } else {
    const outDir = `${config.dataDir}/harness`;
    await mkdir(outDir, { recursive: true });
    const summaryPath = `${outDir}/${runId}-summary.json`;
    await writeFile(summaryPath, result.summaryJson);
    console.log(`raw summary written to ${summaryPath} (${result.summaryJson.length} bytes)`);

    let pretty = result.summaryJson;
    try {
      pretty = JSON.stringify(JSON.parse(result.summaryJson), null, 2);
    } catch {
      console.log('(summary is not valid JSON; printing as is)');
    }
    const lines = pretty.split('\n');
    console.log(`--- raw summary, first ${Math.min(lines.length, RAW_SUMMARY_PRINT_LINES)} of ${lines.length} lines ---`);
    console.log(lines.slice(0, RAW_SUMMARY_PRINT_LINES).join('\n'));

    // src/k6/metrics.ts is written by another task; use it when present.
    try {
      const modulePath = '../src/k6/metrics.ts';
      const mod: { readSummary?: (json: string) => unknown } = await import(modulePath);
      if (typeof mod.readSummary === 'function') {
        console.log('--- readSummary(summaryJson) ---');
        console.log(JSON.stringify(mod.readSummary(result.summaryJson), null, 2));
      } else {
        console.log('src/k6/metrics.ts has no readSummary export yet');
      }
    } catch (e) {
      console.log(`readSummary unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (result.status !== 'done') exitCode = 1;
} catch (e) {
  console.error(`harness failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  exitCode = 1;
} finally {
  const closed = await executor.closeRun(runId);
  console.log(`closeRun ok=${closed.ok} errors=${JSON.stringify(closed.errors)}`);
  if (!closed.ok) exitCode = 1;
  const left = await docker.listByLabel('containers', 'macro=1');
  const leftNets = await docker.listByLabel('networks', 'macro=1');
  console.log(`leftover macro=1 containers: ${left.length}, networks: ${leftNets.length}`);
  if (left.length > 0 || leftNets.length > 0) exitCode = 1;
  console.log(`events: ${events.map((e) => e.type).join(', ')}`);
}
process.exit(exitCode);
