/**
 * Typed Docker Engine API (v1.47) client over the unix socket.
 *
 * - Transport is injectable (`fetchImpl`) so tests can use a fake.
 * - Methods take typed objects only. Path segments (ids, names) are validated
 *   and query values go through URLSearchParams, so caller text can never alter
 *   the request line.
 */

export const DOCKER_API_VERSION = 'v1.47';
export const DEFAULT_DOCKER_SOCKET = '/var/run/docker.sock';

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type DockerRequestInit = RequestInit & { unix?: string };
export type DockerFetch = (url: string, init?: DockerRequestInit) => Promise<Response>;

/** Default transport: Bun fetch through the Docker unix socket. */
export function socketFetch(socketPath: string = DEFAULT_DOCKER_SOCKET): DockerFetch {
  return (url, init) =>
    // `unix` is a Bun extension. `timeout: false` keeps long `wait` calls open.
    fetch(url, { ...init, unix: socketPath, timeout: false } as RequestInit);
}

export class DockerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`Docker API error ${status}: ${message}`);
    this.name = 'DockerError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DockerInfo {
  Runtimes: Record<string, unknown>;
  DefaultRuntime?: string;
  ServerVersion?: string;
  [key: string]: unknown;
}

export interface NetworkCreateParams {
  name: string;
  internal: boolean;
  labels: Record<string, string>;
}

export interface ContainerHostConfig {
  Runtime?: string;
  ReadonlyRootfs?: boolean;
  CapDrop?: string[];
  SecurityOpt?: string[];
  PidsLimit?: number;
  Memory?: number;
  MemorySwap?: number;
  NanoCpus?: number;
  NetworkMode?: string;
  Binds?: string[];
  Tmpfs?: Record<string, string>;
  AutoRemove?: boolean;
}

export interface EndpointSettings {
  Aliases?: string[];
  IPAddress?: string;
}

export interface NetworkingConfig {
  EndpointsConfig?: Record<string, EndpointSettings>;
}

export interface ContainerCreateBody {
  Image: string;
  Cmd?: string[];
  Env?: string[];
  User?: string;
  Labels?: Record<string, string>;
  HostConfig?: ContainerHostConfig;
  NetworkingConfig?: NetworkingConfig;
}

export interface ContainerCreateResult {
  Id: string;
  Warnings: string[];
}

export interface ContainerWaitResult {
  StatusCode: number;
}

export interface ContainerInspect {
  Id: string;
  Name?: string;
  State: {
    Status: string;
    Running?: boolean;
    OOMKilled: boolean;
    ExitCode: number;
    [key: string]: unknown;
  };
  HostConfig: ContainerHostConfig;
  NetworkSettings?: {
    Networks?: Record<string, { IPAddress?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ContainerListItem {
  Id: string;
  Names: string[];
  Image?: string;
  State: string;
  Status?: string;
  Labels: Record<string, string>;
}

export interface NetworkListItem {
  Id: string;
  Name: string;
  Labels: Record<string, string>;
}

export interface ImageInspect {
  Id: string;
  RepoDigests?: string[];
  [key: string]: unknown;
}

export interface DemuxedLogs {
  stdout: string;
  stderr: string;
}

// ---------------------------------------------------------------------------
// Log demultiplexing (8-byte header: [type,0,0,0,len32be])
// ---------------------------------------------------------------------------

export interface DemuxOptions {
  /** Maximum bytes kept per stream; the rest is dropped. Default: unlimited. */
  maxBytesPerStream?: number;
}

/** Incremental demuxer. Frames may be split across `push` calls at any byte. */
export class DockerLogDemuxer {
  private readonly header = new Uint8Array(8);
  private headerFill = 0;
  private remaining = 0; // payload bytes still expected for the current frame
  private current: 1 | 2 | 0 = 0; // 0 = discard current payload
  private readonly out: { 1: Uint8Array[]; 2: Uint8Array[] } = { 1: [], 2: [] };
  private readonly size = { 1: 0, 2: 0 };
  private readonly cap: number;

  constructor(opts: DemuxOptions = {}) {
    this.cap = opts.maxBytesPerStream ?? Number.POSITIVE_INFINITY;
  }

  push(chunk: Uint8Array): void {
    let i = 0;
    while (i < chunk.length) {
      if (this.remaining === 0) {
        // Fill header.
        const need = 8 - this.headerFill;
        const take = Math.min(need, chunk.length - i);
        this.header.set(chunk.subarray(i, i + take), this.headerFill);
        this.headerFill += take;
        i += take;
        if (this.headerFill < 8) return;
        this.headerFill = 0;
        const type = this.header[0];
        // 0 = stdin (echoed on some setups) is treated as stdout.
        this.current = type === 2 ? 2 : type === 0 || type === 1 ? 1 : 0;
        this.remaining =
          ((this.header[4] ?? 0) * 0x1000000) +
          (((this.header[5] ?? 0) << 16) | ((this.header[6] ?? 0) << 8) | (this.header[7] ?? 0));
        continue; // zero-length frames loop back to the header branch
      }
      const take = Math.min(this.remaining, chunk.length - i);
      if (this.current !== 0) this.keep(this.current, chunk.subarray(i, i + take));
      this.remaining -= take;
      i += take;
    }
  }

  private keep(stream: 1 | 2, bytes: Uint8Array): void {
    const room = this.cap - this.size[stream];
    if (room <= 0) return;
    const slice = bytes.length > room ? bytes.subarray(0, room) : bytes;
    // Copy: the caller's buffer may be reused.
    this.out[stream].push(slice.slice());
    this.size[stream] += slice.length;
  }

  /** Decode everything received so far. A truncated trailing frame keeps its partial payload. */
  finish(): DemuxedLogs {
    return { stdout: decode(this.out[1]), stderr: decode(this.out[2]) };
  }
}

function decode(parts: Uint8Array[]): string {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  return new TextDecoder().decode(all);
}

/** Pure: demultiplex a complete Docker log stream into stdout and stderr. */
export function demuxDockerLogs(bytes: Uint8Array, opts: DemuxOptions = {}): DemuxedLogs {
  const d = new DockerLogDemuxer(opts);
  d.push(bytes);
  return d.finish();
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;
const MAX_LOG_BYTES_PER_STREAM = 1024 * 1024;

function segment(value: string, what: string): string {
  if (!SEGMENT_RE.test(value)) throw new Error(`invalid Docker ${what}: ${JSON.stringify(value)}`);
  return value;
}

/** Image refs may contain `/`, `:` and `@`; encode each path piece but keep `/`. */
function imagePath(ref: string): string {
  if (ref.length === 0 || ref.length > 512 || /[\s?#\\]/.test(ref) || ref.includes('..')) {
    throw new Error(`invalid image reference: ${JSON.stringify(ref)}`);
  }
  return ref.split('/').map(encodeURIComponent).join('/');
}

interface RequestOptions {
  query?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** Statuses (besides 2xx) that are returned instead of thrown. */
  allow?: readonly number[];
}

export class DockerClient {
  private readonly fetchImpl: DockerFetch;

  constructor(fetchImpl?: DockerFetch) {
    this.fetchImpl = fetchImpl ?? socketFetch();
  }

  private async request(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : '';
    const init: DockerRequestInit = { method };
    if (opts.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opts.body);
    }
    if (opts.signal) init.signal = opts.signal;
    const res = await this.fetchImpl(`http://docker/${DOCKER_API_VERSION}${path}${qs}`, init);
    if (res.ok || opts.allow?.includes(res.status)) return res;
    throw new DockerError(res.status, await errorMessage(res));
  }

  private async json<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  async info(): Promise<DockerInfo> {
    const info = await this.json<Partial<DockerInfo>>(await this.request('GET', '/info'));
    return { ...info, Runtimes: info.Runtimes ?? {} };
  }

  async networkCreate(p: NetworkCreateParams): Promise<{ Id: string }> {
    const res = await this.request('POST', '/networks/create', {
      body: { Name: p.name, Driver: 'bridge', Internal: p.internal, Labels: p.labels },
    });
    const out = await this.json<{ Id: string }>(res);
    return { Id: out.Id };
  }

  async networkConnect(networkId: string, containerId: string): Promise<void> {
    const res = await this.request('POST', `/networks/${segment(networkId, 'network id')}/connect`, {
      body: { Container: segment(containerId, 'container id') },
    });
    await res.body?.cancel();
  }

  /** Returns true if removed, false if it was already gone (404). */
  async networkRemove(id: string): Promise<boolean> {
    const res = await this.request('DELETE', `/networks/${segment(id, 'network id')}`, { allow: [404] });
    await res.body?.cancel();
    return res.status !== 404;
  }

  async containerCreate(name: string, body: ContainerCreateBody): Promise<ContainerCreateResult> {
    const res = await this.request('POST', '/containers/create', {
      query: { name: segment(name, 'container name') },
      body,
    });
    const out = await this.json<Partial<ContainerCreateResult> & { Id: string }>(res);
    return { Id: out.Id, Warnings: out.Warnings ?? [] };
  }

  /** 204 started, 304 already started: both succeed. */
  async containerStart(id: string): Promise<void> {
    const res = await this.request('POST', `/containers/${segment(id, 'container id')}/start`, {
      allow: [304],
    });
    await res.body?.cancel();
  }

  async containerWait(id: string, signal?: AbortSignal): Promise<ContainerWaitResult> {
    const res = await this.request('POST', `/containers/${segment(id, 'container id')}/wait`, {
      query: { condition: 'not-running' },
      signal,
    });
    const out = await this.json<ContainerWaitResult>(res);
    return { StatusCode: out.StatusCode };
  }

  /** Returns true if a kill signal was sent; false when the container is gone (404) or not running (409). */
  async containerKill(id: string): Promise<boolean> {
    const res = await this.request('POST', `/containers/${segment(id, 'container id')}/kill`, {
      allow: [404, 409],
    });
    await res.body?.cancel();
    return res.ok;
  }

  /** Returns null when the container does not exist. */
  async containerInspect(id: string): Promise<ContainerInspect | null> {
    const res = await this.request('GET', `/containers/${segment(id, 'container id')}/json`, {
      allow: [404],
    });
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    return this.json<ContainerInspect>(res);
  }

  /** Returns true if removed, false if it was already gone (404). */
  async containerRemove(id: string, opts: { force: boolean }): Promise<boolean> {
    const res = await this.request('DELETE', `/containers/${segment(id, 'container id')}`, {
      query: { force: opts.force ? 'true' : 'false', v: 'true' },
      allow: [404],
    });
    await res.body?.cancel();
    return res.status !== 404;
  }

  async containerLogs(id: string): Promise<DemuxedLogs> {
    const res = await this.request('GET', `/containers/${segment(id, 'container id')}/logs`, {
      query: { stdout: 'true', stderr: 'true', timestamps: 'false' },
    });
    const demux = new DockerLogDemuxer({ maxBytesPerStream: MAX_LOG_BYTES_PER_STREAM });
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        demux.push(value);
      }
    }
    return demux.finish();
  }

  /** Lists by label (`key` or `key=value`). Containers include stopped ones. */
  listByLabel(kind: 'containers', label: string): Promise<ContainerListItem[]>;
  listByLabel(kind: 'networks', label: string): Promise<NetworkListItem[]>;
  async listByLabel(
    kind: 'containers' | 'networks',
    label: string,
  ): Promise<ContainerListItem[] | NetworkListItem[]> {
    const filters = JSON.stringify({ label: [label] });
    if (kind === 'containers') {
      const res = await this.request('GET', '/containers/json', { query: { all: 'true', filters } });
      return (await this.json<ContainerListItem[]>(res)).map((c) => ({ ...c, Labels: c.Labels ?? {} }));
    }
    const res = await this.request('GET', '/networks', { query: { filters } });
    return (await this.json<NetworkListItem[]>(res)).map((n) => ({ ...n, Labels: n.Labels ?? {} }));
  }

  /** Returns null when the image is not present locally. */
  async imageInspect(ref: string): Promise<ImageInspect | null> {
    const res = await this.request('GET', `/images/${imagePath(ref)}/json`, { allow: [404] });
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    return this.json<ImageInspect>(res);
  }
}

async function errorMessage(res: Response): Promise<string> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return res.statusText || 'request failed';
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string') {
      return parsed.message;
    }
  } catch {
    // not JSON
  }
  return text.slice(0, 500) || res.statusText || 'request failed';
}
