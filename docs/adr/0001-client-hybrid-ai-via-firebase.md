# Client-side Hybrid AI via Firebase AI Logic

Macro already runs server-side LLM calls for test planning, supervision, and report narration, which are rate-limited (`10/hr` planning quota). We decided to add client-side **Hybrid Inference** via Firebase AI Logic (`InferenceMode.PREFER_ON_DEVICE`) for the **Scenario Assistant** and **Report Q&A**, keeping Firebase optional (`firebase: null` in `GET /api/config` when unconfigured) so the core server-side pipeline remains unaffected.

## Considered Options

- **Proxy Gemini through Macro's Bun server**: Simpler CSP, but cannot use Chrome's on-device Gemini Nano and consumes server quota/bandwidth.
- **Client-side Firebase AI Logic (`PREFER_ON_DEVICE`)**: Enables zero-quota on-device inference in supported browsers with automatic cloud Gemini fallback, at the cost of exposing public Firebase web config via `GET /api/config`, extending CSP `connect-src`, and supporting optional App Check.
