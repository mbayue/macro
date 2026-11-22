# Client-side Hybrid AI via Firebase AI Logic

Macro runs server-side LLM calls for test planning, supervision, and report narration, which are rate-limited (`10/hr` planning quota). We decided to incorporate client-side **Hybrid Inference** via Firebase AI Logic (`InferenceMode.PREFER_ON_DEVICE`) as a core capability for the **Scenario Assistant** and **Report Q&A**, providing on-device Gemini Nano execution with cloud fallback.

## Considered Options

- **Proxy Gemini through Macro's Bun server**: Simpler CSP, but cannot use Chrome's on-device Gemini Nano and consumes server quota/bandwidth.
- **Client-side Firebase AI Logic (`PREFER_ON_DEVICE`)**: Enables zero-quota on-device inference in supported browsers with automatic cloud Gemini fallback, exposing public Firebase web config via `GET /api/config`, extending CSP `connect-src`, and supporting App Check protection.

## Client Safeguards

- **Pre-flight availability detection & runtime fallback**: Probes `LanguageModel.availability()` on mount and combines it with Remote Config's active `hybrid_inference_mode` so Scenario Assistant and Report Q&A surface `On-Device Model: Gemini Nano`, `Gemini Nano downloading`, `On-Device Only: Unavailable`, or `Cloud Model: <formatted model>` (e.g., `Cloud Model: Gemini 3.8 Flash`) before a prompt runs. If `PREFER_ON_DEVICE` throws a non-abort runtime error (such as Chrome failing to start a local session), the runner automatically retries once with `ONLY_IN_CLOUD` and updates the badge immediately without a page reload.
- **Firebase Remote Config tuning**: Fetches and activates `remoteconfig.template.json` parameters (`hybrid_ai_enabled`, `hybrid_inference_mode`, `hybrid_cloud_model`, `scenario_assistant_instruction`, `report_qa_system_instruction`) once per session with a 5 s timeout and built-in defaults, allowing model rollouts, mode switches, prompt tuning, and an emergency kill switch without redeploying. CSP `connect-src` allows `https://firebaseremoteconfig.googleapis.com` and `https://firebaseinstallations.googleapis.com`; offline or blocked fetches silently fall back to defaults.
- **Offline-cached Cloud Firestore Scenario Library**: Reads curated public `scenario_templates` documents via `firebase/firestore` (`persistentLocalCache`) protected by `firestore.rules` (read-only public templates with `list` bounded to `limit <= 20`, default-deny everywhere else) and App Check, extending Test Studio's example chips with instant fallback to `GET /api/config` examples (`https://firestore.googleapis.com` in CSP `connect-src`).
- **Stream cancellation**: Passes an `AbortController` signal into `generateContentStream` / `generateContent` so clicking **Stop** aborts the request and preserves any streamed partial text.
- **Client-side Number Guard**: Verifies completed Report Q&A replies against `CapacityReport` numbers (`allowedNumbers` + `guardText`) and warns when unverified numbers appear.
