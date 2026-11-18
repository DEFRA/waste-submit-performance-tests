import { check } from 'k6'
import exec from 'k6/execution'
import { Counter } from 'k6/metrics'

// Every failed response, tagged with its endpoint and status ("0" when there was no
// response at all: DNS, TLS, a refused connection or a timeout). The report shows a
// count per status through the thresholds in lib/thresholds.js.
export const failedResponses = new Counter('failed_responses')

// How many failed responses each VU logs per endpoint and status, so a run that fails
// every request doesn't flood the CDP log. LOG_FAILURES overrides it; 0 turns it off.
const LOG_LIMIT = Number(__ENV.LOG_FAILURES ?? 5)
const BODY_CHARS = 500
const logged = {}

function hint(status) {
  if (status === 401 || status === 403) {
    return 'Check API_CLIENT_ID and API_CLIENT_SECRET match a client with the read scope'
  }
  if (status === 0) {
    return 'No response: check SERVICE_URL and that the service is deployed in this environment'
  }
  return undefined
}

// Counts a response that isn't the expected status and logs the first few: endpoint,
// URL, status, k6's network error, duration and the start of the body. It never logs
// the request headers, which hold the API key.
export function recordFailure(res, name, expected = 200) {
  if (res.status === expected) {
    return
  }
  const status = String(res.status)
  failedResponses.add(1, { endpoint: name, status })

  const key = `${name}|${status}`
  const count = (logged[key] || 0) + 1
  logged[key] = count
  if (count > LOG_LIMIT) {
    return
  }

  const body = typeof res.body === 'string' ? res.body.slice(0, BODY_CHARS).replace(/\s+/g, ' ') : ''
  const detail = {
    endpoint: name,
    status: res.status,
    url: res.url,
    durationMs: Math.round(res.timings.duration),
    error: res.error || undefined,
    errorCode: res.error_code || undefined,
    contentType: res.headers['Content-Type'],
    body: body || undefined,
    hint: hint(res.status)
  }
  console.error(`failed response ${JSON.stringify(detail)}`)
  if (count === LOG_LIMIT) {
    console.error(
      `failed response: VU ${exec.vu.idInTest} has logged ${LOG_LIMIT} ${status} responses from ${name}; ` +
        'it counts further ones without logging them (LOG_FAILURES changes the limit)'
    )
  }
}

export function checkStatus(res, name, expected = 200) {
  recordFailure(res, name, expected)
  return check(res, { [`${name}: status is ${expected}`]: (r) => r.status === expected })
}

// Every packaging endpoint returns 200 with its results under `items`, which is
// empty when there's nothing for the year. A 404 means the submitter doesn't exist,
// so it counts as a failure here: the test data is wrong.
export function checkItemsResponse(res, name) {
  recordFailure(res, name)
  return check(res, {
    [`${name}: status is 200`]: (r) => r.status === 200,
    [`${name}: items is an array`]: (r) => {
      try {
        return Array.isArray(r.json('items'))
      } catch {
        return false
      }
    }
  })
}
