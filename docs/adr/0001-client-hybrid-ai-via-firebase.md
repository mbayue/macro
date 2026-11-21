# Client-side Hybrid AI via Firebase AI Logic

Macro runs server-side LLM calls for test planning, supervision, and report narration, which are rate-limited (`10/hr` planning quota). We decided to incorporate client-side **Hybrid Inference** via Firebase AI Logic (`InferenceMode.PREFER_ON_DEVICE`) as a core capability for the **Scenario Assistant** and **Report Q&A**, providing on-device Gemini Nano execution with cloud fallback.

## Considered Options

- **Proxy Gemini through Macro's Bun server**: Simpler CSP, but cannot use Chrome's on-device Gemini Nano and consumes server quota/bandwidth.
- **Client-side Firebase AI Logic (`PREFER_ON_DEVICE`)**: Enables zero-quota on-device inference in supported browsers with automatic cloud Gemini fallback, exposing public Firebase web config via `GET /api/config`, extending CSP `connect-src`, and supporting App Check protection.
