import encoding from 'k6/encoding'
import http from 'k6/http'

// Where the tests point, what data they ask for, and the HTTP settings they share.
// Every value can be overridden with an environment variable, so the same image runs
// in CDP perf-test, in Docker Compose and against a service on your own machine.

const SERVICE = 'waste-submit-reg-packaging-api'

export function environment() {
  const env = __ENV.ENVIRONMENT
  if (!env) {
    throw new Error('ENVIRONMENT is required, for example perf-test or local')
  }
  return env
}

// SERVICE_URL wins. Otherwise the service's internal CDP address for ENVIRONMENT. Not
// BASE_URL: CDP runs have had that set to the environment's root domain
// (https://perf-test.cdp-int.defra.cloud), where every API path is a 404.
export function baseUrl() {
  const override = __ENV.SERVICE_URL
  if (override) {
    return override.replace(/\/$/, '')
  }
  return `https://${SERVICE}.${environment()}.cdp-int.defra.cloud`
}

// 2025 is the first year Obligations asks for. In the stub, 2024 to 2027 are sized from
// production counts and 2023 is a small fixed dataset.
export const packagingYear = Number(__ENV.PACKAGING_YEAR || 2025)

// waste-submit-stubs, which stands in for epr-common-data-api in perf-test and locally.
// STUB_URL wins; otherwise its internal CDP address for ENVIRONMENT.
export function stubUrl() {
  const override = __ENV.STUB_URL
  if (override) {
    return override.replace(/\/$/, '')
  }
  return `https://waste-submit-stubs.${environment()}.cdp-int.defra.cloud`
}

const STUB_DATASET = 'epr-common-data-api/approved-submissions'

// What the service reads approved submissions from, which its CommonDataApi__BaseUrl in
// cdp-app-config decides. The suite can't see that setting, so UPSTREAM tells it, and smoke
// checks the two agree (tests/smoke.js).
//   stub (default)  waste-submit-stubs: test data and settings come from the stub.
//   real            a real epr-common-data-api, such as Azure TST1 or PRE1: test data comes
//                   from the service's own by-submitter response.
export const upstream = (__ENV.UPSTREAM || 'stub').trim().toLowerCase()

if (!['stub', 'real'].includes(upstream)) {
  throw new Error(`UPSTREAM must be stub or real, not '${__ENV.UPSTREAM}'`)
}

// What the report calls the upstream, for example "Azure TST1". Release evidence needs it.
export const upstreamLabel = __ENV.UPSTREAM_LABEL || (upstream === 'stub' ? 'waste-submit-stubs' : 'real epr-common-data-api')

// Submitters to ask for, comma-separated. Optional in both modes: without it, the suite finds
// every submitter in PACKAGING_YEAR itself.
const configuredSubmitterIds = __ENV.SUBMITTER_IDS
  ? __ENV.SUBMITTER_IDS.split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  : null

if (configuredSubmitterIds && configuredSubmitterIds.length === 0) {
  throw new Error('SUBMITTER_IDS is set but holds no IDs')
}

function stubGet(path, timeout = '30s', extra = {}) {
  return http.get(`${stubUrl()}${path}`, { tags: { endpoint: 'stub' }, timeout, ...extra })
}

function stubJson(path) {
  const res = stubGet(path)
  if (res.status !== 200) {
    throw new Error(
      `Could not read ${path} from waste-submit-stubs at ${stubUrl()} (status ${res.status} ${res.error || ''}). ` +
        'Check the stub is deployed in this environment, or set UPSTREAM=real if the service reads from a real epr-common-data-api'
    )
  }
  return res.json()
}

// Stub mode: every submitter in the year from the stub's dataset, largest first, and the
// stub's version and settings for the report.
function stubTestData() {
  const info = stubJson('/admin/info')
  const dataset = stubJson(`/admin/datasets/${STUB_DATASET}/${packagingYear}`)
  const submitters = [...dataset.submitters].sort((a, b) => b.rows - a.rows)
  if (submitters.length === 0) {
    throw new Error(
      `waste-submit-stubs has no submitters for ${packagingYear} (profile ${dataset.profile}). ` +
        'Pick a PACKAGING_YEAR it generates data for: see its /admin/info'
    )
  }

  const settings = info.stubs['epr-common-data-api'].approvedSubmissions
  return {
    upstream,
    upstreamLabel,
    packagingYear,
    submitterIds: configuredSubmitterIds || submitters.map((submitter) => submitter.id),
    stubSubmitterIds: submitters.map((submitter) => submitter.id),
    stub: {
      url: stubUrl(),
      version: info.version,
      dataset: STUB_DATASET,
      year: packagingYear,
      profile: dataset.profile,
      sizes: dataset.sizes,
      rowCount: dataset.rowCount,
      bytes: dataset.bytes,
      submitterCount: submitters.length,
      latencyMs: settings.latencyMs,
      latencyJitterMs: settings.latencyJitterMs
    }
  }
}

// Real mode: the submitters the service itself returns for the year, largest first. The stub's
// IDs for the same year are read too, when the stub is reachable, so smoke can fail a run whose
// service is still pointed at the stub.
function realTestData() {
  let submitterIds = configuredSubmitterIds
  if (!submitterIds) {
    const res = http.get(endpoints.bySubmitter(), { ...params('discovery'), tags: { endpoint: 'discovery' } })
    if (res.status !== 200) {
      throw new Error(`Could not read the year's submitters from the service (status ${res.status} ${res.error || ''})`)
    }
    const items = res.json('items') || []
    if (items.length === 0) {
      throw new Error(
        `The service returned no submitters for ${packagingYear} from its upstream. ` +
          'Pick a PACKAGING_YEAR with approved submissions there, or set SUBMITTER_IDS'
      )
    }
    submitterIds = [...items]
      .sort((a, b) => (b.producers || []).length - (a.producers || []).length)
      .map((item) => item.submitterOrganisationId)
  }

  // A short timeout: in real mode the stub may well not be deployed, and that's fine. Any
  // answer, or none (status 0), is expected, so the probe never counts as a failed request.
  const stubDataset = stubGet(`/admin/datasets/${STUB_DATASET}/${packagingYear}`, '5s', {
    responseCallback: http.expectedStatuses(0, { min: 200, max: 599 })
  })
  const stubSubmitterIds = stubDataset.status === 200 ? stubDataset.json('submitterIds') : null

  return {
    upstream,
    upstreamLabel,
    packagingYear,
    submitterIds,
    stubSubmitterIds,
    stub: null
  }
}

// The test data for a run, read once in each script's setup().
export function testData() {
  return upstream === 'stub' ? stubTestData() : realTestData()
}

export function pickSubmitterId(data) {
  return data.submitterIds[Math.floor(Math.random() * data.submitterIds.length)]
}

// Endpoint names double as the `endpoint` tag, which the thresholds are split by.
export const endpoints = {
  health: () => `${baseUrl()}/health`,
  bySubmitter: () => `${baseUrl()}/packaging/${packagingYear}/producer-material-totals-by-submitter`,
  forSubmitter: (submitterId) =>
    `${baseUrl()}/packaging/${packagingYear}/submitter-organisation/${submitterId}/producer-material-totals`,
  // The submission periods endpoints read the service's own database, not epr-common-data-api.
  // The submitter type is fixed: a compliance scheme sees every period, so it is the largest response.
  submissionPeriods: () => `${baseUrl()}/submission-periods/packaging`,
  periodsForSubmitterType: () => `${baseUrl()}/submission-periods/packaging/for-submitter-type?${SUBMITTER}`,
  periodForSubmitterType: (submissionPeriod) =>
    `${baseUrl()}/submission-periods/packaging/${encodeURIComponent(submissionPeriod)}/for-submitter-type?${SUBMITTER}`
}

const SUBMITTER = 'submitterType=ComplianceScheme'

// The names of the submission periods a compliance scheme can see now, for the one-period endpoint.
// They come from the service, so nothing needs copying in as periods are added.
export function submissionPeriodNames() {
  const res = http.get(endpoints.periodsForSubmitterType(), params('discovery'))
  if (res.status !== 200) {
    throw new Error(`Could not read the submission periods: status ${res.status} from ${res.url}`)
  }
  const names = res.json().map((period) => period.name)
  if (names.length === 0) {
    throw new Error('The service returned no submission periods: check its database has the changelog applied')
  }
  return names
}

// The packaging endpoints need the `read` scope. The service takes its API key as HTTP
// Basic credentials, base64(clientId:secret), for a client in its Acl:Clients list (see
// the service's README). In CDP both values are secrets on this test suite.
function authorization() {
  const clientId = __ENV.API_CLIENT_ID
  const secret = __ENV.API_CLIENT_SECRET
  if (!clientId || !secret) {
    throw new Error('API_CLIENT_ID and API_CLIENT_SECRET are required: the service rejects unauthenticated calls')
  }
  return `Basic ${encoding.b64encode(`${clientId}:${secret}`)}`
}

// Built on first use, not at import, so `k6 inspect` can parse the scripts without them.
let headers

function requestHeaders() {
  if (!headers) {
    headers = { Accept: 'application/json', Authorization: authorization() }
    // Only needed when SERVICE_URL is the developer API gateway (ephemeral-protected.api...),
    // for a run from a laptop. Calls inside CDP go straight to the service and don't send it.
    if (__ENV.X_API_KEY) {
      headers['x-api-key'] = __ENV.X_API_KEY
    }
  }
  return headers
}

export function params(endpoint) {
  return {
    headers: requestHeaders(),
    tags: { endpoint },
    // Above PRD's slowest epr-common-data-api database time (35 s), so a slow upstream shows
    // as a slow response rather than a timeout.
    timeout: __ENV.REQUEST_TIMEOUT || '60s'
  }
}
