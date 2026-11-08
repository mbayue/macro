// Egress_Proxy: a dependency-free, CONNECT-only HTTP proxy for the k6 Sandbox.
// Runs inside the proxy container image: no imports from src/, no npm packages.
//
// Config (environment):
//   ALLOW_HOSTS   comma-separated hostnames that may be reached (port 443 only)
//   BLOCK_IPS     comma-separated IPs that are always refused (the Macro VM address)
//   DENIALS_FILE  JSON-lines denial log (default /out/denials.jsonl)
//   PORT          listen port (default 3128)
//
// Rules: any method other than CONNECT gets 403. A CONNECT is resolved with ONE
// dns.lookup, judged by decideConnect over every returned address, and then
// connected to the chosen IP (never re-resolved).

import { appendFile } from "node:fs/promises";
import dns from "node:dns";
import net from "node:net";
import { pipeline } from "node:stream";
import { decideConnect, parseConnectTarget } from "./ip.ts";

export const MAX_HEAD_BYTES = 8 * 1024;
export const HEAD_TIMEOUT_MS = 10_000;
export const DNS_TIMEOUT_MS = 5_000;
export const CONNECT_TIMEOUT_MS = 10_000;
export const IDLE_TIMEOUT_MS = 30_000;
export const MAX_DENIAL_LOG_BYTES = 1024 * 1024;
const MAX_HOST_CHARS = 255;

export interface Denial {
  ts: string;
  host: string;
  port: number;
  reason: string;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type LookupFn = (host: string) => Promise<ResolvedAddress[]>;
export type ConnectFn = (address: string, port: number) => net.Socket;

export interface ProxyOptions {
  allowHosts: readonly string[];
  blockIps: readonly string[];
  /** Appends one denial. Must not throw. */
  logDenial: (denial: Denial) => void;
  lookup?: LookupFn;
  connect?: ConnectFn;
  now?: () => Date;
  timeouts?: Partial<{ head: number; dns: number; connect: number; idle: number }>;
}

// ---------------------------------------------------------------------------
// Request head parsing (pure)
// ---------------------------------------------------------------------------

export interface RequestHead {
  method: string;
  target: string;
  /** Value of the first Host header, if any. */
  hostHeader: string | undefined;
}

/** Returns the index just past the blank line that ends the head, or -1. */
export function findHeadEnd(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i + 4;
  }
  return -1;
}

/** Parses the request line and the Host header. Null when malformed. */
export function parseRequestHead(head: string): RequestHead | null {
  const lines = head.split("\r\n");
  const requestLine = lines[0];
  if (requestLine === undefined) return null;
  const parts = requestLine.split(" ");
  if (parts.length !== 3) return null;
  const [method, target, version] = parts;
  if (method === undefined || target === undefined || version === undefined) return null;
  if (!/^[A-Za-z]{1,16}$/.test(method)) return null;
  if (!/^HTTP\/1\.[01]$/.test(version)) return null;
  if (target.length === 0 || target.length > 2048) return null;
  let hostHeader: string | undefined;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line === "") break;
    const colon = line.indexOf(":");
    if (colon <= 0) return null;
    if (line.slice(0, colon).toLowerCase() === "host" && hostHeader === undefined) {
      hostHeader = line.slice(colon + 1).trim();
    }
  }
  return { method, target, hostHeader };
}

function printable(s: string): string {
  let out = "";
  for (const ch of s.slice(0, MAX_HOST_CHARS)) {
    const c = ch.charCodeAt(0);
    out += c > 0x20 && c < 0x7f ? ch : "?";
  }
  return out;
}

/** Best-effort destination of a non-CONNECT request, for the denial log only. */
export function describeDestination(head: RequestHead | null): { host: string; port: number } {
  if (head === null) return { host: "", port: 0 };
  const { target, hostHeader } = head;
  let authority: string | undefined;
  let defaultPort = 80;
  const abs = /^(https?):\/\/([^/?#]*)/i.exec(target);
  if (abs) {
    authority = abs[2];
    if (abs[1]?.toLowerCase() === "https") defaultPort = 443;
  } else if (hostHeader !== undefined) {
    authority = hostHeader;
  }
  if (authority === undefined || authority === "") return { host: "", port: 0 };
  const at = authority.lastIndexOf("@");
  if (at >= 0) authority = authority.slice(at + 1);
  const hasPort = authority.startsWith("[") ? authority.includes("]:") : authority.includes(":");
  const parsed = parseConnectTarget(hasPort ? authority : `${authority}:${defaultPort}`);
  if (parsed !== null) return parsed;
  return { host: printable(authority), port: 0 };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

function denyResponse(reason: string): string {
  return (
    "HTTP/1.1 403 Forbidden\r\n" +
    "X-Macro-Proxy: denied\r\n" +
    `X-Macro-Reason: ${reason}\r\n` +
    "Content-Length: 0\r\n" +
    "Connection: close\r\n\r\n"
  );
}

function errorResponse(status: string, reason: string): string {
  return `HTTP/1.1 ${status}\r\nX-Macro-Proxy: error\r\nX-Macro-Reason: ${reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const defaultLookup: LookupFn = async (host) => {
  const list = await dns.promises.lookup(host, { all: true });
  return list.map((a) => ({ address: a.address, family: a.family }));
};

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function endWith(socket: net.Socket, text: string): void {
  if (socket.destroyed) return;
  socket.end(text);
  // Do not keep a half-closed socket around if the peer never reads.
  setTimeout(() => socket.destroy(), 2_000).unref();
}

export function createProxyServer(opts: ProxyOptions): net.Server {
  const lookup = opts.lookup ?? defaultLookup;
  const connect: ConnectFn = opts.connect ?? ((address, port) => net.connect({ host: address, port }));
  const now = opts.now ?? (() => new Date());
  const t = {
    head: opts.timeouts?.head ?? HEAD_TIMEOUT_MS,
    dns: opts.timeouts?.dns ?? DNS_TIMEOUT_MS,
    connect: opts.timeouts?.connect ?? CONNECT_TIMEOUT_MS,
    idle: opts.timeouts?.idle ?? IDLE_TIMEOUT_MS,
  };

  const deny = (client: net.Socket, host: string, port: number, reason: string): void => {
    try {
      opts.logDenial({ ts: now().toISOString(), host: printable(host), port, reason });
    } catch {
      // logging must never take the proxy down
    }
    endWith(client, denyResponse(reason));
  };

  const handleConnect = async (client: net.Socket, authority: string, leftover: Buffer): Promise<void> => {
    const target = parseConnectTarget(authority);
    if (target === null) return deny(client, authority, 0, "bad_target");

    let addresses: ResolvedAddress[];
    try {
      addresses = await withTimeout(lookup(target.host), t.dns, "dns lookup");
    } catch {
      // A name that does not resolve has no addresses; the decision still applies host/port rules first.
      addresses = [];
    }
    // One lookup only. IPv4 first so a container without IPv6 routes still connects;
    // every address (both families) is still checked by decideConnect.
    const ordered = [...addresses.filter((a) => a.family === 4), ...addresses.filter((a) => a.family !== 4)].map(
      (a) => a.address,
    );
    const decision = decideConnect(target.host, target.port, ordered, opts.allowHosts, opts.blockIps);
    if (!decision.allow) return deny(client, target.host, target.port, decision.reason);
    if (client.destroyed) return;

    const upstream = connect(decision.address, target.port);
    upstream.setTimeout(t.connect);
    const fail = (reason: string): void => {
      upstream.destroy();
      endWith(client, errorResponse("502 Bad Gateway", reason));
    };
    upstream.once("error", () => fail("upstream_error"));
    upstream.once("timeout", () => fail("upstream_timeout"));
    client.once("close", () => upstream.destroy());
    upstream.once("connect", () => {
      upstream.removeAllListeners("error");
      upstream.removeAllListeners("timeout");
      upstream.setTimeout(t.idle);
      client.setTimeout(t.idle);
      const teardown = (): void => {
        client.destroy();
        upstream.destroy();
      };
      upstream.on("timeout", teardown);
      client.on("timeout", teardown);
      upstream.on("error", teardown);
      client.on("error", teardown);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (leftover.length > 0) upstream.write(leftover);
      pipeline(client, upstream, (err) => {
        if (err) teardown();
      });
      pipeline(upstream, client, (err) => {
        if (err) teardown();
      });
      client.resume();
    });
  };

  const server = net.createServer((client) => {
    client.setNoDelay(true);
    client.on("error", () => client.destroy());
    let buf = Buffer.alloc(0);
    const headTimer = setTimeout(() => client.destroy(), t.head);

    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      const end = findHeadEnd(buf);
      if (end < 0) {
        if (buf.length > MAX_HEAD_BYTES) {
          clearTimeout(headTimer);
          client.removeListener("data", onData);
          deny(client, "", 0, "header_too_large");
        }
        return;
      }
      clearTimeout(headTimer);
      client.removeListener("data", onData);
      client.pause();
      if (end > MAX_HEAD_BYTES) return deny(client, "", 0, "header_too_large");
      const head = parseRequestHead(buf.subarray(0, end - 4).toString("latin1"));
      const leftover = buf.subarray(end);
      if (head === null) return deny(client, "", 0, "malformed_request");
      if (head.method !== "CONNECT") {
        const dest = describeDestination(head);
        return deny(client, dest.host, dest.port, "method_not_allowed");
      }
      handleConnect(client, head.target, leftover).catch(() => {
        endWith(client, errorResponse("500 Internal Server Error", "internal_error"));
      });
    };
    client.on("data", onData);
    client.on("close", () => clearTimeout(headTimer));
  });
  server.maxConnections = 4096;
  server.on("error", (err) => console.error(`proxy server error: ${err.message}`));
  return server;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Serialised, size-capped JSON-lines appender. */
export function createDenialLogger(file: string): (denial: Denial) => void {
  let written = 0;
  let chain: Promise<void> = Promise.resolve();
  return (denial) => {
    const line = `${JSON.stringify(denial)}\n`;
    if (written + line.length > MAX_DENIAL_LOG_BYTES) return;
    written += line.length;
    chain = chain
      .then(() => appendFile(file, line))
      .catch((err: unknown) => {
        console.error(`cannot write denial log: ${err instanceof Error ? err.message : String(err)}`);
      });
  };
}

if (import.meta.main) {
  process.on("uncaughtException", (err) => console.error(`uncaught: ${err.message}`));
  process.on("unhandledRejection", (reason) => console.error(`unhandled rejection: ${String(reason)}`));

  const port = Number(process.env.PORT ?? "3128");
  const allowHosts = csv(process.env.ALLOW_HOSTS);
  const blockIps = csv(process.env.BLOCK_IPS);
  const denialsFile = process.env.DENIALS_FILE ?? "/out/denials.jsonl";
  const server = createProxyServer({ allowHosts, blockIps, logDenial: createDenialLogger(denialsFile) });
  server.listen(port, "0.0.0.0", () => {
    console.log(`egress proxy listening on :${port}; allow=${allowHosts.join(",")}; blocked ips=${blockIps.length}`);
  });
  const stop = (): void => {
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
