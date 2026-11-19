# gVisor Sandbox and Allowlist Egress Proxy

Each load-test Stage runs k6 in an ephemeral, read-only gVisor (`runsc`) container on an internal-only Docker network whose sole exit is a per-run HTTP `CONNECT` egress proxy (`proxy/proxy.ts`), while `macro-api` itself accesses Docker only through a least-privilege socket proxy.

## Considered Options

- **Run k6 directly on the API host or standard Docker bridge**: Lower operational complexity, but exposes the host network, cloud metadata (`169.254.169.254`), and internal services if a script or runtime is compromised.
- **gVisor + internal network + egress proxy + socket proxy**: Harder to set up and requires `runsc` on the host, but isolates every stage at the kernel, network, and Docker-API boundaries and is verifiable on demand via Containment Probes.
