/**
 * Manual harness (task 4.12): run the Containment_Probe through the real
 * Sandbox_Runner and print the log lines, the classifier output, and the
 * containment events. Run it on the `macro` VM; see scripts/run-stage.ts for the
 * `docker run` command (swap the script name).
 *
 * Optional environment: SANDBOX_RUNTIME (default runsc), DATA_DIR (default /var/lib/macro).
 */

import { readFile } from 'node:fs/promises';
import { parseConfig } from '../src/config.ts';
import { classifyProbe, parseProbeLogs, PROBE_ACTIONS } from '../src/k6/probe-result.ts';
import { DockerClient } from '../src/sandbox/docker.ts';
import { DockerStageExecutor, SandboxRunner } from '../src/sandbox/runner.ts';
import type { ContainmentEvent } from '../src/sandbox/runner.ts';

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

const runId = `harness-probe-${Date.now()}`;
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
console.log(`dataDir=${config.dataDir} runId=${runId}`);

let exitCode = 0;
try {
  await runner.ensureEgress();
  await runner.ensureProxyImage();
  await runner.assertRuntimeUsable();

  const script = await readFile(new URL('../src/k6/probe.js', import.meta.url), 'utf8');
  const net = await executor.openRun(runId);
  console.log(`run network ${net.networkName} proxy ${net.proxyUrl}`);

  const started = Date.now();
  const result = await executor.run(
    { runId, stageIdx: 0, script, durationSec: 0, kind: 'probe' },
    new AbortController().signal,
  );
  console.log(`probe finished in ${((Date.now() - started) / 1000).toFixed(1)} s: status=${result.status}`
    + ` reason=${result.reason ?? '-'} oomKilled=${result.oomKilled} killed=${result.killed}`);

  const stdout = result.logs?.stdout ?? '';
  const stderr = result.logs?.stderr ?? '';
  console.log('--- sandbox stdout ---');
  console.log(stdout);
  console.log('--- sandbox stderr ---');
  console.log(stderr);

  const lines = parseProbeLogs(stdout, stderr);
  console.log('--- parseProbeLogs ---');
  console.log(JSON.stringify(lines, null, 2));

  const classification = classifyProbe(lines, { oomKilled: result.oomKilled, killedByMacro: result.killed });
  console.log('--- classifyProbe ---');
  console.log(JSON.stringify(classification, null, 2));
  for (const a of PROBE_ACTIONS) console.log(`  (${a.id}) ${classification.actions[a.id].padEnd(10)} ${a.label}`);
  if (classification.result !== 'passed') exitCode = 1;
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
  console.log('--- containment events ---');
  for (const e of events) console.log(JSON.stringify(e));
}
process.exit(exitCode);
