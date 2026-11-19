/**
 * Client-side Hybrid Inference helper via Firebase AI Logic.
 * Prefers Chrome's on-device Gemini Nano and automatically falls back to cloud Gemini.
 */
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
} from 'firebase/ai';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import type { FirebaseWebConfig } from '../../../../../src/api-types.ts';
import type { CapacityReport } from '../../../../../src/report/build.ts';

export type InferenceOrigin = 'on-device' | 'cloud' | 'unknown';

export interface HybridReply {
  text: string;
  origin: InferenceOrigin;
}

export type HybridRunner = (prompt: string) => Promise<HybridReply>;

const modelCache = new Map<string, GenerativeModel>();
const appCheckInitialized = new Set<string>();

/** Maps Firebase AI Logic's InferenceSource enum to a UI-friendly origin label. */
export function mapInferenceSource(source: InferenceSource | undefined): InferenceOrigin {
  if (source === InferenceSource.ON_DEVICE) return 'on-device';
  if (source === InferenceSource.IN_CLOUD) return 'cloud';
  return 'unknown';
}

/** Builds a prompt for the Scenario Assistant to refine a plain-English Traffic Description. */
export function buildScenarioPrompt(opts: {
  draft: string;
  instruction: string;
  routes: readonly string[];
}): string {
  const routeList = opts.routes.length > 0 ? opts.routes.slice(0, 12).join(', ') : '(default catalog routes)';
  const currentDraft = opts.draft.trim() || '(empty — create a realistic starting scenario)';
  return [
    'You are Macro Scenario Assistant, helping a developer write a clear plain-English Traffic Description for a load test.',
    'Return ONLY the refined plain-English Traffic Description (1 to 3 sentences, max 500 characters). No markdown, no quotes, no preamble.',
    'Include concrete user counts (10 to 1000), traffic shape (steady, ramp, or spike), and user actions.',
    `Available routes on target: ${routeList}`,
    `Current draft: ${currentDraft}`,
    `Refinement goal: ${opts.instruction}`,
  ].join('\n');
}

/** Formats a CapacityReport into a compact, deterministic metrics summary for Report Q&A. */
export function summarizeReportForQa(report: CapacityReport): string {
  const lines: string[] = [
    `Plan: ${report.planName} | Target: ${report.target} | Status: ${report.headline.status}`,
    `Thresholds: p95 <= ${report.thresholds.p95Ms} ms, error rate <= ${report.thresholds.errorRatePct}%`,
    `Safe capacity: ${report.headline.safeCapacity !== null ? `${report.headline.safeCapacity} VUs` : 'none'}`,
    `Breaking point: ${report.headline.breakingPoint !== null ? `${report.headline.breakingPoint} VUs` : 'not reached'}`,
    `First degraded route: ${report.headline.firstDegradedRoute ?? 'none'}`,
  ];

  for (const s of report.stages) {
    const o = s.overall?.display;
    const metrics = o
      ? `reqs=${o.requests}, rps=${o.rps}, err=${o.errorRatePct}, 429=${o.http429}, p50=${o.p50}, p95=${o.p95}, p99=${o.p99}`
      : `no metrics (${s.errorReason ?? s.status})`;
    lines.push(`Stage ${s.displayIndex} (${s.vus} VUs, ${s.durationSec}s, verdict=${s.verdict ?? s.status}): ${metrics}`);

    for (const r of s.routes) {
      lines.push(
        `  - ${r.route}${r.exceedsThresholds ? ' [EXCEEDED]' : ''}: rps=${r.display.rps}, err=${r.display.errorRatePct}, p95=${r.display.p95}, p99=${r.display.p99}`,
      );
    }
  }

  return lines.join('\n');
}

/** Builds a grounded prompt for Report Q&A using only measured CapacityReport numbers. */
export function buildReportQaPrompt(report: CapacityReport, question: string): string {
  return [
    'You are Macro Report Q&A. Answer the user question concisely using ONLY the measured metrics below.',
    'Reply in plain text only (no markdown, no **bold** or bullet formatting).',
    'Never invent numbers, routes, or causes that are not supported by the metrics. If a value is missing, say so.',
    '',
    summarizeReportForQa(report),
    '',
    `Question: ${question.trim()}`,
  ].join('\n');
}

/** Executes a hybrid prompt through the provided runner and normalizes errors/empty outputs. */
export async function runHybridPrompt(
  runner: HybridRunner,
  prompt: string,
): Promise<{ ok: true; reply: HybridReply } | { ok: false; error: string }> {
  try {
    const reply = await runner(prompt);
    const text = reply.text.trim();
    if (!text) return { ok: false, error: 'Model returned an empty response.' };
    return { ok: true, reply: { text, origin: reply.origin } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Hybrid inference failed.' };
  }
}

function getOrCreateFirebaseApp(config: FirebaseWebConfig): FirebaseApp {
  const apps = getApps();
  const existing = apps.find((a) => a.options.appId === config.appId);
  if (existing) return existing;
  const options = {
    apiKey: config.apiKey,
    appId: config.appId,
    projectId: config.projectId,
    ...(config.authDomain ? { authDomain: config.authDomain } : {}),
    ...(config.measurementId ? { measurementId: config.measurementId } : {}),
  };
  return apps.length === 0 ? initializeApp(options) : initializeApp(options, `macro-${config.appId}`);
}

function ensureAppCheck(app: FirebaseApp, siteKey: string): void {
  if (appCheckInitialized.has(app.name)) return;
  const metaEnv = (import.meta as { env?: { DEV?: boolean; VITE_APP_CHECK_DEBUG_TOKEN?: string } }).env;
  if (typeof self !== 'undefined' && metaEnv?.DEV) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      metaEnv.VITE_APP_CHECK_DEBUG_TOKEN || true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  appCheckInitialized.add(app.name);
}

function getOrCreateHybridModel(config: FirebaseWebConfig): GenerativeModel {
  const cacheKey = JSON.stringify(config);
  let model = modelCache.get(cacheKey);
  if (!model) {
    const app = getOrCreateFirebaseApp(config);
    if (config.appCheckSiteKey) ensureAppCheck(app, config.appCheckSiteKey);
    const ai = getAI(app, {
      backend: new GoogleAIBackend(),
      ...(config.appCheckSiteKey ? { useLimitedUseAppCheckTokens: true } : {}),
    });
    model = getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE });
    modelCache.set(cacheKey, model);
  }
  return model;
}

/**
 * Creates a HybridRunner backed by Firebase AI Logic (`InferenceMode.PREFER_ON_DEVICE`).
 * SDK initialization is deferred until the first prompt is executed.
 */
export function createFirebaseHybridRunner(config: FirebaseWebConfig): HybridRunner {
  return async (prompt: string): Promise<HybridReply> => {
    const model = getOrCreateHybridModel(config);
    const result = await model.generateContent(prompt);
    return {
      text: result.response.text(),
      origin: mapInferenceSource(result.response.inferenceSource),
    };
  };
}
