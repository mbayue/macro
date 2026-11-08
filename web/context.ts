/**
 * Types shared by app.ts and every view. Kept separate from app.ts so views can
 * import them without a cycle.
 */
import type { ConfigResponse, ModelCallView, RunView } from '../src/api-types.ts';
import type { TestPlan } from '../src/types.ts';

/** Returned by a view's render function; called once when the user navigates away. */
export type ViewCleanup = () => void;

/** Route parameters: `{}` for the describe view, `{ id }` for run and probe views. */
export type RouteParams = Readonly<Record<string, string>>;

export interface AppContext {
  /** Result of GET /api/config, loaded once before the first view renders. */
  readonly config: ConfigResponse;
  /**
   * Go to a route. Accepts `/run/<id>`, `/probe/<id>`, `/` (a leading `#` is
   * also accepted). The id must already be URL-encoded (`encodeURIComponent`).
   */
  navigate(path: string): void;
  /** Speak a short message through the polite live region. */
  announce(message: string): void;
}

/**
 * Optional extras the Run view passes to the report view, so the report view
 * does not have to fetch the snapshot again. All fields are optional except runId.
 */
export interface ReportViewHelpers {
  runId: string;
  run?: RunView;
  plan?: TestPlan | null;
  modelCalls?: ModelCallView[];
}
