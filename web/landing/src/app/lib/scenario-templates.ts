/**
 * Client-side Cloud Firestore Scenario Library (`scenario_templates`).
 * Dynamically loads `firebase/firestore` off the critical render path and uses offline persistence
 * (`persistentLocalCache`) so curated Traffic Description templates remain available offline
 * alongside On-Device Model (Gemini Nano), falling back to built-in examples.
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

const firestoreCache = new Map<string, Firestore>();
const templatesCache = new Map<string, Promise<readonly ScenarioTemplate[]>>();

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
    const order = typeof doc.order === 'number' && Number.isFinite(doc.order) ? doc.order : Number.MAX_SAFE_INTEGER;
    valid.push({ label, text, order });
  }

  valid.sort((a, b) => a.order - b.order);

  const seen = new Set<string>();
  const deduped: ScenarioTemplate[] = [];
  for (const item of valid) {
    const key = item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ label: item.label, text: item.text });
  }

  return deduped.length > 0 ? deduped : fallback;
}

/**
 * Fetches curated scenario templates from Cloud Firestore (`scenario_templates`),
 * cached once per app session with a 4 s timeout and silent fallback to built-in examples.
 */
export function fetchScenarioTemplates(
  config: FirebaseWebConfig,
  fallback: readonly ScenarioTemplate[],
): Promise<readonly ScenarioTemplate[]> {
  const cached = templatesCache.get(config.appId);
  if (cached) return cached;

  const pending = (async (): Promise<readonly ScenarioTemplate[]> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const firestoreMod = await import('firebase/firestore');
      let db = firestoreCache.get(config.appId);
      if (!db) {
        const app = getFirebaseAppWithAppCheck(config);
        try {
          db = firestoreMod.initializeFirestore(app, {
            localCache: firestoreMod.persistentLocalCache(),
          });
        } catch {
          db = firestoreMod.getFirestore(app);
        }
        firestoreCache.set(config.appId, db);
      }
      const q = firestoreMod.query(
        firestoreMod.collection(db, 'scenario_templates'),
        firestoreMod.orderBy('order', 'asc'),
        firestoreMod.limit(12),
      );
      const snap = await Promise.race([
        firestoreMod.getDocs(q),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Firestore scenario templates timed out')), 4_000);
        }),
      ]);
      const docs = snap.docs.map((d) => d.data() as RawScenarioTemplateDoc);
      return parseScenarioTemplates(docs, fallback);
    } catch {
      return fallback;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  })();

  templatesCache.set(config.appId, pending);
  return pending;
}
