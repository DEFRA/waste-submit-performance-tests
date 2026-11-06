// Smoke: one request to each endpoint, to prove the service is up and the test data
// is right before any timed test runs. The runner stops if this fails.
import http from 'k6/http'
import { check } from 'k6'
import { endpoints, params, submitterIds } from '../lib/config.js'
import { checkItemsResponse } from '../lib/checks.js'

export const options = {
  scenarios: {
    smoke: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '1m'
    }
  },
  thresholds: {
    checks: ['rate==1.0'],
    http_req_failed: ['rate==0']
  }
}

export default function () {
  const health = http.get(endpoints.health(), params('health'))
  check(health, { 'health: status is 200': (r) => r.status === 200 })

  checkItemsResponse(http.get(endpoints.bySubmitter(), params('by-submitter')), 'by-submitter')

  for (const submitterId of submitterIds) {
    checkItemsResponse(http.get(endpoints.forSubmitter(submitterId), params('for-submitter')), 'for-submitter')
  }
}
