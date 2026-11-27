/**
 * Test Studio Firebase feed hook: loads scenario templates and featured runs once per config,
 * subscribes to active announcements, and handles cancellation/unsubscribe cleanup.
 */
import { useCallback, useEffect, useState } from 'react';
import type { FirebaseWebConfig } from '../../../../../src/api-types.ts';
import {
  type ActiveAnnouncement,
  type FeaturedRunItem,
  fetchFeaturedRuns,
  fetchScenarioTemplates,
  type ScenarioTemplate,
  subscribeActiveAnnouncement,
} from '../lib/scenario-templates.ts';

/** Builds the default featured-run list from the configured public sample run ID. */
export function defaultFeaturedRuns(sampleRunId: string | null | undefined): readonly FeaturedRunItem[] {
  return sampleRunId
    ? [
        {
          runId: sampleRunId,
          label: 'View sample report',
          summary: 'Inspect a completed public demo run with stages, charts, and capacity verdict.',
        },
      ]
    : [];
}

export interface StudioFeedDeps {
  fetchScenarioTemplates: typeof fetchScenarioTemplates;
  fetchFeaturedRuns: typeof fetchFeaturedRuns;
  subscribeActiveAnnouncement: typeof subscribeActiveAnnouncement;
}

const DEFAULT_DEPS: StudioFeedDeps = {
  fetchScenarioTemplates,
  fetchFeaturedRuns,
  subscribeActiveAnnouncement,
};

export interface SubscribeStudioFeedOptions {
  firebase: FirebaseWebConfig;
  fallbackExamples: readonly ScenarioTemplate[];
  fallbackRuns: readonly FeaturedRunItem[];
}

export interface SubscribeStudioFeedCallbacks {
  onExamples: (examples: readonly ScenarioTemplate[]) => void;
  onFeaturedRuns: (runs: readonly FeaturedRunItem[]) => void;
  onAnnouncement: (announcement: ActiveAnnouncement | null) => void;
}

/**
 * Loads scenario templates, featured runs, and active announcement subscription from Firestore
 * with cancellation guarding and an unsubscribe cleanup callback.
 */
export function subscribeStudioFeed(
  options: SubscribeStudioFeedOptions,
  callbacks: SubscribeStudioFeedCallbacks,
  deps: StudioFeedDeps = DEFAULT_DEPS,
): () => void {
  let cancelled = false;
  void deps.fetchScenarioTemplates(options.firebase, options.fallbackExamples).then((templates) => {
    if (!cancelled) callbacks.onExamples(templates);
  });
  void deps.fetchFeaturedRuns(options.firebase, options.fallbackRuns).then((runs) => {
    if (!cancelled) callbacks.onFeaturedRuns(runs);
  });
  const unsubAnnouncement = deps.subscribeActiveAnnouncement(options.firebase, (next) => {
    if (!cancelled) callbacks.onAnnouncement(next);
  });
  return () => {
    cancelled = true;
    unsubAnnouncement();
  };
}

export interface UseFirebaseStudioFeedOptions {
  firebase: FirebaseWebConfig | null | undefined;
  examples: readonly ScenarioTemplate[];
  sampleRunId: string | null | undefined;
}

export interface StudioFeedState {
  examples: readonly ScenarioTemplate[];
  featuredRuns: readonly FeaturedRunItem[];
  announcement: ActiveAnnouncement | null;
  dismissAnnouncement: () => void;
}

/** Subscribes to Firebase Test Studio catalog data and dismissible status announcements. */
export function useFirebaseStudioFeed({
  firebase,
  examples: fallbackExamples,
  sampleRunId,
}: UseFirebaseStudioFeedOptions): StudioFeedState {
  const [examples, setExamples] = useState<readonly ScenarioTemplate[]>(() => fallbackExamples);
  const [featuredRuns, setFeaturedRuns] = useState<readonly FeaturedRunItem[]>(() =>
    defaultFeaturedRuns(sampleRunId),
  );
  const [rawAnnouncement, setRawAnnouncement] = useState<ActiveAnnouncement | null>(null);
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState<string | null>(null);

  useEffect(() => {
    if (!firebase) return;
    let unsub: (() => void) | null = null;
    // Defer Firestore + App Check hydration off the initial paint/TTI window;
    // fallbackExamples and sampleRunId from /api/config render immediately.
    const timer = globalThis.setTimeout(() => {
      unsub = subscribeStudioFeed(
        {
          firebase,
          fallbackExamples,
          fallbackRuns: defaultFeaturedRuns(sampleRunId),
        },
        {
          onExamples: setExamples,
          onFeaturedRuns: setFeaturedRuns,
          onAnnouncement: setRawAnnouncement,
        },
      );
    }, 2500);
    return () => {
      globalThis.clearTimeout(timer);
      unsub?.();
    };
  }, [firebase, fallbackExamples, sampleRunId]);

  const announcement =
    rawAnnouncement !== null && dismissedAnnouncement !== rawAnnouncement.message ? rawAnnouncement : null;

  const dismissAnnouncement = useCallback(() => {
    if (rawAnnouncement !== null) setDismissedAnnouncement(rawAnnouncement.message);
  }, [rawAnnouncement]);

  return { examples, featuredRuns, announcement, dismissAnnouncement };
}
