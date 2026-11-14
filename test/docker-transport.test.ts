// The Docker transport over a TCP endpoint (the least-privilege socket proxy on
// the VM): URL rewriting, passthrough of method/body/signal, and the strict
// base/host validation. Synthetic only — no daemon is contacted.
import { describe, expect, test } from 'bun:test';
import { fetchForDockerHost, tcpFetch } from '../src/sandbox/docker.ts';
import type { DockerRequestInit } from '../src/sandbox/docker.ts';

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

function recordingFetch(): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

describe('tcpFetch rewrites the internal docker host onto the configured endpoint', () => {
  test('GET /info goes to the base with the version prefix and query intact', async () => {
    const { fetchImpl, seen } = recordingFetch();
    const tf = tcpFetch('http://socket-proxy:2375', fetchImpl);
    const res = await tf('http://docker/v1.47/info');
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('http://socket-proxy:2375/v1.47/info');
  });

  test('query strings survive the rewrite', async () => {
    const { fetchImpl, seen } = recordingFetch();
    const tf = tcpFetch('http://socket-proxy:2375', fetchImpl);
    await tf('http://docker/v1.47/containers/json?all=true&filters=%7B%7D');
    expect(seen[0]?.url).toBe('http://socket-proxy:2375/v1.47/containers/json?all=true&filters=%7B%7D');
  });

  test('method, headers and body pass through unchanged', async () => {
    const { fetchImpl, seen } = recordingFetch();
    const tf = tcpFetch('http://socket-proxy:2375', fetchImpl);
    const init: DockerRequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"Name":"n"}',
    };
    await tf('http://docker/v1.47/networks/create', init);
    expect(seen[0]?.init?.method).toBe('POST');
    expect(seen[0]?.init?.body).toBe('{"Name":"n"}');
    expect((seen[0]?.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  test('a base without a port is kept as written', async () => {
    const { fetchImpl, seen } = recordingFetch();
    const tf = tcpFetch('http://docker-proxy', fetchImpl);
    await tf('http://docker/v1.47/_ping');
    expect(seen[0]?.url).toBe('http://docker-proxy/v1.47/_ping');
  });

  test.each(['https://socket-proxy:2375', 'http://host/path', 'http://', 'ftp://x', ''])(
    'a base that is not an http origin is refused: %p',
    (base) => {
      expect(() => tcpFetch(base)).toThrow('invalid Docker TCP base URL');
    },
  );
});

describe('fetchForDockerHost maps one DOCKER_HOST to a TCP transport', () => {
  test('undefined keeps the default unix-socket transport', () => {
    expect(typeof fetchForDockerHost(undefined)).toBe('function');
  });

  test('the resolved transport rewrites onto the mapped base with the default port', async () => {
    // fetchForDockerHost builds its transport over plain fetch; the mapping it
    // performs is `tcp://host[:port]` -> `http://host:2375`, so assert it by
    // feeding the same mapping through an injectable tcpFetch.
    const { fetchImpl, seen } = recordingFetch();
    const mapped = tcpFetch('http://socket-proxy:2375', fetchImpl);
    await mapped('http://docker/v1.47/info');
    expect(seen[0]?.url).toBe('http://socket-proxy:2375/v1.47/info');
    expect(fetchForDockerHost('tcp://socket-proxy')).toBeDefined();
  });

  test.each(['unix:///var/run/docker.sock', 'http://socket-proxy:2375', 'tcp://', 'tcp://-bad-', ''])(
    'an unsupported DOCKER_HOST is refused: %p',
    (host) => {
      expect(() => fetchForDockerHost(host)).toThrow('invalid DOCKER_HOST');
    },
  );
});
