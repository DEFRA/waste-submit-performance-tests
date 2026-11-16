# Vendored libraries

Copied, unchanged, from [waste-obligations-perf-tests](https://github.com/DEFRA/waste-obligations-perf-tests)
(`scenarios/backend/lib/`), which vendors them because the CDP proxy blocks the remote imports k6 would otherwise use.

| File | Upstream | Gives |
|---|---|---|
| `k6-reporter.js` | [benc-uk/k6-reporter](https://github.com/benc-uk/k6-reporter) `dist/bundle.js` | `htmlReport`, the per-test `summary.html` |
| `k6-summary.js` | [jslib.k6.io/k6-summary/0.0.2](https://jslib.k6.io/k6-summary/0.0.2/index.js) | `textSummary` (the end-of-test summary in the log) and `jUnit` |

To update one, replace the file with the upstream build and run the suite in Docker Compose.
