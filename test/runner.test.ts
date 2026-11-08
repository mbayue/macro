import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { K6_IMAGE_DEFAULT, parseConfig } from '../src/config.ts';
import type { Config } from '../src/config.ts';
import type {
  ContainerCreateBody,
  ContainerCreateResult,
  ContainerInspect,
  ContainerListItem,
  ContainerWaitResult,
  DemuxedLogs,
  DockerInfo,
  ImageInspect,
  NetworkCreateParams,
  NetworkListItem,
} from '../src/sandbox/docker.ts';
import {
  buildProxyCreateBody,
  buildSandboxCreateBody,
  DockerStageExecutor,
  EGRESS_NETWORK,
  PROXY_IMAGE,
  RunNetworkError,
  SandboxRefusedError,
  SandboxRunner,
  timeCapSec,
} from '../src/sandbox/runner.ts';
import type {
  Clock,
  ContainmentEvent,
  DockerApi,
  RunnerFs,
  RunNet,
  StageRunResult,
  StageSpec,
} from '../src/sandbox/runner.ts';

// ---------------------------------------------------------------------------
// Fakes: virtual clock, in-memory filesystem, Docker API
// ---------------------------------------------------------------------------

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

class FakeClock implements Clock {
  t = 1_000_000;
  private timers: { at: number; resolve: () => void }[] = [];

  now(): number {
    return this.t;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const timer = { at: this.t + ms, resolve };
      this.timers.push(timer);
      signal?.addEventListener(
        'abort',
        () => {
          this.timers = this.timers.filter((x) => x !== timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  async flush(): Promise<void> {
    for (let i = 0; i < 6; i++) await tick();
  }

  private pop(limit: number): boolean {
    let best: { at: number; resolve: () => void } | undefined;
    for (const x of this.timers) if (x.at <= limit && (best === undefined || x.at < best.at)) best = x;
    if (best === undefined) return false;
    this.timers = this.timers.filter((x) => x !== best);
    this.t = Math.max(this.t, best.at);
    best.resolve();
    return true;
  }

  /** Move virtual time forward by `ms`, firing due timers in order. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    await this.flush();
    while (this.pop(target)) await this.flush();
    this.t = target;
    await this.flush();
  }

  /** Run virtual time forward until `p` settles. */
  async drive<T>(p: Promise<T>): Promise<T> {
    let settled = false;
    p.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    for (let guard = 0; guard < 50_000; guard++) {
      await this.flush();
      if (settled) return p;
      if (!this.pop(Number.POSITIVE_INFINITY)) {
        await this.flush();
        if (settled) return p;
        throw new Error('deadlock: promise pending and no timers');
      }
    }
    throw new Error('drive: too many steps');
  }
}

class FakeFs implements RunnerFs {
  files = new Map<string, { data: string; mode: number }>();
  dirs = new Map<string, number>();
  mkdirs: [string, number][] = [];
  writes: { path: string; data: string; mode: number }[] = [];
  removed: string[] = [];
  chmods: [string, number][] = [];
  chowns: [string, number, number][] = [];
  canChown = true;
  failMkdir = false;

  async mkdir(path: string, mode: number): Promise<void> {
    if (this.failMkdir) throw new Error('disk full');
    this.dirs.set(path, mode);
    this.mkdirs.push([path, mode]);
  }
  async chmod(path: string, mode: number): Promise<void> {
    this.chmods.push([path, mode]);
  }
  async chownBestEffort(path: string, uid: number, gid: number): Promise<boolean> {
    this.chowns.push([path, uid, gid]);
    return this.canChown;
  }
  async writeFile(path: string, data: string, mode: number): Promise<void> {
    this.writes.push({ path, data, mode });
    this.files.set(path, { data, mode });
  }
  async readTextCapped(path: string, maxBytes: number): Promise<string | null> {
    const f = this.files.get(path);
    if (f === undefined) return null;
    if (f.data.length > maxBytes) throw new Error(`file is larger than ${maxBytes} bytes`);
    return f.data;
  }
  async readFrom(path: string, offset: number, maxBytes: number): Promise<Uint8Array | null> {
    const f = this.files.get(path);
    if (f === undefined) return null;
    return new TextEncoder().encode(f.data).subarray(offset, offset + maxBytes);
  }
  async rm(path: string): Promise<void> {
    this.removed.push(path);
    for (const key of [...this.files.keys()]) if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    for (const key of [...this.dirs.keys()]) if (key === path || key.startsWith(`${path}/`)) this.dirs.delete(key);
  }
}

interface FakeContainer {
  id: string;
  name: string;
  body: ContainerCreateBody;
  running: boolean;
  exitCode: number | undefined;
  oom: boolean;
  removed: boolean;
  inspectsLeft: number;
  waiters: { resolve: (r: ContainerWaitResult) => void; reject: (e: Error) => void }[];
}

interface Scenario {
  exitCode: number;
  oom: boolean;
  neverExits: boolean;
  logs: DemuxedLogs;
  onStart?: (c: FakeContainer) => void;
}

type FailOp =
  | 'info'
  | 'networkCreate'
  | 'networkConnect'
  | 'containerCreate'
  | 'containerStart'
  | 'containerRemove'
  | 'containerKill';

class FakeDocker implements DockerApi {
  calls: { op: string; args: unknown[] }[] = [];
  containers = new Map<string, FakeContainer>();
  networks = new Map<string, { Id: string; Name: string; Labels: Record<string, string> }>();
  runtimes: Record<string, unknown> = { runc: {}, runsc: {} };
  scenario: Scenario = { exitCode: 0, oom: false, neverExits: false, logs: { stdout: '', stderr: '' } };
  /** After a remove, inspect keeps returning the container this many times before returning null. */
  inspectsBeforeGone = 0;
  neverGone = false;
  networkRemoveFailures = 0;
  /** Fail the Nth-and-later calls of an operation (match on name for create). */
  failOps = new Map<FailOp, (args: unknown[]) => Error | undefined>();
  private seq = 0;

  constructor(private readonly timeline: string[]) {}

  private rec(op: string, ...args: unknown[]): void {
    this.calls.push({ op, args });
    this.timeline.push(`docker:${op}${typeof args[0] === 'string' ? `:${args[0]}` : ''}`);
  }
  private maybeFail(op: FailOp, args: unknown[]): void {
    const err = this.failOps.get(op)?.(args);
    if (err) throw err;
  }
  count(op: string): number {
    return this.calls.filter((c) => c.op === op).length;
  }
  callsOf(op: string): unknown[][] {
    return this.calls.filter((c) => c.op === op).map((c) => c.args);
  }
  byName(prefix: string): FakeContainer | undefined {
    return [...this.containers.values()].find((c) => c.name.startsWith(prefix));
  }

  async info(): Promise<DockerInfo> {
    this.rec('info');
    this.maybeFail('info', []);
    return { Runtimes: this.runtimes };
  }
  async networkCreate(p: NetworkCreateParams): Promise<{ Id: string }> {
    this.rec('networkCreate', p);
    this.maybeFail('networkCreate', [p]);
    const Id = `net-${++this.seq}`;
    this.networks.set(Id, { Id, Name: p.name, Labels: p.labels });
    return { Id };
  }
  async networkConnect(networkId: string, containerId: string): Promise<void> {
    this.rec('networkConnect', networkId, containerId);
    this.maybeFail('networkConnect', [networkId, containerId]);
  }
  async networkRemove(id: string): Promise<boolean> {
    this.rec('networkRemove', id);
    if (this.networkRemoveFailures > 0) {
      this.networkRemoveFailures--;
      throw new Error('network has active endpoints');
    }
    for (const [key, n] of this.networks) if (key === id || n.Name === id) this.networks.delete(key);
    return true;
  }
  async containerCreate(name: string, body: ContainerCreateBody): Promise<ContainerCreateResult> {
    this.rec('containerCreate', name, body);
    this.maybeFail('containerCreate', [name, body]);
    const id = `cid-${++this.seq}-${name}`;
    this.containers.set(id, {
      id,
      name,
      body,
      running: false,
      exitCode: undefined,
      oom: false,
      removed: false,
      inspectsLeft: 0,
      waiters: [],
    });
    return { Id: id, Warnings: [] };
  }
  private exit(c: FakeContainer, code: number, oom: boolean): void {
    c.running = false;
    c.exitCode = code;
    c.oom = oom;
    for (const w of c.waiters.splice(0)) w.resolve({ StatusCode: code });
  }
  async containerStart(id: string): Promise<void> {
    this.rec('containerStart', id);
    this.maybeFail('containerStart', [id]);
    const c = this.containers.get(id);
    if (c === undefined) throw new Error('no such container');
    c.running = true;
    if (c.name.startsWith('macro-proxy-')) return;
    this.scenario.onStart?.(c);
    if (!this.scenario.neverExits) this.exit(c, this.scenario.exitCode, this.scenario.oom);
  }
  containerWait(id: string, signal?: AbortSignal): Promise<ContainerWaitResult> {
    this.rec('containerWait', id);
    const c = this.containers.get(id);
    if (c === undefined) return Promise.reject(new Error('no such container'));
    if (!c.running && c.exitCode !== undefined) return Promise.resolve({ StatusCode: c.exitCode });
    return new Promise<ContainerWaitResult>((resolve, reject) => {
      const waiter = { resolve, reject };
      c.waiters.push(waiter);
      signal?.addEventListener(
        'abort',
        () => {
          c.waiters = c.waiters.filter((w) => w !== waiter);
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
  }
  async containerKill(id: string): Promise<boolean> {
    this.rec('containerKill', id);
    this.maybeFail('containerKill', [id]);
    const c = this.containers.get(id);
    if (c === undefined || !c.running) return false;
    this.exit(c, 137, false);
    return true;
  }
  private inspectOf(c: FakeContainer): ContainerInspect {
    const networkName = c.body.HostConfig?.NetworkMode ?? '';
    return {
      Id: c.id,
      State: {
        Status: c.running ? 'running' : 'exited',
        Running: c.running,
        OOMKilled: c.oom,
        ExitCode: c.exitCode ?? 0,
      },
      HostConfig: c.body.HostConfig ?? {},
      NetworkSettings: { Networks: { [networkName]: { IPAddress: '10.99.0.2' } } },
    };
  }
  async containerInspect(id: string): Promise<ContainerInspect | null> {
    this.calls.push({ op: 'containerInspect', args: [id] });
    const c = this.containers.get(id);
    if (c === undefined) {
      this.timeline.push(`docker:inspect-null:${id}`);
      return null;
    }
    if (c.removed && !this.neverGone) {
      if (c.inspectsLeft > 0) {
        c.inspectsLeft--;
        return this.inspectOf(c);
      }
      this.containers.delete(id);
      this.timeline.push(`docker:inspect-null:${id}`);
      return null;
    }
    return this.inspectOf(c);
  }
  async containerRemove(id: string, opts: { force: boolean }): Promise<boolean> {
    this.rec('containerRemove', id, opts);
    this.maybeFail('containerRemove', [id, opts]);
    const c = this.containers.get(id);
    if (c === undefined) return false;
    c.removed = true;
    c.running = false;
    c.inspectsLeft = this.inspectsBeforeGone;
    return true;
  }
  async containerLogs(id: string): Promise<DemuxedLogs> {
    this.calls.push({ op: 'containerLogs', args: [id] });
    const c = this.containers.get(id);
    if (c?.name.startsWith('macro-proxy-')) return { stdout: 'egress proxy listening on :3128\n', stderr: '' };
    return this.scenario.logs;
  }
  listByLabel(kind: 'containers', label: string): Promise<ContainerListItem[]>;
  listByLabel(kind: 'networks', label: string): Promise<NetworkListItem[]>;
  async listByLabel(
    kind: 'containers' | 'networks',
    label: string,
  ): Promise<ContainerListItem[] | NetworkListItem[]> {
    this.rec('listByLabel', kind, label);
    const [key = '', value] = label.split('=');
    const matches = (labels: Record<string, string>): boolean =>
      Object.hasOwn(labels, key) && (value === undefined || labels[key] === value);
    if (kind === 'containers') {
      return [...this.containers.values()]
        .filter((c) => !c.removed && matches(c.body.Labels ?? {}))
        .map((c) => ({
          Id: c.id,
          Names: [`/${c.name}`],
          State: c.running ? 'running' : 'exited',
          Labels: c.body.Labels ?? {},
        }));
    }
    return [...this.networks.values()].filter((n) => matches(n.Labels));
  }
  async imageInspect(ref: string): Promise<ImageInspect | null> {
    this.rec('imageInspect', ref);
    return { Id: 'sha256:fake' };
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const SECRET_KEY = 'vultr-inference-SECRET-0123456789';
const TURNSTILE_SECRET = 'turnstile-SECRET-abcdef';

function makeConfig(extra: Record<string, string> = {}): Config {
  const result = parseConfig({
    VULTR_INFERENCE_API_KEY: SECRET_KEY,
    TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
    TURNSTILE_SITE_KEY: 'site-key',
    DATA_DIR: '/data',
    ...extra,
  });
  if (!result.ok) throw new Error(`bad test config: ${JSON.stringify(result.errors)}`);
  return result.config;
}

interface Harness {
  clock: FakeClock;
  fs: FakeFs;
  docker: FakeDocker;
  events: ContainmentEvent[];
  timeline: string[];
  runner: SandboxRunner;
  config: Config;
  logs: string[];
}

function harness(extraEnv: Record<string, string> = {}, configure?: (h: Harness) => void): Harness {
  const config = makeConfig(extraEnv);
  const timeline: string[] = [];
  const clock = new FakeClock();
  const fs = new FakeFs();
  const docker = new FakeDocker(timeline);
  const events: ContainmentEvent[] = [];
  const logs: string[] = [];
  const runner = new SandboxRunner({
    docker,
    config,
    clock,
    fs,
    denialPollMs: 0,
    emit: (e) => {
      events.push(e);
      timeline.push(`event:${e.type}`);
    },
    log: (m) => logs.push(m),
  });
  const h: Harness = { clock, fs, docker, events, timeline, runner, config, logs };
  configure?.(h);
  return h;
}

const RUN_ID = 'run-abc123';
const NET_NAME = `macro-run-${RUN_ID}`;
const RUN_DIR = `/data/runs/${RUN_ID}`;

function spec(over: Partial<StageSpec> = {}): StageSpec {
  return { runId: RUN_ID, stageIdx: 2, script: '// fixed test script', durationSec: 30, kind: 'stage', ...over };
}

const stageDirOf = (runId: string, idx: number): string => `/data/runs/${runId}/stage-${idx}`;

async function openNet(h: Harness, runId = RUN_ID): Promise<RunNet> {
  return h.clock.drive(h.runner.openRunNetwork(runId));
}

function putSummary(h: Harness, runId: string, idx: number, text: string): void {
  h.fs.files.set(`${stageDirOf(runId, idx)}/out/summary.json`, { data: text, mode: 0o600 });
}

const types = (h: Harness): string[] => h.events.map((e) => e.type);

async function runStage(h: Harness, s: StageSpec = spec(), signal?: AbortSignal): Promise<StageRunResult> {
  const net = await openNet(h, s.runId);
  return h.clock.drive(h.runner.runSandbox(net, s, signal ?? new AbortController().signal));
}

function sandboxCreateBody(h: Harness): ContainerCreateBody {
  const call = h.docker.callsOf('containerCreate').find((a) => String(a[0]).startsWith('macro-sbx-'));
  if (call === undefined) throw new Error('no Sandbox was created');
  return call[1] as ContainerCreateBody;
}

// ---------------------------------------------------------------------------
// Hardening: exact create bodies (Requirements 6.2, 6.3, 6.4, 6.5, 6.12)
// ---------------------------------------------------------------------------

describe('Sandbox create body', () => {
  test('HostConfig carries exactly the hardening fields (6.3, 6.5, 6.12) with the pinned image and labels (6.2)', async () => {
    const h = harness();
    h.docker.scenario.exitCode = 0;
    const net = await openNet(h);
    h.docker.scenario.onStart = () => putSummary(h, RUN_ID, 2, '{}');
    await h.clock.drive(h.runner.runSandbox(net, spec(), new AbortController().signal));

    const call = h.docker.callsOf('containerCreate').find((a) => a[0] === `macro-sbx-${RUN_ID}-2`);
    expect(call).toBeDefined();
    const { Env: _env, ...body } = call?.[1] as ContainerCreateBody;
    const stageDir = stageDirOf(RUN_ID, 2);
    expect(body).toEqual({
      Image: K6_IMAGE_DEFAULT,
      User: '65534:65534',
      Cmd: ['run', '--no-usage-report', '--quiet', '/scripts/stage.js'],
      Labels: { macro: '1', 'macro.run': RUN_ID, 'macro.stage': '2' },
      HostConfig: {
        Runtime: 'runsc',
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        PidsLimit: 256,
        Memory: 1073741824,
        MemorySwap: 1073741824,
        NanoCpus: 1_000_000_000,
        NetworkMode: NET_NAME,
        Binds: [`${stageDir}/stage.js:/scripts/stage.js:ro`, `${stageDir}/out:/out:rw`],
        Tmpfs: { '/tmp': 'size=16m' },
        AutoRemove: false,
      },
    });
  });

  test('image is pinned by digest and the Sandbox is never privileged, on the host network, or given the Docker socket (6.2, 6.3)', async () => {
    const h = harness();
    await runStage(h);
    const body = sandboxCreateBody(h);
    expect(body.Image).toContain('@sha256:');
    expect(body.Image).toBe(h.config.sandbox.k6Image);
    const uid = Number(body.User?.split(':')[0]);
    expect(Number.isInteger(uid)).toBe(true);
    expect(uid).not.toBe(0);
    const host = body.HostConfig as Record<string, unknown>;
    expect(Object.keys(host).sort()).toEqual(
      [
        'AutoRemove', 'Binds', 'CapDrop', 'Memory', 'MemorySwap', 'NanoCpus', 'NetworkMode',
        'PidsLimit', 'ReadonlyRootfs', 'Runtime', 'SecurityOpt', 'Tmpfs',
      ].sort(),
    );
    expect(host['Privileged']).toBeUndefined();
    expect(host['CapAdd']).toBeUndefined();
    expect(host['PidMode']).toBeUndefined();
    expect(host['PortBindings']).toBeUndefined();
    expect(host['NetworkMode']).not.toBe('host');
    expect(host['MemorySwap']).toBe(host['Memory']); // no swap
    const binds = host['Binds'] as string[];
    expect(binds.length).toBe(2);
    expect(binds.some((b) => b.includes('docker.sock'))).toBe(false);
    expect(binds[0]?.endsWith(':ro')).toBe(true);
    expect(binds[1]?.endsWith(':/out:rw')).toBe(true);
    // The script path in Cmd is the read-only bind target.
    const scriptTarget = binds[0]?.split(':')[1];
    expect(body.Cmd?.at(-1)).toBe(scriptTarget);
  });

  test('Env holds only the Egress_Proxy address (6.4): HTTPS_PROXY and HTTP_PROXY, nothing else', async () => {
    const h = harness();
    await runStage(h);
    const body = sandboxCreateBody(h);
    expect(body.Env).toEqual(['HTTPS_PROXY=http://10.99.0.2:3128', 'HTTP_PROXY=http://10.99.0.2:3128']);
  });

  test('no Macro secret reaches any create body (6.4)', async () => {
    const h = harness();
    await runStage(h);
    for (const [, args] of h.docker.calls.entries()) {
      const text = JSON.stringify(args);
      expect(text).not.toContain(SECRET_KEY);
      expect(text).not.toContain(TURNSTILE_SECRET);
    }
  });

  test.each(['runsc', 'runc'] as const)('runtime comes from config: %s (6.12)', async (runtime) => {
    const h = harness({ SANDBOX_RUNTIME: runtime });
    await runStage(h);
    expect(sandboxCreateBody(h).HostConfig?.Runtime).toBe(runtime);
  });

  test('runtime defaults to runsc when SANDBOX_RUNTIME is unset (6.12)', async () => {
    const h = harness();
    await runStage(h);
    expect(sandboxCreateBody(h).HostConfig?.Runtime).toBe('runsc');
  });

  test('builder output depends only on its typed inputs', () => {
    const a = buildSandboxCreateBody({
      image: K6_IMAGE_DEFAULT,
      runtime: 'runc',
      runId: 'r1',
      stageIdx: 7,
      networkName: 'macro-run-r1',
      proxyUrl: 'http://10.0.0.9:3128',
      scriptPath: '/d/runs/r1/stage-7/stage.js',
      outDir: '/d/runs/r1/stage-7/out',
    });
    expect(a.HostConfig?.Runtime).toBe('runc');
    expect(a.Labels).toEqual({ macro: '1', 'macro.run': 'r1', 'macro.stage': '7' });
    expect(a.Env).toContain('HTTPS_PROXY=http://10.0.0.9:3128');
    expect(a.Env).toContain('HTTP_PROXY=http://10.0.0.9:3128');
  });

  test('stage files: script written read-only, output directory restricted, both removed afterwards (6.9)', async () => {
    const h = harness();
    h.docker.scenario.onStart = () => putSummary(h, RUN_ID, 2, '{"ok":true}');
    const result = await runStage(h);
    const stageDir = stageDirOf(RUN_ID, 2);
    expect(h.fs.writes).toEqual([{ path: `${stageDir}/stage.js`, data: '// fixed test script', mode: 0o444 }]);
    expect(h.fs.mkdirs).toContainEqual([`${stageDir}/out`, 0o700]);
    expect(h.fs.chowns.some(([p, uid]) => p === `${stageDir}/out` && uid === 65534)).toBe(true);
    expect(h.fs.removed).toContain(stageDir);
    expect(result).toMatchObject({ status: 'done', summaryJson: '{"ok":true}', oomKilled: false, killed: false });
  });

  test('when the output directory cannot be chowned it is made writable instead', async () => {
    const h = harness();
    h.fs.canChown = false;
    await runStage(h);
    expect(h.fs.chmods).toContainEqual([`${stageDirOf(RUN_ID, 2)}/out`, 0o777]);
  });
});

describe('Egress_Proxy create body and Run network (6.5, 6.15)', () => {
  test('open creates an internal labelled network, then the proxy on it, attached to macro-egress', async () => {
    const h = harness();
    const net = await openNet(h);
    const [netCall] = h.docker.callsOf('networkCreate');
    expect(netCall?.[0]).toEqual({ name: NET_NAME, internal: true, labels: { macro: '1', 'macro.run': RUN_ID } });

    const proxyCall = h.docker.callsOf('containerCreate').find((a) => a[0] === `macro-proxy-${RUN_ID}`);
    expect(proxyCall).toBeDefined();
    expect(proxyCall?.[1]).toEqual(
      buildProxyCreateBody({
        runId: RUN_ID,
        networkName: NET_NAME,
        proxyDir: `${RUN_DIR}/proxy`,
        allowHosts: ['yue.macro.my.id', 'api.yue.macro.my.id'],
        blockIps: ['45.77.37.116'],
      }),
    );
    const body = proxyCall?.[1] as ContainerCreateBody;
    expect(body.Image).toBe(PROXY_IMAGE);
    expect(body.HostConfig).toMatchObject({
      Runtime: 'runc',
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      Memory: 128 * 1024 * 1024,
      NetworkMode: NET_NAME,
    });
    expect(body.Env).toContain('ALLOW_HOSTS=yue.macro.my.id,api.yue.macro.my.id');
    expect(body.Env).toContain('BLOCK_IPS=45.77.37.116');
    expect(body.Labels).toMatchObject({ macro: '1', 'macro.run': RUN_ID });

    const proxyId = net.proxyContainerId;
    expect(h.docker.callsOf('networkConnect')).toEqual([[EGRESS_NETWORK, proxyId]]);
    const order = h.timeline.filter((t) => /^docker:(networkCreate|containerCreate|networkConnect|containerStart)/.test(t));
    expect(order.map((t) => t.split(':')[1])).toEqual(['networkCreate', 'containerCreate', 'networkConnect', 'containerStart']);

    expect(net).toMatchObject({
      runId: RUN_ID,
      networkName: NET_NAME,
      proxyIp: '10.99.0.2',
      proxyUrl: 'http://10.99.0.2:3128',
      runDir: RUN_DIR,
    });
    expect(h.fs.dirs.get(`${RUN_DIR}/proxy`)).toBe(0o700);
  });

  test.each(['', 'a b', '../x', 'x/y', '-lead', 'a'.repeat(65), 'run;rm -rf /', 'run\n1', '日本'])(
    'invalid Run ID %p is rejected before any Docker call',
    async (bad) => {
      const h = harness();
      await expect(h.runner.openRunNetwork(bad)).rejects.toThrow('invalid Run ID');
      expect(h.docker.calls.length).toBe(0);
      expect(h.fs.dirs.size).toBe(0);
    },
  );

  test('opening a Run network twice is refused', async () => {
    const h = harness();
    await openNet(h);
    await expect(h.clock.drive(h.runner.openRunNetwork(RUN_ID))).rejects.toBeInstanceOf(RunNetworkError);
    expect(h.docker.count('networkCreate')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Time cap, OOM, removal (6.7, 6.8, 6.9)
// ---------------------------------------------------------------------------

describe('time cap (6.7, 12.8)', () => {
  test('a Stage still running at duration + 30 s is killed; events are created, time cap hit, killed, removed', async () => {
    const h = harness();
    h.docker.scenario.neverExits = true;
    const net = await openNet(h);
    const p = h.runner.runSandbox(net, spec({ durationSec: 45 }), new AbortController().signal);

    await h.clock.advance(74_999);
    expect(types(h)).toEqual(['sandbox_created']);
    expect(h.docker.count('containerKill')).toBe(0);

    await h.clock.advance(1);
    const result = await h.clock.drive(p);
    expect(types(h)).toEqual(['sandbox_created', 'time_cap_hit', 'sandbox_killed', 'sandbox_removed']);
    expect(result).toMatchObject({ status: 'error', reason: 'time cap hit', killed: true, oomKilled: false });
    expect(h.events.every((e) => e.runId === RUN_ID && e.stageIdx === 2)).toBe(true);
  });

  test('the probe cap is 60 s regardless of its nominal duration', async () => {
    const h = harness();
    h.docker.scenario.neverExits = true;
    h.docker.scenario.logs = { stdout: 'MACRO_PROBE {"action":"e","outcome":"started"}\n', stderr: '' };
    const net = await openNet(h);
    const p = h.runner.runSandbox(net, spec({ kind: 'probe', stageIdx: 1, durationSec: 1 }), new AbortController().signal);
    await h.clock.advance(59_999);
    expect(h.docker.count('containerKill')).toBe(0);
    await h.clock.advance(1);
    const result = await h.clock.drive(p);
    expect(types(h)).toEqual(['sandbox_created', 'time_cap_hit', 'sandbox_killed', 'sandbox_removed']);
    expect(result.killed).toBe(true);
    expect(result.logs?.stdout).toContain('MACRO_PROBE');
  });

  test('timeCapSec is duration + 30 for a Stage and 60 for the probe', () => {
    expect(timeCapSec({ kind: 'stage', durationSec: 30 })).toBe(60);
    expect(timeCapSec({ kind: 'stage', durationSec: 180 })).toBe(210);
    expect(timeCapSec({ kind: 'probe', durationSec: 1 })).toBe(60);
  });

  test('a stop request kills the Sandbox without a time cap event', async () => {
    const h = harness();
    h.docker.scenario.neverExits = true;
    const net = await openNet(h);
    const stop = new AbortController();
    const p = h.runner.runSandbox(net, spec(), stop.signal);
    await h.clock.advance(5_000);
    stop.abort();
    const result = await h.clock.drive(p);
    expect(types(h)).toEqual(['sandbox_created', 'sandbox_killed', 'sandbox_removed']);
    expect(result).toMatchObject({ status: 'error', reason: 'stopped', killed: true });
  });
});

describe('memory cap (6.8)', () => {
  test('Docker OOMKilled gives a memory cap hit event and an error Stage', async () => {
    const h = harness();
    h.docker.scenario = { ...h.docker.scenario, exitCode: 137, oom: true };
    const result = await runStage(h);
    expect(types(h)).toEqual(['sandbox_created', 'memory_cap_hit', 'sandbox_removed']);
    expect(result).toMatchObject({ status: 'error', reason: 'memory cap hit', oomKilled: true, killed: false });
  });

  test('exit code 137 without a Macro kill counts as a memory cap hit even if OOMKilled is false', async () => {
    const h = harness();
    h.docker.scenario = { ...h.docker.scenario, exitCode: 137, oom: false };
    const result = await runStage(h);
    expect(types(h)).toEqual(['sandbox_created', 'memory_cap_hit', 'sandbox_removed']);
    expect(result.oomKilled).toBe(true);
    expect(result.status).toBe('error');
  });

  test('exit code 137 caused by a Macro kill is not reported as a memory cap hit', async () => {
    const h = harness();
    h.docker.scenario.neverExits = true;
    const net = await openNet(h);
    const p = h.runner.runSandbox(net, spec({ durationSec: 30 }), new AbortController().signal);
    await h.clock.advance(60_000);
    const result = await h.clock.drive(p);
    expect(types(h)).not.toContain('memory_cap_hit');
    expect(result.oomKilled).toBe(false);
  });

  test('a clean exit with a summary is done, with no containment event besides created and removed', async () => {
    const h = harness();
    h.docker.scenario.onStart = () => putSummary(h, RUN_ID, 2, '{"metrics":{}}');
    const result = await runStage(h);
    expect(types(h)).toEqual(['sandbox_created', 'sandbox_removed']);
    expect(result).toEqual({ status: 'done', summaryJson: '{"metrics":{}}', oomKilled: false, killed: false });
  });

  test('a non-zero exit or a missing summary is an error Stage with a reason', async () => {
    const failing = harness();
    failing.docker.scenario = { ...failing.docker.scenario, exitCode: 1 };
    const r1 = await runStage(failing);
    expect(r1).toMatchObject({ status: 'error', reason: 'k6 exited with code 1' });

    const noSummary = harness();
    const r2 = await runStage(noSummary);
    expect(r2).toMatchObject({ status: 'error', reason: 'k6 produced no summary' });
    expect(r2.summaryJson).toBeUndefined();
  });
});

describe('Sandbox removed only after Docker reports it gone (6.9)', () => {
  test('the event comes after remove and after the inspect that returned 404', async () => {
    const h = harness();
    h.docker.inspectsBeforeGone = 3; // the container lingers for three more inspects
    await runStage(h);
    const sbx = [...h.timeline].find((t) => t.startsWith('docker:containerRemove:') && t.includes('macro-sbx-'));
    expect(sbx).toBeDefined();
    const id = String(sbx?.slice('docker:containerRemove:'.length));
    const removeAt = h.timeline.indexOf(sbx ?? '');
    const nullAt = h.timeline.indexOf(`docker:inspect-null:${id}`);
    const eventAt = h.timeline.indexOf('event:sandbox_removed');
    expect(removeAt).toBeGreaterThanOrEqual(0);
    expect(nullAt).toBeGreaterThan(removeAt);
    expect(eventAt).toBeGreaterThan(nullAt);
    // No "removed" event appears before the 404.
    expect(h.timeline.slice(0, nullAt)).not.toContain('event:sandbox_removed');
  });

  test('a container that never disappears yields an error and no Sandbox removed event', async () => {
    const h = harness();
    h.docker.neverGone = true;
    const result = await runStage(h);
    expect(result.status).toBe('error');
    expect(result.reason).toContain('could not be removed');
    expect(types(h)).not.toContain('sandbox_removed');
    expect(h.docker.count('containerRemove')).toBeGreaterThan(1); // the remove is re-issued while waiting
  });

  test('the Sandbox is removed after every kind of exit', async () => {
    for (const scenario of [
      { exitCode: 0, oom: false },
      { exitCode: 1, oom: false },
      { exitCode: 137, oom: true },
    ]) {
      const h = harness();
      h.docker.scenario = { ...h.docker.scenario, ...scenario };
      await runStage(h);
      expect(types(h).at(-1)).toBe('sandbox_removed');
      expect(h.docker.byName('macro-sbx-')).toBeUndefined();
      expect(h.fs.removed).toContain(stageDirOf(RUN_ID, 2));
    }
  });
});

// ---------------------------------------------------------------------------
// Create-failure cleanup (6.16)
// ---------------------------------------------------------------------------

describe('create-failure cleanup (6.16)', () => {
  test('Sandbox create failure starts no k6 process, records no events, and removes the stage directory', async () => {
    const h = harness();
    const net = await openNet(h);
    h.docker.failOps.set('containerCreate', (a) =>
      String(a[0]).startsWith('macro-sbx-') ? new Error('no such image') : undefined,
    );
    const result = await h.clock.drive(h.runner.runSandbox(net, spec(), new AbortController().signal));
    expect(result.status).toBe('error');
    expect(result.reason).toContain('cannot create Sandbox');
    expect(h.docker.callsOf('containerStart').every((a) => !String(a[0]).includes('macro-sbx-'))).toBe(true);
    expect(h.events).toEqual([]);
    expect(h.fs.removed).toContain(stageDirOf(RUN_ID, 2));
    expect(h.docker.byName('macro-sbx-')).toBeUndefined();
  });

  test('Sandbox start failure removes the created container and confirms it gone before the removed event', async () => {
    const h = harness();
    const net = await openNet(h);
    h.docker.failOps.set('containerStart', (a) => (String(a[0]).includes('macro-sbx-') ? new Error('runsc failed') : undefined));
    h.docker.inspectsBeforeGone = 2;
    const result = await h.clock.drive(h.runner.runSandbox(net, spec(), new AbortController().signal));
    expect(result.reason).toContain('cannot start Sandbox');
    expect(h.docker.count('containerWait')).toBe(0);
    expect(types(h)).toEqual(['sandbox_created', 'sandbox_removed']);
    expect(h.docker.byName('macro-sbx-')).toBeUndefined();
    expect(h.timeline.indexOf('event:sandbox_removed')).toBeGreaterThan(
      h.timeline.findIndex((t) => t.startsWith('docker:inspect-null:') && t.includes('macro-sbx-')),
    );
  });

  test('a filesystem failure before create starts no container', async () => {
    const h = harness();
    const net = await openNet(h);
    h.fs.failMkdir = true;
    const result = await h.clock.drive(h.runner.runSandbox(net, spec(), new AbortController().signal));
    expect(result.status).toBe('error');
    expect(h.docker.callsOf('containerCreate').filter((a) => String(a[0]).startsWith('macro-sbx-'))).toEqual([]);
  });

  test('Run network create failure removes nothing it did not create and throws RunNetworkError', async () => {
    const h = harness();
    h.docker.failOps.set('networkCreate', () => new Error('address pool exhausted'));
    await expect(h.clock.drive(h.runner.openRunNetwork(RUN_ID))).rejects.toBeInstanceOf(RunNetworkError);
    expect(h.docker.count('containerCreate')).toBe(0);
    expect(h.docker.count('networkRemove')).toBe(0);
    expect(h.fs.removed).toContain(RUN_DIR);
  });

  test('proxy create failure removes the Run network and directory', async () => {
    const h = harness();
    h.docker.failOps.set('containerCreate', () => new Error('image macro-proxy not found'));
    await expect(h.clock.drive(h.runner.openRunNetwork(RUN_ID))).rejects.toThrow('cannot create Run network or Egress_Proxy');
    expect(h.docker.callsOf('networkRemove')).toEqual([[NET_NAME]]);
    expect(h.docker.networks.size).toBe(0);
    expect(h.fs.removed).toContain(RUN_DIR);
    expect(h.docker.count('containerStart')).toBe(0);
  });

  test('proxy start failure removes the proxy container (confirmed gone) and the network', async () => {
    const h = harness();
    h.docker.failOps.set('containerStart', () => new Error('proxy cannot start'));
    await expect(h.clock.drive(h.runner.openRunNetwork(RUN_ID))).rejects.toBeInstanceOf(RunNetworkError);
    expect(h.docker.byName('macro-proxy-')).toBeUndefined();
    expect(h.docker.networks.size).toBe(0);
    expect(types(h)).toEqual([]); // no Sandbox was involved
    // The proxy was removed before the network.
    const removeProxyAt = h.timeline.findIndex((t) => t.startsWith('docker:containerRemove:'));
    const removeNetAt = h.timeline.findIndex((t) => t.startsWith('docker:networkRemove:'));
    expect(removeProxyAt).toBeGreaterThanOrEqual(0);
    expect(removeNetAt).toBeGreaterThan(removeProxyAt);
  });

  test('a network that cannot be removed is reported in the error', async () => {
    const h = harness();
    h.docker.failOps.set('containerCreate', () => new Error('boom'));
    h.docker.networkRemoveFailures = 99;
    await expect(h.clock.drive(h.runner.openRunNetwork(RUN_ID))).rejects.toThrow('network not removed');
    expect(h.docker.count('networkRemove')).toBe(3);
  });

  test('the executor turns a Run network failure into an error Stage and creates no Sandbox', async () => {
    const h = harness();
    h.docker.failOps.set('networkCreate', () => new Error('no address pool'));
    const executor = new DockerStageExecutor(h.runner);
    const result = await h.clock.drive(executor.run(spec(), new AbortController().signal));
    expect(result.status).toBe('error');
    expect(result.reason).toContain('cannot create Run network');
    expect(h.docker.byName('macro-sbx-')).toBeUndefined();
    expect(h.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Run close and startup sweep (6.10, 6.11)
// ---------------------------------------------------------------------------

describe('closeRunNetwork (6.10)', () => {
  test('removes every container labelled with the Run, the network, and the Run directory', async () => {
    const h = harness();
    await openNet(h);
    // A leftover Sandbox from an aborted Stage.
    await h.docker.containerCreate('macro-sbx-run-abc123-3', {
      Image: 'x',
      Labels: { macro: '1', 'macro.run': RUN_ID, 'macro.stage': '3' },
    });
    // Another Run's container must be left alone.
    await h.docker.containerCreate('macro-sbx-other-1', { Image: 'x', Labels: { macro: '1', 'macro.run': 'other', 'macro.stage': '1' } });

    const result = await h.clock.drive(h.runner.closeRunNetwork(RUN_ID));
    expect(result).toEqual({ ok: true, errors: [] });
    expect(h.docker.byName('macro-proxy-')).toBeUndefined();
    expect(h.docker.byName('macro-sbx-run-abc123')).toBeUndefined();
    expect(h.docker.byName('macro-sbx-other')).toBeDefined();
    expect(h.docker.networks.size).toBe(0);
    expect(h.fs.removed).toContain(RUN_DIR);
    expect(h.events).toEqual([{ type: 'sandbox_removed', runId: RUN_ID, stageIdx: 3 }]);
  });

  test('network removal is retried up to three times', async () => {
    const ok = harness();
    await openNet(ok);
    ok.docker.networkRemoveFailures = 2;
    expect(await ok.clock.drive(ok.runner.closeRunNetwork(RUN_ID))).toEqual({ ok: true, errors: [] });
    expect(ok.docker.count('networkRemove')).toBe(3);

    const bad = harness();
    await openNet(bad);
    bad.docker.networkRemoveFailures = 99;
    const r = await bad.clock.drive(bad.runner.closeRunNetwork(RUN_ID));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('network not removed');
    expect(bad.docker.count('networkRemove')).toBe(3);
  });

  test('a Run network can be opened again after it is closed', async () => {
    const h = harness();
    await openNet(h);
    await h.clock.drive(h.runner.closeRunNetwork(RUN_ID));
    await expect(openNet(h)).resolves.toMatchObject({ runId: RUN_ID });
  });

  test('an invalid Run ID is refused without touching Docker', async () => {
    const h = harness();
    const r = await h.runner.closeRunNetwork('../etc');
    expect(r.ok).toBe(false);
    expect(h.docker.calls.length).toBe(0);
  });
});

describe('startup sweep (6.11)', () => {
  async function seeded(): Promise<Harness> {
    const h = harness();
    await h.docker.networkCreate({ name: EGRESS_NETWORK, internal: false, labels: { 'macro.infra': 'egress' } });
    await h.docker.networkCreate({ name: 'macro-run-old1', internal: true, labels: { macro: '1', 'macro.run': 'old1' } });
    await h.docker.networkCreate({ name: 'macro-run-old2', internal: true, labels: { macro: '1', 'macro.run': 'old2' } });
    await h.docker.networkCreate({ name: 'someone-elses', internal: false, labels: {} });
    await h.docker.containerCreate('macro-proxy-old1', { Image: 'p', Labels: { macro: '1', 'macro.run': 'old1', 'macro.role': 'proxy' } });
    await h.docker.containerCreate('macro-sbx-old1-1', { Image: 'k', Labels: { macro: '1', 'macro.run': 'old1', 'macro.stage': '1' } });
    await h.docker.containerCreate('macro-sbx-old2-4', { Image: 'k', Labels: { macro: '1', 'macro.run': 'old2', 'macro.stage': '4' } });
    await h.docker.containerCreate('unrelated', { Image: 'nginx', Labels: { app: 'web' } });
    h.docker.calls.length = 0;
    h.timeline.length = 0;
    return h;
  }

  test('removes every macro=1 container and network and the runs directory, and nothing else', async () => {
    const h = await seeded();
    const result = await h.clock.drive(h.runner.cleanupAll());
    expect(result).toEqual({ containers: 3, networks: 2, errors: [] });
    expect(h.docker.callsOf('listByLabel')).toEqual([
      ['containers', 'macro=1'],
      ['networks', 'macro=1'],
    ]);
    expect(h.docker.callsOf('containerRemove').every((a) => (a[1] as { force: boolean }).force === true)).toBe(true);
    expect(h.docker.byName('unrelated')).toBeDefined();
    expect([...h.docker.networks.values()].map((n) => n.Name).sort()).toEqual([EGRESS_NETWORK, 'someone-elses'].sort());
    expect(h.fs.removed).toContain('/data/runs');
  });

  test('a container that cannot be removed is reported and not counted', async () => {
    const h = await seeded();
    h.docker.neverGone = true;
    const result = await h.clock.drive(h.runner.cleanupAll());
    expect(result.containers).toBe(0);
    expect(result.errors.some((e) => e.includes('not removed'))).toBe(true);
  });

  test('a network that cannot be removed after three attempts is reported', async () => {
    const h = await seeded();
    h.docker.networkRemoveFailures = 99;
    const result = await h.clock.drive(h.runner.cleanupAll());
    expect(result.networks).toBe(0);
    expect(result.errors.filter((e) => e.startsWith('network remove')).length).toBe(2);
    expect(h.docker.count('networkRemove')).toBe(6);
  });

  test('a Docker listing failure becomes an error instead of a throw', async () => {
    const h = await seeded();
    const original = h.docker.listByLabel.bind(h.docker) as FakeDocker['listByLabel'];
    h.docker.listByLabel = (async () => {
      throw new Error('docker unreachable');
    }) as FakeDocker['listByLabel'];
    const result = await h.clock.drive(h.runner.cleanupAll());
    expect(result.errors.join(' ')).toContain('docker unreachable');
    h.docker.listByLabel = original;
  });
});

// ---------------------------------------------------------------------------
// Runtime refusal (6.13)
// ---------------------------------------------------------------------------

describe('runtime refusal (6.13)', () => {
  test('an invalid SANDBOX_RUNTIME refuses every Run open, naming the value, and creates nothing', () => {
    // Feature: macro, 4.9 unit: runtime refusal for any invalid SANDBOX_RUNTIME value
    return fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 20 })
          .filter((s) => s.trim() !== '' && s.trim() !== 'runsc' && s.trim() !== 'runc'),
        async (value) => {
          const h = harness({ SANDBOX_RUNTIME: value });
          const error = await h.runner.openRunNetwork(RUN_ID).catch((e: unknown) => e);
          expect(error).toBeInstanceOf(SandboxRefusedError);
          expect((error as Error).message).toContain(JSON.stringify(value.trim()));
          await expect(h.runner.assertRuntimeUsable()).rejects.toBeInstanceOf(SandboxRefusedError);
          expect(h.docker.count('networkCreate')).toBe(0);
          expect(h.docker.count('containerCreate')).toBe(0);
          expect(h.fs.dirs.size).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('runsc not registered with Docker refuses with the explicit runc hint and creates nothing', async () => {
    const h = harness();
    h.docker.runtimes = { runc: {} };
    const error = await h.runner.openRunNetwork(RUN_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SandboxRefusedError);
    expect((error as Error).message).toContain('gVisor');
    expect((error as Error).message).toContain('SANDBOX_RUNTIME=runc');
    expect(h.docker.count('networkCreate')).toBe(0);
    expect(h.docker.count('containerCreate')).toBe(0);
  });

  test('the executor reports a refusal as an error Stage and creates no Sandbox', async () => {
    const h = harness();
    h.docker.runtimes = {};
    const result = await new DockerStageExecutor(h.runner).run(spec(), new AbortController().signal);
    expect(result.status).toBe('error');
    expect(result.reason).toContain('SANDBOX_RUNTIME=runc');
    expect(h.docker.count('containerCreate')).toBe(0);
  });

  test('runsc registered, or runc set explicitly, is accepted', async () => {
    const withRunsc = harness();
    await expect(withRunsc.runner.assertRuntimeUsable()).resolves.toBeUndefined();
    const explicitRunc = harness({ SANDBOX_RUNTIME: 'runc' });
    explicitRunc.docker.runtimes = {};
    await expect(explicitRunc.runner.assertRuntimeUsable()).resolves.toBeUndefined();
    expect(explicitRunc.docker.count('info')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Egress-blocked events from the proxy denial log (6.6)
// ---------------------------------------------------------------------------

describe('egress blocked events (6.6)', () => {
  test('each denial line becomes an event with the Run ID, current Stage index, host, and port', async () => {
    const h = harness();
    const net = await openNet(h);
    const path = `${net.runDir}/proxy/denials.jsonl`;
    const lines = [
      JSON.stringify({ ts: '2026-11-08T00:00:00Z', host: 'example.com', port: 443, reason: 'host_not_allowed' }),
      'not json',
      JSON.stringify({ port: 80 }),
      JSON.stringify({ ts: 1, host: 'h'.repeat(300), port: 443, reason: 'x' }),
    ];
    h.fs.files.set(path, { data: `${lines.join('\n')}\n{"host":"part`, mode: 0o600 });
    h.docker.scenario.neverExits = true;
    await h.runner.pollDenials(RUN_ID);
    expect(h.events).toEqual([
      { type: 'egress_blocked', runId: RUN_ID, stageIdx: 1, host: 'example.com', port: 443 },
      { type: 'egress_blocked', runId: RUN_ID, stageIdx: 1, host: 'h'.repeat(255), port: 443 },
    ]);

    // The partial line is picked up once it is complete, and old lines are not repeated.
    const prev = h.fs.files.get(path)?.data ?? '';
    h.fs.files.set(path, { data: `${prev}ial.example","port":80}\n`, mode: 0o600 });
    await h.runner.pollDenials(RUN_ID);
    expect(h.events.length).toBe(3);
    expect(h.events[2]).toEqual({ type: 'egress_blocked', runId: RUN_ID, stageIdx: 1, host: 'partial.example', port: 80 });
  });

  test('events carry the index of the Stage being run', async () => {
    const h = harness();
    const net = await openNet(h);
    const path = `${net.runDir}/proxy/denials.jsonl`;
    h.docker.scenario.onStart = () => {
      h.fs.files.set(path, { data: `${JSON.stringify({ host: '169.254.169.254', port: 80 })}\n`, mode: 0o600 });
      putSummary(h, RUN_ID, 5, '{}');
    };
    await h.clock.drive(h.runner.runSandbox(net, spec({ stageIdx: 5 }), new AbortController().signal));
    const blocked = h.events.filter((e) => e.type === 'egress_blocked');
    expect(blocked).toEqual([{ type: 'egress_blocked', runId: RUN_ID, stageIdx: 5, host: '169.254.169.254', port: 80 }]);
    // The denial is recorded before the Sandbox is reported removed.
    expect(types(h).indexOf('egress_blocked')).toBeLessThan(types(h).indexOf('sandbox_removed'));
  });
});
