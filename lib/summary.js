// What each test writes when it ends:
//   summary.html  a readable report of every metric, threshold and check
//   summary.json  every metric, read by entrypoint.sh for the index page
//   junit.xml     thresholds as JUnit test cases
//   stub.json     the stub's version, dataset and latency, or that no stub was used,
//                 read by entrypoint.sh for the index page
// plus k6's usual text summary on stdout, so it stays in the log.
//
// Files go to RESULTS_DIR, which entrypoint.sh sets per test; results/<test> otherwise.
import { htmlReport } from './vendor/k6-reporter.js'
import { textSummary, jUnit } from './vendor/k6-summary.js'

export function buildHandleSummary(testName) {
  const outDir = (__ENV.RESULTS_DIR || `results/${testName}`).replace(/\/$/, '')
  return function handleSummary(data) {
    return {
      stdout: textSummary(data, { indent: ' ', enableColors: false }),
      [`${outDir}/summary.html`]: htmlReport(data, { title: `waste-submit-reg-packaging-api: ${testName}` }),
      [`${outDir}/summary.json`]: JSON.stringify(data, null, 2),
      [`${outDir}/junit.xml`]: jUnit(data),
      [`${outDir}/stub.json`]: JSON.stringify(stubEvidence(data.setup_data), null, 2)
    }
  }
}

// What the run ran against, from the test data its setup() read (lib/config.js testData).
function stubEvidence(setupData) {
  if (!setupData) {
    return { used: 'unknown' }
  }
  const upstream = { upstream: setupData.upstream, upstreamLabel: setupData.upstreamLabel }
  if (!setupData.stub) {
    return {
      used: false,
      ...upstream,
      packagingYear: setupData.packagingYear,
      submitters: setupData.submitterIds.length,
      checkedAgainstStub: Boolean(setupData.stubSubmitterIds)
    }
  }
  return { used: true, ...upstream, ...setupData.stub }
}
