/**
 * Inference_Client (requirements 2.4, 2.6, 2.7; design "Inference_Client").
 *
 * One OpenAI-compatible `chat/completions` request with a single forced tool.
 * The key goes only into the `Authorization` header. Returned errors are fixed
 * strings; upstream bodies and the key never leave this module.
 */

import type { Config } from '../config.ts';
import type { AgentName, ModelOutcome, Store } from '../store/db.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object for the tool arguments. */
  parameters: object;
}

export interface CallToolOptions {
  agent: AgentName;
  system: string;
  user: string;
  /** Extra messages appended after the user message (for example a planner retry). */
  history?: readonly ChatMessage[];
  tool: ToolDefinition;
  /** Per attempt (primary and fallback each get this much). */
  timeoutMs: number;
  maxTokens?: number;
  draftId?: string;
  runId?: string;
  /** Caller deadline or cancellation. When it fires, no fallback attempt is made. */
  signal?: AbortSignal;
}

export type CallToolResult =
  | { ok: true; toolCalls: unknown[]; model: string }
  | { ok: false; error: 'inference_not_configured' | 'request_failed' };

export interface InferenceDeps {
  config: Config['inference'];
  store?: Store;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const DEFAULT_MAX_TOKENS = 1500;

type AttemptResult =
  | { kind: 'ok'; toolCalls: unknown[]; promptTokens: number | null; completionTokens: number | null }
  | { kind: 'error' }
  | { kind: 'timeout' }
  /** The caller's signal fired; a further attempt would be aborted at once. */
  | { kind: 'caller_abort' };

class AbortedError extends Error {}

function tokenCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class InferenceClient {
  private readonly config: Config['inference'];
  private readonly store: Store | undefined;
  private readonly fetchImpl: (input: string, init: RequestInit) => Promise<Response>;
  private readonly now: () => number;

  constructor(deps: InferenceDeps) {
    this.config = deps.config;
    this.store = deps.store;
    const impl = deps.fetchImpl;
    this.fetchImpl = impl !== undefined ? (input, init) => impl(input, init) : (input, init) => fetch(input, init);
    this.now = deps.now ?? Date.now;
  }

  get configured(): boolean {
    return this.config.apiKey.trim() !== '';
  }

  async callTool(opts: CallToolOptions): Promise<CallToolResult> {
    if (!this.configured) return { ok: false, error: 'inference_not_configured' };

    const models = [this.config.model];
    if (this.config.fallbackModel.trim() !== '') models.push(this.config.fallbackModel);

    for (const model of models) {
      const started = this.now();
      const result = await this.attempt(model, opts);
      const latencyMs = Math.max(0, this.now() - started);
      this.record(opts, model, result, latencyMs);
      if (result.kind === 'ok') return { ok: true, toolCalls: result.toolCalls, model };
      if (result.kind === 'caller_abort') break;
    }
    return { ok: false, error: 'request_failed' };
  }

  private record(opts: CallToolOptions, model: string, result: AttemptResult, latencyMs: number): void {
    if (this.store === undefined) return;
    const outcome: ModelOutcome = result.kind === 'ok' ? 'success' : result.kind === 'error' ? 'error' : 'timeout';
    try {
      this.store.recordModelCall({
        ...(opts.draftId !== undefined ? { draftId: opts.draftId } : {}),
        ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
        agent: opts.agent,
        model,
        outcome,
        latencyMs,
        promptTokens: result.kind === 'ok' ? result.promptTokens : null,
        completionTokens: result.kind === 'ok' ? result.completionTokens : null,
        ts: this.now(),
      });
    } catch {
      // A bookkeeping failure must not turn a good model answer into an error.
    }
  }

  private async attempt(model: string, opts: CallToolOptions): Promise<AttemptResult> {
    const timeoutSignal = AbortSignal.timeout(opts.timeoutMs);
    const combined = opts.signal ? AbortSignal.any([timeoutSignal, opts.signal]) : timeoutSignal;

    // Race against the signal ourselves: an injected fetch may ignore it.
    const aborted = new Promise<never>((_, reject) => {
      if (combined.aborted) reject(new AbortedError());
      else combined.addEventListener('abort', () => reject(new AbortedError()), { once: true });
    });
    aborted.catch(() => {});

    const messages: ChatMessage[] = [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
      ...(opts.history ?? []),
    ];
    const body = JSON.stringify({
      model,
      messages,
      tools: [
        {
          type: 'function',
          function: { name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.parameters },
        },
      ],
      tool_choice: { type: 'function', function: { name: opts.tool.name } },
      temperature: 0.2,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    });
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const work = (async (): Promise<unknown> => {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body,
        redirect: 'error',
        signal: combined,
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new Error('upstream error status');
      }
      return (await res.json()) as unknown;
    })();
    work.catch(() => {});

    try {
      const json = await Promise.race([work, aborted]);
      return this.parse(json);
    } catch {
      if (timeoutSignal.aborted) return { kind: 'timeout' };
      if (opts.signal?.aborted) return { kind: 'caller_abort' };
      return { kind: 'error' };
    }
  }

  private parse(json: unknown): AttemptResult {
    if (!isRecord(json) || !Array.isArray(json['choices'])) return { kind: 'error' };
    const choice: unknown = json['choices'][0];
    const message = isRecord(choice) ? choice['message'] : undefined;
    const rawCalls = isRecord(message) ? message['tool_calls'] : undefined;
    const toolCalls: unknown[] = Array.isArray(rawCalls) ? [...rawCalls] : [];
    const usage = isRecord(json['usage']) ? json['usage'] : {};
    return {
      kind: 'ok',
      toolCalls,
      promptTokens: tokenCount(usage['prompt_tokens']),
      completionTokens: tokenCount(usage['completion_tokens']),
    };
  }
}

// ---------------------------------------------------------------- helpers ----

export interface ParsedToolCall {
  name: string;
  /** Raw `arguments`: usually a JSON string, sometimes an already-parsed object. */
  args: unknown;
}

/** Read name and arguments from an OpenAI-shaped (or flat) tool call. */
export function readToolCall(call: unknown): ParsedToolCall | null {
  if (!isRecord(call)) return null;
  const fn = isRecord(call['function']) ? call['function'] : call;
  const name = fn['name'];
  if (typeof name !== 'string') return null;
  return { name, args: fn['arguments'] };
}

/** The first tool call with this name; later calls and other tools are ignored. */
export function firstToolCall(toolCalls: readonly unknown[], name: string): ParsedToolCall | null {
  for (const call of toolCalls) {
    const parsed = readToolCall(call);
    if (parsed !== null && parsed.name === name) return parsed;
  }
  return null;
}

/** Tool-call arguments as JSON text (objects are serialized); null when not JSON-like. */
export function argsAsText(args: unknown): string | null {
  if (typeof args === 'string') return args;
  if (isRecord(args)) return JSON.stringify(args);
  return null;
}
