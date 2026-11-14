/**
 * Process entry point. Startup order (requirements 15.9, 6.11-6.13):
 *   config -> Run_Store -> Docker -> Sandbox_Runner -> runtime check -> leftover sweep ->
 *   mark interrupted Runs -> egress network + proxy image -> controllers -> HTTP server.
 *
 * A Sandbox problem never stops the HTTP server: it makes every Run start refuse with a fixed
 * message (shown by GET /api/config), so the operator can see what is wrong.
 */

import { InferenceClient } from './agents/inference.ts';
import { writeReport } from './agents/reporter.ts';
import { makeSupervisor } from './agents/supervisor.ts';
import { SQL } from 'bun';
import { loadConfigOrExit, redactedConfig } from './config.ts';
import { createTigerMirror, createTigerTrendsReader, formatDemoBaselineContext } from './metrics/tiger.ts';
import type { Config } from './config.ts';
import type { CapacityReport } from './report/build.ts';
import { RunController } from './run/controller.ts';
import { ProbeController } from './run/probe.ts';
import { DockerClient, fetchForDockerHost } from './sandbox/docker.ts';
import { DockerStageExecutor, SandboxRefusedError, SandboxRunner } from './sandbox/runner.ts';
import { resolveTxt } from 'node:dns/promises';
import { createResendMailer } from './auth/magic-link.ts';
import { verifyTurnstile } from './security/turnstile.ts';
import { createApp } from './server.ts';
import { Store } from './store/db.ts';

const MSG_DOCKER_UNREACHABLE =
  'Docker is not reachable from the Macro_API, so no Sandbox can be created. Runs are refused until the problem is fixed and the Macro_API is restarted.';
const MSG_CLEANUP_FAILED =
  'Leftover Sandbox containers or networks from a previous start could not be removed. Runs are refused until the Macro_API is restarted successfully.';
const MSG_EGRESS_FAILED =
  'The Sandbox egress network could not be prepared. Runs are refused until the problem is fixed and the Macro_API is restarted.';
const MSG_PROXY_IMAGE_MISSING =
  'The Egress_Proxy image macro-proxy:latest is not present. Build it, then restart the Macro_API.';

function errName(e: unknown): string {
  return e instanceof Error ? e.name : 'unknown';
}

function logLine(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

function logError(code: string, e?: unknown): void {
  console.error(JSON.stringify({ level: 'error', code, ...(e !== undefined ? { error: errName(e) } : {}) }));
}

/** Component diagnostics are code-authored text (never request data or secrets); clipped to one line. */
function logWarn(source: string, message: string): void {
  console.error(JSON.stringify({ level: 'warn', source, message: message.slice(0, 500) }));
}

async function main(): Promise<void> {
  const config = loadConfigOrExit();

  const store = Store.open(config.dataDir);
  const stopPurge = store.startPurgeTimer();

  // Unix socket by default; the compose deploy points DOCKER_HOST at the
  // least-privilege socket proxy, so the API container never holds the socket.
  const docker = new DockerClient(fetchForDockerHost(config.dockerHost));
  const runner = new SandboxRunner({
    docker,
    config,
    emit: (e) => {
      const payload: { type: string; host?: string; port?: number } = { type: e.type };
      if (e.host !== undefined) payload.host = e.host;
      if (e.port !== undefined) payload.port = e.port;
      store.appendEvent({ type: 'containment', runId: e.runId, stageIdx: e.stageIdx, payload, ts: Date.now() });
    },
    log: (m) => logWarn('sandbox_runner', m),
  });

  // The first failure wins; later steps still run so their cleanup is not skipped.
  let runtimeError: string | undefined = config.sandbox.runtimeError;
  const refuse = (message: string): void => {
    runtimeError ??= message;
  };

  try {
    await runner.assertRuntimeUsable();
  } catch (e) {
    if (e instanceof SandboxRefusedError) refuse(e.message);
    else {
      logError('runtime_check_failed', e);
      refuse(MSG_DOCKER_UNREACHABLE);
    }
  }

  try {
    const swept = await runner.cleanupAll();
    if (swept.errors.length > 0) {
      logError('startup_cleanup_incomplete', swept.errors.join('; '));
      refuse(MSG_CLEANUP_FAILED);
    }
  } catch (e) {
    logError('startup_cleanup_failed', e);
    refuse(MSG_CLEANUP_FAILED);
  }

  try {
    const interrupted = store.markRunningInterrupted(Date.now());
    if (interrupted > 0) logLine({ event: 'runs_interrupted', count: interrupted });
  } catch (e) {
    logError('mark_interrupted_failed', e);
  }

  if (runtimeError === undefined) {
    try {
      await runner.ensureEgress();
    } catch (e) {
      logError('egress_network_failed', e);
      refuse(MSG_EGRESS_FAILED);
    }
    try {
      await runner.ensureProxyImage();
    } catch (e) {
      logError('proxy_image_check_failed', e);
      refuse(MSG_PROXY_IMAGE_MISSING);
    }
  }

  // The config every other component sees: admission refuses all starts when runtimeError is set.
  const effective: Config =
    runtimeError === undefined || runtimeError === config.sandbox.runtimeError
      ? config
      : { ...config, sandbox: { ...config.sandbox, runtimeError } };

  const executor = new DockerStageExecutor(runner);
  const client = new InferenceClient({ config: effective.inference, store });
  const supervise = makeSupervisor({ client });

  // Optional TigerData mirror of public-run samples. Unset TIGERDATA_URL
  // disables it; Bun connects lazily, so startup never waits on the service.
  const tigerSql = effective.tigerDataUrl !== undefined ? new SQL(effective.tigerDataUrl) : undefined;
  const tigerMirror =
    effective.tigerDataUrl !== undefined && tigerSql !== undefined
      ? createTigerMirror({ url: effective.tigerDataUrl, client: tigerSql })
      : undefined;
  const getDemoTrends =
    effective.tigerDataUrl !== undefined && tigerSql !== undefined
      ? createTigerTrendsReader({ url: effective.tigerDataUrl, client: tigerSql })
      : undefined;

  /** Adds the AI section to a stored report and announces it. Never throws. */
  const onRunEnded = async (runId: string): Promise<void> => {
    try {
      const row = store.getReport(runId);
      if (row === null) return;
      const run = store.getRun(runId);
      const target = run?.planHash == null ? null : store.getPlanTarget(run.planHash);
      let baselineNote: string | undefined;
      if (run?.visibility === 'public' && getDemoTrends !== undefined) {
        const trends = await Promise.race([
          getDemoTrends(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 400)),
        ]).catch(() => null);
        if (trends !== null) baselineNote = formatDemoBaselineContext(trends);
      }
      const ai = await writeReport(
        { client },
        row.body as CapacityReport,
        {
          runId,
          ...(target !== null ? { routes: target.routes } : {}),
          ...(baselineNote !== undefined ? { baselineNote } : {}),
        },
      );
      store.setReportAi(runId, ai, ai.status === 'unavailable' ? 'unavailable' : 'ready');
      store.appendEvent({ type: 'report', runId, payload: { ready: true, ai: true }, ts: Date.now() });
    } catch (e) {
      logError('report_ai_failed', e);
    }
  };

  const runController = new RunController({
    store,
    config: effective,
    executor,
    supervise,
    onRunEnded,
    ...(tigerMirror !== undefined ? { mirrorStageSamples: tigerMirror } : {}),
    log: (m) => logWarn('run_controller', m),
  });
  const probeController = new ProbeController({
    store,
    config: effective,
    executor,
    log: (m) => logWarn('probe_controller', m),
  });

  const app = createApp({
    store,
    config: effective,
    verifyTurnstile: (token, ip) => verifyTurnstile(token, ip, { secretKey: effective.turnstile.secretKey }),
    client,
    runController,
    probeController,
    resolveTxt,
    fetchImpl: fetch,
    ...(getDemoTrends !== undefined ? { getDemoTrends } : {}),
    ...(effective.auth !== undefined
      ? {
          mailer: createResendMailer({
            apiKey: effective.auth.resendApiKey,
            from: effective.auth.resendFrom,
          }),
        }
      : {}),
  });

  const server = Bun.serve({
    port: effective.port,
    hostname: '0.0.0.0',
    // Planning can wait on the model for minutes; SSE and /api/plan also call server.timeout(req, 0).
    idleTimeout: 255,
    maxRequestBodySize: 128 * 1024,
    fetch: (req, srv) => app.fetch(req, srv),
  });

  logLine({
    event: 'startup',
    port: server.port,
    runsAvailable: runtimeError === undefined,
    runtimeError: runtimeError ?? null,
    config: redactedConfig(effective),
  });

  // Graceful stop: no new connections; running Sandboxes are swept by the next start.
  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logLine({ event: 'shutdown', signal });
    try {
      void server.stop(true);
    } catch (e) {
      logError('server_stop_failed', e);
    }
    stopPurge();
    try {
      store.close();
    } catch (e) {
      logError('store_close_failed', e);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logError('unhandled_rejection', reason));
}

await main();
