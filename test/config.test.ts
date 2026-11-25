import { describe, expect, test } from 'bun:test';
import { isAbsolute } from 'node:path';
import { DEFAULTS, K6_IMAGE_DEFAULT, parseConfig, parseHttpsOrigin, redactedConfig } from '../src/config.ts';
import { absoluteDataDir } from '../src/config.ts';
import type { Config, ConfigResult } from '../src/config.ts';

// Synthetic values only: parseConfig takes an explicit object and never touches process.env.
const SECRET_KEY = 'test-inference-key-1111';
const SECRET_TS = 'test-turnstile-secret-2222';
const SITE = 'test-site-key-3333';
const FB_API_KEY = 'AIzaSyTestKey123';
const FB_APP_ID = '1:565002558232:web:27b0355cf83c682da91c6d';
const FB_PROJECT_ID = 'macro-c80bc';
const BASE: Record<string, string> = {
  INFERENCE_API_KEY: SECRET_KEY,
  INFERENCE_BASE_URL: 'https://api.vultrinference.com/v1',
  INFERENCE_MODEL: 'minimax-m3.1-flash',
  INFERENCE_FALLBACK_MODEL: 'mimo-v2.6-flash',
  TURNSTILE_SECRET_KEY: SECRET_TS,
  TURNSTILE_SITE_KEY: SITE,
  FIREBASE_API_KEY: FB_API_KEY,
  FIREBASE_APP_ID: FB_APP_ID,
  FIREBASE_PROJECT_ID: FB_PROJECT_ID,
};

function env(patch: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...BASE, ...patch };
}

function ok(result: ConfigResult): Config {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.errors)}`);
  return result.config;
}

function settingsOf(result: ConfigResult): string[] {
  if (result.ok) throw new Error('expected errors, got ok');
  return result.errors.map((e) => e.setting);
}

describe('required settings', () => {
  test('a minimal environment yields the documented defaults', () => {
    const c = ok(parseConfig(env()));
    expect(c.inference).toEqual({
      apiKey: SECRET_KEY,
      baseUrl: 'https://api.vultrinference.com/v1',
      model: 'minimax-m3.1-flash',
      fallbackModel: 'mimo-v2.6-flash',
    });
    expect(c.turnstile).toEqual({ secretKey: SECRET_TS, siteKey: SITE });
    expect(c.target.webOrigin).toBe('https://yue.macro.my.id');
    expect(c.target.apiOrigin).toBe('https://api.yue.macro.my.id');
    expect(c.target.allowlist).toEqual(['https://yue.macro.my.id', 'https://api.yue.macro.my.id']);
    expect(c.sandbox.runtime).toBe('runsc');
    expect(c.sandbox.runtimeError).toBeUndefined();
    expect('runtimeError' in c.sandbox).toBe(false);
    expect(c.sandbox.k6Image).toBe(K6_IMAGE_DEFAULT);
    expect(c.macroVmIp).toBe(DEFAULTS.macroVmIp);
    expect(c.port).toBe(3000);
    expect(c.dataDir).toBe(DEFAULTS.dataDir);
    expect(c.firebase).toEqual({
      apiKey: FB_API_KEY,
      appId: FB_APP_ID,
      projectId: FB_PROJECT_ID,
    });
    expect('vultrApiKey' in c).toBe(false);
  });

  test.each([
    'INFERENCE_API_KEY',
    'INFERENCE_BASE_URL',
    'INFERENCE_MODEL',
    'INFERENCE_FALLBACK_MODEL',
    'TURNSTILE_SECRET_KEY',
    'TURNSTILE_SITE_KEY',
    'FIREBASE_API_KEY',
    'FIREBASE_APP_ID',
    'FIREBASE_PROJECT_ID',
  ])('a missing %s is reported by name', (name) => {
    const result = parseConfig(env({ [name]: undefined }));
    expect(settingsOf(result)).toEqual([name]);
  });

  test.each([
    'INFERENCE_API_KEY',
    'INFERENCE_BASE_URL',
    'INFERENCE_MODEL',
    'INFERENCE_FALLBACK_MODEL',
    'TURNSTILE_SECRET_KEY',
    'TURNSTILE_SITE_KEY',
    'FIREBASE_API_KEY',
    'FIREBASE_APP_ID',
    'FIREBASE_PROJECT_ID',
  ])('an empty or whitespace-only %s is reported by name', (name) => {
    expect(settingsOf(parseConfig(env({ [name]: '' })))).toEqual([name]);
    expect(settingsOf(parseConfig(env({ [name]: '   \t ' })))).toEqual([name]);
  });

  test('every missing secret is reported, not only the first', () => {
    expect(settingsOf(parseConfig({})).sort()).toEqual(
      [
        'FIREBASE_API_KEY',
        'FIREBASE_APP_ID',
        'FIREBASE_PROJECT_ID',
        'INFERENCE_API_KEY',
        'INFERENCE_BASE_URL',
        'INFERENCE_FALLBACK_MODEL',
        'INFERENCE_MODEL',
        'TURNSTILE_SECRET_KEY',
        'TURNSTILE_SITE_KEY',
      ].sort(),
    );
  });

  test('secret values never appear in error text', () => {
    const result = parseConfig(env({ K6_IMAGE: 'grafana/k6:latest', TARGET_ORIGINS: 'bad', PORT: 'x', TURNSTILE_SITE_KEY: '' }));
    expect(result.ok).toBe(false);
    const text = JSON.stringify(result);
    for (const secret of [SECRET_KEY, SECRET_TS, FB_API_KEY]) expect(text).not.toContain(secret);
  });

  test('values are trimmed', () => {
    const c = ok(parseConfig(env({ INFERENCE_API_KEY: `  ${SECRET_KEY}\n`, PORT: ' 8080 ' })));
    expect(c.inference.apiKey).toBe(SECRET_KEY);
    expect(c.port).toBe(8080);
  });
});

describe('inference setting aliases', () => {
  test('VULTR_INFERENCE_API_KEY is used when INFERENCE_API_KEY is unset', () => {
    const c = ok(parseConfig(env({ INFERENCE_API_KEY: undefined, VULTR_INFERENCE_API_KEY: 'vultr-key-4444' })));
    expect(c.inference.apiKey).toBe('vultr-key-4444');
  });

  test('AI_API_KEY is used when INFERENCE_API_KEY and VULTR_INFERENCE_API_KEY are unset', () => {
    const c = ok(parseConfig(env({ INFERENCE_API_KEY: undefined, AI_API_KEY: 'alias-key-4444' })));
    expect(c.inference.apiKey).toBe('alias-key-4444');
  });

  test('INFERENCE_API_KEY wins when aliases are also set', () => {
    const c = ok(parseConfig(env({ INFERENCE_API_KEY: SECRET_KEY, VULTR_INFERENCE_API_KEY: 'other', AI_API_KEY: 'alias' })));
    expect(c.inference.apiKey).toBe(SECRET_KEY);
  });

  test('VULTR_INFERENCE_BASE_URL is used when INFERENCE_BASE_URL is unset', () => {
    const c = ok(parseConfig(env({ INFERENCE_BASE_URL: undefined, VULTR_INFERENCE_BASE_URL: 'http://vultr.local/v1' })));
    expect(c.inference.baseUrl).toBe('http://vultr.local/v1');
  });

  test('VULTR_INFERENCE_MODEL and VULTR_INFERENCE_FALLBACK_MODEL are used when INFERENCE_* are unset', () => {
    const c = ok(
      parseConfig(
        env({
          INFERENCE_MODEL: undefined,
          INFERENCE_FALLBACK_MODEL: undefined,
          VULTR_INFERENCE_MODEL: 'vultr-model-1',
          VULTR_INFERENCE_FALLBACK_MODEL: 'vultr-model-2',
        }),
      ),
    );
    expect(c.inference.model).toBe('vultr-model-1');
    expect(c.inference.fallbackModel).toBe('vultr-model-2');
  });

  test('neither set: the error names INFERENCE_API_KEY and mentions aliases', () => {
    const result = parseConfig(env({ INFERENCE_API_KEY: undefined }));
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.setting).toBe('INFERENCE_API_KEY');
    expect(result.errors[0]?.reason).toContain('VULTR_INFERENCE_API_KEY');
    expect(result.errors[0]?.reason).toContain('AI_API_KEY');
  });
});

describe('SANDBOX_RUNTIME', () => {
  test.each(['runsc', 'runc'] as const)('%s is accepted without a runtime error', (runtime) => {
    const c = ok(parseConfig(env({ SANDBOX_RUNTIME: runtime })));
    expect(c.sandbox.runtime).toBe(runtime);
    expect(c.sandbox.runtimeError).toBeUndefined();
  });

  test.each(['kata', 'RUNSC', 'runsc,runc', 'docker', 'default'])('%p sets runtimeError and falls back to runsc', (value) => {
    const c = ok(parseConfig(env({ SANDBOX_RUNTIME: value })));
    expect(c.sandbox.runtime).toBe('runsc');
    expect(c.sandbox.runtimeError).toContain('SANDBOX_RUNTIME');
    expect(c.sandbox.runtimeError).toContain(JSON.stringify(value));
  });

  test('an invalid runtime does not stop startup (the Run start is refused later, Requirement 6.13)', () => {
    expect(parseConfig(env({ SANDBOX_RUNTIME: 'kata' })).ok).toBe(true);
  });

  test('empty SANDBOX_RUNTIME defaults to runsc without runtime error', () => {
    expect(ok(parseConfig(env())).sandbox.runtime).toBe('runsc');
    expect(ok(parseConfig(env({ SANDBOX_RUNTIME: '  ' }))).sandbox.runtime).toBe('runsc');
  });
});

describe('K6_IMAGE', () => {
  test.each([
    'grafana/k6@sha256:3e4186aea62e11a45560bfc51e19eeafe82fc07ce069c78aff44b7ff893d9a5e',
    'my-registry.example.com/k6@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'k6:v1@sha256:baee',
  ])('a pinned digest is accepted: %s', (image) => {
    expect(ok(parseConfig(env({ K6_IMAGE: image }))).sandbox.k6Image).toBe(image);
  });

  test.each(['grafana/k6:latest', 'grafana/k6:v2.3.0', 'grafana/k6', 'sha256:deadbeef']) (
    'an unpinned image is rejected: %p',
    (image) => {
      expect(settingsOf(parseConfig(env({ K6_IMAGE: image })))).toEqual(['K6_IMAGE']);
    },
  );
});

describe('TARGET_ORIGINS', () => {
  test('accepts two origins', () => {
    const c = ok(parseConfig(env({ TARGET_ORIGINS: 'https://web.example.test,https://api.example.test:8443' })));
    expect(c.target.webOrigin).toBe('https://web.example.test');
    expect(c.target.apiOrigin).toBe('https://api.example.test:8443');
    expect(c.target.allowlist).toEqual(['https://web.example.test', 'https://api.example.test:8443']);
  });

  test('normalises lowercase scheme and host, strips default 443 port', () => {
    const c = ok(parseConfig(env({ TARGET_ORIGINS: ' HTTPS://Web.Example.TEST , https://API.example.test ' })));
    expect(c.target.webOrigin).toBe('https://web.example.test');
    expect(c.target.apiOrigin).toBe('https://api.example.test');
  });

  test('parses a single https origin correctly', () => {
    expect(parseHttpsOrigin('https://example.com')).toBe('https://example.com');
    expect(parseHttpsOrigin('HTTPS://EXAMPLE.COM:8443')).toBe('https://example.com:8443');
    expect(parseHttpsOrigin('http://insecure.test')).toBeUndefined();
    expect(parseHttpsOrigin('https://example.com/path')).toBeUndefined();
    expect(parseHttpsOrigin('https://user:pass@example.com')).toBeUndefined();
  });

  test.each([
    'http://yue.macro.my.id,https://api.yue.macro.my.id',
    'https://yue.macro.my.id',
    'https://a.test,https://b.test,https://c.test',
    'https://yue.macro.my.id/path,https://api.yue.macro.my.id',
    'https://user:pass@yue.macro.my.id,https://api.yue.macro.my.id',
    'https://yue.macro.my.id?query=1,https://api.yue.macro.my.id',
    'not a url',
  ])('rejects invalid TARGET_ORIGINS: %p', (value) => {
    expect(settingsOf(parseConfig(env({ TARGET_ORIGINS: value })))).toEqual(['TARGET_ORIGINS']);
  });

  test('TARGET_ORIGINS error does not shadow other missing required settings', () => {
    const result = parseConfig({ TARGET_ORIGINS: 'nope' });
    const settings = settingsOf(result);
    expect(settings).toContain('TARGET_ORIGINS');
    expect(settings).toContain('INFERENCE_API_KEY');
    expect(settings).toContain('TURNSTILE_SECRET_KEY');
    expect(settings).toContain('TURNSTILE_SITE_KEY');
    expect(settings).toContain('FIREBASE_API_KEY');
  });
});

describe('DOCKER_HOST', () => {
  test('unset means local unix socket (dockerHost is undefined)', () => {
    const c = ok(parseConfig(env()));
    expect('dockerHost' in c).toBe(false);
    expect(c.dockerHost).toBeUndefined();
  });

  test.each([
    ['tcp://socket-proxy:2375', 'tcp://socket-proxy:2375'],
    ['tcp://SOCKET-PROXY:2375', 'tcp://socket-proxy:2375'],
    ['tcp://10.0.0.2:2375', 'tcp://10.0.0.2:2375'],
    ['tcp://host', 'tcp://host'],
    ['pipe:////./pipe/docker_engine', 'pipe:////./pipe/docker_engine'],
    ['pipe://\\\\.\\pipe\\docker_engine', 'pipe://\\\\.\\pipe\\docker_engine'],
  ])('%p is accepted -> %p', (raw, expected) => {
    expect(ok(parseConfig(env({ DOCKER_HOST: raw }))).dockerHost).toBe(expected);
  });

  test.each(['unix:///var/run/docker.sock', 'http://socket-proxy:2375', 'tcp://', 'tcp://-bad-', 'tcp://x:99999', 'pipe://'])(
    'an unsupported DOCKER_HOST (%p) fails by name',
    (raw) => {
      expect(settingsOf(parseConfig(env({ DOCKER_HOST: raw })))).toEqual(['DOCKER_HOST']);
    },
  );

  test('an empty DOCKER_HOST counts as unset, like every other optional setting', () => {
    const c = ok(parseConfig(env({ DOCKER_HOST: '' })));
    expect(c.dockerHost).toBeUndefined();
  });
});

describe('TIGERDATA_URL', () => {
  test('unset means no tigerDataUrl field (the mirror is disabled)', () => {
    const c = ok(parseConfig(env()));
    expect('tigerDataUrl' in c).toBe(false);
    expect(c.tigerDataUrl).toBeUndefined();
  });

  test.each([
    'postgres://tsdbadmin:pw@host.cloud.tigerdata.com:12345/tsdb?sslmode=require',
    'postgresql://user@host/db',
  ])('%p is accepted as written', (raw) => {
    expect(ok(parseConfig(env({ TIGERDATA_URL: raw }))).tigerDataUrl).toBe(raw);
  });

  test('whitespace around the value is trimmed', () => {
    expect(ok(parseConfig(env({ TIGERDATA_URL: '  postgres://host/db ' }))).tigerDataUrl).toBe('postgres://host/db');
  });

  test.each(['mysql://host/db', 'https://host/db', 'postgres://', 'postgres://host db', 'not a url'])(
    'an unsupported TIGERDATA_URL (%p) fails by name',
    (raw) => {
      expect(settingsOf(parseConfig(env({ TIGERDATA_URL: raw })))).toEqual(['TIGERDATA_URL']);
    },
  );

  test('an empty TIGERDATA_URL counts as unset, like every other optional setting', () => {
    const c = ok(parseConfig(env({ TIGERDATA_URL: '' })));
    expect(c.tigerDataUrl).toBeUndefined();
  });

  test('the URL carries credentials, so redactedConfig marks it [set] and never prints it', () => {
    const url = 'postgres://tsdbadmin:SECRET-PW@host.cloud.tigerdata.com:12345/tsdb';
    const c = ok(parseConfig(env({ TIGERDATA_URL: url })));
    const text = JSON.stringify(redactedConfig(c));
    expect(text).not.toContain(url);
    expect(text).not.toContain('SECRET-PW');
    expect(text).toContain('[set]');
  });
});

describe('PORT, inference overrides, and general settings', () => {
  test('valid PORT values are parsed as numbers', () => {
    expect(ok(parseConfig(env({ PORT: '1' }))).port).toBe(1);
    expect(ok(parseConfig(env({ PORT: '65535' }))).port).toBe(65535);
    for (const bad of ['0', '65536', '-1', '8080abc', '3000.5', 'not a number']) {
      expect(settingsOf(parseConfig(env({ PORT: bad })))).toEqual(['PORT']);
    }
  });

  test('INFERENCE_BASE_URL and VULTR_INFERENCE_BASE_URL must be an http(s) URL', () => {
    expect(ok(parseConfig(env({ INFERENCE_BASE_URL: 'http://localhost:9000/v1' }))).inference.baseUrl).toBe(
      'http://localhost:9000/v1',
    );
    expect(ok(parseConfig(env({ INFERENCE_BASE_URL: undefined, VULTR_INFERENCE_BASE_URL: 'http://localhost:8000/v1' }))).inference.baseUrl).toBe(
      'http://localhost:8000/v1',
    );
    expect(settingsOf(parseConfig(env({ INFERENCE_BASE_URL: 'ftp://x.test' })))).toEqual([
      'INFERENCE_BASE_URL',
    ]);
  });

  test('model, VM address, data directory, and optional Vultr API key overrides', () => {
    const c = ok(
      parseConfig(
        env({
          INFERENCE_MODEL: 'm1',
          INFERENCE_FALLBACK_MODEL: 'm2',
          MACRO_VM_IP: '203.0.113.9',
          DATA_DIR: '/tmp/macro-test',
          VULTR_API_KEY: 'vultr-key-5555',
        }),
      ),
    );
    expect(c.inference.model).toBe('m1');
    expect(c.inference.fallbackModel).toBe('m2');
    expect(c.macroVmIp).toBe('203.0.113.9');
    expect(c.dataDir).toBe('/tmp/macro-test');
    expect(c.vultrApiKey).toBe('vultr-key-5555');
  });

  test('the config is deeply frozen', () => {
    const c = ok(parseConfig(env()));
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.inference)).toBe(true);
    expect(Object.isFrozen(c.target)).toBe(true);
    expect(Object.isFrozen(c.target.allowlist)).toBe(true);
    expect(Object.isFrozen(c.sandbox)).toBe(true);
    expect(Object.isFrozen(c.firebase)).toBe(true);
  });

  test('redactedConfig hides all secret keys', () => {
    const c = ok(parseConfig(env({ VULTR_API_KEY: 'vultr-key-5555' })));
    const text = JSON.stringify(redactedConfig(c));
    for (const secret of [SECRET_KEY, SECRET_TS, FB_API_KEY, 'vultr-key-5555']) expect(text).not.toContain(secret);
    expect(text).toContain('[set]');
  });
});

const CORE_AUTH_ENV: Record<string, string> = {
  SESSION_SECRET: 'session-secret-aaaa',
  PUBLIC_BASE_URL: 'https://macro.my.id',
  RESEND_API_KEY: 're_test_bbbb',
  RESEND_FROM: 'Macro <hello@macro.my.id>',
};

const GITHUB_AUTH_ENV: Record<string, string> = {
  GITHUB_CLIENT_ID: 'gh-client-cccc',
  GITHUB_CLIENT_SECRET: 'gh-secret-dddd',
  GITHUB_REDIRECT_URI: 'https://macro.my.id/api/auth/github/callback',
};

describe('optional auth block', () => {
  test('no auth env omits config.auth and config.githubAuth', () => {
    const c = ok(parseConfig(env()));
    expect('auth' in c).toBe(false);
    expect('githubAuth' in c).toBe(false);
  });

  test('core auth env enables config.auth without GitHub OAuth', () => {
    const c = ok(parseConfig(env(CORE_AUTH_ENV)));
    expect(c.auth).toEqual({
      sessionSecret: 'session-secret-aaaa',
      publicBaseUrl: 'https://macro.my.id',
      resendApiKey: 're_test_bbbb',
      resendFrom: 'Macro <hello@macro.my.id>',
    });
    expect(c.githubAuth).toBeUndefined();
    expect(Object.isFrozen(c.auth)).toBe(true);
  });

  test('core auth env plus GitHub OAuth configures both', () => {
    const c = ok(parseConfig(env({ ...CORE_AUTH_ENV, ...GITHUB_AUTH_ENV })));
    expect(c.auth?.sessionSecret).toBe('session-secret-aaaa');
    expect(c.auth?.githubClientId).toBe('gh-client-cccc');
    expect(c.githubAuth).toEqual({
      clientId: 'gh-client-cccc',
      clientSecret: 'gh-secret-dddd',
      redirectUri: 'https://macro.my.id/api/auth/github/callback',
    });
    expect(Object.isFrozen(c.githubAuth)).toBe(true);
  });

  test('partial core auth env fails config', () => {
    const result = parseConfig(env({ SESSION_SECRET: 'only-one' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const settings = result.errors.map((e) => e.setting);
    expect(settings).toContain('PUBLIC_BASE_URL');
    expect(settings).toContain('RESEND_API_KEY');
    expect(settings).toContain('RESEND_FROM');
  });

  test('GitHub OAuth without core auth block fails config', () => {
    const result = parseConfig(env(GITHUB_AUTH_ENV));
    expect(result.ok).toBe(false);
    expect(settingsOf(result)).toContain('GITHUB_CLIENT_ID');
  });

  test('redactedConfig hides auth and github secrets', () => {
    const c = ok(parseConfig(env({ ...CORE_AUTH_ENV, ...GITHUB_AUTH_ENV })));
    const text = JSON.stringify(redactedConfig(c));
    for (const secret of ['session-secret-aaaa', 're_test_bbbb', 'gh-secret-dddd']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('firebase', () => {
  const FB = {
    FIREBASE_API_KEY: 'AIzaSyTestKey123',
    FIREBASE_APP_ID: '1:565002558232:web:27b0355cf83c682da91c6d',
    FIREBASE_PROJECT_ID: 'macro-c80bc',
  };

  test('accepts required fields and optional authDomain, measurementId, appCheckSiteKey', () => {
    const c = ok(
      parseConfig(
        env({
          ...FB,
          FIREBASE_AUTH_DOMAIN: 'macro-c80bc.firebaseapp.com',
          FIREBASE_MEASUREMENT_ID: 'G-TEST1234',
          FIREBASE_APPCHECK_SITE_KEY: '6LeTestSiteKey',
        }),
      ),
    );
    expect(c.firebase).toEqual({
      apiKey: FB.FIREBASE_API_KEY,
      appId: FB.FIREBASE_APP_ID,
      projectId: FB.FIREBASE_PROJECT_ID,
      authDomain: 'macro-c80bc.firebaseapp.com',
      measurementId: 'G-TEST1234',
      appCheckSiteKey: '6LeTestSiteKey',
    });
  });

  test.each(['FIREBASE_API_KEY', 'FIREBASE_APP_ID', 'FIREBASE_PROJECT_ID'])(
    'missing required %s reports that field by name',
    (missing) => {
      const patch: Record<string, string | undefined> = { ...FB, [missing]: undefined };
      expect(settingsOf(parseConfig(env(patch)))).toEqual([missing]);
    },
  );
});

describe('googleAuth', () => {
  const G = {
    GOOGLE_CLIENT_ID: 'google-client-123',
    GOOGLE_CLIENT_SECRET: 'google-secret-xyz',
    GOOGLE_REDIRECT_URI: 'https://macro.my.id/api/auth/google/callback',
  };

  test('unset means no googleAuth field', () => {
    const c = ok(parseConfig(env()));
    expect('googleAuth' in c).toBe(false);
    expect(c.googleAuth).toBeUndefined();
  });

  test('accepts complete googleAuth env when core auth is present', () => {
    const c = ok(parseConfig(env({ ...CORE_AUTH_ENV, ...G })));
    expect(c.googleAuth).toEqual({
      clientId: G.GOOGLE_CLIENT_ID,
      clientSecret: G.GOOGLE_CLIENT_SECRET,
      redirectUri: G.GOOGLE_REDIRECT_URI,
    });
    const text = JSON.stringify(redactedConfig(c));
    expect(text).not.toContain(G.GOOGLE_CLIENT_SECRET);
  });

  test.each(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'])(
    'partial googleAuth config missing %s reports that field by name',
    (missing) => {
      const patch: Record<string, string | undefined> = { ...CORE_AUTH_ENV, ...G, [missing]: undefined };
      expect(settingsOf(parseConfig(env(patch)))).toEqual([missing]);
    },
  );

  test.each(['not-a-url', 'ftp://macro.my.id/callback', 'javascript:alert(1)'])(
    'rejects non-HTTP(S) GOOGLE_REDIRECT_URI (%s)',
    (badUri) => {
      const result = parseConfig(env({ ...CORE_AUTH_ENV, ...G, GOOGLE_REDIRECT_URI: badUri }));
      expect(result.ok).toBe(false);
      expect(settingsOf(result)).toEqual(['GOOGLE_REDIRECT_URI']);
    },
  );
});

describe('absoluteDataDir', () => {
  test('a relative DATA_DIR resolves to an absolute path against the working directory', () => {
    for (const relative of ['./data', 'data']) {
      const resolved = absoluteDataDir(relative, '/repo');
      expect(isAbsolute(resolved)).toBe(true);
      expect(resolved.endsWith('data')).toBe(true);
    }
  });

  test('an absolute DATA_DIR is kept as written', () => {
    expect(absoluteDataDir('/var/lib/macro', '/repo')).toBe('/var/lib/macro');
  });
});
