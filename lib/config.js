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

// BASE_URL wins. Otherwise the service's internal CDP address for ENVIRONMENT.
export function baseUrl() {
  const override = __ENV.BASE_URL
  if (override) {
    return override.replace(/\/$/, '')
  }
  return `https://${SERVICE}.${environment()}.cdp-int.defra.cloud`
}

// The service serves stub data for 2024 with these two synthetic submitters (see the
// service's README): a direct registrant, and a compliance scheme with four members.
// When the real data source is wired in, point these at submitters that exist in
// perf-test with SUBMITTER_IDS (comma-separated) and PACKAGING_YEAR.
const STUB_SUBMITTER_IDS = [
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
]

export const packagingYear = Number(__ENV.PACKAGING_YEAR || 2024)

export const submitterIds = __ENV.SUBMITTER_IDS
  ? __ENV.SUBMITTER_IDS.split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  : STUB_SUBMITTER_IDS

if (submitterIds.length === 0) {
  throw new Error('SUBMITTER_IDS is set but holds no IDs')
}

export function pickSubmitterId() {
  return submitterIds[Math.floor(Math.random() * submitterIds.length)]
}

// Endpoint names double as the `endpoint` tag, which the thresholds are split by.
export const endpoints = {
  health: () => `${baseUrl()}/health`,
  bySubmitter: () => `${baseUrl()}/packaging/${packagingYear}/producer-material-totals-by-submitter`,
  forSubmitter: (submitterId) =>
    `${baseUrl()}/packaging/${packagingYear}/submitter-organisation/${submitterId}/producer-material-totals`
}

export function params(endpoint) {
  return {
    headers: { Accept: 'application/json' },
    tags: { endpoint },
    timeout: '30s'
  }
}
