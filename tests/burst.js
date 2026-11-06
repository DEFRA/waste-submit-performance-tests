// Burst: several consumers ask for every submitter's totals at the same moment, the
// way Obligations fans out one request per submitter. It checks response times hold
// up under that short concurrency. It is not a stress or spike test.
//
// BURST_VUS (default 10) consumers each make BURST_ITERATIONS (default 3) rounds.
// Each round requests every submitter in SUBMITTER_IDS in parallel.
import http from 'k6/http'
import { endpoints, params, submitterIds } from '../lib/config.js'
import { checkItemsResponse } from '../lib/checks.js'
import { loadThresholds } from '../lib/thresholds.js'

export const options = {
  scenarios: {
    burst: {
      executor: 'per-vu-iterations',
      vus: Number(__ENV.BURST_VUS || 10),
      iterations: Number(__ENV.BURST_ITERATIONS || 3),
      maxDuration: '5m'
    }
  },
  thresholds: loadThresholds(['for-submitter'])
}

export default function () {
  const responses = http.batch(
    submitterIds.map((submitterId) => ['GET', endpoints.forSubmitter(submitterId), null, params('for-submitter')])
  )
  for (const res of responses) {
    checkItemsResponse(res, 'for-submitter')
  }
}
