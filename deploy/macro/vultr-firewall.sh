#!/usr/bin/env bash
# Create or refresh the Vultr firewall group `macro-vm` and attach it to the
# `macro` instance (Requirement 9.10).
#
#   Inbound tcp 80 and 443: Cloudflare IP ranges only, so CF-Connecting-IP cannot be
#                           spoofed by hitting the VM directly.
#   Inbound tcp 22:         ${SSH_ALLOW_CIDR:-0.0.0.0/0} (SSH is key-only; narrow it
#                           to your own address when you can). Default also opens ::/0.
#
# NOTE: Vultr Firewall filters INBOUND traffic only. Outbound control for Sandboxes
# lives in the egress proxy (proxy/proxy.ts), not here.
#
# Usage:
#   export VULTR_API_KEY=...           # shell environment only; never written or echoed
#   deploy/macro/vultr-firewall.sh --dry-run
#   deploy/macro/vultr-firewall.sh
#
# Environment:
#   VULTR_API_KEY          required (not needed for --dry-run, which then skips lookups)
#   SSH_ALLOW_CIDR         comma-separated IPv4/IPv6 CIDRs for port 22 (default 0.0.0.0/0)
#   MACRO_INSTANCE_LABEL   instance label to attach to (default: macro)
#
# Requires: bash, curl, jq (Debian/Ubuntu: apt install curl jq).
#
# Rules are deleted and recreated on every run so reruns are clean. SSH rules are
# created first, but a rerun on an attached group still leaves a short window with
# fewer rules. Existing SSH sessions are not dropped.
#
# Never attach this group to `yue-demo`: Let's Encrypt there needs 80/443 open to all.
set -euo pipefail

API="https://api.vultr.com/v2"
GROUP_NAME="macro-vm"
INSTANCE_LABEL="${MACRO_INSTANCE_LABEL:-macro}"
SSH_ALLOW_CIDR="${SSH_ALLOW_CIDR:-0.0.0.0/0}"
DRY_RUN=0

die() { echo "error: $*" >&2; exit 1; }
say() { echo "$*"; }

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $arg (use --dry-run or --help)" ;;
  esac
done

command -v curl >/dev/null 2>&1 || die "curl is required (apt install curl)"
command -v jq >/dev/null 2>&1 || die "jq is required (apt install jq)"

HAVE_KEY=0
if [[ -n "${VULTR_API_KEY:-}" ]]; then
  [[ "$VULTR_API_KEY" =~ ^[A-Za-z0-9_-]+$ ]] || die "VULTR_API_KEY has unexpected characters"
  HAVE_KEY=1
elif (( DRY_RUN == 0 )); then
  die "VULTR_API_KEY is not set in the environment"
fi

[[ "$INSTANCE_LABEL" != "yue-demo" ]] || die "refusing to attach the macro firewall to yue-demo"

# vultr METHOD PATH [JSON_BODY]  -> response body in $REPLY. Exits on a non-2xx status.
# The key reaches curl as a config on stdin (printf is a builtin), so it is never in
# any argv and never on disk.
vultr() {
  local method=$1 path=$2 data=${3-} attempt=0 out code
  while :; do
    attempt=$((attempt + 1))
    local args=(-sS --max-time 30 -X "$method" -K - -w $'\n%{http_code}')
    if [[ -n "$data" ]]; then
      args+=(-H 'Content-Type: application/json' --data "$data")
    fi
    out=$(printf 'header = "Authorization: Bearer %s"\n' "$VULTR_API_KEY" | curl "${args[@]}" "$API$path") || die "network error calling $method $path"
    code=${out##*$'\n'}
    REPLY=${out%$'\n'*}
    if [[ "$code" == 429 && $attempt -lt 5 ]]; then
      sleep 2
      continue
    fi
    if [[ ! "$code" =~ ^2[0-9][0-9]$ ]]; then
      die "$method $path returned HTTP $code: $(printf '%s' "$REPLY" | jq -r '.error // empty' 2>/dev/null || true)"
    fi
    return 0
  done
}

# ---- Cloudflare ranges ----
fetch_ranges() { # url kind(v4|v6)
  local body line
  body=$(curl -fsS --max-time 20 "$1") || die "could not fetch $1"
  local re
  if [[ "$2" == v4 ]]; then
    re='^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$'
  else
    re='^[0-9A-Fa-f:]+/[0-9]{1,3}$'
  fi
  local n=0
  while IFS= read -r line; do
    line=${line%$'\r'}
    [[ -z "$line" ]] && continue
    [[ "$line" =~ $re ]] || die "unexpected line in $1: $line"
    printf '%s\n' "$line"
    n=$((n + 1))
  done <<<"$body"
  (( n >= 3 )) || die "$1 returned fewer than 3 ranges"
}

CF_V4_TEXT=$(fetch_ranges https://www.cloudflare.com/ips-v4 v4)
CF_V6_TEXT=$(fetch_ranges https://www.cloudflare.com/ips-v6 v6)
mapfile -t CF_V4 <<<"$CF_V4_TEXT"
mapfile -t CF_V6 <<<"$CF_V6_TEXT"

# ---- Desired rules (JSON objects, one per element) ----
RULES=()
add_rule() { # ip_type port cidr note
  local subnet=${3%/*} size=${3#*/}
  RULES+=("$(jq -nc --arg t "$1" --arg p "$2" --arg s "$subnet" --argjson z "$size" --arg n "$4" \
    '{ip_type:$t, protocol:"tcp", subnet:$s, subnet_size:$z, port:$p, source:"", notes:$n}')")
}

IFS=',' read -r -a SSH_CIDRS <<<"$SSH_ALLOW_CIDR"
SSH_V4=0; SSH_V6=0
for cidr in "${SSH_CIDRS[@]}"; do
  cidr=${cidr// /}
  [[ -n "$cidr" ]] || continue
  [[ "$cidr" == */* ]] || die "SSH_ALLOW_CIDR entries must be CIDRs (got: $cidr)"
  if [[ "$cidr" == *:* ]]; then
    add_rule v6 22 "$cidr" "ssh (key-only)"; SSH_V6=$((SSH_V6 + 1))
  else
    add_rule v4 22 "$cidr" "ssh (key-only)"; SSH_V4=$((SSH_V4 + 1))
  fi
done
# The default (open to all) also covers IPv6.
if [[ "$SSH_ALLOW_CIDR" == "0.0.0.0/0" ]]; then
  add_rule v6 22 "::/0" "ssh (key-only)"; SSH_V6=$((SSH_V6 + 1))
fi

for port in 80 443; do
  for cidr in "${CF_V4[@]}"; do add_rule v4 "$port" "$cidr" "cloudflare $port"; done
  for cidr in "${CF_V6[@]}"; do add_rule v6 "$port" "$cidr" "cloudflare $port"; done
done

TOTAL=${#RULES[@]}
say "Cloudflare ranges: ${#CF_V4[@]} IPv4, ${#CF_V6[@]} IPv6"
say "Desired inbound rules: $TOTAL (ssh: $SSH_V4 IPv4 + $SSH_V6 IPv6; 80 and 443: $(( (${#CF_V4[@]} + ${#CF_V6[@]}) * 2 )))"

# ---- Dry run without a key: nothing to look up ----
if (( DRY_RUN == 1 && HAVE_KEY == 0 )); then
  say "[dry-run] no VULTR_API_KEY: skipping lookups."
  say "[dry-run] would find or create firewall group '$GROUP_NAME'"
  say "[dry-run] would delete its existing rules, then create $TOTAL rules"
  say "[dry-run] would attach it to the instance labelled '$INSTANCE_LABEL'"
  printf '%s\n' "${RULES[@]}" | jq -r '"  \(.ip_type) tcp/\(.port) from \(.subnet)/\(.subnet_size)  (\(.notes))"'
  exit 0
fi

# ---- Find or create the group ----
vultr GET "/firewalls?per_page=500"
GROUP_ID=$(printf '%s' "$REPLY" | jq -r --arg d "$GROUP_NAME" '[.firewall_groups[] | select(.description == $d)][0].id // empty')
MAX_RULES=$(printf '%s' "$REPLY" | jq -r --arg d "$GROUP_NAME" '[.firewall_groups[] | select(.description == $d)][0].max_rule_count // empty')

if [[ -z "$GROUP_ID" ]]; then
  if (( DRY_RUN == 1 )); then
    say "[dry-run] would create firewall group '$GROUP_NAME'"
    GROUP_ID="<new>"
  else
    vultr POST "/firewalls" "$(jq -nc --arg d "$GROUP_NAME" '{description:$d}')"
    GROUP_ID=$(printf '%s' "$REPLY" | jq -r '.firewall_group.id')
    MAX_RULES=$(printf '%s' "$REPLY" | jq -r '.firewall_group.max_rule_count // empty')
    say "Created firewall group '$GROUP_NAME': $GROUP_ID"
  fi
else
  say "Reusing firewall group '$GROUP_NAME': $GROUP_ID"
fi

if [[ -n "$MAX_RULES" && "$TOTAL" -gt "$MAX_RULES" ]]; then
  die "$TOTAL rules exceed the group limit of $MAX_RULES; narrow SSH_ALLOW_CIDR or ask Vultr to raise the limit"
fi

# ---- Delete existing rules ----
if [[ "$GROUP_ID" != "<new>" ]]; then
  vultr GET "/firewalls/$GROUP_ID/rules?per_page=500"
  mapfile -t OLD_IDS < <(printf '%s' "$REPLY" | jq -r '.firewall_rules[].id')
  say "Existing rules to delete: ${#OLD_IDS[@]}"
  for id in "${OLD_IDS[@]}"; do
    [[ -n "$id" ]] || continue
    if (( DRY_RUN == 1 )); then continue; fi
    vultr DELETE "/firewalls/$GROUP_ID/rules/$id"
    sleep 0.1
  done
fi

# ---- Create rules ----
if (( DRY_RUN == 1 )); then
  say "[dry-run] would create $TOTAL rules:"
  printf '%s\n' "${RULES[@]}" | jq -r '"  \(.ip_type) tcp/\(.port) from \(.subnet)/\(.subnet_size)  (\(.notes))"'
else
  for rule in "${RULES[@]}"; do
    vultr POST "/firewalls/$GROUP_ID/rules" "$rule"
    sleep 0.1
  done
  vultr GET "/firewalls/$GROUP_ID/rules?per_page=500"
  CREATED=$(printf '%s' "$REPLY" | jq '.firewall_rules | length')
  V4=$(printf '%s' "$REPLY" | jq '[.firewall_rules[] | select(.ip_type == "v4")] | length')
  V6=$(printf '%s' "$REPLY" | jq '[.firewall_rules[] | select(.ip_type == "v6")] | length')
  say "Firewall group $GROUP_ID now has $CREATED rules ($V4 IPv4, $V6 IPv6); expected $TOTAL"
  [[ "$CREATED" == "$TOTAL" ]] || die "rule count mismatch"
fi

# ---- Attach to the instance ----
if (( HAVE_KEY == 1 )); then
  vultr GET "/instances?per_page=500"
  mapfile -t MATCHES < <(printf '%s' "$REPLY" | jq -r --arg l "$INSTANCE_LABEL" '.instances[] | select(.label == $l) | "\(.id) \(.firewall_group_id // "")"')
  (( ${#MATCHES[@]} == 1 )) || die "expected exactly one instance labelled '$INSTANCE_LABEL', found ${#MATCHES[@]}"
  INSTANCE_ID=${MATCHES[0]%% *}
  CURRENT_GROUP=${MATCHES[0]#* }
  if [[ "$CURRENT_GROUP" == "$GROUP_ID" ]]; then
    say "Instance '$INSTANCE_LABEL' ($INSTANCE_ID) already uses group $GROUP_ID"
  elif (( DRY_RUN == 1 )); then
    say "[dry-run] would attach group $GROUP_ID to instance '$INSTANCE_LABEL' ($INSTANCE_ID)"
  else
    vultr PATCH "/instances/$INSTANCE_ID" "$(jq -nc --arg g "$GROUP_ID" '{firewall_group_id:$g}')"
    say "Attached group $GROUP_ID to instance '$INSTANCE_LABEL' ($INSTANCE_ID)"
  fi
fi
