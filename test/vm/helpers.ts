/**
 * Real-Docker integration helpers for `test/vm` (`bun run test:vm`).
 *
 * These tests talk to a REAL Docker daemon and run REAL containers. Nothing here
 * touches Docker as part of plain `bun test`: the suite is gated on
 * MACRO_VM_TEST=1, which `bun run test:vm` sets for the run.
 *
 * Transport: the production DockerClient speaks HTTP over `/var/run/docker.sock`
 * (Bun's `unix` fetch extension). On Windows there is no unix socket — Docker
 * Desktop exposes the same API on the named pipe `\\.\pipe\docker_engine`, which
 * Bun's `unix` option cannot open; `pipeFetch` in `src/sandbox/docker.ts`
 * carries a node:http transport for that pipe and is used here too.
 *
 * Safety: every container and network these tests create is labelled `macro=1`,
 * and the suite refuses to start when `macro=1` resources already exist —
 * `cleanupAll` would sweep a live Macro deployment otherwise.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { K6_IMAGE_DEFAULT, parseConfig } from '../../src/config.ts';
import type { Config } from '../../src/config.ts';
import { DockerClient, pipeFetch } from '../../src/sandbox/docker.ts';
import type { DockerFetch, DockerInfo, DockerRequestInit } from '../../src/sandbox/docker.ts';
import { SandboxRunner } from '../../src/sandbox/runner.ts';
import type { ContainmentEvent } from '../../src/sandbox/runner.ts';
import type { SandboxRuntime } from '../../src/types.ts';

export const PROXY_IMAGE = 'macro-proxy:latest';
const REPO_ROOT = join(import.meta.dir, '..', '..');
const PIPE_PATH = '\\\\.\\pipe\\docker_engine';
const DAEMON_INFO_TIMEOUT_MS = 5_000;

// ------------------------------------------------------------------ probing

export interface DockerProbe {
  docker: DockerClient;
  info: DockerInfo;
  transport: 'unix' | 'pipe';
  runtime: SandboxRuntime;
}

/** Talks to the local Docker daemon once and reports the usable transport and runtime. */
export async function probeDocker(): Promise<DockerProbe | null> {
  const candidates: { transport: 'unix' | 'pipe'; fetch: DockerFetch }[] =
    process.platform === 'win32'
      ? [{ transport: 'pipe', fetch: pipeFetch(PIPE_PATH) }]
      : [{ transport: 'unix', fetch: (url, init) => fetch(url, { ...init, unix: '/var/run/docker.sock', timeout: false } as DockerRequestInit) }];
  for (const candidate of candidates) {
    try {
      const res = await candidate.fetch('http://docker/v1.47/info', { signal: AbortSignal.timeout(DAEMON_INFO_TIMEOUT_MS) });
      if (!res.ok) continue;
      const info = (await res.json()) as DockerInfo;
      const runtime: SandboxRuntime = Object.hasOwn(info.Runtimes ?? {}, 'runsc') ? 'runsc' : 'runc';
      return { docker: new DockerClient(candidate.fetch), info, transport: candidate.transport, runtime };
    } catch {
      continue;
    }
  }
  return null;
}

// ------------------------------------------------------------------ images

function spawn(cmd: readonly string[]): { ok: boolean; tail: string } {
  const r = Bun.spawnSync([...cmd], { cwd: REPO_ROOT, stdout: 'ignore', stderr: 'pipe' });
  return {
    ok: r.exitCode === 0,
    tail: r.stderr === null ? '' : r.stderr.toString().slice(-500),
  };
}

/**
 * Builds the Egress_Proxy image and pulls the pinned k6 image when missing.
 * Network operations; run once per suite invocation.
 */
export async function ensureImages(docker: DockerClient): Promise<{ ok: boolean; reason?: string }> {
  if ((await docker.imageInspect(K6_IMAGE_DEFAULT)) === null) {
    const pulled = spawn(['docker', 'pull', K6_IMAGE_DEFAULT]);
    if (!pulled.ok) return { ok: false, reason: `docker pull of the k6 image failed: ${pulled.tail}` };
  }
  if ((await docker.imageInspect(PROXY_IMAGE)) === null) {
    const built = spawn(['docker', 'build', '-q', '-t', PROXY_IMAGE, '-f', 'proxy/Dockerfile', '.']);
    if (!built.ok) return { ok: false, reason: `docker build of the egress proxy image failed: ${built.tail}` };
  }
  return { ok: true };
}

// ------------------------------------------------------------------- config

/** A real Config whose dataDir is a fresh temp directory (forward slashes so Docker binds accept it). */
export async function vmConfig(runtime: SandboxRuntime): Promise<Config> {
  const raw = await mkdtemp(join(tmpdir(), 'macro-vm-test-'));
  const dataDir = raw.replaceAll('\\', '/');
  const result = parseConfig({
    VULTR_INFERENCE_API_KEY: 'vm-test-inference-key',
    TURNSTILE_SECRET_KEY: 'vm-test-turnstile-secret',
    TURNSTILE_SITE_KEY: 'vm-test-site-key',
    SANDBOX_RUNTIME: runtime,
    DATA_DIR: dataDir,
  });
  if (!result.ok) throw new Error(`vm test config invalid: ${JSON.stringify(result.errors)}`);
  return result.config;
}

export function removeConfigDir(config: Config): Promise<void> {
  return rm(config.dataDir, { recursive: true, force: true }).then(
    () => undefined,
    () => undefined,
  );
}

// -------------------------------------------------------------------- runner

export interface VmTestRunnerOptions {
  docker: DockerClient;
  config: Config;
  emit?: (event: ContainmentEvent) => void;
}

/** A SandboxRunner over the real daemon with a quiet log. */
export function makeRunner(options: VmTestRunnerOptions): SandboxRunner {
  return new SandboxRunner({
    docker: options.docker,
    config: options.config,
    emit: (e) => options.emit?.(e),
    log: () => {},
  });
}

export function newRunId(prefix: string): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${prefix}-${Date.now().toString(36)}-${suffix}`.slice(0, 64);
}
