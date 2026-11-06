// Pass/fail limits for every test.
//
// The EPR Test Strategy says thresholds are agreed per service with its business
// stakeholders. These match the waste-obligations-perf-tests suite (p95 < 2000 ms,
// errors < 1%), the service that consumes this API. They have not yet been formally
// agreed for this API: confirm them, then change the defaults here.
//
// P95_MS and ERROR_RATE override them for a single run.

export const P95_MS = Number(__ENV.P95_MS || 2000)
export const ERROR_RATE = Number(__ENV.ERROR_RATE || 0.01)

// p95 per endpoint, so a slow endpoint can't hide behind a fast one.
export function latencyThresholds(endpointNames) {
  return Object.fromEntries(
    endpointNames.map((name) => [`http_req_duration{endpoint:${name}}`, [`p(95)<${P95_MS}`]])
  )
}

export function loadThresholds(endpointNames) {
  return {
    ...latencyThresholds(endpointNames),
    http_req_failed: [`rate<${ERROR_RATE}`],
    checks: [`rate>${1 - ERROR_RATE}`]
  }
}
