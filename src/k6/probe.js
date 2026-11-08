// Macro Containment_Probe. Fixed k6 script: hand-written, nothing generated.
// Runs inside the Sandbox (plain JavaScript for k6's runtime, not Bun).
//
// Each action prints exactly one line through console.log:
//   MACRO_PROBE {"action":"a","outcome":"no_response"}
//   MACRO_PROBE {"action":"a","outcome":"response","status":200}
//   MACRO_PROBE {"action":"d","outcome":"names","names":["SOME_KEY"]}
//   MACRO_PROBE {"action":"e","outcome":"started"}
// Lines go out through console.log because action (e) gets the process
// OOM-killed, so handleSummary would never run.
//
// Note on (a)-(c): k6 reports status 0 when the connection fails, times out, or
// the Egress_Proxy refuses the CONNECT. A plain-HTTP request refused by the proxy
// comes back as 403 with the header `X-Macro-Proxy: denied`. Both count as
// "no_response": no response from the destination host arrived.

import http from 'k6/http';

export const options = {
  vus: 1,
  iterations: 1,
};

const TIMEOUT = '10s';
const ACTION_A_URL = 'https://example.com/'; // fixed host outside the Target_Allowlist
const ACTION_B_URL = 'http://169.254.169.254/';
const ACTION_C_URL = __ENV.MACRO_PROBE_API || 'http://macro-api:3000/';

const NAME_PATTERN = /KEY|SECRET|TOKEN/i;
const CHUNK_BYTES = 16 * 1024 * 1024;
const TARGET_BYTES = 1.5 * 1024 * 1024 * 1024;
const PAGE_BYTES = 4096;

function emit(line) {
  console.log('MACRO_PROBE ' + JSON.stringify(line));
}

function isProxyDenial(res) {
  const headers = res.headers || {};
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'x-macro-proxy') {
      return String(headers[name]).toLowerCase() === 'denied';
    }
  }
  return false;
}

function attempt(action, url) {
  let res = null;
  try {
    res = http.get(url, {
      timeout: TIMEOUT,
      redirects: 0,
      responseType: 'none',
    });
  } catch (e) {
    res = null;
  }
  if (res === null || !res.status || isProxyDenial(res)) {
    emit({ action: action, outcome: 'no_response' });
  } else {
    emit({ action: action, outcome: 'response', status: res.status });
  }
}

function matchingEnvNames() {
  const names = [];
  for (const name of Object.keys(__ENV)) {
    if (NAME_PATTERN.test(name)) {
      names.push(name);
    }
  }
  names.sort();
  return names; // names only, values are never read into the output
}

function allocate() {
  // Hold every chunk and touch each page so the memory is really committed.
  const held = [];
  for (let total = 0; total < TARGET_BYTES; total += CHUNK_BYTES) {
    const buf = new Uint8Array(CHUNK_BYTES);
    for (let i = 0; i < CHUNK_BYTES; i += PAGE_BYTES) {
      buf[i] = 1;
    }
    held.push(buf);
  }
  return held.length;
}

export default function () {
  attempt('a', ACTION_A_URL);
  attempt('b', ACTION_B_URL);
  attempt('c', ACTION_C_URL);
  emit({ action: 'd', outcome: 'names', names: matchingEnvNames() });

  // (e) is last. The "started" line goes out before the first allocation.
  emit({ action: 'e', outcome: 'started' });
  allocate();
  // Reaching this point means the memory cap did not stop the allocation.
}
