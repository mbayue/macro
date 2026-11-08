#!/usr/bin/env bash
# Install gVisor (runsc) from the official apt repository and register it with Docker.
# Idempotent. Run as root on Ubuntu 24.04. Requirements 6.12, 6.13.
set -euo pipefail

KEYRING=/usr/share/keyrings/gvisor-archive-keyring.gpg
LIST=/etc/apt/sources.list.d/gvisor.list
KEY_URL=https://gvisor.dev/archive.key
REPO_URL=https://storage.googleapis.com/gvisor/releases

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed" >&2
  exit 1
fi

apt-get update -qq
apt-get install -y -qq apt-transport-https ca-certificates curl gnupg

# 1. Signing key -> /usr/share/keyrings, then verify it parses as a public key.
tmp_key="$(mktemp)"
trap 'rm -f "$tmp_key"' EXIT
curl -fsSL "$KEY_URL" -o "$tmp_key"
if ! gpg --show-keys --with-colons "$tmp_key" | grep -q '^pub:'; then
  echo "downloaded gVisor key is not a valid OpenPGP public key" >&2
  exit 1
fi
gpg --dearmor --yes -o "$KEYRING" < "$tmp_key"
chmod 0644 "$KEYRING"
echo "gVisor signing key fingerprint(s):"
gpg --show-keys --with-colons "$KEYRING" | awk -F: '$1=="fpr"{print "  " $10}'

# 2. Apt source pinned to that keyring. apt rejects the repo if the signature does not verify.
arch="$(dpkg --print-architecture)"
echo "deb [arch=${arch} signed-by=${KEYRING}] ${REPO_URL} release main" > "$LIST"
apt-get update -qq
apt-get install -y -qq runsc

# 3. Register the runtime with Docker (runsc install merges into /etc/docker/daemon.json).
if docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q '"runsc"'; then
  echo "runsc already registered with Docker"
else
  runsc install
  systemctl restart docker
fi

# 4. Wait for Docker, then verify.
for _ in $(seq 1 30); do
  docker info >/dev/null 2>&1 && break
  sleep 1
done
runtimes="$(docker info --format '{{json .Runtimes}}')"
echo "docker runtimes: ${runtimes}"
if ! echo "$runtimes" | grep -q '"runsc"'; then
  echo "runsc is not listed under Docker runtimes" >&2
  exit 1
fi
echo "runsc version:"
runsc --version
