# waste-submit-performance-tests

[k6](https://grafana.com/docs/k6/latest/) performance tests for the Submit Data team's CDP services, run from the CDP
Portal in the `perf-test` environment. They cover
[waste-submit-reg-packaging-api](https://github.com/DEFRA/waste-submit-reg-packaging-api) for now.

- [What is tested](#what-is-tested)
- [Thresholds](#thresholds)
- [Running in CDP](#running-in-cdp)
- [Running locally](#running-locally)
- [Stub or real epr-common-data-api](#stub-or-real-epr-common-data-api)
- [Authentication](#authentication)
- [Settings](#settings)
- [Results](#results)
- [Layout](#layout)
- [Things to know](#things-to-know)
- [Licence](#licence)

## What is tested

Only the API's **published** endpoints are tested: the ones in its v1 OpenAPI document. When an endpoint is
published, add it here. Whether an endpoint is correct is not tested here; that is the API's own test project.

The published endpoints are in two groups:

- **Packaging**, for the Obligations service: low traffic, and slow because each call reads a whole year from
  epr-common-data-api. What matters is that the data comes back in good time when Obligations asks for it.
- **Submission periods**, for the frontends: called as pages load, and fast because they read a few rows from the
  API's own database.

Neither needs a stress, spike, soak or capacity test.

| Test | Load | Proves |
|---|---|---|
| `smoke` | 1 request to `/health`, to `producer-material-totals-by-submitter`, to `producer-material-totals` for the 2 largest submitters, and to each submission periods endpoint. With the stub, also its `/health` | The service is up, the test data is right and, with the stub, that `by-submitter` returns exactly the stub's submitters, so the service is reading from the stub. **It is a gate:** if it fails, the other tests don't run |
| `response-time` | For 5 minutes, all at once: 1 request a minute to each packaging endpoint, and 60 a minute to each submission periods endpoint | Each endpoint answers within its p95 threshold under steady, realistic load. Obligations calls `by-submitter` about once a day and `for-submitter` a few times an hour at most. The submission periods rate is a working figure for page loads |
| `burst` | 10 consumers at once, each asking for 10 submitters' totals in parallel, 3 times | An occasional stress check, well above Obligations' real traffic. **Not part of the regular run**: run it with the `burst` profile |

The packaging endpoints are:

- `GET /packaging/{packagingYear}/producer-material-totals-by-submitter` (tagged `by-submitter`)
- `GET /packaging/{packagingYear}/submitter-organisation/{submitterOrganisationId}/producer-material-totals` (tagged
  `for-submitter`)

The submission periods endpoints, always asked for as a compliance scheme, which sees every period:

- `GET /submission-periods/packaging` (tagged `submission-periods`)
- `GET /submission-periods/packaging/for-submitter-type` (tagged `periods-for-submitter-type`)
- `GET /submission-periods/packaging/{submissionPeriod}/for-submitter-type` (tagged `period-for-submitter-type`), for
  a period picked at random from those the service returns

## Thresholds

A test fails if any of these are missed. They are in [lib/thresholds.js](lib/thresholds.js).

| Measure | Limit |
|---|---|
| Response time, p95, for each packaging endpoint separately | Under 20 s (`P95_MS`, default 20000) |
| Response time, p95, for each submission periods endpoint separately | Under 1 s (`PERIODS_P95_MS`, default 1000) |
| Failed requests | Under 1% (smoke: none) |
| Checks (status 200, and `items` is an array or at least one period is returned) | Over 99% (smoke: all) |
| Dropped iterations (`response-time` only) | None |

The 20 s p95 is for runs with the stub's Typical latency, 7.4 to 14.2 s upstream, which is how `perf-test` runs: it's
what Obligations would see. With the stub's latency at None, to measure the service's own cost, use `P95_MS=2000`.
The 1 s p95 for the submission periods endpoints has no upstream in it: each is a simple lookup in the
service's own database.
The two packaging figures are working figures until business stakeholders agree them, as the EPR Test Strategy requires (SUB-445).


## Running in CDP

Performance test suites only run in `perf-test`. The CDP Portal always runs the latest build of the suite, which
[publish.yml](.github/workflows/publish.yml) builds whenever `main` changes.

1. Deploy waste-submit-reg-packaging-api to `perf-test` from the CDP Portal. The tests call it at
   `https://waste-submit-reg-packaging-api.perf-test.cdp-int.defra.cloud`, with the suite's own API key (see
   [Authentication](#authentication)).
2. Open [Test Suites](https://portal.cdp-int.defra.cloud/test-suites), choose **waste-submit-performance-tests**, pick
   `perf-test` and choose **Run**. Leave the profile empty to run every test, or set one of the profiles below.
3. When it finishes, the Portal shows whether it passed and links to the report.

### Profiles

The Portal passes the run's profile to the suite as `PROFILE`.

| Profile | Runs |
|---|---|
| empty or `all` | `smoke`, then `response-time`. Takes about 6 minutes |
| `smoke` | `smoke` only |
| `response-time` | `response-time` only |
| `burst` | `burst` only |

### Running automatically

The suite should run every time a new version of the API is promoted to `perf-test`:

1. On the waste-submit-reg-packaging-api service page, open **Automations** and turn on auto-deployment to `perf-test`,
   so each new version is deployed there.
2. Set the suite to run after each deployment of the service to `perf-test`, with the profile empty (all tests).
3. Optionally, set up [Slack notifications](https://portal.cdp-int.defra.cloud/documentation/how-to/testing/test-notifications.md)
   for failed runs.

CDP's guide to scheduled runs is
[Scheduled Test Runs](https://portal.cdp-int.defra.cloud/documentation/how-to/testing/scheduled-test-runs.md).

## Running locally

You need Docker. [compose.yml](compose.yml) starts a released image of the API with its Postgres,
[waste-submit-stubs](https://github.com/DEFRA/waste-submit-stubs) in place of epr-common-data-api, LocalStack in place
of the results bucket, and the suite:

```bash
docker compose up --build --exit-code-from development
```

The results are written to `./results`. Open `results/index.html`. Change what runs with the [settings](#settings), for
example:

```bash
SERVICE_VERSION=0.10.0 DURATION=30s docker compose up --build --exit-code-from development
docker compose run --rm -e PROFILE=smoke development
```

`SERVICE_VERSION` picks the API image (default `latest`). The stack gives the service a local-only `PerformanceTests`
client and the suite its credentials. Pull a newer `latest` with `docker compose pull service`.

The stub is the same image that runs in `perf-test` (`STUBS_VERSION`, default `latest`). It serves synthetic approved
submissions sized from production counts for 2024 to 2027, about 32,000 rows and 11 MB a year, and the suite reads its
submitters from the stub. Add upstream latency with its presets:

```bash
COMMON_DATA_API_LATENCY_MS=7443 COMMON_DATA_API_LATENCY_JITTER_MS=6754 docker compose up --build --exit-code-from development
P95_MS=2000 docker compose up --build --exit-code-from development
```

The first is Typical latency, against the default 20 s p95. The second has no latency, against 2 s. If the service
changes what it reads from epr-common-data-api, review waste-submit-stubs with it.

To run one script against a service on your own machine with k6 installed (`brew install k6`):

```bash
ENVIRONMENT=local SERVICE_URL=http://localhost:8085 API_CLIENT_ID=Developer API_CLIENT_SECRET=developer-pwd k6 run tests/smoke.js
```

To run from a laptop against a deployed service, go through the developer API gateway with the AWS OpenVPN connected,
a Developer API key from your [CDP Portal profile](https://portal.cdp-int.defra.cloud/user-profile), and the suite's
client credentials:

```bash
ENVIRONMENT=perf-test \
  SERVICE_URL=https://ephemeral-protected.api.perf-test.cdp-int.defra.cloud/waste-submit-reg-packaging-api \
  X_API_KEY=<developer API key> API_CLIENT_ID=<client id> API_CLIENT_SECRET=<secret> \
  k6 run tests/smoke.js
```

Timings taken through the gateway include it, so use them to check the scripts, not to measure the service.

Pull requests run the same Compose stack, with `DURATION=30s`, in
[check-pull-request.yml](.github/workflows/check-pull-request.yml). That proves the scripts work, not the service's
performance, which is only measured in `perf-test`.

## Stub or real epr-common-data-api

The service reads approved submissions from whatever its `CommonDataApi__BaseUrl` points at. By default that's
[waste-submit-stubs](https://github.com/DEFRA/waste-submit-stubs), which serves synthetic data sized from production.
To measure against a real epr-common-data-api instead, such as Azure TST1 or PRE1, change two files in cdp-app-config
and redeploy the service:

| File | Stub (default) | Real |
|---|---|---|
| `services/waste-submit-reg-packaging-api/perf-test/waste-submit-reg-packaging-api.env` | `CommonDataApi__BaseUrl=https://waste-submit-stubs.perf-test.cdp-int.defra.cloud/epr-common-data-api` | `CommonDataApi__BaseUrl=https://<the Azure web app>` |
| `services/waste-submit-performance-tests/perf-test/waste-submit-performance-tests.env` | Nothing | `UPSTREAM=real` and `UPSTREAM_LABEL=Azure TST1` (or PRE1) |

The suite can't read the service's setting, so `UPSTREAM` tells it which one to expect, and `smoke` checks the two
agree:

- **`UPSTREAM=stub`:** `by-submitter` must return exactly the stub's submitters for the year. Pointing the service at
  a real upstream without changing the suite fails here.
- **`UPSTREAM=real`:** `by-submitter` must return none of the stub's submitters. The stub's IDs are name-based UUIDs
  that real data can't contain, so a service still pointing at the stub fails here. If the stub isn't deployed, the
  check is skipped and the report says so.

In real mode the suite finds its submitters from the service's own `by-submitter` response, so no IDs need copying in.
Set `SUBMITTER_IDS` only to ask for particular ones.

Before a real run:

- **Tell the environment's owners.** TST1 and PRE1 are shared, and every packaging request makes epr-common-data-api run
  its stored procedure, which takes 7 to 35 s in production. `response-time` at 1 request a minute is light. `burst`
  refuses to run against a real upstream unless `ALLOW_BURST_ON_REAL=true` is set.
- **Check the data.** The environment needs approved submissions with obligations for `PACKAGING_YEAR` (default 2025),
  and the SUB-410 stored procedure deployed. Set `PACKAGING_YEAR` to a year it has.
- **Check the limits.** The 20 s p95 and 60 s timeout were set from production's database time. A real run also
  includes moving about 11 MB from Azure into CDP, so expect it to be slower than the stub's Typical latency.
- **Proxy.** The service calls the Azure web apps through the CDP proxy. The TST and PRE web apps are on its perf-test
  allow-list in cdp-tenant-config.

Put both files back to the stub afterwards. The report's Upstream line records which upstream each run used, for the
release evidence.

## Authentication

The packaging endpoints need the `read` scope. The service takes an API key as HTTP Basic credentials,
`Authorization: Basic base64(clientId:secret)`, for a client in its `Acl:Clients` list. See
[Service-to-service authentication](https://github.com/DEFRA/waste-submit-reg-packaging-api#service-to-service-authentication)
in the service's README. `/health` never needs it.

The suite calls as its own client, `PerformanceTests`, so its traffic and access stay apart from the frontend's. To set it
up in `perf-test`:

1. In cdp-app-config, for waste-submit-reg-packaging-api in `perf-test`: `Acl__Clients__PerformanceTests__Type=ApiKey`
   and `Acl__Clients__PerformanceTests__Scopes__0=read`.
2. In the CDP Portal, on the service's secrets for `perf-test`: `Acl__Clients__PerformanceTests__Secret`, a new random
   value. Redeploy the service so it picks the client up.
3. In the CDP Portal, on this test suite's secrets for `perf-test`: `API_CLIENT_ID=PerformanceTests` and
   `API_CLIENT_SECRET` with the same secret.

The suite stops before running anything if either is missing. A wrong or unknown pair makes the packaging calls return
`401`, so `smoke` fails and logs which setting to check.

Inside CDP the suite calls the service directly and needs no `x-api-key`. That header is only for the developer API
gateway, used from a laptop (see [Running locally](#running-locally)).

## Settings

Every setting is an environment variable. In CDP only `ENVIRONMENT`, `PROFILE`, the results path and the two client
secrets are set, so the defaults apply.

| Variable | Default | What it does |
|---|---|---|
| `ENVIRONMENT` | Set by CDP | The environment, used to build the service's address. **Required** |
| `PROFILE` | `all` | Which tests run. See [Profiles](#profiles) |
| `API_CLIENT_ID` | CDP secret | The client the suite calls the service as. **Required** |
| `API_CLIENT_SECRET` | CDP secret | That client's secret. **Required** |
| `X_API_KEY` | Unset | A Developer API key, sent as `x-api-key`. Only for runs through the developer API gateway |
| `SERVICE_URL` | `https://waste-submit-reg-packaging-api.<ENVIRONMENT>.cdp-int.defra.cloud` | Where the service is. Not `BASE_URL`: CDP runs have had that set to the environment's root domain, where every path is a 404, so the suite ignores it |
| `PACKAGING_YEAR` | `2025` | The year asked for |
| `STUB_URL` | `https://waste-submit-stubs.<ENVIRONMENT>.cdp-int.defra.cloud` | Where waste-submit-stubs is. The suite reads the year's submitters and the stub's settings from it |
| `UPSTREAM` | `stub` | What the service reads from: `stub` (waste-submit-stubs) or `real`. See [Stub or real epr-common-data-api](#stub-or-real-epr-common-data-api) |
| `UPSTREAM_LABEL` | `waste-submit-stubs`, or `real epr-common-data-api` | What the report calls the upstream, for example `Azure TST1` |
| `SUBMITTER_IDS` | Found by the suite | Comma-separated submitter organisation IDs to ask for. Otherwise they come from the stub (`stub`) or from the service's `by-submitter` response (`real`) |
| `ALLOW_BURST_ON_REAL` | Unset | `true` lets `burst` run with `UPSTREAM=real` |
| `SMOKE_SUBMITTERS` | `2` | `smoke`: how many submitters to ask for one at a time, largest first |
| `REQUEST_TIMEOUT` | `60s` | Each request's timeout, above PRD's slowest epr-common-data-api database time (35 s) |
| `RATE_PER_MIN` | `1` | `response-time`: requests a minute, per packaging endpoint |
| `PERIODS_RATE_PER_MIN` | `60` | `response-time`: requests a minute, per submission periods endpoint |
| `DURATION` | `5m` | `response-time`: how long it runs |
| `BURST_VUS` | `10` | `burst`: how many consumers at once |
| `BURST_ITERATIONS` | `3` | `burst`: rounds per consumer |
| `BURST_SUBMITTERS` | `10` | `burst`: submitters asked for in each round, largest first. Every request fetches the whole year upstream |
| `P95_MS` | `20000` | The p95 limit for the packaging endpoints, for one run |
| `PERIODS_P95_MS` | `1000` | The p95 limit for the submission periods endpoints, for one run |
| `ERROR_RATE` | `0.01` | The failed-request limit for one run |
| `LOG_FAILURES` | `5` | Failed responses each VU logs per endpoint and status. `0` turns the logging off |
| `RESULTS_OUTPUT_S3_PATH` | Set by CDP | Where the results are uploaded. Nothing is uploaded when it is unset |

## Results

Each run writes everything to `results/`, and [entrypoint.sh](entrypoint.sh) copies the folder to the
`RESULTS_OUTPUT_S3_PATH` the CDP Portal gives the run. The Portal's
report link opens `index.html`.

- `index.html`: what the run ran against (the stub's version, dataset, size and latency, or that `SUBMITTER_IDS` was
  set and no stub was used), then each test's result, requests, average and p95 response time, failed requests, checks, p95 for each
  endpoint, failed responses by status, and links to the files below.
- `<test>/summary.html`: a report of every metric, threshold and check, for every test.
- `<test>/dashboard.html`: k6's web dashboard, with charts of response times and request rates over the run. k6 only
  draws it for a run long enough to chart, so `smoke` and `burst` don't have one.
- `<test>/summary.json`: every metric. `index.html` is built from it.
- `<test>/junit.xml`: each threshold as a JUnit test case.
- `<test>/stub.json`: the stub's version, dataset and latency settings for that test, as read in its `setup()`.
- `logs/<test>.log`: k6's full output, ending with its text summary.

Each test's `handleSummary`, from [lib/summary.js](lib/summary.js), writes `summary.html`, `summary.json` and
`junit.xml`, using the reporters in [lib/vendor/](lib/vendor/README.md). They are copied in rather than imported from
the web because the CDP proxy blocks k6's remote imports. A new test needs
`export const handleSummary = buildHandleSummary('<test>')`.

The suite fails (exits 1) when any test misses a threshold, errors, or is skipped because `smoke` failed.

### When requests fail

Every response that isn't a 200 is counted in `failed_responses`, tagged with its endpoint and status. The
**Failures by status** column in `index.html` and the `failed_responses{status:...}` rows in `summary.html` show the
counts. Status `0` means there was no response at all: DNS, TLS, a refused connection or a timeout.

The log has a `failed response` line, as JSON, for the first `LOG_FAILURES` of each endpoint and status per VU, with the
URL, status, duration, k6's `error` and `errorCode` for a network failure, and the first 500 characters of the body. A
401 or 403 adds a hint about the client secrets. The request headers, which hold the API key, are never logged.

```
failed response {"endpoint":"by-submitter","status":500,"url":"https://...","durationMs":12,"contentType":"application/problem+json","body":"{\"title\":\"System.Net.Http.HttpRequestException\", ..."}
```

The same lines are in the run's logs in the CDP Portal and in `logs/<test>.log` in the results.

## Layout

| Path | Contains |
|---|---|
| `tests/` | One k6 script per test |
| `lib/config.js` | The service's address, the test data and the request settings |
| `lib/thresholds.js` | The pass/fail limits |
| `lib/checks.js` | The checks every packaging response must pass |
| `lib/summary.js`, `lib/vendor/` | The files each test writes when it ends |
| `entrypoint.sh` | Runs the tests, writes `index.html` and uploads the results |
| `compose.yml`, `compose/` | The local stack |

To add a test, add a script to `tests/` that exports `handleSummary` (see [Results](#results)), add it to the `case`
in `entrypoint.sh` and to the tables above. Tag every
request with `params('<endpoint>')` from `lib/config.js` so the thresholds can split by endpoint.

## Things to know

- **Where the data comes from.** From 0.10.0 the API reads approved submissions from epr-common-data-api. In
  `perf-test` and locally that's waste-submit-stubs: the service's `CommonDataApi__BaseUrl` points at
  `https://waste-submit-stubs.perf-test.cdp-int.defra.cloud/epr-common-data-api` in cdp-app-config. The stub's data
  is synthetic, sized from production counts. Each run's report records the stub's version, dataset and latency, which
  the release evidence needs.
- **Both endpoints fetch the whole year upstream.** Every request costs about 11 MB from epr-common-data-api, and with
  the stub's Typical latency, 7.4 to 14.2 s. That's why the p95 limit is 20 s and the request timeout 60 s.
- **`producer-material-totals-by-submitter` is not paged.** It returns every approved submission for the year, so its
  response grows with real data. Watch its p95 and `data_received` most closely once real data lands.
- **A cold service is slower.** The first requests after the service starts take longer while .NET warms up. With the
  `all` profile, `smoke` runs first and warms it up; a single-test profile straight after a deployment may not pass.
- **The CDP proxy.** The tests call the service directly inside CDP and don't set `HTTPS_PROXY`, so the timings leave
  the proxy out. If a first run in `perf-test` can't reach the service, check whether the call has to go through the
  proxy (`HTTP_PROXY`, `localhost:3128`).
- **2-hour limit.** CDP stops any test run after 2 hours. The full suite takes about 6 minutes, or about 7 with
  Typical latency.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government licence v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
