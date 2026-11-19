# Deterministic Policy Gate and Number Guard

Macro separates AI proposal from deterministic enforcement: the Planner drafts a Test Plan, but `src/plan/policy.ts` enforces target allowlists, route membership, stage/VU/duration caps, and plan-hash approval before execution; similarly, `src/report/number-guard.ts` withholds AI-generated Capacity Report prose if it cites any number absent from measured k6 metrics.

## Considered Options

- **Trust LLM structured output directly**: Simpler pipeline, but prompt injection or model drift could target unverified hosts, exceed safe VU limits, or fabricate report numbers.
- **Model proposes, fixed code decides**: Adds deterministic validation and number-checking layers, guaranteeing that no unverified target or unmeasured metric ever reaches execution or the user's Capacity Report.
