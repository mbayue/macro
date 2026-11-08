/**
 * Sandbox_Runner: runs each k6 Stage (or the Containment_Probe) in a hardened
 * container on a per-Run internal Docker network whose only exit is the
 * Egress_Proxy.
 *
 * Nothing request-controlled reaches an image, mount, network, name, or command:
 * those values come from constants, from the validated Run ID, from the stage
 * index (an integer), and from `Config`. Everything outside the Docker calls is
 * injectable (`DockerApi`, `Clock`, `RunnerFs`, `emit`) so a test can use fakes.
 *
 * Host paths in `Binds` are resolved by the Docker daemon on the host. When
 * macro-api itself runs in a container, `dataDir` must be bind-mounted at the
 * same path on both sides.
 */

import { constants as fsConstants } from 'node:fs';
import { chmod, chown, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { ContainmentType } from '../types.ts';
import { DockerError } from './docker.ts';
import type {
  ContainerCreateBody,
  ContainerInspect,
  DemuxedLogs,
  DockerClient,
} from './docker.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROXY_IMAGE = 'macro-proxy:latest';
export const EGRESS_NETWORK = 'macro-egress';
export const PROXY_PORT = 3128;
export const SANDBOX_UID = 65534;
export const SANDBOX_USER = `${SANDBOX_UID}:${SANDBOX_UID}`;
export const SANDBOX_MEMORY_BYTES = 1024 ** 3;
export const SANDBOX_NANO_CPUS = 1_000_000_000;
export const SANDBOX_PIDS_LIMIT = 256;
export const SANDBOX_SCRIPT_PATH = '/scripts/stage.js';
export const SANDBOX_OUT_DIR = '/out';
export const STAGE_TIME_CAP_EXTRA_SEC = 30;
export const PROBE_TIME_CAP_SEC = 60;
export const SUMMARY_MAX_BYTES = 5 * 1024 * 1024;
export const CLOSE_RUN_DEADLINE_MS = 30_000;
export const DENIAL_POLL_MS = 1_000;

const PROXY_MEMORY_BYTES = 128 * 1024 * 1024;
const PROXY_PIDS_LIMIT = 128;
const PROXY_READY_POLLS = 25;
const PROXY_READY_POLL_MS = 200;
const REMOVE_POLLS = 100;
const REMOVE_POLL_MS = 200;
const KILL_SETTLE_MS = 10_000;
const NETWORK_REMOVE_ATTEMPTS = 3;
const NETWORK_REMOVE_BACKOFF_MS = 1_000;
const DENIAL_READ_CHUNK = 64 * 1024;
const DENIAL_READ_ROUNDS = 4;
const MAX_EGRESS_EVENTS_PER_RUN = 500;
const MAX_EGRESS_HOST_CHARS = 255;
const FAILURE_LOG_TAIL_CHARS = 8 * 1024;
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_STAGE_IDX = 1000;
const MAX_STAGE_DURATION_SEC = 3600;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DockerApi = Pick<
  DockerClient,
  | 'info'
  | 'networkCreate'
  | 'networkConnect'
  | 'networkRemove'
  | 'containerCreate'
  | 'containerStart'
  | 'containerWait'
  | 'containerKill'
  | 'containerInspect'
  | 'containerRemove'
  | 'containerLogs'
  | 'listByLabel'
  | 'imageInspect'
>;

export interface Clock {
  now(): number;
  /** Resolves after `ms`, or as soon as `signal` aborts. Never rejects. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

export interface ContainmentEvent {
  type: ContainmentType;
  runId: string;
  stageIdx: number;
  host?: string;
  port?: number;
}
export type EmitFn = (event: ContainmentEvent) => void;

export interface StageSpec {
  runId: string;
  stageIdx: number;
  script: string;
  durationSec: number;
  kind: 'stage' | 'probe';
}

export interface StageRunResult {
  status: 'done' | 'error';
  reason?: string;
  summaryJson?: string;
  logs?: { stdout: string; stderr: string };
  oomKilled: boolean;
  killed: boolean;
}

export interface StageExecutor {
  run(spec: StageSpec, signal: AbortSignal): Promise<StageRunResult>;
}

export interface RunNet {
  readonly runId: string;
  readonly networkName: string;
  readonly networkId: string;
  readonly proxyContainerId: string;
  readonly proxyIp: string;
  /** `http://<proxyIp>:3128`, the only value placed in the Sandbox environment. */
  readonly proxyUrl: string;
  readonly runDir: string;
}

export interface CloseResult {
  ok: boolean;
  errors: string[];
}

export interface CleanupResult {
  containers: number;
  networks: number;
  errors: string[];
}

/** Raised when SANDBOX_RUNTIME is invalid or gVisor is missing (Requirement 6.13). */
export class SandboxRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxRefusedError';
  }
}

/** Raised by `openRunNetwork` after it has removed whatever it created (Requirement 6.16). */
export class RunNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunNetworkError';
  }
}

// ---------------------------------------------------------------------------
// Filesystem seam
// ---------------------------------------------------------------------------

export interface RunnerFs {
  /** Recursive mkdir; the final directory ends with exactly `mode`. */
  mkdir(path: string, mode: number): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  /** Returns false when the process may not chown (not root). */
  chownBestEffort(path: string, uid: number, gid: number): Promise<boolean>;
  writeFile(path: string, data: string, mode: number): Promise<void>;
  /** Regular file only (no symlinks). Null when missing. Throws when larger than `maxBytes`. */
  readTextCapped(path: string, maxBytes: number): Promise<string | null>;
  /** Up to `maxBytes` starting at `offset`. Null when the file is missing. */
  readFrom(path: string, offset: number, maxBytes: number): Promise<Uint8Array | null>;
  /** Recursive, forgiving remove. */
  rm(path: string): Promise<void>;
}

function isMissing(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');
}

async function openRegular(path: string): Promise<Awaited<ReturnType<typeof open>> | null> {
  // O_NOFOLLOW: the Sandbox controls the output directory and must not be able to
  // point us at another file with a symlink.
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, flags);
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
  const st = await handle.stat();
  if (!st.isFile()) {
    await handle.close();
    throw new Error('not a regular file');
  }
  return handle;
}

export const nodeFs: RunnerFs = {
  async mkdir(path, mode) {
    await mkdir(path, { recursive: true, mode });
    await chmod(path, mode);
  },
  async chmod(path, mode) {
    await chmod(path, mode);
  },
  async chownBestEffort(path, uid, gid) {
    try {
      await chown(path, uid, gid);
      return true;
    } catch {
      return false;
    }
  },
  async writeFile(path, data, mode) {
    await writeFile(path, data, { mode });
    await chmod(path, mode);
  },
  async readTextCapped(path, maxBytes) {
    const handle = await openRegular(path);
    if (handle === null) return null;
    try {
      const size = (await handle.stat()).size;
      if (size > maxBytes) throw new Error(`file is larger than ${maxBytes} bytes`);
      const buf = new Uint8Array(size);
      let off = 0;
      while (off < size) {
        const { bytesRead } = await handle.read(buf, off, size - off, off);
        if (bytesRead === 0) break;
        off += bytesRead;
      }
      return new TextDecoder().decode(buf.subarray(0, off));
    } finally {
      await handle.close();
    }
  },
  async readFrom(path, offset, maxBytes) {
    const handle = await openRegular(path);
    if (handle === null) return null;
    try {
      const buf = new Uint8Array(maxBytes);
      const { bytesRead } = await handle.read(buf, 0, maxBytes, offset);
      return buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
  async rm(path) {
    await rm(path, { recursive: true, force: true });
  },
};

// ---------------------------------------------------------------------------
// Pure builders (exported so tests can assert the exact create bodies)
// ---------------------------------------------------------------------------

export function validateRunId(runId: string): string {
  if (!RUN_ID_RE.test(runId)) throw new Error(`invalid Run ID: ${JSON.stringify(runId)}`);
  return runId;
}

export const runNetworkName = (runId: string): string => `macro-run-${runId}`;
export const proxyContainerName = (runId: string): string => `macro-proxy-${runId}`;
export const sandboxContainerName = (runId: string, stageIdx: number): string =>
  `macro-sbx-${runId}-${stageIdx}`;

/** Hostnames of the configured target origins. */
export function allowHostsFromConfig(config: Pick<Config, 'target'>): string[] {
  const hosts = new Set<string>();
  for (const origin of config.target.allowlist) hosts.add(new URL(origin).hostname.toLowerCase());
  return [...hosts];
}

export interface ProxyBodyInput {
  runId: string;
  networkName: string;
  proxyDir: string;
  allowHosts: readonly string[];
  blockIps: readonly string[];
}

export function buildProxyCreateBody(i: ProxyBodyInput): ContainerCreateBody {
  return {
    Image: PROXY_IMAGE,
    User: SANDBOX_USER,
    Env: [
      `ALLOW_HOSTS=${i.allowHosts.join(',')}`,
      `BLOCK_IPS=${i.blockIps.join(',')}`,
      `DENIALS_FILE=${SANDBOX_OUT_DIR}/denials.jsonl`,
    ],
    Labels: { macro: '1', 'macro.run': i.runId, 'macro.role': 'proxy' },
    HostConfig: {
      Runtime: 'runc',
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      PidsLimit: PROXY_PIDS_LIMIT,
      Memory: PROXY_MEMORY_BYTES,
      MemorySwap: PROXY_MEMORY_BYTES,
      NetworkMode: i.networkName,
      Binds: [`${i.proxyDir}:${SANDBOX_OUT_DIR}:rw`],
      AutoRemove: false,
    },
  };
}

export interface SandboxBodyInput {
  image: string;
  runtime: string;
  runId: string;
  stageIdx: number;
  networkName: string;
  proxyUrl: string;
  scriptPath: string;
  outDir: string;
}

export function buildSandboxCreateBody(i: SandboxBodyInput): ContainerCreateBody {
  return {
    Image: i.image,
    User: SANDBOX_USER,
    Cmd: ['run', '--no-usage-report', '--quiet', SANDBOX_SCRIPT_PATH],
    Env: [
      `HTTPS_PROXY=${i.proxyUrl}`,
      `HTTP_PROXY=${i.proxyUrl}`,
    ],
    Labels: { macro: '1', 'macro.run': i.runId, 'macro.stage': String(i.stageIdx) },
    HostConfig: {
      Runtime: i.runtime,
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      PidsLimit: SANDBOX_PIDS_LIMIT,
      Memory: SANDBOX_MEMORY_BYTES,
      MemorySwap: SANDBOX_MEMORY_BYTES,
      NanoCpus: SANDBOX_NANO_CPUS,
      NetworkMode: i.networkName,
      Binds: [`${i.scriptPath}:${SANDBOX_SCRIPT_PATH}:ro`, `${i.outDir}:${SANDBOX_OUT_DIR}:rw`],
      Tmpfs: { '/tmp': 'size=16m' },
      AutoRemove: false,
    },
  };
}

/** Time cap in seconds: Stage duration + 30 s; 60 s for the probe. */
export function timeCapSec(spec: Pick<StageSpec, 'kind' | 'durationSec'>): number {
  return spec.kind === 'probe' ? PROBE_TIME_CAP_SEC : spec.durationSec + STAGE_TIME_CAP_EXTRA_SEC;
}

const denialLineSchema = z.object({
  ts: z.union([z.string(), z.number()]).optional(),
  host: z.string(),
  port: z.number().int().min(0).max(65535),
});

/** Parses one denials.jsonl line; null when invalid. Host is cut to 255 characters. */
export function parseDenialLine(line: string): { host: string; port: number } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  const parsed = denialLineSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { host: parsed.data.host.slice(0, MAX_EGRESS_HOST_CHARS), port: parsed.data.port };
}

function errMsg(e: unknown): string {
  if (e instanceof DockerError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

function tail(s: string): string {
  return s.length > FAILURE_LOG_TAIL_CHARS ? s.slice(-FAILURE_LOG_TAIL_CHARS) : s;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface SandboxRunnerDeps {
  docker: DockerApi;
  config: Config;
  emit: EmitFn;
  clock?: Clock;
  fs?: RunnerFs;
  /** Denial poll interval; 0 disables the background poller (tests call `pollDenials`). */
  denialPollMs?: number;
  log?: (message: string) => void;
}

interface RunState {
  net: RunNet;
  proxyDir: string;
  stageIdx: number;
  offset: number;
  emitted: number;
  chain: Promise<void>;
  stop: AbortController;
  poller: Promise<void> | undefined;
}

export class SandboxRunner {
  private readonly docker: DockerApi;
  private readonly config: Config;
  private readonly emitFn: EmitFn;
  private readonly clock: Clock;
  private readonly fs: RunnerFs;
  private readonly denialPollMs: number;
  private readonly log: (message: string) => void;
  private readonly runs = new Map<string, RunState>();

  constructor(deps: SandboxRunnerDeps) {
    this.docker = deps.docker;
    this.config = deps.config;
    this.emitFn = deps.emit;
    this.clock = deps.clock ?? systemClock;
    this.fs = deps.fs ?? nodeFs;
    this.denialPollMs = deps.denialPollMs ?? DENIAL_POLL_MS;
    this.log = deps.log ?? (() => {});
  }

  // ----- startup helpers ---------------------------------------------------

  /** Creates the `macro-egress` bridge network if missing. It carries no `macro=1` label, so sweeps leave it alone. */
  async ensureEgress(): Promise<void> {
    const existing = await this.docker.listByLabel('networks', 'macro.infra=egress');
    if (existing.some((n) => n.Name === EGRESS_NETWORK)) return;
    try {
      await this.docker.networkCreate({
        name: EGRESS_NETWORK,
        internal: false,
        labels: { 'macro.infra': 'egress' },
      });
    } catch (e) {
      // 409: a network with this name already exists (created without our label). Use it.
      if (!(e instanceof DockerError && e.status === 409)) throw e;
    }
  }

  /** Throws when the locally built proxy image is missing. */
  async ensureProxyImage(): Promise<void> {
    const image = await this.docker.imageInspect(PROXY_IMAGE);
    if (image === null) {
      throw new Error(
        `Egress_Proxy image ${PROXY_IMAGE} is not present; build it with: docker build -t ${PROXY_IMAGE} -f proxy/Dockerfile .`,
      );
    }
  }

  /** Requirement 6.13: refuse when the runtime setting is invalid or gVisor is not registered. */
  async assertRuntimeUsable(): Promise<void> {
    const { runtime, runtimeError } = this.config.sandbox;
    if (runtimeError !== undefined) throw new SandboxRefusedError(runtimeError);
    if (runtime === 'runsc') {
      const info = await this.docker.info();
      if (!Object.hasOwn(info.Runtimes, 'runsc')) {
        throw new SandboxRefusedError(
          'gVisor (runsc) is not registered with Docker; set SANDBOX_RUNTIME=runc explicitly to run without gVisor',
        );
      }
    }
  }

  // ----- events ------------------------------------------------------------

  private emit(type: ContainmentType, runId: string, stageIdx: number, extra?: { host: string; port: number }): void {
    const event: ContainmentEvent = { type, runId, stageIdx };
    if (extra) {
      event.host = extra.host;
      event.port = extra.port;
    }
    try {
      this.emitFn(event);
    } catch (e) {
      this.log(`emit failed: ${errMsg(e)}`);
    }
  }

  // ----- Run network -------------------------------------------------------

  async openRunNetwork(runId: string): Promise<RunNet> {
    validateRunId(runId);
    if (this.runs.has(runId)) throw new RunNetworkError(`Run network for ${runId} is already open`);
    await this.assertRuntimeUsable();

    const networkName = runNetworkName(runId);
    const runDir = posix.join(this.config.dataDir, 'runs', runId);
    const proxyDir = posix.join(runDir, 'proxy');
    let networkId: string | undefined;
    let proxyId: string | undefined;
    try {
      await this.fs.mkdir(proxyDir, 0o700);
      if (!(await this.fs.chownBestEffort(proxyDir, SANDBOX_UID, SANDBOX_UID))) await this.fs.chmod(proxyDir, 0o777);

      networkId = (
        await this.docker.networkCreate({
          name: networkName,
          internal: true,
          labels: { macro: '1', 'macro.run': runId },
        })
      ).Id;

      const body = buildProxyCreateBody({
        runId,
        networkName,
        proxyDir,
        allowHosts: allowHostsFromConfig(this.config),
        blockIps: [this.config.macroVmIp],
      });
      proxyId = (await this.docker.containerCreate(proxyContainerName(runId), body)).Id;
      await this.docker.networkConnect(EGRESS_NETWORK, proxyId);
      await this.docker.containerStart(proxyId);

      const inspect = await this.docker.containerInspect(proxyId);
      const proxyIp = inspect?.NetworkSettings?.Networks?.[networkName]?.IPAddress;
      if (proxyIp === undefined || proxyIp === '') throw new Error('Egress_Proxy has no address on the Run network');
      await this.waitProxyReady(proxyId);

      const net: RunNet = {
        runId,
        networkName,
        networkId,
        proxyContainerId: proxyId,
        proxyIp,
        proxyUrl: `http://${proxyIp}:${PROXY_PORT}`,
        runDir,
      };
      const state: RunState = {
        net,
        proxyDir,
        stageIdx: 1,
        offset: 0,
        emitted: 0,
        chain: Promise.resolve(),
        stop: new AbortController(),
        poller: undefined,
      };
      this.runs.set(runId, state);
      if (this.denialPollMs > 0) state.poller = this.denialLoop(state);
      return net;
    } catch (e) {
      const message = errMsg(e);
      const errors: string[] = [];
      if (proxyId !== undefined) {
        await this.removeContainer(proxyId);
        if (!(await this.confirmGone(proxyId))) errors.push('proxy container not removed');
      }
      if (networkId !== undefined && !(await this.removeNetworkWithRetries(networkName, errors))) {
        errors.push('network not removed');
      }
      await this.fs.rm(runDir).catch(() => undefined);
      throw new RunNetworkError(
        `cannot create Run network or Egress_Proxy: ${message}${errors.length > 0 ? ` (${errors.join('; ')})` : ''}`,
      );
    }
  }

  private async waitProxyReady(proxyId: string): Promise<void> {
    for (let i = 0; i < PROXY_READY_POLLS; i++) {
      const info = await this.docker.containerInspect(proxyId);
      if (info === null || info.State.Running === false) throw new Error('Egress_Proxy exited during startup');
      let logs: DemuxedLogs | undefined;
      try {
        logs = await this.docker.containerLogs(proxyId);
      } catch {
        logs = undefined;
      }
      if (logs?.stdout.includes('listening')) return;
      await this.clock.sleep(PROXY_READY_POLL_MS);
    }
    throw new Error('Egress_Proxy did not start listening');
  }

  async closeRunNetwork(runId: string): Promise<CloseResult> {
    const errors: string[] = [];
    try {
      validateRunId(runId);
    } catch (e) {
      return { ok: false, errors: [errMsg(e)] };
    }
    const deadline = this.clock.now() + CLOSE_RUN_DEADLINE_MS;
    const state = this.runs.get(runId);
    if (state) {
      state.stop.abort();
      await state.poller?.catch(() => undefined);
      await this.pollDenials(runId);
    }

    try {
      const found = await this.docker.listByLabel('containers', `macro.run=${runId}`);
      for (const c of found) await this.removeContainer(c.Id);
      for (const c of found) {
        if (await this.confirmGone(c.Id)) {
          const stage = Number(c.Labels['macro.stage']);
          if (Number.isInteger(stage)) this.emit('sandbox_removed', runId, stage);
        } else {
          errors.push(`container ${c.Id.slice(0, 12)} not removed`);
        }
      }
    } catch (e) {
      errors.push(`container cleanup: ${errMsg(e)}`);
    }

    if (this.clock.now() > deadline) errors.push('Run cleanup exceeded 30 seconds');
    if (!(await this.removeNetworkWithRetries(runNetworkName(runId), errors))) errors.push('network not removed');

    await this.fs.rm(posix.join(this.config.dataDir, 'runs', runId)).catch((e: unknown) => {
      errors.push(`run directory: ${errMsg(e)}`);
    });
    this.runs.delete(runId);
    return { ok: errors.length === 0, errors };
  }

  /**
   * Startup sweep (Requirement 6.11): removes every container and network labelled
   * `macro=1` and the per-Run host directories. The caller must refuse to accept Runs
   * when `errors` is not empty.
   */
  async cleanupAll(): Promise<CleanupResult> {
    const errors: string[] = [];
    let containers = 0;
    let networks = 0;
    try {
      const found = await this.docker.listByLabel('containers', 'macro=1');
      for (const c of found) await this.removeContainer(c.Id);
      for (const c of found) {
        if (await this.confirmGone(c.Id)) containers++;
        else errors.push(`container ${c.Id.slice(0, 12)} not removed`);
      }
    } catch (e) {
      errors.push(`container sweep: ${errMsg(e)}`);
    }
    try {
      const found = await this.docker.listByLabel('networks', 'macro=1');
      for (const n of found) {
        if (await this.removeNetworkWithRetries(n.Id, errors)) networks++;
      }
    } catch (e) {
      errors.push(`network sweep: ${errMsg(e)}`);
    }
    for (const state of this.runs.values()) state.stop.abort();
    this.runs.clear();
    await this.fs.rm(posix.join(this.config.dataDir, 'runs')).catch((e: unknown) => {
      errors.push(`runs directory: ${errMsg(e)}`);
    });
    return { containers, networks, errors };
  }

  // ----- Stage execution ---------------------------------------------------

  async runSandbox(net: RunNet, spec: StageSpec, signal: AbortSignal): Promise<StageRunResult> {
    const fail = (reason: string): StageRunResult => ({ status: 'error', reason, oomKilled: false, killed: false });
    const state = this.runs.get(net.runId);
    if (state === undefined || state.net.networkId !== net.networkId) return fail('Run network is not open');
    if (spec.runId !== net.runId) return fail('Stage spec does not belong to this Run network');
    if (!Number.isInteger(spec.stageIdx) || spec.stageIdx < 0 || spec.stageIdx > MAX_STAGE_IDX) {
      return fail('invalid stage index');
    }
    if (
      !Number.isInteger(spec.durationSec) ||
      spec.durationSec < 0 ||
      spec.durationSec > MAX_STAGE_DURATION_SEC
    ) {
      return fail('invalid stage duration');
    }
    if (signal.aborted) return fail('stopped before the Sandbox was created');

    const { runId, stageIdx } = spec;
    state.stageIdx = stageIdx;
    const stageDir = posix.join(net.runDir, `stage-${stageIdx}`);
    const scriptPath = posix.join(stageDir, 'stage.js');
    const outDir = posix.join(stageDir, 'out');
    let containerId: string | undefined;

    const finish = async (result: StageRunResult): Promise<StageRunResult> => {
      // Always: remove the container (if created) and the stage directory, confirm via 404.
      let removed = true;
      if (containerId !== undefined) {
        await this.removeContainer(containerId);
        removed = await this.confirmGone(containerId);
      }
      await this.fs.rm(stageDir).catch((e: unknown) => this.log(`stage dir removal failed: ${errMsg(e)}`));
      if (containerId !== undefined) {
        if (removed) {
          this.emit('sandbox_removed', runId, stageIdx);
        } else {
          result = { ...result, status: 'error', reason: `${result.reason ?? 'error'}; Sandbox could not be removed` };
        }
      }
      return result;
    };

    // --- create (Requirement 6.16: any failure here starts no k6 process)
    try {
      await this.fs.mkdir(stageDir, 0o755);
      await this.fs.mkdir(outDir, 0o700);
      if (!(await this.fs.chownBestEffort(outDir, SANDBOX_UID, SANDBOX_UID))) await this.fs.chmod(outDir, 0o777);
      await this.fs.writeFile(scriptPath, spec.script, 0o444);
      const body = buildSandboxCreateBody({
        image: this.config.sandbox.k6Image,
        runtime: this.config.sandbox.runtime,
        runId,
        stageIdx,
        networkName: net.networkName,
        proxyUrl: net.proxyUrl,
        scriptPath,
        outDir,
      });
      containerId = (await this.docker.containerCreate(sandboxContainerName(runId, stageIdx), body)).Id;
      this.emit('sandbox_created', runId, stageIdx);
    } catch (e) {
      return finish(fail(`cannot create Sandbox: ${errMsg(e)}`));
    }

    const id = containerId;
    const waitCtl = new AbortController();
    const capCtl = new AbortController();
    let onAbort: (() => void) | undefined;
    try {
      try {
        await this.docker.containerStart(id);
      } catch (e) {
        return await finish(fail(`cannot start Sandbox: ${errMsg(e)}`));
      }

      // --- wait with time cap and stop signal
      type Outcome = { k: 'exit'; code: number | undefined } | { k: 'cap' } | { k: 'abort' };
      const waitP: Promise<Outcome> = this.docker.containerWait(id, waitCtl.signal).then(
        (r): Outcome => ({ k: 'exit', code: r.StatusCode }),
        (): Outcome => ({ k: 'exit', code: undefined }),
      );
      const capP: Promise<Outcome> = this.clock
        .sleep(timeCapSec(spec) * 1000, capCtl.signal)
        .then((): Outcome => ({ k: 'cap' }));
      const abortP = new Promise<Outcome>((resolve) => {
        onAbort = () => resolve({ k: 'abort' });
        signal.addEventListener('abort', onAbort, { once: true });
      });
      const first = await Promise.race([waitP, capP, abortP]);
      capCtl.abort();

      let killed = false;
      let reason: string | undefined;
      let exitCode = first.k === 'exit' ? first.code : undefined;
      if (first.k !== 'exit') {
        if (first.k === 'cap') {
          this.emit('time_cap_hit', runId, stageIdx);
          reason = 'time cap hit';
        } else {
          reason = 'stopped';
        }
        killed = true;
        try {
          await this.docker.containerKill(id);
          this.emit('sandbox_killed', runId, stageIdx);
        } catch (e) {
          this.log(`kill failed: ${errMsg(e)}`);
        }
        const settled = await Promise.race([waitP, this.clock.sleep(KILL_SETTLE_MS).then((): Outcome => ({ k: 'cap' }))]);
        if (settled.k === 'exit') exitCode = settled.code;
      }
      waitCtl.abort();

      // --- exit handling (any reason): OOM, summary, logs
      let inspect: ContainerInspect | null = null;
      try {
        inspect = await this.docker.containerInspect(id);
      } catch (e) {
        this.log(`inspect failed: ${errMsg(e)}`);
      }
      if (exitCode === undefined) exitCode = inspect?.State.ExitCode;
      const oomKilled = inspect?.State.OOMKilled === true || (!killed && exitCode === 137);
      if (oomKilled) {
        this.emit('memory_cap_hit', runId, stageIdx);
        reason ??= 'memory cap hit';
      }

      let summaryJson: string | undefined;
      let summaryProblem: string | undefined;
      try {
        const text = await this.fs.readTextCapped(posix.join(outDir, 'summary.json'), SUMMARY_MAX_BYTES);
        if (text !== null) summaryJson = text;
      } catch (e) {
        summaryProblem = `summary unreadable: ${errMsg(e)}`;
      }

      if (reason === undefined && exitCode !== 0) reason = `k6 exited with code ${exitCode ?? 'unknown'}`;
      if (reason === undefined && spec.kind === 'stage' && summaryJson === undefined) {
        reason = summaryProblem ?? 'k6 produced no summary';
      }

      let logs: StageRunResult['logs'];
      if (spec.kind === 'probe' || reason !== undefined) {
        try {
          const l = await this.docker.containerLogs(id);
          logs = spec.kind === 'probe' ? l : { stdout: tail(l.stdout), stderr: tail(l.stderr) };
        } catch (e) {
          this.log(`logs unavailable: ${errMsg(e)}`);
        }
      }

      await this.pollDenials(runId);

      const result: StageRunResult = { status: reason === undefined ? 'done' : 'error', oomKilled, killed };
      if (reason !== undefined) result.reason = reason;
      if (summaryJson !== undefined) result.summaryJson = summaryJson;
      if (logs !== undefined) result.logs = logs;
      return await finish(result);
    } catch (e) {
      return await finish(fail(`Sandbox run failed: ${errMsg(e)}`));
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
      waitCtl.abort();
      capCtl.abort();
    }
  }

  // ----- denial log tail ---------------------------------------------------

  private async denialLoop(state: RunState): Promise<void> {
    const { signal } = state.stop;
    while (!signal.aborted) {
      await this.clock.sleep(this.denialPollMs, signal);
      if (signal.aborted) break;
      await this.pollDenials(state.net.runId);
    }
  }

  /** Reads new complete lines from the Run's denials.jsonl and emits "egress blocked" events. */
  pollDenials(runId: string): Promise<void> {
    const state = this.runs.get(runId);
    if (state === undefined) return Promise.resolve();
    state.chain = state.chain.then(() => this.pollOnce(state)).catch((e: unknown) => {
      this.log(`denial poll failed: ${errMsg(e)}`);
    });
    return state.chain;
  }

  private async pollOnce(state: RunState): Promise<void> {
    const path = posix.join(state.proxyDir, 'denials.jsonl');
    for (let round = 0; round < DENIAL_READ_ROUNDS; round++) {
      const bytes = await this.fs.readFrom(path, state.offset, DENIAL_READ_CHUNK);
      if (bytes === null || bytes.length === 0) return;
      const lastNewline = bytes.lastIndexOf(10);
      let consumed: number;
      if (lastNewline >= 0) consumed = lastNewline + 1;
      else if (bytes.length >= DENIAL_READ_CHUNK) consumed = bytes.length; // oversized line: drop it
      else return; // partial line; wait for the rest
      const text = new TextDecoder().decode(bytes.subarray(0, consumed));
      state.offset += consumed;
      for (const line of text.split('\n')) {
        if (line === '') continue;
        const parsed = parseDenialLine(line);
        if (parsed === null) continue;
        if (state.emitted >= MAX_EGRESS_EVENTS_PER_RUN) continue;
        state.emitted++;
        this.emit('egress_blocked', state.net.runId, state.stageIdx, parsed);
      }
      if (bytes.length < DENIAL_READ_CHUNK) return;
    }
  }

  // ----- Docker helpers ----------------------------------------------------

  private async removeContainer(id: string): Promise<void> {
    try {
      await this.docker.containerRemove(id, { force: true });
    } catch (e) {
      this.log(`container remove failed: ${errMsg(e)}`);
    }
  }

  /** True only after `containerInspect` returns null (404). Re-issues the remove while waiting. */
  private async confirmGone(id: string): Promise<boolean> {
    for (let i = 0; i < REMOVE_POLLS; i++) {
      let info: ContainerInspect | null | undefined;
      try {
        info = await this.docker.containerInspect(id);
      } catch {
        info = undefined;
      }
      if (info === null) return true;
      if (i > 0 && i % 5 === 0) await this.removeContainer(id);
      await this.clock.sleep(REMOVE_POLL_MS);
    }
    return false;
  }

  private async removeNetworkWithRetries(idOrName: string, errors: string[]): Promise<boolean> {
    let lastError = '';
    for (let attempt = 1; attempt <= NETWORK_REMOVE_ATTEMPTS; attempt++) {
      try {
        await this.docker.networkRemove(idOrName);
        return true;
      } catch (e) {
        lastError = errMsg(e);
        if (attempt < NETWORK_REMOVE_ATTEMPTS) await this.clock.sleep(NETWORK_REMOVE_BACKOFF_MS);
      }
    }
    errors.push(`network remove: ${lastError}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// StageExecutor implementation
// ---------------------------------------------------------------------------

/**
 * Docker-backed executor. `run` opens the Run's network on first use (so a
 * network/proxy failure becomes an `error` Stage result, Requirement 6.16).
 * The Run_Controller must call `closeRun` when the Run ends for any reason.
 */
export class DockerStageExecutor implements StageExecutor {
  private readonly nets = new Map<string, Promise<RunNet>>();

  constructor(private readonly runner: SandboxRunner) {}

  openRun(runId: string): Promise<RunNet> {
    let p = this.nets.get(runId);
    if (p === undefined) {
      p = this.runner.openRunNetwork(runId);
      this.nets.set(runId, p);
      p.catch(() => this.nets.delete(runId));
    }
    return p;
  }

  async run(spec: StageSpec, signal: AbortSignal): Promise<StageRunResult> {
    let net: RunNet;
    try {
      net = await this.openRun(spec.runId);
    } catch (e) {
      return { status: 'error', reason: errMsg(e), oomKilled: false, killed: false };
    }
    return this.runner.runSandbox(net, spec, signal);
  }

  closeRun(runId: string): Promise<CloseResult> {
    this.nets.delete(runId);
    return this.runner.closeRunNetwork(runId);
  }
}
