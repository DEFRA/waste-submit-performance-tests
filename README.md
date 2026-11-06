# waste-submit-performance-tests

[k6](https://grafana.com/docs/k6/latest/) performance tests for the Submit Data team's CDP services, run from the CDP
Portal in the `perf-test` environment. They cover
[waste-submit-reg-packaging-api](https://github.com/DEFRA/waste-submit-reg-packaging-api) for now.

- [What is tested](#what-is-tested)
- [Thresholds](#thresholds)
- [Running in CDP](#running-in-cdp)
- [Running locally](#running-locally)
- [Settings](#settings)
- [Results](#results)
- [Layout](#layout)
- [Things to know](#things-to-know)
- [Licence](#licence)

## What is tested

waste-submit-reg-packaging-api is a read-only API with one consumer, the Obligations service, and low traffic. What
matters is that it returns data in good time when Obligations asks for it, so there is no stress, spike, soak or
capacity test.

| Test | Load | Proves |
|---|---|---|
| `smoke` | 1 request to `/health`, to `producer-material-totals-by-submitter`, and to `producer-material-totals` for each submitter | The service is up and the test data is right. **It is a gate:** if it fails, the other tests don't run |
| `response-time` | 30 requests a minute to each packaging endpoint at once, for 5 minutes | Each endpoint answers within the p95 threshold under steady, realistic load |
| `burst` | 10 consumers at once, each asking for every submitter's totals in parallel, 3 times | Response times hold up when Obligations fans out one request per submitter |

The packaging endpoints are:

- `GET /packaging/{packagingYear}/producer-material-totals-by-submitter` (tagged `by-submitter`)
- `GET /packaging/{packagingYear}/submitter-organisation/{submitterOrganisationId}/producer-material-totals` (tagged
  `for-submitter`)

## Thresholds

A test fails if any of these are missed. They are in [lib/thresholds.js](lib/thresholds.js).

| Measure | Limit |
|---|---|
| Response time, p95, for each endpoint separately | Under 2000 ms |
| Failed requests | Under 1% (smoke: none) |
| Checks (status 200, `items` is an array) | Over 99% (smoke: all) |
| Dropped iterations (`response-time` only) | None |


## Running in CDP

Performance test suites only run in `perf-test`. The CDP Portal always runs the latest build of the suite, which
[publish.yml](.github/workflows/publish.yml) builds whenever `main` changes.

1. Deploy waste-submit-reg-packaging-api to `perf-test` from the CDP Portal. The tests call it at
   `https://waste-submit-reg-packaging-api.perf-test.cdp-int.defra.cloud`.
2. Open [Test Suites](https://portal.cdp-int.defra.cloud/test-suites), choose **waste-submit-performance-tests**, pick
   `perf-test` and choose **Run**. Leave the profile empty to run every test, or set one of the profiles below.
3. When it finishes, the Portal shows whether it passed and links to the report.

### Profiles

The Portal passes the run's profile to the suite as `PROFILE`.

| Profile | Runs |
|---|---|
| empty or `all` | `smoke`, then `response-time` and `burst`. Takes about 6 minutes |
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

You need Docker. [compose.yml](compose.yml) starts a released image of the API with its Postgres, LocalStack in place of
the results bucket, and the suite:

```bash
docker compose up --build --exit-code-from development
```

The results are written to `./results`. Open `results/index.html`. Change what runs with the [settings](#settings), for
example:

```bash
SERVICE_VERSION=0.8.0 DURATION=30s docker compose up --build --exit-code-from development
docker compose run --rm -e PROFILE=smoke development
```

`SERVICE_VERSION` picks the API image (default `latest`). Pull a newer `latest` with `docker compose pull service`.

To run one script against a service on your own machine with k6 installed (`brew install k6`):

```bash
ENVIRONMENT=local BASE_URL=http://localhost:8085 k6 run tests/smoke.js
```

Pull requests run the same Compose stack, with `DURATION=30s`, in
[check-pull-request.yml](.github/workflows/check-pull-request.yml). That proves the scripts work, not the service's
performance, which is only measured in `perf-test`.

## Settings

Every setting is an environment variable. In CDP only `ENVIRONMENT`, `PROFILE` and the results path are set, so the
defaults apply.

| Variable | Default | What it does |
|---|---|---|
| `ENVIRONMENT` | Set by CDP | The environment, used to build the service's address. **Required** |
| `PROFILE` | `all` | Which tests run. See [Profiles](#profiles) |
| `BASE_URL` | `https://waste-submit-reg-packaging-api.<ENVIRONMENT>.cdp-int.defra.cloud` | Where the service is |
| `PACKAGING_YEAR` | `2024` | The year asked for |
| `SUBMITTER_IDS` | The two stub submitters | Comma-separated submitter organisation IDs to ask for |
| `RATE_PER_MIN` | `30` | `response-time`: requests a minute, per endpoint |
| `DURATION` | `5m` | `response-time`: how long it runs |
| `BURST_VUS` | `10` | `burst`: how many consumers at once |
| `BURST_ITERATIONS` | `3` | `burst`: rounds per consumer |
| `P95_MS` | `2000` | The p95 limit for one run |
| `ERROR_RATE` | `0.01` | The failed-request limit for one run |
| `RESULTS_OUTPUT_S3_PATH` | Set by CDP | Where the results are uploaded. Nothing is uploaded when it is unset |

## Results

[entrypoint.sh](entrypoint.sh) writes everything to `results/`, and CDP uploads it to the Portal:

- `index.html`: each test's result, with links. This is the page the Portal opens.
- `<test>/report.html`: k6's own HTML report, with charts of response times and request rates. k6 only draws it for a
  run long enough to chart, so `smoke` and `burst` don't have one.
- `<test>/summary.json`: every metric, from `k6 run --summary-export`.
- `logs/<test>.log`: k6's full output.

The suite fails (exits 1) when any test misses a threshold, errors, or is skipped because `smoke` failed.

## Layout

| Path | Contains |
|---|---|
| `tests/` | One k6 script per test |
| `lib/config.js` | The service's address, the test data and the request settings |
| `lib/thresholds.js` | The pass/fail limits |
| `lib/checks.js` | The checks every packaging response must pass |
| `entrypoint.sh` | Runs the tests, writes `index.html` and uploads the results |
| `compose.yml`, `compose/` | The local stack |

To add a test, add a script to `tests/`, add it to the `case` in `entrypoint.sh` and to the tables above. Tag every
request with `params('<endpoint>')` from `lib/config.js` so the thresholds can split by endpoint.

## Things to know

- **The API serves stub data.** It returns fixed data for 2024 from memory, so today's timings measure the platform and
  the service, not a database query. Run the suite again when the real data source is wired in, and point
  `SUBMITTER_IDS` and `PACKAGING_YEAR` at data that exists in `perf-test`. Test data must be synthetic.
- **`producer-material-totals-by-submitter` is not paged.** It returns every approved submission for the year, so its
  response grows with real data. Watch its p95 and `data_received` most closely once real data lands.
- **A cold service is slower.** The first requests after the service starts take longer while .NET warms up. With the
  `all` profile, `smoke` runs first and warms it up; a single-test profile straight after a deployment may not pass.
- **The CDP proxy.** The tests call the service directly inside CDP and don't set `HTTPS_PROXY`, so the timings leave
  the proxy out. If a first run in `perf-test` can't reach the service, check whether the call has to go through the
  proxy (`HTTP_PROXY`, `localhost:3128`).
- **2-hour limit.** CDP stops any test run after 2 hours. The full suite takes about 6 minutes.

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
