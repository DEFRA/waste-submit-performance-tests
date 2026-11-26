// Response time: a steady, realistic request rate on both packaging endpoints at once,
// to show each returns its data within the p95 threshold. This is not a stress test.
// The API has one consumer (Obligations) and low traffic, so the rate is low: Obligations
// calls by-submitter about once a day, and for-submitter when a regulator event happens, a
// few times an hour at most.
//
//
// The three submission periods endpoints run alongside. Frontends call them as pages load, so
// their rate is higher and their p95 limit much tighter (lib/thresholds.js). They read the
// service's own database, so the upstream's latency doesn't reach them.
//
// RATE_PER_MIN (default 1, per packaging endpoint), PERIODS_RATE_PER_MIN (default 60, per
// submission periods endpoint) and DURATION (default 5m) change the load.
import http from 'k6/http'
import { endpoints, params, pickSubmitterId, submissionPeriodNames, testData } from '../lib/config.js'
import { checkItemsResponse, checkPeriodResponse, checkPeriodsResponse } from '../lib/checks.js'
import { buildHandleSummary } from '../lib/summary.js'
import { loadThresholds, PERIODS_ENDPOINTS } from '../lib/thresholds.js'

const rate = Number(__ENV.RATE_PER_MIN || 1)
const periodsRate = Number(__ENV.PERIODS_RATE_PER_MIN || 60)
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
    forSubmitter: { ...steady, exec: 'forSubmitter' },
    submissionPeriods: { ...steady, rate: periodsRate, exec: 'submissionPeriods' },
    periodsForSubmitterType: { ...steady, rate: periodsRate, exec: 'periodsForSubmitterType' },
    periodForSubmitterType: { ...steady, rate: periodsRate, exec: 'periodForSubmitterType' }
  },
  thresholds: {
    ...loadThresholds(['by-submitter', 'for-submitter', ...PERIODS_ENDPOINTS]),
    // A dropped iteration means every VU was still waiting on a slow response.
    dropped_iterations: ['count==0']
  }
}

export function setup() {
  return { ...testData(), submissionPeriods: submissionPeriodNames() }
}

export function bySubmitter() {
  checkItemsResponse(http.get(endpoints.bySubmitter(), params('by-submitter')), 'by-submitter')
}

export function forSubmitter(data) {
  checkItemsResponse(http.get(endpoints.forSubmitter(pickSubmitterId(data)), params('for-submitter')), 'for-submitter')
}

export function submissionPeriods() {
  checkPeriodsResponse(http.get(endpoints.submissionPeriods(), params('submission-periods')), 'submission-periods')
}

export function periodsForSubmitterType() {
  checkPeriodsResponse(
    http.get(endpoints.periodsForSubmitterType(), params('periods-for-submitter-type')),
    'periods-for-submitter-type'
  )
}

export function periodForSubmitterType(data) {
  const submissionPeriod = data.submissionPeriods[Math.floor(Math.random() * data.submissionPeriods.length)]
  checkPeriodResponse(
    http.get(endpoints.periodForSubmitterType(submissionPeriod), params('period-for-submitter-type')),
    'period-for-submitter-type',
    submissionPeriod
  )
}

export const handleSummary = buildHandleSummary('response-time')
