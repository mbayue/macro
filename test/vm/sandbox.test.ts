/**
 * Real-Docker integration tests for the Sandbox_Runner, the Egress_Proxy and the
 * Containment_Probe (Requirement 6; the `bun run test:vm` suite, task 4.13).
 *
 * Unlike `test/runner.test.ts` (fake DockerApi, FakeClock, in-memory FS) these
 * tests run REAL containers on the local daemon: a k6 stage that writes a
 * summary, egress denials from inside a real sandbox, the memory and time caps,
 * the startup sweep, and the production probe script end to end.
 *
 * Opt-in: the whole file is gated on MACRO_VM_TEST=1, which `bun run test:vm`
 * sets through bun's embedded shell on every platform. Plain `bun test` skips
 * it without touching Docker.
 *
 * Prerequisites (checked, never assumed): a reachable Docker daemon, the pinned
 * k6 image (pulled when missing), the locally built `macro-proxy:latest` image
 * (built when missing), and no pre-existing `macro=1` containers or networks —
 * the final `cleanupAll` test sweeps everything labelled `macro=1`, so a live
 * Macro deployment on the same daemon would make the suite refuse to start.
 *
 * gVisor is optional: when `runsc` is registered it is used (and the refusal
 * test is skipped); otherwise the suite runs on `runc`, which still exercises
 * the proxy, the caps and the lifecycle. One host-dependent behaviour is
 * asserted honestly instead of assumed: Linux VMs (production, CI) enforce the
 * 1 GiB memory cap eagerly, so the probe's bounded allocation is OOM-killed;
 * Docker Desktop/WSL2 does not, and the probe test reports that instead of
 * pretending it passed.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { DockerStageExecutor } from '../../src/sandbox/runner.ts';
import type { StageRunResult } from '../../src/sandbox/runner.ts';
import { tcpFetch, DockerClient } from '../../src/sandbox/docker.ts';
import { ProbeController } from '../../src/run/probe.ts';
import type { ProbeClassification } from '../../src/k6/probe-result.ts';
import { Store } from '../../src/store/db.ts';
import type { ContainmentEvent } from '../../src/sandbox/runner.ts';
import type { Config } from '../../src/config.ts';
import type { DockerInfo } from '../../src/sandbox/docker.ts';
import type { SandboxRuntime } from '../../src/types.ts';
import {
  ensureImages,
  makeRunner,
  newRunId,
  probeDocker,
  removeConfigDir,
  vmConfig,
} from './helpers.ts';

/** The least-privilege Docker API proxy (Tecnativa), pinned by digest (linux/amd64). */
const SOCKET_PROXY_IMAGE =
  'tecnativa/docker-socket-proxy@sha256:1f5038b54f06c3e18422902cf00ba21803d1c97805aae032e5e6673d532d3459';

// ----------------------------------------------------------------- fixtures

const noopStage = (vus: number, duration: number): string => `
import { sleep } from 'k6';
export const options = { vus: ${vus}, duration: '${duration}s' };
export default function () { sleep(0.4); }
export function handleSummary(data) { return { '/out/summary.json': JSON.stringify(data) }; }
`;

const egressStage = (url: string): string => `
import http from 'k6/http';
export const options = { vus: 1, duration: '3s' };
export default function () { try { http.get(${JSON.stringify(url)}, { timeout: '5s' }); } catch (e) {} }
export function handleSummary(data) { return { '/out/summary.json': JSON.stringify(data) }; }
`;

const oomStage = (): string => `
export const options = { vus: 1, duration: '5s' };
export default function () {
  const held = [];
  for (;;) {
    const buf = new Uint8Array(16 * 1024 * 1024);
    for (let i = 0; i < buf.length; i += 4096) buf[i] = 1;
    held.push(buf);
  }
}
`;

const busyLoopStage = (): string => `
export const options = { vus: 1, duration: '60s' };
export default function () { for (;;) {} }
`;

// ------------------------------------------------------------- suite setup

interface OkSetup {
  kind: 'ok';
  docker: DockerClient;
  info: DockerInfo;
  runtime: SandboxRuntime;
  config: Config;
  /** True when a container can mount /var/run/docker.sock (Docker Desktop and Linux both allow it). */
  socketMountable: boolean;
}
interface UnavailableSetup {
  kind: 'unavailable';
  reason: string;
}
type Setup = OkSetup | UnavailableSetup;

const setup: Setup = await (async (): Promise<Setup> => {
  // Real containers are opt-in: plain `bun test` skips this file; `bun run test:vm`
  // sets MACRO_VM_TEST=1 (bun's embedded shell does this on Windows and POSIX).
  if (process.env.MACRO_VM_TEST !== '1') {
    return {
      kind: 'unavailable',
      reason: 'the real-container suite is opt-in: run `bun run test:vm` (it sets MACRO_VM_TEST=1)',
    };
  }
  const probe = await probeDocker();
  if (probe === null) {
    return {
      kind: 'unavailable',
      reason:
        'No Docker daemon is reachable (unix socket on POSIX, \\\\.\\pipe\\docker_engine on Windows). The real-container suite runs with `bun run test:vm` where Docker is available.',
    };
  }
  const images = await ensureImages(probe.docker);
  if (!images.ok) return { kind: 'unavailable', reason: images.reason ?? 'image preparation failed' };

  // The production startup path (src/main.ts) prepares the egress network before any Run.
  const config = await vmConfig(probe.runtime);
  await makeRunner({ docker: probe.docker, config }).ensureEgress();

  // Safety net for cleanupAll: refuse to run next to a live Macro deployment.
  const preexisting = await Promise.all([
    probe.docker.listByLabel('containers', 'macro=1'),
    probe.docker.listByLabel('networks', 'macro=1'),
  ]);
  if (preexisting[0]!.length > 0 || preexisting[1]!.length > 0) {
    return {
      kind: 'unavailable',
      reason: `Containers or networks labelled macro=1 already exist (${preexisting[0]!.length} containers, ${preexisting[1]!.length} networks). The sweep test would remove a live Macro deployment; run this suite on an isolated Docker host.`,
    };
  }

  // Socket-proxy tests mount the daemon socket into a container. Docker Desktop
  // (the daemon runs in its own VM) and plain Linux both allow this; probe it
  // instead of assuming. The probe also pre-pulls the pinned proxy image.
  const mountProbe = Bun.spawnSync(
    [
      'docker',
      'run',
      '--rm',
      '-v',
      '/var/run/docker.sock:/var/run/docker.sock',
      '--entrypoint',
      'sh',
      SOCKET_PROXY_IMAGE,
      '-c',
      'test -S /var/run/docker.sock',
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  );

  return {
    kind: 'ok',
    docker: probe.docker,
    info: probe.info,
    runtime: probe.runtime,
    config,
    socketMountable: mountProbe.exitCode === 0,
  };
})();

if (setup.kind === 'unavailable') {
  console.warn(`[macro vm] suite unavailable: ${setup.reason}`);
}

const ok = setup.kind === 'ok';
const runscAvailable = setup.kind === 'ok' && setup.runtime === 'runsc';
const ready = (): OkSetup => {
  if (setup.kind !== 'ok') throw new Error(setup.reason);
  return setup;
};

// Per-test containment-event collector.
class EventLog {
  readonly events: ContainmentEvent[] = [];
  readonly onEmit = (e: ContainmentEvent): void => {
    this.events.push(e);
  };
  ofType(type: string): ContainmentEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}

async function runStage(
  s: OkSetup,
  runId: string,
  script: string,
  durationSec: number,
  allowHosts: readonly string[],
  log: EventLog,
): Promise<StageRunResult> {
  const runner = makeRunner({ docker: s.docker, config: s.config, emit: log.onEmit });
  const net = await runner.openRunNetwork(runId, allowHosts);
  return runner.runSandbox(
    net,
    { runId, stageIdx: 0, script, durationSec, kind: 'stage' },
    new AbortController().signal,
  );
}

// ------------------------------------------------------------------- tests

afterAll(async () => {
  if (setup.kind !== 'ok') return;
  const runner = makeRunner({ docker: setup.docker, config: setup.config });
  await runner.cleanupAll();
  await removeConfigDir(setup.config);
});

describe('test:vm prerequisites', () => {
  test.skipIf(!ok)(
    'Docker daemon is reachable, images are prepared, and no macro=1 resources exist',
    () => {
      const s = ready();
      expect(s.info.ServerVersion).toBeDefined();
      expect(['runsc', 'runc']).toContain(s.runtime);
    },
  );

  if (!ok) {
    test('the suite reports why it cannot run', () => {
      expect(setup.kind).toBe('unavailable');
    });
  }
});

describe('test:vm runtime guard', () => {
  test.skipIf(!ok)(
    'assertRuntimeUsable accepts the detected runtime',
    async () => {
      const s = ready();
      const runner = makeRunner({ docker: s.docker, config: s.config });
      await expect(runner.assertRuntimeUsable()).resolves.toBeUndefined();
    },
    10_000,
  );

  test.skipIf(!ok || runscAvailable)(
    'assertRuntimeUsable refuses runsc when gVisor is not registered',
    async () => {
      const s = ready();
      const withoutGvisor = { ...s.config, sandbox: { ...s.config.sandbox, runtime: 'runsc' as const } };
      const runner = makeRunner({ docker: s.docker, config: withoutGvisor });
      await expect(runner.assertRuntimeUsable()).rejects.toThrow('runsc');
    },
    10_000,
  );
});

describe('test:vm stage in a real sandbox', () => {
  test.skipIf(!ok)(
    'a k6 stage runs, writes its summary, and its sandbox is removed',
    async () => {
      const s = ready();
      const log = new EventLog();
      const runner = makeRunner({ docker: s.docker, config: s.config, emit: log.onEmit });
      const runId = newRunId('sum');
      const result = await runStage(s, runId, noopStage(2, 2), 2, ['macro-vm-test.invalid'], log);
      expect(result.status).toBe('done');
      expect(result.summaryJson).toBeDefined();
      const summary = JSON.parse(result.summaryJson!) as { metrics?: unknown };
      expect(summary.metrics).toBeDefined();
      expect(log.ofType('sandbox_created')).toHaveLength(1);
      expect(log.ofType('sandbox_removed')).toHaveLength(1);

      const close = await runner.closeRunNetwork(runId);
      expect(close.ok).toBe(true);
      const containers = await s.docker.listByLabel('containers', `macro.run=${runId}`);
      const networks = await s.docker.listByLabel('networks', `macro.run=${runId}`);
      expect(containers).toHaveLength(0);
      expect(networks).toHaveLength(0);
    },
    90_000,
  );
});

describe('test:vm egress containment', () => {
  test.skipIf(!ok)(
    'a CONNECT to a non-allowlisted host is blocked and logged as a denial',
    async () => {
      const s = ready();
      const log = new EventLog();
      const result = await runStage(s, newRunId('egress'), egressStage('https://example.com/'), 3, ['macro-vm-test.invalid'], log);
      expect(result.status).toBe('done');
      const blocked = log.ofType('egress_blocked');
      expect(blocked.length).toBeGreaterThan(0);
      expect(blocked.every((e) => e.host === 'example.com' && e.port === 443)).toBe(true);
    },
    90_000,
  );

  test.skipIf(!ok)(
    'the metadata address 169.254.169.254 is refused as an IP literal',
    async () => {
      const s = ready();
      const log = new EventLog();
      const result = await runStage(s, newRunId('meta'), egressStage('https://169.254.169.254/'), 3, ['macro-vm-test.invalid'], log);
      expect(result.status).toBe('done');
      const blocked = log.ofType('egress_blocked');
      expect(blocked.length).toBeGreaterThan(0);
      expect(blocked.every((e) => e.host === '169.254.169.254' && e.port === 443)).toBe(true);
    },
    90_000,
  );
});

describe('test:vm resource caps', () => {
  test.skipIf(!ok)(
    'a sandbox that allocates more than 1 GiB is OOM-killed',
    async () => {
      const s = ready();
      const log = new EventLog();
      const result = await runStage(s, newRunId('oom'), oomStage(), 5, ['macro-vm-test.invalid'], log);
      expect(result.status).toBe('error');
      expect(result.oomKilled).toBe(true);
      expect(log.ofType('memory_cap_hit')).toHaveLength(1);
      expect(log.ofType('sandbox_removed')).toHaveLength(1);
    },
    120_000,
  );

  test.skipIf(!ok)(
    'a sandbox that runs past its time cap is killed',
    async () => {
      const s = ready();
      const log = new EventLog();
      const result = await runStage(s, newRunId('cap'), busyLoopStage(), 1, ['macro-vm-test.invalid'], log);
      expect(result.status).toBe('error');
      expect(result.killed).toBe(true);
      expect(result.reason).toBe('time cap hit');
      expect(log.ofType('time_cap_hit')).toHaveLength(1);
      expect(log.ofType('sandbox_killed')).toHaveLength(1);
      expect(log.ofType('sandbox_removed')).toHaveLength(1);
    },
    60_000,
  );
});

describe('test:vm containment probe end to end', () => {
  test.skipIf(!ok)(
    'the real probe script is contained: all four network and env actions, and the memory cap where the host enforces it',
    async () => {
      const s = ready();
      const log = new EventLog();
      const runner = makeRunner({ docker: s.docker, config: s.config, emit: log.onEmit });
      const store = new Store(':memory:');
      const controller = new ProbeController({
        store,
        executor: new DockerStageExecutor(runner),
        log: () => {},
      });
      const runId = newRunId('probe');
      store.createRun({ id: runId, kind: 'probe', planHash: null, runtime: s.runtime, startedAt: Date.now() });
      controller.start(runId);
      await controller.whenDone(runId);

      const run = store.getRun(runId);
      expect(run?.status).toBe('completed');
      const classification = run?.probeResult as ProbeClassification | undefined;
      expect(classification).toBeDefined();
      // Actions (a)-(d) must be contained on every host: proxy denials and the
      // sandbox environment do not depend on memory-cgroup enforcement.
      for (const action of ['a', 'b', 'c', 'd'] as const) {
        expect(classification!.actions[action]).toBe('contained');
      }

      // Action (e) is OOM-killed only on hosts whose cgroups enforce the 1 GiB
      // cap eagerly (Linux VMs: production gVisor, CI). Docker Desktop/WSL2 lets
      // a bounded allocation finish, so the action reports escaped there. That
      // is a host property, not a containment property: the sandbox may never
      // let a NETWORK action through, whatever the host.
      if (classification!.actions.e === 'contained') {
        expect(classification!.result).toBe('passed');
        expect(log.ofType('memory_cap_hit')).toHaveLength(1);
      } else {
        expect(classification!.escaped).toEqual(['e']);
        console.warn(
          '[macro vm] this host does not enforce the container memory cap for bounded allocations ' +
            `(observed: ${classification!.result}). Production runs gVisor on Linux, where the live probe passes all five actions.`,
        );
      }

      // The network actions were all denied by the real proxy.
      const hosts = new Set(log.ofType('egress_blocked').map((e) => e.host));
      expect(hosts.has('example.com')).toBe(true);
      expect(hosts.has('169.254.169.254')).toBe(true);
      expect(hosts.has('macro-api')).toBe(true);
    },
    120_000,
  );
});

describe('test:vm startup sweep', () => {
  test.skipIf(!ok)(
    'cleanupAll removes every macro=1 container and network',
    async () => {
      const s = ready();
      const runner = makeRunner({ docker: s.docker, config: s.config });
      const a = newRunId('sweepa');
      const b = newRunId('sweepb');
      await runner.openRunNetwork(a, ['macro-vm-test.invalid']);
      await runner.openRunNetwork(b, ['macro-vm-test.invalid']);
      const before = await Promise.all([
        s.docker.listByLabel('containers', 'macro=1'),
        s.docker.listByLabel('networks', 'macro=1'),
      ]);
      expect(before[0]!.length).toBeGreaterThanOrEqual(2); // two proxies
      expect(before[1]!.length).toBeGreaterThanOrEqual(2); // two run networks

      const swept = await runner.cleanupAll();
      expect(swept.errors).toEqual([]);
      expect(swept.containers).toBeGreaterThanOrEqual(2);
      expect(swept.networks).toBeGreaterThanOrEqual(2);

      const after = await Promise.all([
        s.docker.listByLabel('containers', 'macro=1'),
        s.docker.listByLabel('networks', 'macro=1'),
      ]);
      expect(after[0]).toHaveLength(0);
      expect(after[1]).toHaveLength(0);
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// The compose deploy reaches Docker through a least-privilege socket proxy
// (deploy/macro/docker-compose.yml). These tests prove the proxy stays least
// privileged (a path outside the allowlist answers 403) and that the allowlist
// is complete — the WHOLE Sandbox_Runner loop works through it.
//
// They run wherever a container can mount the daemon socket, which the setup
// probes. One split is honest about Docker Desktop: the allowlist checks run
// everywhere the socket mounts, but the full loop needs host paths that the
// RAW daemon can bind. Docker Desktop's Windows front door translates C:/ paths
// into its Linux VM and a container that mounts the raw socket bypasses that
// translation, so a Windows-path bind is rejected there (verified by hand). On
// Linux — CI and the production VM — host paths and daemon paths are the same,
// so the loop runs; on this Windows checkout it reports the skip instead.
// ---------------------------------------------------------------------------

describe('test:vm least-privilege socket proxy', () => {
  let hardened: DockerClient | undefined;
  let hardenedBase: string | undefined;
  let proxyContainerId: string | undefined;
  const socketMountable = setup.kind === 'ok' && setup.socketMountable;
  const fullLoopRunnable = socketMountable && process.platform === 'linux';

  beforeAll(async () => {
    if (!socketMountable) return;
    const s = ready();
    if ((await s.docker.imageInspect(SOCKET_PROXY_IMAGE)) === null) {
      const pulled = Bun.spawnSync(['docker', 'pull', SOCKET_PROXY_IMAGE], { stdout: 'ignore', stderr: 'pipe' });
      if (pulled.exitCode !== 0) {
        throw new Error(`docker pull of ${SOCKET_PROXY_IMAGE} failed: ${pulled.stderr?.toString().slice(-300)}`);
      }
    }
    // Same allowlist and hardening as the compose service.
    const created = await s.docker.containerCreate('macro-vmtest-socket-proxy', {
      Image: SOCKET_PROXY_IMAGE,
      Env: [
        'CONTAINERS=1',
        'NETWORKS=1',
        'IMAGES=1',
        'INFO=1',
        'ALLOW_START=1',
        'ALLOW_RESTARTS=1',
        'POST=1',
        'PING=1',
        'VERSION=1',
      ],
      ExposedPorts: { '2375/tcp': {} },
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
        PortBindings: { '2375/tcp': [{ HostPort: '' }] },
        AutoRemove: false,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
      },
    });
    proxyContainerId = created.Id;
    await s.docker.containerStart(created.Id);
    const inspect = await s.docker.containerInspect(created.Id);
    const hostPort = inspect?.NetworkSettings?.Ports?.['2375/tcp']?.[0]?.HostPort;
    if (hostPort === undefined || hostPort === '') {
      throw new Error('the socket proxy published no host port');
    }
    hardenedBase = `http://127.0.0.1:${hostPort}`;
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`${hardenedBase}/_ping`, { signal: AbortSignal.timeout(2_000) });
        if (res.ok) {
          hardened = new DockerClient(tcpFetch(hardenedBase));
          return;
        }
      } catch {
        // Not ready yet.
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('the socket proxy did not become ready');
  }, 180_000);

  afterAll(async () => {
    if (!socketMountable || proxyContainerId === undefined) return;
    const s = ready();
    await s.docker.containerRemove(proxyContainerId, { force: true });
    proxyContainerId = undefined;
  });

  test.skipIf(!socketMountable)(
    'GET /info works through the proxy and a path outside the allowlist answers 403',
    async () => {
      const s = ready();
      const info = await hardened!.info();
      expect(info.ServerVersion).toBe(s.info.ServerVersion);

      // /volumes is not in the allowlist: the proxy refuses it before Docker sees it.
      const res = await tcpFetch(hardenedBase!)('http://docker/v1.47/volumes');
      expect(res.status).toBe(403);
    },
    15_000,
  );

  test.skipIf(!fullLoopRunnable)(
    'the full sandbox loop runs through the proxy: network, stage, summary, cleanup',
    async () => {
      const s = ready();
      const log = new EventLog();
      const runner = makeRunner({ docker: hardened!, config: s.config, emit: log.onEmit });
      await runner.ensureEgress();
      await runner.ensureProxyImage();
      const runId = newRunId('sp');
      const net = await runner.openRunNetwork(runId, ['macro-vm-test.invalid']);
      const result = await runner.runSandbox(
        net,
        { runId, stageIdx: 0, script: noopStage(1, 2), durationSec: 2, kind: 'stage' },
        new AbortController().signal,
      );
      expect(result.status).toBe('done');
      expect(result.summaryJson).toBeDefined();
      expect(log.ofType('sandbox_created')).toHaveLength(1);
      expect(log.ofType('sandbox_removed')).toHaveLength(1);
      const close = await runner.closeRunNetwork(runId);
      expect(close.ok).toBe(true);
    },
    120_000,
  );

  test.skipIf(!fullLoopRunnable)(
    'the time-cap kill path works through the proxy',
    async () => {
      const s = ready();
      const log = new EventLog();
      const runner = makeRunner({ docker: hardened!, config: s.config, emit: log.onEmit });
      const runId = newRunId('spcap');
      const net = await runner.openRunNetwork(runId, ['macro-vm-test.invalid']);
      const result = await runner.runSandbox(
        net,
        { runId, stageIdx: 0, script: busyLoopStage(), durationSec: 1, kind: 'stage' },
        new AbortController().signal,
      );
      expect(result.status).toBe('error');
      expect(result.killed).toBe(true);
      expect(result.reason).toBe('time cap hit');
      expect(log.ofType('time_cap_hit')).toHaveLength(1);
      expect(log.ofType('sandbox_killed')).toHaveLength(1);
      const close = await runner.closeRunNetwork(runId);
      expect(close.ok).toBe(true);
    },
    120_000,
  );
});
