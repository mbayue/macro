/**
 * Client-side Cloud Firestore public read-only catalog helpers:
 * - `scenario_templates`: curated Traffic Description chips for Test Studio
 * - `qa_prompts`: curated follow-up questions for Report Q&A
 * - `featured_runs`: curated public sample runs for Test Studio
 * - `announcements`: real-time `onSnapshot` status notice banner
 *
 * Dynamically loads `firebase/firestore` off the critical render path and uses offline persistence
 * (`persistentLocalCache`) so cached catalog data remains available offline alongside Gemini Nano.
 */
import type { Firestore } from 'firebase/firestore';
import type { FirebaseWebConfig } from '../../../../../src/api-types.ts';
import { getFirebaseAppWithAppCheck } from './hybrid-ai.ts';

export interface ScenarioTemplate {
  label: string;
  text: string;
}

export interface RawScenarioTemplateDoc {
  label?: unknown;
  text?: unknown;
  order?: unknown;
  active?: unknown;
}

export interface RawQaPromptDoc {
  question?: unknown;
  order?: unknown;
  active?: unknown;
}

export interface FeaturedRunItem {
  runId: string;
  label: string;
  summary: string;
}

export interface RawFeaturedRunDoc {
  runId?: unknown;
  label?: unknown;
  summary?: unknown;
  order?: unknown;
  active?: unknown;
}

export interface ActiveAnnouncement {
  message: string;
  tone: 'info' | 'warn';
}

export interface RawAnnouncementDoc {
  message?: unknown;
  tone?: unknown;
  order?: unknown;
  active?: unknown;
}

type FirestoreModule = typeof import('firebase/firestore');

const SAFE_RUN_ID = /^[a-z0-9][a-z0-9-]{7,63}$/i;
const QUERY_TIMEOUT_MS = 4_000;

const firestoreCache = new Map<string, Firestore>();
const templatesCache = new Map<string, Promise<readonly ScenarioTemplate[]>>();
const qaPromptsCache = new Map<string, Promise<readonly string[]>>();
const featuredRunsCache = new Map<string, Promise<readonly FeaturedRunItem[]>>();

function finiteOrder(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function sortAndDedupe<T extends { order: number }, R>(
  items: T[],
  keyOf: (item: T) => string,
  mapOut: (item: T) => R,
  fallback: readonly R[],
): readonly R[] {
  items.sort((a, b) => a.order - b.order);
  const seen = new Set<string>();
  const out: R[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapOut(item));
  }
  return out.length > 0 ? out : fallback;
}

/** Validates, sorts, and deduplicates raw Firestore scenario_templates documents with safe fallback. */
export function parseScenarioTemplates(
  docs: readonly RawScenarioTemplateDoc[],
  fallback: readonly ScenarioTemplate[],
): readonly ScenarioTemplate[] {
  const valid: Array<{ label: string; text: string; order: number }> = [];
  for (const doc of docs) {
    if (doc.active === false) continue;
    if (typeof doc.label !== 'string' || typeof doc.text !== 'string') continue;
    const label = doc.label.trim();
    const text = doc.text.trim();
    if (label.length < 1 || label.length > 60) continue;
    if (text.length < 10 || text.length > 1000) continue;
    valid.push({ label, text, order: finiteOrder(doc.order) });
  }
  return sortAndDedupe(valid, (i) => i.label.toLowerCase(), ({ label, text }) => ({ label, text }), fallback);
}

/** Validates, sorts, and deduplicates raw Firestore qa_prompts documents with safe fallback. */
export function parseQaPrompts(
  docs: readonly RawQaPromptDoc[],
  fallback: readonly string[],
): readonly string[] {
  const valid: Array<{ question: string; order: number }> = [];
  for (const doc of docs) {
    if (doc.active === false) continue;
    if (typeof doc.question !== 'string') continue;
    const question = doc.question.trim();
    if (question.length < 5 || question.length > 140) continue;
    valid.push({ question, order: finiteOrder(doc.order) });
  }
  return sortAndDedupe(valid, (i) => i.question.toLowerCase(), (i) => i.question, fallback);
}

/** Validates, sorts, and deduplicates raw Firestore featured_runs documents with safe fallback. */
export function parseFeaturedRuns(
  docs: readonly RawFeaturedRunDoc[],
  fallback: readonly FeaturedRunItem[],
): readonly FeaturedRunItem[] {
  const valid: Array<FeaturedRunItem & { order: number }> = [];
  for (const doc of docs) {
    if (doc.active === false) continue;
    if (typeof doc.runId !== 'string' || typeof doc.label !== 'string' || typeof doc.summary !== 'string') continue;
    const runId = doc.runId.trim();
    const label = doc.label.trim();
    const summary = doc.summary.trim();
    if (!SAFE_RUN_ID.test(runId)) continue;
    if (label.length < 1 || label.length > 60) continue;
    if (summary.length < 5 || summary.length > 160) continue;
    valid.push({ runId, label, summary, order: finiteOrder(doc.order) });
  }
  return sortAndDedupe(valid, (i) => i.runId, ({ runId, label, summary }) => ({ runId, label, summary }), fallback);
}

/** Selects the highest-priority active announcement from raw Firestore announcements documents. */
export function parseActiveAnnouncement(docs: readonly RawAnnouncementDoc[]): ActiveAnnouncement | null {
  const valid: Array<ActiveAnnouncement & { order: number }> = [];
  for (const doc of docs) {
    if (doc.active !== true) continue;
    if (typeof doc.message !== 'string') continue;
    if (doc.tone !== 'info' && doc.tone !== 'warn') continue;
    const message = doc.message.trim();
    if (message.length < 5 || message.length > 240) continue;
    valid.push({ message, tone: doc.tone, order: finiteOrder(doc.order) });
  }
  valid.sort((a, b) => a.order - b.order);
  const first = valid[0];
  return first ? { message: first.message, tone: first.tone } : null;
}

async function loadFirestoreDb(config: FirebaseWebConfig): Promise<{ mod: FirestoreModule; db: Firestore }> {
  const mod = await import('firebase/firestore');
  let db = firestoreCache.get(config.appId);
  if (!db) {
    const app = getFirebaseAppWithAppCheck(config);
    try {
      db = mod.initializeFirestore(app, { localCache: mod.persistentLocalCache() });
    } catch {
      db = mod.getFirestore(app);
    }
    firestoreCache.set(config.appId, db);
  }
  return { mod, db };
}

async function queryOrderedCollection<T>(
  config: FirebaseWebConfig,
  collectionName: string,
  maxDocs: number,
  parse: (docs: readonly Record<string, unknown>[]) => T,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { mod, db } = await loadFirestoreDb(config);
    const q = mod.query(mod.collection(db, collectionName), mod.orderBy('order', 'asc'), mod.limit(maxDocs));
    const snap = await Promise.race([
      mod.getDocs(q),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Firestore ${collectionName} timed out`)), QUERY_TIMEOUT_MS);
      }),
    ]);
    return parse(snap.docs.map((d) => d.data() as Record<string, unknown>));
  } catch {
    return fallback;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function cachedQuery<T>(
  cache: Map<string, Promise<T>>,
  config: FirebaseWebConfig,
  collectionName: string,
  maxDocs: number,
  parse: (docs: readonly Record<string, unknown>[]) => T,
  fallback: T,
): Promise<T> {
  const cached = cache.get(config.appId);
  if (cached) return cached;
  const pending = queryOrderedCollection(config, collectionName, maxDocs, parse, fallback);
  cache.set(config.appId, pending);
  return pending;
}

/** Fetches curated scenario templates from Cloud Firestore (`scenario_templates`), cached per session. */
export function fetchScenarioTemplates(
  config: FirebaseWebConfig,
  fallback: readonly ScenarioTemplate[],
): Promise<readonly ScenarioTemplate[]> {
  return cachedQuery(templatesCache, config, 'scenario_templates', 12, (docs) => parseScenarioTemplates(docs, fallback), fallback);
}

/** Fetches curated Report Q&A prompts from Cloud Firestore (`qa_prompts`), cached per session. */
export function fetchQaPrompts(
  config: FirebaseWebConfig,
  fallback: readonly string[],
): Promise<readonly string[]> {
  return cachedQuery(qaPromptsCache, config, 'qa_prompts', 12, (docs) => parseQaPrompts(docs, fallback), fallback);
}

/** Fetches curated featured benchmark runs from Cloud Firestore (`featured_runs`), cached per session. */
export function fetchFeaturedRuns(
  config: FirebaseWebConfig,
  fallback: readonly FeaturedRunItem[],
): Promise<readonly FeaturedRunItem[]> {
  return cachedQuery(featuredRunsCache, config, 'featured_runs', 6, (docs) => parseFeaturedRuns(docs, fallback), fallback);
}

/**
 * Subscribes to live status announcements from Cloud Firestore (`announcements`) via `onSnapshot`.
 * Filters `active == true` (bounded to 20 docs) so historical inactive notices never hide active ones.
 * Silently ignores errors and returns an unsubscribe cleanup function.
 */
export function subscribeActiveAnnouncement(
  config: FirebaseWebConfig,
  onUpdate: (announcement: ActiveAnnouncement | null) => void,
): () => void {
  let closed = false;
  let unsub: (() => void) | null = null;

  void loadFirestoreDb(config)
    .then(({ mod, db }) => {
      if (closed) return;
      const q = mod.query(mod.collection(db, 'announcements'), mod.where('active', '==', true), mod.limit(20));
      unsub = mod.onSnapshot(
        q,
        (snap) => {
          if (closed) return;
          onUpdate(parseActiveAnnouncement(snap.docs.map((d) => d.data() as RawAnnouncementDoc)));
        },
        () => {
          if (!closed) onUpdate(null);
        },
      );
    })
    .catch(() => {
      if (!closed) onUpdate(null);
    });

  return () => {
    closed = true;
    unsub?.();
  };
}
