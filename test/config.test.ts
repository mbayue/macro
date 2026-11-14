import { describe, expect, test } from 'bun:test';
import { DEFAULTS, K6_IMAGE_DEFAULT, parseConfig, parseHttpsOrigin, redactedConfig } from '../src/config.ts';
import type { Config, ConfigResult } from '../src/config.ts';

// Synthetic values only: parseConfig takes an explicit object and never touches process.env.
const SECRET_KEY = 'test-inference-key-1111';
const SECRET_TS = 'test-turnstile-secret-2222';
const SITE = 'test-site-key-3333';
const BASE: Record<string, string> = {
  VULTR_INFERENCE_API_KEY: SECRET_KEY,
  TURNSTILE_SECRET_KEY: SECRET_TS,
  TURNSTILE_SITE_KEY: SITE,
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
      baseUrl: DEFAULTS.inferenceBaseUrl,
      model: DEFAULTS.inferenceModel,
      fallbackModel: DEFAULTS.inferenceFallbackModel,
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
    expect('vultrApiKey' in c).toBe(false);
  });

  test.each(['VULTR_INFERENCE_API_KEY', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY'])(
    'a missing %s is reported by name',
    (name) => {
      const result = parseConfig(env({ [name]: undefined }));
      expect(settingsOf(result)).toEqual([name]);
    },
  );

  test.each(['VULTR_INFERENCE_API_KEY', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY'])(
    'an empty or whitespace-only %s is reported by name',
    (name) => {
      expect(settingsOf(parseConfig(env({ [name]: '' })))).toEqual([name]);
      expect(settingsOf(parseConfig(env({ [name]: '   \t ' })))).toEqual([name]);
    },
  );

  test('every missing secret is reported, not only the first', () => {
    expect(settingsOf(parseConfig({})).sort()).toEqual(
      ['TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY', 'VULTR_INFERENCE_API_KEY'].sort(),
    );
  });

  test('secret values never appear in error text', () => {
    const result = parseConfig(env({ K6_IMAGE: 'grafana/k6:latest', TARGET_ORIGINS: 'bad', PORT: 'x', TURNSTILE_SITE_KEY: '' }));
    expect(result.ok).toBe(false);
    const text = JSON.stringify(result);
    for (const secret of [SECRET_KEY, SECRET_TS]) expect(text).not.toContain(secret);
  });

  test('values are trimmed', () => {
    const c = ok(parseConfig(env({ VULTR_INFERENCE_API_KEY: `  ${SECRET_KEY}\n`, PORT: ' 8080 ' })));
    expect(c.inference.apiKey).toBe(SECRET_KEY);
    expect(c.port).toBe(8080);
  });
});

describe('AI_API_KEY alias', () => {
  test('is used when VULTR_INFERENCE_API_KEY is unset', () => {
    const c = ok(parseConfig(env({ VULTR_INFERENCE_API_KEY: undefined, AI_API_KEY: 'alias-key-4444' })));
    expect(c.inference.apiKey).toBe('alias-key-4444');
  });

  test('is used when VULTR_INFERENCE_API_KEY is empty', () => {
    const c = ok(parseConfig(env({ VULTR_INFERENCE_API_KEY: '  ', AI_API_KEY: 'alias-key-4444' })));
    expect(c.inference.apiKey).toBe('alias-key-4444');
  });

  test('VULTR_INFERENCE_API_KEY wins when both are set', () => {
    const c = ok(parseConfig(env({ AI_API_KEY: 'alias-key-4444' })));
    expect(c.inference.apiKey).toBe(SECRET_KEY);
  });

  test('neither set: the error names VULTR_INFERENCE_API_KEY and mentions the alias', () => {
    const result = parseConfig(env({ VULTR_INFERENCE_API_KEY: undefined }));
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.setting).toBe('VULTR_INFERENCE_API_KEY');
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

  test('unset or blank means runsc', () => {
    expect(ok(parseConfig(env())).sandbox.runtime).toBe('runsc');
    expect(ok(parseConfig(env({ SANDBOX_RUNTIME: '  ' }))).sandbox.runtime).toBe('runsc');
  });
});

describe('K6_IMAGE', () => {
  test('the built-in default is pinned by digest', () => {
    expect(K6_IMAGE_DEFAULT).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  test('an image pinned by digest is accepted', () => {
    const image = `grafana/k6@sha256:${'ab'.repeat(32)}`;
    expect(ok(parseConfig(env({ K6_IMAGE: image }))).sandbox.k6Image).toBe(image);
  });

  test.each(['grafana/k6', 'grafana/k6:latest', 'grafana/k6:1.0.0', 'registry.example.com/k6:sha256-abc'])(
    '%p (no digest) fails naming K6_IMAGE',
    (image) => {
      expect(settingsOf(parseConfig(env({ K6_IMAGE: image })))).toEqual(['K6_IMAGE']);
    },
  );
});

describe('TARGET_ORIGINS', () => {
  test('two https origins set the web and API roles in order', () => {
    const c = ok(parseConfig(env({ TARGET_ORIGINS: 'https://web.example.test,https://api.example.test:8443' })));
    expect(c.target.webOrigin).toBe('https://web.example.test');
    expect(c.target.apiOrigin).toBe('https://api.example.test:8443');
    expect(c.target.allowlist).toEqual(['https://web.example.test', 'https://api.example.test:8443']);
  });

  test('whitespace around entries is ignored and hosts are lowercased', () => {
    const c = ok(parseConfig(env({ TARGET_ORIGINS: ' HTTPS://Web.Example.TEST , https://API.example.test ' })));
    expect(c.target.allowlist).toEqual(['https://web.example.test', 'https://api.example.test']);
  });

  test.each([
    ['one origin', 'https://web.example.test'],
    ['three origins', 'https://a.test,https://b.test,https://c.test'],
    ['trailing comma', 'https://a.test,https://b.test,'],
    ['http scheme', 'http://a.test,https://b.test'],
    ['a path', 'https://a.test/app,https://b.test'],
    ['a trailing slash', 'https://a.test/,https://b.test'],
    ['a query', 'https://a.test?x=1,https://b.test'],
    ['a fragment', 'https://a.test#x,https://b.test'],
    ['credentials', 'https://user:pw@a.test,https://b.test'],
    ['port 0', 'https://a.test:0,https://b.test'],
    ['port 65536', 'https://a.test:65536,https://b.test'],
    ['an empty second entry', 'https://a.test, '],
    ['no scheme', 'a.test,b.test'],
    ['an underscore host', 'https://a_b.test,https://b.test'],
  ])('rejects %s', (_label, value) => {
    expect(settingsOf(parseConfig(env({ TARGET_ORIGINS: value })))).toEqual(['TARGET_ORIGINS']);
  });

  test('the setting is named even when other settings are also wrong', () => {
    const result = parseConfig({ TARGET_ORIGINS: 'nope' });
    expect(settingsOf(result)).toContain('TARGET_ORIGINS');
  });

  test('parseHttpsOrigin accepts bare origins only', () => {
    expect(parseHttpsOrigin('https://a.test')).toBe('https://a.test');
    expect(parseHttpsOrigin('https://A.test:65535')).toBe('https://a.test:65535');
    expect(parseHttpsOrigin('https://a.test:1')).toBe('https://a.test:1');
    expect(parseHttpsOrigin('https://a.test/')).toBeUndefined();
    expect(parseHttpsOrigin('http://a.test')).toBeUndefined();
    expect(parseHttpsOrigin('https://')).toBeUndefined();
  });
});

describe('other settings', () => {
  test('PORT must be an integer from 1 to 65535', () => {
    expect(ok(parseConfig(env({ PORT: '1' }))).port).toBe(1);
    expect(ok(parseConfig(env({ PORT: '65535' }))).port).toBe(65535);
    for (const bad of ['0', '65536', '-1', '3000.5', 'abc', '1e3', '0x10']) {
      expect(settingsOf(parseConfig(env({ PORT: bad })))).toEqual(['PORT']);
    }
  });

  test('VULTR_INFERENCE_BASE_URL must be an http(s) URL', () => {
    expect(ok(parseConfig(env({ VULTR_INFERENCE_BASE_URL: 'http://localhost:9000/v1' }))).inference.baseUrl).toBe(
      'http://localhost:9000/v1',
    );
    expect(settingsOf(parseConfig(env({ VULTR_INFERENCE_BASE_URL: 'ftp://x.test' })))).toEqual([
      'VULTR_INFERENCE_BASE_URL',
    ]);
    expect(settingsOf(parseConfig(env({ VULTR_INFERENCE_BASE_URL: 'not a url' })))).toEqual([
      'VULTR_INFERENCE_BASE_URL',
    ]);
  });

  test('model, VM address, data directory, and optional Vultr API key overrides', () => {
    const c = ok(
      parseConfig(
        env({
          VULTR_INFERENCE_MODEL: 'm1',
          VULTR_INFERENCE_FALLBACK_MODEL: 'm2',
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
  });

  test('redactedConfig hides all three secret keys', () => {
    const c = ok(parseConfig(env({ VULTR_API_KEY: 'vultr-key-5555' })));
    const text = JSON.stringify(redactedConfig(c));
    for (const secret of [SECRET_KEY, SECRET_TS, 'vultr-key-5555']) expect(text).not.toContain(secret);
    expect(text).toContain('[set]');
    const unset = JSON.stringify(redactedConfig(ok(parseConfig(env()))));
    expect(unset).toContain('[unset]');
  });
});

const AUTH_ENV: Record<string, string> = {
  SESSION_SECRET: 'session-secret-aaaa',
  PUBLIC_BASE_URL: 'https://macro.my.id',
  RESEND_API_KEY: 're_test_bbbb',
  RESEND_FROM: 'Macro <hello@macro.my.id>',
  GITHUB_CLIENT_ID: 'gh-client-cccc',
  GITHUB_CLIENT_SECRET: 'gh-secret-dddd',
  GITHUB_REDIRECT_URI: 'https://macro.my.id/api/auth/github/callback',
};

describe('optional auth block', () => {
  test('no auth env omits config.auth', () => {
    const c = ok(parseConfig(env()));
    expect('auth' in c).toBe(false);
  });

  test('complete auth env freezes config.auth', () => {
    const c = ok(parseConfig(env(AUTH_ENV)));
    expect(c.auth).toEqual({
      sessionSecret: 'session-secret-aaaa',
      publicBaseUrl: 'https://macro.my.id',
      resendApiKey: 're_test_bbbb',
      resendFrom: 'Macro <hello@macro.my.id>',
      githubClientId: 'gh-client-cccc',
      githubClientSecret: 'gh-secret-dddd',
      githubRedirectUri: 'https://macro.my.id/api/auth/github/callback',
    });
    expect(Object.isFrozen(c.auth)).toBe(true);
  });

  test('partial auth env fails config', () => {
    const result = parseConfig(env({ SESSION_SECRET: 'only-one' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const settings = result.errors.map((e) => e.setting);
    expect(settings).toContain('PUBLIC_BASE_URL');
    expect(settings).toContain('RESEND_API_KEY');
    expect(settings).toContain('RESEND_FROM');
    expect(settings).toContain('GITHUB_CLIENT_ID');
    expect(settings).toContain('GITHUB_CLIENT_SECRET');
    expect(settings).toContain('GITHUB_REDIRECT_URI');
  });

  test('redactedConfig hides auth secrets', () => {
    const c = ok(parseConfig(env(AUTH_ENV)));
    const text = JSON.stringify(redactedConfig(c));
    for (const secret of ['session-secret-aaaa', 're_test_bbbb', 'gh-secret-dddd']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('DOCKER_HOST', () => {
  test('unset means no dockerHost field (local unix socket)', () => {
    const c = ok(parseConfig(env()));
    expect('dockerHost' in c).toBe(false);
    expect(c.dockerHost).toBeUndefined();
  });

  test.each([
    ['tcp://socket-proxy:2375', 'tcp://socket-proxy:2375'],
    ['tcp://socket-proxy', 'tcp://socket-proxy'],
    ['TCP://Socket-Proxy:2375', 'tcp://socket-proxy:2375'],
    ['  tcp://socket-proxy:2375  ', 'tcp://socket-proxy:2375'],
  ])('%p is accepted as %p', (raw, expected) => {
    expect(ok(parseConfig(env({ DOCKER_HOST: raw }))).dockerHost).toBe(expected);
  });

  test.each(['unix:///var/run/docker.sock', 'http://socket-proxy:2375', 'tcp://', 'tcp://-bad-', 'tcp://x:99999'])(
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

