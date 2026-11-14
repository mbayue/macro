// Startup configuration. `parseConfig` is pure; `loadConfigOrExit` is the only
// place that reads `process.env`.

import { isAbsolute, join } from 'node:path';

// Pinned digest of grafana/k6 (k6 v2.3.0, linux/amd64), verified on the macro VM under runsc.
export const K6_IMAGE_DEFAULT = 'grafana/k6@sha256:3e4186aea62e11a45560bfc51e19eeafe82fc07ce069c78aff44b7ff893d9a5e';

export const DEFAULTS = {
  inferenceBaseUrl: 'https://api.vultrinference.com/v1',
  inferenceModel: 'minimax-m3.1-flash',
  inferenceFallbackModel: 'mimo-v2.6-flash',
  targetOrigins: 'https://yue.macro.my.id,https://api.yue.macro.my.id',
  sandboxRuntime: 'runsc',
  macroVmIp: '45.77.37.116',
  port: 3000,
  dataDir: '/var/lib/macro',
} as const;

export type SandboxRuntime = 'runsc' | 'runc';

export interface Config {
  readonly inference: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly model: string;
    readonly fallbackModel: string;
  };
  readonly turnstile: {
    readonly secretKey: string;
    readonly siteKey: string;
  };
  readonly target: {
    /** First TARGET_ORIGINS entry (web role). */
    readonly webOrigin: string;
    /** Second TARGET_ORIGINS entry (api role). */
    readonly apiOrigin: string;
    /** [webOrigin, apiOrigin] */
    readonly allowlist: readonly string[];
  };
  readonly sandbox: {
    /** Selected runtime when valid, otherwise `runsc`. */
    readonly runtime: SandboxRuntime;
    /** Set when SANDBOX_RUNTIME is invalid; every Run start must be refused with it (Req 6.13). */
    readonly runtimeError?: string;
    readonly k6Image: string;
  };
  readonly macroVmIp: string;
  readonly port: number;
  readonly dataDir: string;
  /**
   * `DOCKER_HOST`: `tcp://host[:port]` on the VM deploy, where the API reaches
   * Docker through the least-privilege socket proxy (compose wires it), or
   * `pipe://<pipe path>` for Windows local dev. Unset means the local unix
   * socket (/var/run/docker.sock).
   */
  readonly dockerHost?: string;
  /**
   * `TIGERDATA_URL`: postgres:// connection string of the Tiger Cloud service
   * (trial now, always-free tier later). Present = the best-effort mirror of
   * public-run stage samples runs; omitted = the mirror is disabled.
   */
  readonly tigerDataUrl?: string;
  /** Requirement 17 only. Key omitted when unset. */
  readonly vultrApiKey?: string;
  /**
   * Present only when every auth env var is set. Omitted means auth routes stay disabled
   * (local demo without accounts still works).
   */
  readonly auth?: {
    readonly sessionSecret: string;
    readonly publicBaseUrl: string;
    readonly resendApiKey: string;
    readonly resendFrom: string;
    readonly githubClientId: string;
    readonly githubClientSecret: string;
    readonly githubRedirectUri: string;
  };
  readonly domainConnect?: {
    readonly keyId: string;
    readonly privateKey: string;
  };
}

export interface ConfigError {
  setting: string;
  reason: string;
}

export type ConfigResult =
  | { ok: true; config: Config }
  | { ok: false; errors: ConfigError[] };

type Env = Record<string, string | undefined>;

/** Trimmed value; whitespace-only or missing = undefined. */
function read(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v === undefined || v === '' ? undefined : v;
}

const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const ORIGIN_RE = new RegExp(`^https://(${HOST_LABEL}(?:\\.${HOST_LABEL})*)(?::(\\d{1,5}))?$`, 'i');

/** Normalised (lowercased) `https://host[:port]` origin, or undefined if the value is not one. */
export function parseHttpsOrigin(value: string): string | undefined {
  const m = ORIGIN_RE.exec(value);
  if (!m) return undefined;
  const port = m[2];
  if (port !== undefined) {
    const n = Number(port);
    if (n < 1 || n > 65535) return undefined;
  }
  return value.toLowerCase();
}

function parseTargetOrigins(raw: string): readonly [string, string] | undefined {
  const parts = raw.split(',').map((p) => p.trim());
  if (parts.length !== 2) return undefined;
  const web = parseHttpsOrigin(parts[0] ?? '');
  const api = parseHttpsOrigin(parts[1] ?? '');
  if (web === undefined || api === undefined) return undefined;
  return [web, api];
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}

export function parseConfig(env: Env): ConfigResult {
  const errors: ConfigError[] = [];
  const fail = (setting: string, reason: string): void => {
    errors.push({ setting, reason });
  };

  // Required secrets. VULTR_INFERENCE_API_KEY wins over the AI_API_KEY alias.
  const apiKey = read(env, 'VULTR_INFERENCE_API_KEY') ?? read(env, 'AI_API_KEY');
  if (apiKey === undefined) fail('VULTR_INFERENCE_API_KEY', 'is required and must not be empty (alias: AI_API_KEY)');
  const turnstileSecret = read(env, 'TURNSTILE_SECRET_KEY');
  if (turnstileSecret === undefined) fail('TURNSTILE_SECRET_KEY', 'is required and must not be empty');
  const turnstileSite = read(env, 'TURNSTILE_SITE_KEY');
  if (turnstileSite === undefined) fail('TURNSTILE_SITE_KEY', 'is required and must not be empty');

  // Inference
  const baseUrl = read(env, 'VULTR_INFERENCE_BASE_URL') ?? DEFAULTS.inferenceBaseUrl;
  if (!isHttpUrl(baseUrl)) fail('VULTR_INFERENCE_BASE_URL', 'must be an http(s) URL');
  const model = read(env, 'VULTR_INFERENCE_MODEL') ?? DEFAULTS.inferenceModel;
  const fallbackModel = read(env, 'VULTR_INFERENCE_FALLBACK_MODEL') ?? DEFAULTS.inferenceFallbackModel;

  // Target origins
  const origins = parseTargetOrigins(read(env, 'TARGET_ORIGINS') ?? DEFAULTS.targetOrigins);
  if (origins === undefined) {
    fail(
      'TARGET_ORIGINS',
      'must be exactly two comma-separated origins of the form https://host[:port] with no path, query, or credentials',
    );
  }

  // Sandbox
  const runtimeRaw = read(env, 'SANDBOX_RUNTIME') ?? DEFAULTS.sandboxRuntime;
  let runtime: SandboxRuntime = 'runsc';
  let runtimeError: string | undefined;
  if (runtimeRaw === 'runsc' || runtimeRaw === 'runc') {
    runtime = runtimeRaw;
  } else {
    runtimeError = `SANDBOX_RUNTIME has invalid value ${JSON.stringify(runtimeRaw)}; expected "runsc" or "runc"`;
  }
  const k6Image = read(env, 'K6_IMAGE') ?? K6_IMAGE_DEFAULT;
  if (!k6Image.includes('@sha256:')) fail('K6_IMAGE', 'must be pinned by digest (must contain "@sha256:")');

  // Server
  const macroVmIp = read(env, 'MACRO_VM_IP') ?? DEFAULTS.macroVmIp;
  const dataDir = read(env, 'DATA_DIR') ?? DEFAULTS.dataDir;
  const portRaw = read(env, 'PORT');
  let port: number = DEFAULTS.port;
  if (portRaw !== undefined) {
    const n = /^\d+$/.test(portRaw) ? Number(portRaw) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= 65535) port = n;
    else fail('PORT', 'must be an integer from 1 to 65535');
  }

  const vultrApiKey = read(env, 'VULTR_API_KEY');

  // Docker endpoint: unset = the local unix socket. tcp:// targets the
  // least-privilege socket proxy (the compose deploy sets it); pipe:// names a
  // Windows named pipe, so `bun run dev` reaches Docker Desktop on a dev box.
  const dockerHostRaw = read(env, 'DOCKER_HOST');
  let dockerHost: string | undefined;
  if (dockerHostRaw !== undefined) {
    const tcp = /^tcp:\/\/([a-z0-9](?:[a-z0-9._-]*[a-z0-9]))(?::(\d{1,5}))?$/i.exec(dockerHostRaw);
    const pipe = /^pipe:\/\/(.{1,256})$/i.exec(dockerHostRaw);
    const port = tcp?.[2];
    if (tcp !== null) {
      if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) {
        fail('DOCKER_HOST', 'must be tcp://host[:port] when set (for example tcp://socket-proxy:2375)');
      } else {
        dockerHost = dockerHostRaw.toLowerCase();
      }
    } else if (pipe !== null) {
      dockerHost = dockerHostRaw;
    } else {
      fail('DOCKER_HOST', 'must be tcp://host[:port] or pipe://<pipe path> when set');
    }
  }

  // TigerData mirror: postgres:// connection string, stored as written. Unset
  // (or empty) disables the mirror; a malformed value fails by name.
  const tigerDataUrlRaw = read(env, 'TIGERDATA_URL');
  let tigerDataUrl: string | undefined;
  if (tigerDataUrlRaw !== undefined) {
    if (/^postgres(?:ql)?:\/\/\S{1,500}$/i.test(tigerDataUrlRaw)) {
      tigerDataUrl = tigerDataUrlRaw;
    } else {
      fail('TIGERDATA_URL', 'must be a postgres:// or postgresql:// URL when set');
    }
  }

  // Auth: all-or-nothing. Any one set requires every auth setting.
  const AUTH_KEYS = [
    'SESSION_SECRET',
    'PUBLIC_BASE_URL',
    'RESEND_API_KEY',
    'RESEND_FROM',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GITHUB_REDIRECT_URI',
  ] as const;
  const authValues = Object.fromEntries(AUTH_KEYS.map((k) => [k, read(env, k)])) as Record<
    (typeof AUTH_KEYS)[number],
    string | undefined
  >;
  const authPresent = AUTH_KEYS.filter((k) => authValues[k] !== undefined);
  const authMissing = AUTH_KEYS.filter((k) => authValues[k] === undefined);
  let auth: Config['auth'] | undefined;
  if (authPresent.length > 0 && authMissing.length > 0) {
    for (const setting of authMissing) {
      fail(setting, 'is required when any auth setting is set (all-or-nothing)');
    }
  } else if (authPresent.length === AUTH_KEYS.length) {
    const publicBaseUrl = authValues.PUBLIC_BASE_URL as string;
    if (!isHttpUrl(publicBaseUrl)) fail('PUBLIC_BASE_URL', 'must be an http(s) URL');
    const githubRedirectUri = authValues.GITHUB_REDIRECT_URI as string;
    if (!isHttpUrl(githubRedirectUri)) fail('GITHUB_REDIRECT_URI', 'must be an http(s) URL');
    auth = {
      sessionSecret: authValues.SESSION_SECRET as string,
      publicBaseUrl,
      resendApiKey: authValues.RESEND_API_KEY as string,
      resendFrom: authValues.RESEND_FROM as string,
      githubClientId: authValues.GITHUB_CLIENT_ID as string,
      githubClientSecret: authValues.GITHUB_CLIENT_SECRET as string,
      githubRedirectUri,
    };
  }

  if (
    errors.length > 0 ||
    apiKey === undefined ||
    turnstileSecret === undefined ||
    turnstileSite === undefined ||
    origins === undefined
  ) {
    return { ok: false, errors };
  }

  const domainConnectPrivateKey = read(env, 'DOMAIN_CONNECT_PRIVATE_KEY');
  const domainConnectKeyId = read(env, 'DOMAIN_CONNECT_KEY_ID') ?? 'p1';
  const domainConnect =
    domainConnectPrivateKey !== undefined
      ? { keyId: domainConnectKeyId, privateKey: domainConnectPrivateKey }
      : undefined;

  const config: Config = {
    inference: { apiKey, baseUrl, model, fallbackModel },
    turnstile: { secretKey: turnstileSecret, siteKey: turnstileSite },
    target: { webOrigin: origins[0], apiOrigin: origins[1], allowlist: [origins[0], origins[1]] },
    sandbox: {
      runtime,
      ...(runtimeError !== undefined ? { runtimeError } : {}),
      k6Image,
    },
    macroVmIp,
    port,
    dataDir,
    ...(dockerHost !== undefined ? { dockerHost } : {}),
    ...(tigerDataUrl !== undefined ? { tigerDataUrl } : {}),
    ...(vultrApiKey !== undefined ? { vultrApiKey } : {}),
    ...(auth !== undefined ? { auth } : {}),
    ...(domainConnect !== undefined ? { domainConnect } : {}),
  };
  return { ok: true, config: deepFreeze(config) };
}

/** Loggable copy: the three secret keys are replaced by '[set]' / '[unset]'. */
export function redactedConfig(config: Config): unknown {
  const mark = (v: string | undefined): '[set]' | '[unset]' => (v === undefined || v === '' ? '[unset]' : '[set]');
  return {
    ...config,
    inference: { ...config.inference, apiKey: mark(config.inference.apiKey) },
    turnstile: { ...config.turnstile, secretKey: mark(config.turnstile.secretKey) },
    // The URL itself carries credentials (user:password@host), so only its
    // presence is loggable.
    tigerDataUrl: mark(config.tigerDataUrl),
    vultrApiKey: mark(config.vultrApiKey),
    ...(config.auth !== undefined
      ? {
          auth: {
            ...config.auth,
            sessionSecret: mark(config.auth.sessionSecret),
            resendApiKey: mark(config.auth.resendApiKey),
            githubClientSecret: mark(config.auth.githubClientSecret),
          },
        }
      : {}),
    ...(config.domainConnect !== undefined
      ? {
          domainConnect: {
            keyId: config.domainConnect.keyId,
            privateKey: mark(config.domainConnect.privateKey),
          },
        }
      : {}),
  };
}

/**
 * Docker bind mounts use host paths, so a relative DATA_DIR cannot work; resolve
 * one against `cwd` (the compose deploy's /var/lib/macro is already absolute).
 */
export function absoluteDataDir(dataDir: string, cwd: string = process.cwd()): string {
  return isAbsolute(dataDir) ? dataDir : join(cwd, dataDir);
}

/** Reads `process.env` once. On any error prints each (naming the setting, never a secret value) and exits 1. */
export function loadConfigOrExit(): Config {
  const result = parseConfig(process.env);
  if (result.ok) return { ...result.config, dataDir: absoluteDataDir(result.config.dataDir) };
  for (const e of result.errors) {
    console.error(`config error: ${e.setting} ${e.reason}`);
  }
  process.exit(1);
}
