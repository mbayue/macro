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
import {
  fetchAndActivate,
  getBoolean,
  getRemoteConfig,
  getString,
  type RemoteConfig,
} from 'firebase/remote-config';
import type { FirebaseWebConfig } from '../../../../../src/api-types.ts';
import type { CapacityReport } from '../../../../../src/report/build.ts';
import { allowedNumbers, guardText, type GuardResult } from '../../../../../src/report/number-guard.ts';

export type InferenceOrigin = 'on-device' | 'cloud' | 'unknown';
export type OnDeviceAvailability = 'ready' | 'downloading' | 'cloud-fallback' | 'on-device-unavailable';
export type LanguageModelProbe = () => Promise<string>;

export interface HybridRemoteConfig {
  enabled: boolean;
  mode: InferenceMode;
  cloudModel: string;
  scenarioAssistantInstruction: string;
  reportQaSystemInstruction: string;
}

export interface HybridRemoteConfigRaw {
  hybrid_ai_enabled?: boolean | string;
  hybrid_inference_mode?: string;
  hybrid_cloud_model?: string;
  scenario_assistant_instruction?: string;
  report_qa_system_instruction?: string;
}

export const DEFAULT_SCENARIO_ASSISTANT_INSTRUCTION =
  'Refine this traffic description with clear ramp-up and peak stages, realistic catalog route mix, and exact virtual user counts and durations.';

export const DEFAULT_REPORT_QA_SYSTEM_INSTRUCTION =
  'You are Macro Report Q&A. Answer the user question concisely using ONLY the measured metrics below.';

export const DEFAULT_HYBRID_REMOTE_CONFIG: HybridRemoteConfig = {
  enabled: true,
  mode: InferenceMode.PREFER_ON_DEVICE,
  cloudModel: 'gemini-2.5-flash',
  scenarioAssistantInstruction: DEFAULT_SCENARIO_ASSISTANT_INSTRUCTION,
  reportQaSystemInstruction: DEFAULT_REPORT_QA_SYSTEM_INSTRUCTION,
};

const VALID_INFERENCE_MODES = new Set<string>(Object.values(InferenceMode));

/** Parses raw Firebase Remote Config parameter values into a validated HybridRemoteConfig with safe defaults. */
export function parseHybridRemoteConfig(raw: HybridRemoteConfigRaw): HybridRemoteConfig {
  const rawEnabled = raw.hybrid_ai_enabled;
  const enabled =
    typeof rawEnabled === 'boolean'
      ? rawEnabled
      : typeof rawEnabled === 'string' && rawEnabled.trim() !== ''
        ? rawEnabled.trim().toLowerCase() !== 'false'
        : DEFAULT_HYBRID_REMOTE_CONFIG.enabled;

  const rawMode = raw.hybrid_inference_mode?.trim();
  const mode: InferenceMode =
    rawMode && VALID_INFERENCE_MODES.has(rawMode)
      ? (rawMode as InferenceMode)
      : DEFAULT_HYBRID_REMOTE_CONFIG.mode;

  const cloudModel = raw.hybrid_cloud_model?.trim() || DEFAULT_HYBRID_REMOTE_CONFIG.cloudModel;
  const scenarioAssistantInstruction =
    raw.scenario_assistant_instruction?.trim() || DEFAULT_HYBRID_REMOTE_CONFIG.scenarioAssistantInstruction;
  const reportQaSystemInstruction =
    raw.report_qa_system_instruction?.trim() || DEFAULT_HYBRID_REMOTE_CONFIG.reportQaSystemInstruction;

  return {
    enabled,
    mode,
    cloudModel,
    scenarioAssistantInstruction,
    reportQaSystemInstruction,
  };
}

/** Resolves the pre-flight availability label by combining Chrome's Nano status with the active InferenceMode. */
export function resolveHybridAvailability(
  onDeviceStatus: Exclude<OnDeviceAvailability, 'on-device-unavailable'>,
  mode: InferenceMode,
): OnDeviceAvailability {
  if (mode === InferenceMode.ONLY_IN_CLOUD || mode === InferenceMode.PREFER_IN_CLOUD) {
    return 'cloud-fallback';
  }
  if (mode === InferenceMode.ONLY_ON_DEVICE && onDeviceStatus === 'cloud-fallback') {
    return 'on-device-unavailable';
  }
  return onDeviceStatus;
}

export interface HybridReply {
  text: string;
  origin: InferenceOrigin;
}

export type HybridRunner = (
  prompt: string,
  onChunk?: (text: string) => void,
  signal?: AbortSignal,
) => Promise<HybridReply>;

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
export function buildReportQaPrompt(
  report: CapacityReport,
  question: string,
  systemInstruction?: string,
): string {
  const lead = systemInstruction?.trim() || DEFAULT_REPORT_QA_SYSTEM_INSTRUCTION;
  return [
    lead,
    'Reply in plain text only (no markdown, no **bold** or bullet formatting).',
    'Never invent numbers, routes, or causes that are not supported by the metrics. If a value is missing, say so.',
    '',
    summarizeReportForQa(report),
    '',
    `Question: ${question.trim()}`,
  ].join('\n');
}

export const AI_HELPER_UNAVAILABLE = "AI helper isn't available right now";

function defaultLanguageModelProbe(): LanguageModelProbe | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    LanguageModel?: { availability?: () => Promise<string> };
  };
  if (typeof g.LanguageModel?.availability === 'function') {
    return () => g.LanguageModel!.availability!();
  }
  return null;
}

/** Checks Chrome Built-in AI (Gemini Nano) availability before running a prompt. */
export async function detectOnDeviceAvailability(
  probe?: LanguageModelProbe,
): Promise<Exclude<OnDeviceAvailability, 'on-device-unavailable'>> {
  const fn = probe ?? defaultLanguageModelProbe();
  if (!fn) return 'cloud-fallback';
  try {
    const status = (await fn()).toLowerCase();
    if (status === 'available' || status === 'readily') return 'ready';
    if (status === 'downloading' || status === 'downloadable' || status === 'after-download') return 'downloading';
    return 'cloud-fallback';
  } catch {
    return 'cloud-fallback';
  }
}

/** Verifies numbers in a Report Q&A reply against the measured CapacityReport values. */
export function verifyReportQaReply(replyText: string, report: CapacityReport): GuardResult {
  return guardText(replyText, allowedNumbers(report));
}

export type HybridPromptResult =
  | { ok: true; reply: HybridReply }
  | { ok: false; aborted: true }
  | { ok: false; aborted?: false; error: string };

/** Executes a hybrid prompt through the provided runner and normalizes errors, aborts, and empty outputs. */
export async function runHybridPrompt(
  runner: HybridRunner,
  prompt: string,
  onChunk?: (text: string) => void,
  signal?: AbortSignal,
): Promise<HybridPromptResult> {
  if (signal?.aborted) return { ok: false, aborted: true };
  try {
    const reply = await runner(prompt, onChunk, signal);
    if (signal?.aborted) return { ok: false, aborted: true };
    const text = reply.text.trim();
    if (!text) return { ok: false, error: 'Model returned an empty response.' };
    return { ok: true, reply: { text, origin: reply.origin } };
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      return { ok: false, aborted: true };
    }
    console.error('Hybrid inference error:', err);
    return { ok: false, error: AI_HELPER_UNAVAILABLE };
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

const remoteConfigCache = new Map<string, Promise<HybridRemoteConfig>>();

function isDevEnvironment(): boolean {
  const metaEnv = (import.meta as { env?: { DEV?: boolean } }).env;
  return Boolean(metaEnv?.DEV);
}

function readHybridRemoteConfig(rc: RemoteConfig): HybridRemoteConfig {
  return parseHybridRemoteConfig({
    hybrid_ai_enabled: getBoolean(rc, 'hybrid_ai_enabled'),
    hybrid_inference_mode: getString(rc, 'hybrid_inference_mode'),
    hybrid_cloud_model: getString(rc, 'hybrid_cloud_model'),
    scenario_assistant_instruction: getString(rc, 'scenario_assistant_instruction'),
    report_qa_system_instruction: getString(rc, 'report_qa_system_instruction'),
  });
}

/**
 * Fetches and activates Firebase Remote Config once per app session.
 * Silently falls back to built-in defaults if offline, timed out, or blocked.
 */
export function fetchHybridRemoteConfig(config: FirebaseWebConfig): Promise<HybridRemoteConfig> {
  const cached = remoteConfigCache.get(config.appId);
  if (cached) return cached;

  const pending = (async (): Promise<HybridRemoteConfig> => {
    try {
      const app = getOrCreateFirebaseApp(config);
      const rc = getRemoteConfig(app);
      rc.settings = {
        fetchTimeoutMillis: 5_000,
        minimumFetchIntervalMillis: isDevEnvironment() ? 0 : 3_600_000,
      };
      rc.defaultConfig = {
        hybrid_ai_enabled: DEFAULT_HYBRID_REMOTE_CONFIG.enabled,
        hybrid_inference_mode: DEFAULT_HYBRID_REMOTE_CONFIG.mode,
        hybrid_cloud_model: DEFAULT_HYBRID_REMOTE_CONFIG.cloudModel,
        scenario_assistant_instruction: DEFAULT_HYBRID_REMOTE_CONFIG.scenarioAssistantInstruction,
        report_qa_system_instruction: DEFAULT_HYBRID_REMOTE_CONFIG.reportQaSystemInstruction,
      };
      await fetchAndActivate(rc);
      return readHybridRemoteConfig(rc);
    } catch {
      return DEFAULT_HYBRID_REMOTE_CONFIG;
    }
  })();

  remoteConfigCache.set(config.appId, pending);
  return pending;
}

function getOrCreateHybridModel(
  config: FirebaseWebConfig,
  remoteConfig: HybridRemoteConfig = DEFAULT_HYBRID_REMOTE_CONFIG,
): GenerativeModel {
  const cacheKey = JSON.stringify({
    config,
    mode: remoteConfig.mode,
    cloudModel: remoteConfig.cloudModel,
  });
  let model = modelCache.get(cacheKey);
  if (!model) {
    const app = getOrCreateFirebaseApp(config);
    if (config.appCheckSiteKey) ensureAppCheck(app, config.appCheckSiteKey);
    const ai = getAI(app, {
      backend: new GoogleAIBackend(),
      ...(config.appCheckSiteKey ? { useLimitedUseAppCheckTokens: true } : {}),
    });
    model = getGenerativeModel(ai, {
      mode: remoteConfig.mode,
      inCloudParams: { model: remoteConfig.cloudModel },
    });
    modelCache.set(cacheKey, model);
  }
  return model;
}

/**
 * Creates a HybridRunner backed by Firebase AI Logic with Remote Config mode and cloud model settings.
 * SDK initialization is deferred until the first prompt is executed.
 * Streams content in real-time via `generateContentStream` when available.
 */
export function createFirebaseHybridRunner(
  config: FirebaseWebConfig,
  remoteConfig: HybridRemoteConfig = DEFAULT_HYBRID_REMOTE_CONFIG,
): HybridRunner {
  return async (prompt: string, onChunk?: (text: string) => void, signal?: AbortSignal): Promise<HybridReply> => {
    const model = getOrCreateHybridModel(config, remoteConfig);
    const requestOptions = signal ? { signal } : undefined;
    if (typeof model.generateContentStream === 'function') {
      const result = await model.generateContentStream(prompt, requestOptions);
      let fullText = '';
      for await (const chunk of result.stream) {
        if (signal?.aborted) break;
        const chunkText = chunk.text();
        fullText += chunkText;
        onChunk?.(fullText);
      }
      if (signal?.aborted) {
        return { text: fullText, origin: 'unknown' };
      }
      const response = await result.response;
      return {
        text: fullText || response.text(),
        origin: mapInferenceSource(response.inferenceSource),
      };
    }
    const result = await model.generateContent(prompt, requestOptions);
    if (signal?.aborted) {
      return { text: '', origin: 'unknown' };
    }
    const text = result.response.text();
    onChunk?.(text);
    return {
      text,
      origin: mapInferenceSource(result.response.inferenceSource),
    };
  };
}
