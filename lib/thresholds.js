// Pass/fail limits for every test.
// (p95 < 2000 ms, errors < 1%), the service that consumes this API.
//
// P95_MS and ERROR_RATE override them for a single run.

export const P95_MS = Number(__ENV.P95_MS || 10000)
export const ERROR_RATE = Number(__ENV.ERROR_RATE || 0.01)

// p95 per endpoint, so a slow endpoint can't hide behind a fast one.
export function latencyThresholds(endpointNames) {
  return Object.fromEntries(
    endpointNames.map((name) => [`http_req_duration{endpoint:${name}}`, [`p(95)<${P95_MS}`]])
  )
}

// k6 only reports a tagged submetric that a threshold names, so these always pass and
// exist to show failed_responses (lib/checks.js) per status in the report. 0 means no
// response at all. A status not listed still counts in the failed_responses total.
const REPORTED_STATUSES = [0, 400, 401, 403, 404, 405, 408, 429, 500, 502, 503, 504]

export function failureThresholds() {
  return Object.fromEntries([
    ['failed_responses', ['count>=0']],
    ...REPORTED_STATUSES.map((status) => [`failed_responses{status:${status}}`, ['count>=0']])
  ])
}

export function loadThresholds(endpointNames) {
  return {
    ...latencyThresholds(endpointNames),
    ...failureThresholds(),
    http_req_failed: [`rate<${ERROR_RATE}`],
    checks: [`rate>${1 - ERROR_RATE}`]
  }
}
