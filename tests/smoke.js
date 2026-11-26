// Smoke: proves the service is up, the test data is right and the service reads from the
// upstream UPSTREAM says, before any timed test runs. The runner stops if this fails.
//   UPSTREAM=stub  by-submitter must return exactly the stub's submitters for the year.
//   UPSTREAM=real  by-submitter must return none of them, when the stub is reachable, so a
//                  service still pointed at the stub can't pass as a real run.
//
// SMOKE_SUBMITTERS (default 2) is how many submitters it asks for one at a time, largest
// first. Each call fetches the whole year upstream, so with realistic latency every one takes
// seconds.
import http from 'k6/http'
import { check } from 'k6'
import { endpoints, params, stubUrl, submissionPeriodNames, testData } from '../lib/config.js'
import { checkItemsResponse, checkPeriodResponse, checkPeriodsResponse, checkStatus } from '../lib/checks.js'
import { failureThresholds } from '../lib/thresholds.js'
import { buildHandleSummary } from '../lib/summary.js'

const smokeSubmitters = Number(__ENV.SMOKE_SUBMITTERS || 2)

export const options = {
  scenarios: {
    smoke: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      // Long enough for a few calls on the stub's Worst latency (35 s each).
      maxDuration: '5m'
    }
  },
  thresholds: {
    ...failureThresholds(),
    checks: ['rate==1.0'],
    http_req_failed: ['rate==0']
  }
}

export function setup() {
  return testData()
}

export default function (data) {
  checkStatus(http.get(endpoints.health(), params('health')), 'health')

  if (data.stub) {
    checkStatus(http.get(`${stubUrl()}/health`, { tags: { endpoint: 'stub' } }), 'stub health')
  }

  const bySubmitter = http.get(endpoints.bySubmitter(), params('by-submitter'))
  checkItemsResponse(bySubmitter, 'by-submitter')

  // The service returns one item per submitter it read upstream. The stub's IDs are name-based
  // UUIDs that real data can't contain, so comparing them shows which upstream answered.
  const returned = submitterIdsIn(bySubmitter)
  if (data.upstream === 'stub') {
    const expected = new Set(data.stubSubmitterIds)
    check(bySubmitter, {
      [`by-submitter: returns exactly the stub's ${expected.size} submitters (UPSTREAM=stub)`]: () =>
        returned !== null && returned.length === expected.size && returned.every((id) => expected.has(id))
    })
  } else if (data.stubSubmitterIds) {
    const stubIds = new Set(data.stubSubmitterIds)
    check(bySubmitter, {
      'by-submitter: returns none of the stub\'s submitters (UPSTREAM=real)': () =>
        returned !== null && !returned.some((id) => stubIds.has(id))
    })
  } else {
    console.log('UPSTREAM=real: the stub is not reachable, so the run is not checked against it')
  }

  for (const submitterId of data.submitterIds.slice(0, smokeSubmitters)) {
    checkItemsResponse(http.get(endpoints.forSubmitter(submitterId), params('for-submitter')), 'for-submitter')
  }

  // The submission periods endpoints, which read the service's own database.
  checkPeriodsResponse(http.get(endpoints.submissionPeriods(), params('submission-periods')), 'submission-periods')
  checkPeriodsResponse(
    http.get(endpoints.periodsForSubmitterType(), params('periods-for-submitter-type')),
    'periods-for-submitter-type'
  )
  const submissionPeriod = submissionPeriodNames()[0]
  checkPeriodResponse(
    http.get(endpoints.periodForSubmitterType(submissionPeriod), params('period-for-submitter-type')),
    'period-for-submitter-type',
    submissionPeriod
  )
}

function submitterIdsIn(res) {
  try {
    return res.json('items').map((item) => item.submitterOrganisationId)
  } catch {
    return null
  }
}

export const handleSummary = buildHandleSummary('smoke')
