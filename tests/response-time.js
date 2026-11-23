// Response time: a steady, realistic request rate on both packaging endpoints at once,
// to show each returns its data within the p95 threshold. This is not a stress test.
// The API has one consumer (Obligations) and low traffic, so the rate is low: Obligations
// calls by-submitter about once a day, and for-submitter when a regulator event happens, a
// few times an hour at most.
//
// RATE_PER_MIN (default 1, per endpoint) and DURATION (default 5m) change the load.
import http from 'k6/http'
import { endpoints, params, pickSubmitterId, testData } from '../lib/config.js'
import { checkItemsResponse } from '../lib/checks.js'
import { buildHandleSummary } from '../lib/summary.js'
import { loadThresholds } from '../lib/thresholds.js'

const rate = Number(__ENV.RATE_PER_MIN || 1)
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

export function setup() {
  return testData()
}

export function bySubmitter() {
  checkItemsResponse(http.get(endpoints.bySubmitter(), params('by-submitter')), 'by-submitter')
}

export function forSubmitter(data) {
  checkItemsResponse(http.get(endpoints.forSubmitter(pickSubmitterId(data)), params('for-submitter')), 'for-submitter')
}

export const handleSummary = buildHandleSummary('response-time')
