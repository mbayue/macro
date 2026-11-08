#!/usr/bin/env bash
# Demo_Target smoke checks (task 3.5; requirements 14.2-14.6, 14.9, 14.10).
#
# Needs only bash, curl, and one of dig / nslookup / getent. Prints PASS / FAIL / SKIP
# per check and exits 1 if any check FAILs. Never prints values from the YUE .env,
# only variable names and counts.
#
# Usage: deploy/check.sh [options]
#   --from-macro   also run the 200-request burst ON the macro VM over ssh and
#                  require zero 429 (requirement 14.4: the macro VM is allowlisted)
#   --allowlisted  this host is itself allowlisted (e.g. you run the script on the
#                  macro VM): the local burst must then see zero 429 instead of some
#   --no-ssh       skip every check that needs ssh (YUE .env names, --from-macro)
#   -h, --help     show this help
#
# Note: the burst from a non-allowlisted host rate limits that host for about a minute.
# Wait 60 s before running the script again from the same IP.
#
# Environment overrides:
#   YUE_IP (45.32.113.74)  MACRO_IP (45.77.37.116)  WEB_HOST (yue.macro.my.id)
#   API_HOST (api.yue.macro.my.id)  YUE_ENV_FILE (/opt/yue/.env)  BURST (200)
#   SSH_KEY (~/.ssh/id_ed25519 when it exists)  SSH_USER (root)

YUE_IP="${YUE_IP:-45.32.113.74}"
MACRO_IP="${MACRO_IP:-45.77.37.116}"
WEB_HOST="${WEB_HOST:-yue.macro.my.id}"
API_HOST="${API_HOST:-api.yue.macro.my.id}"
YUE_ENV_FILE="${YUE_ENV_FILE:-/opt/yue/.env}"
BURST="${BURST:-200}"
SSH_USER="${SSH_USER:-root}"
LEDGER_URL="https://${API_HOST}/api/v1/orders/public?page=1"

FROM_MACRO=0
ALLOWLISTED=0
NO_SSH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from-macro) FROM_MACRO=1 ;;
    --allowlisted) ALLOWLISTED=1 ;;
    --no-ssh) NO_SSH=1 ;;
    -h|--help) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 2; }

SSH_KEY="${SSH_KEY:-}"
if [ -z "$SSH_KEY" ] && [ -f "$HOME/.ssh/id_ed25519" ]; then SSH_KEY="$HOME/.ssh/id_ed25519"; fi
ssh_to() { # ssh_to <ip> <remote command...>
  local ip="$1"; shift
  local opts=(-o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new)
  if [ -n "$SSH_KEY" ]; then opts+=(-i "$SSH_KEY"); fi
  ssh "${opts[@]}" "${SSH_USER}@${ip}" "$@"
}

FAILS=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }

# --- helpers ----------------------------------------------------------------

resolve_a() { # resolve_a <host>: IPv4 addresses, one per line
  if command -v dig >/dev/null 2>&1; then
    dig +short A "$1" | grep -E '^[0-9]+(\.[0-9]+){3}$'
  elif command -v nslookup >/dev/null 2>&1; then
    nslookup "$1" 2>/dev/null | awk '/^Name:/{seen=1} seen && /^Address(es)?:/{print $NF} seen && /^[ \t]+[0-9]+\./{print $1}' | grep -E '^[0-9]+(\.[0-9]+){3}$'
  else
    getent ahostsv4 "$1" | awk '{print $1}' | sort -u
  fi
}

# burst <url> <count>: prints "<http code> <count>" lines for <count> rapid requests
# over one curl process (one config line pair per request). Also used over ssh.
burst() {
  local url="$1" n="$2" i
  for ((i = 0; i < n; i++)); do printf 'url = "%s"\noutput = "/dev/null"\n' "$url"; done |
    curl -s -w '%{http_code}\n' --max-time 120 -K - | sort | uniq -c | awk '{print $2, $1}'
}

count_code() { # count_code <burst output> <code or 'other'>
  printf '%s\n' "$1" | awk -v c="$2" '$1==c {n+=$2} END {print n+0}'
}

# --- 1. DNS (14.2) ----------------------------------------------------------
for host in "$WEB_HOST" "$API_HOST"; do
  ips="$(resolve_a "$host" | sort -u | tr '\n' ' ')"
  ips="${ips% }"
  if [ "$ips" = "$YUE_IP" ]; then
    pass "DNS $host -> $YUE_IP (no proxy)"
  else
    fail "DNS $host -> '${ips:-no answer}', expected only $YUE_IP"
  fi
done

# --- 2. Certificates and no Cloudflare (14.2, 14.3) -------------------------
for url in "https://${WEB_HOST}/" "https://${API_HOST}/api/v1/health"; do
  headers="$(curl -sS --fail --max-time 30 -D - -o /dev/null "$url" 2>/tmp/macro-check-err.$$)"
  rc=$?
  if [ $rc -ne 0 ]; then
    fail "TLS $url (curl exit $rc: $(tr '\n' ' ' </tmp/macro-check-err.$$ | cut -c1-160))"
  elif printf '%s' "$headers" | grep -qiE '^(cf-ray|server: cloudflare)'; then
    fail "TLS $url is valid but served through Cloudflare"
  else
    pass "TLS $url valid certificate, not Cloudflare"
  fi
done
rm -f /tmp/macro-check-err.$$

# --- 3. Products (14.6) -----------------------------------------------------
body="$(curl -sS --fail --max-time 30 "https://${API_HOST}/api/v1/products" 2>/dev/null)"
n_active="$(printf '%s' "$body" | grep -o '"isActive":true' | wc -l | tr -d ' ')"
if [ "${n_active:-0}" -ge 5 ]; then
  pass "GET /api/v1/products returns $n_active active products (need >= 5)"
else
  fail "GET /api/v1/products returns ${n_active:-0} active products (need >= 5)"
fi

# --- 4. Burst from the macro VM (14.4) --------------------------------------
if [ "$FROM_MACRO" -eq 1 ]; then
  if [ "$NO_SSH" -eq 1 ]; then
    skip "burst from macro VM (--no-ssh)"
  else
    out="$(ssh_to "$MACRO_IP" "$(declare -f burst); burst '$LEDGER_URL' '$BURST'" 2>/dev/null)"
    rc=$?
    n429="$(count_code "$out" 429)"
    n200="$(count_code "$out" 200)"
    summary="$(printf '%s' "$out" | tr '\n' ',' | sed 's/,$//; s/ /x/g')"
    if [ $rc -ne 0 ] || [ -z "$out" ]; then
      fail "burst from macro VM $MACRO_IP: ssh or curl failed (exit $rc)"
    elif [ "$n429" -eq 0 ] && [ "$n200" -gt 0 ]; then
      pass "burst of $BURST ledger GETs from macro VM $MACRO_IP: no 429 [$summary]"
    else
      fail "burst of $BURST ledger GETs from macro VM $MACRO_IP: $n429 x 429 [$summary]"
    fi
  fi
fi

# --- 5. YUE .env hygiene (14.9, 14.10), names and counts only ----------------
if [ "$NO_SSH" -eq 1 ]; then
  skip "YUE .env checks (--no-ssh)"
else
  # shellcheck disable=SC2016
  report="$(ssh_to "$YUE_IP" "YUE_ENV_FILE='$YUE_ENV_FILE' bash -s" 2>/dev/null <<'REMOTE'
f="$YUE_ENV_FILE"
[ -r "$f" ] || { echo "UNREADABLE"; exit 0; }
# Names of notification / storage variables that have a non-empty value (value never printed).
awk -F= '
  /^[ \t]*#/ || !/=/ { next }
  {
    name=$1; sub(/^[ \t]+/, "", name); sub(/[ \t]+$/, "", name)
    val=substr($0, index($0, "=") + 1); gsub(/^[ \t"\x27]+|[ \t"\x27]+$/, "", val)
    if (name ~ /(WEBHOOK|S3|AWS|BUCKET)/ && val != "") print "NONEMPTY " name
  }' "$f"
# Count of lines mentioning the old production stack (count only).
echo "FORBIDDEN $(grep -ciE 'yueshop|supabase' "$f")"
# Kafka must point at the unresolvable placeholder broker.
if grep -qE '^[ \t]*KAFKA_BROKERS=.*\.invalid(:[0-9]+)?[ \t"\x27]*$' "$f"; then echo "KAFKA invalid"; else echo "KAFKA other"; fi
REMOTE
)"
  rc=$?
  if [ $rc -ne 0 ] || [ -z "$report" ] || printf '%s' "$report" | grep -q '^UNREADABLE'; then
    fail "YUE .env: cannot read $YUE_ENV_FILE on $YUE_IP over ssh"
  else
    nonempty="$(printf '%s\n' "$report" | sed -n 's/^NONEMPTY //p' | tr '\n' ' ')"
    forbidden="$(printf '%s\n' "$report" | sed -n 's/^FORBIDDEN //p')"
    if [ -z "$nonempty" ]; then
      pass "YUE .env: webhook / S3 / AWS variables are empty or absent"
    else
      fail "YUE .env: non-empty notification/storage variables: ${nonempty% }"
    fi
    if [ "${forbidden:-1}" = "0" ]; then
      pass "YUE .env: no yueshop / supabase strings"
    else
      fail "YUE .env: ${forbidden:-?} line(s) mention yueshop / supabase"
    fi
    if printf '%s\n' "$report" | grep -q '^KAFKA invalid'; then
      pass "YUE .env: KAFKA_BROKERS points at an unresolvable (.invalid) host"
    else
      fail "YUE .env: KAFKA_BROKERS is not an .invalid placeholder"
    fi
  fi
fi

# --- 6. Burst from THIS host (14.4 / 14.5) ----------------------------------
# Last on purpose: a non-allowlisted host that bursts is rate limited for about a minute,
# and during that time YUE's global limiter answers other routes with HTTP 500.
out="$(burst "$LEDGER_URL" "$BURST")"
n429="$(count_code "$out" 429)"
n200="$(count_code "$out" 200)"
summary="$(printf '%s' "$out" | tr '\n' ',' | sed 's/,$//; s/ /x/g')"
if [ "$ALLOWLISTED" -eq 1 ]; then
  if [ "$n429" -eq 0 ] && [ "$n200" -gt 0 ]; then
    pass "burst of $BURST ledger GETs from this (allowlisted) host: no 429 [$summary]"
  else
    fail "burst of $BURST ledger GETs from this (allowlisted) host: $n429 x 429 [$summary]"
  fi
else
  if [ "$n429" -gt 0 ]; then
    pass "burst of $BURST ledger GETs from this non-allowlisted host is rate limited (429 x $n429) [$summary]"
  else
    fail "burst of $BURST ledger GETs from this host never got 429 (is this host allowlisted? use --allowlisted) [$summary]"
  fi
fi

echo
if [ "$FAILS" -eq 0 ]; then
  echo "All checks passed."
  exit 0
fi
echo "$FAILS check(s) failed."
exit 1
