// Response time: a steady, realistic request rate on both packaging endpoints at once,
// to show each returns its data within the p95 threshold. This is not a stress test.
// The API has one consumer (Obligations) and low traffic, so the rate is low.
//
// RATE_PER_MIN (default 30, per endpoint) and DURATION (default 5m) change the load.
import http from 'k6/http'
import { endpoints, params, pickSubmitterId } from '../lib/config.js'
import { checkItemsResponse } from '../lib/checks.js'
import { loadThresholds } from '../lib/thresholds.js'

const rate = Number(__ENV.RATE_PER_MIN || 30)
const duration = __ENV.DURATION || '5m'

const steady = {
  executor: 'constant-arrival-rate',
  rate,
  timeUnit: '1m',
  duration,
  preAllocatedVUs: 2,
  maxVUs: 10
}

export const options = {
  scenarios: {
    bySubmitter: { ...steady, exec: 'bySubmitter' },
    forSubmitter: { ...steady, exec: 'forSubmitter' }
  },
  thresholds: {
    ...loadThresholds(['by-submitter', 'for-submitter']),
    // A dropped iteration means every VU was still waiting on a slow response.
    dropped_iterations: ['count==0']
  }
}

export function bySubmitter() {
  checkItemsResponse(http.get(endpoints.bySubmitter(), params('by-submitter')), 'by-submitter')
}

export function forSubmitter() {
  checkItemsResponse(http.get(endpoints.forSubmitter(pickSubmitterId()), params('for-submitter')), 'for-submitter')
}
