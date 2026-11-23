// Burst: an occasional stress check, not part of the regular run. Several consumers ask for
// many submitters' totals at the same moment. Obligations' real traffic is a few calls an
// hour, so this is more than it will see. Run it with PROFILE=burst.
//
// BURST_VUS (default 10) consumers each make BURST_ITERATIONS (default 3) rounds. Each round
// requests BURST_SUBMITTERS (default 10) submitters in parallel, largest first. Every request
// fetches the whole year upstream, so raising BURST_SUBMITTERS multiplies the upstream load.
//
// With UPSTREAM=real it refuses to run unless ALLOW_BURST_ON_REAL=true: every request makes the
// real epr-common-data-api run its stored procedure, in an environment other teams share.
import http from 'k6/http'
import { endpoints, params, testData, upstream, upstreamLabel } from '../lib/config.js'
import { checkItemsResponse } from '../lib/checks.js'
import { buildHandleSummary } from '../lib/summary.js'
import { loadThresholds } from '../lib/thresholds.js'

const burstSubmitters = Number(__ENV.BURST_SUBMITTERS || 10)

export const options = {
  scenarios: {
    burst: {
      executor: 'per-vu-iterations',
      vus: Number(__ENV.BURST_VUS || 10),
      iterations: Number(__ENV.BURST_ITERATIONS || 3),
      maxDuration: '10m'
    }
  },
  thresholds: loadThresholds(['for-submitter'])
}

export function setup() {
  if (upstream === 'real' && __ENV.ALLOW_BURST_ON_REAL !== 'true') {
    throw new Error(
      `burst would send ${Number(__ENV.BURST_VUS || 10) * Number(__ENV.BURST_ITERATIONS || 3) * burstSubmitters} ` +
        `full-year requests to ${upstreamLabel}, a shared environment. Agree it with the environment's owners, ` +
        'then set ALLOW_BURST_ON_REAL=true'
    )
  }
  return testData()
}

export default function (data) {
  const responses = http.batch(
    data.submitterIds
      .slice(0, burstSubmitters)
      .map((submitterId) => ['GET', endpoints.forSubmitter(submitterId), null, params('for-submitter')])
  )
  for (const res of responses) {
    checkItemsResponse(res, 'for-submitter')
  }
}

export const handleSummary = buildHandleSummary('burst')
