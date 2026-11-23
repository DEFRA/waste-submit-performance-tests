#!/bin/sh
# Runs the k6 tests, writes results/index.html for the CDP Portal and, when
# RESULTS_OUTPUT_S3_PATH is set, uploads the results to S3.
#
# PROFILE picks the tests. CDP Portal passes it from the run's profile field.
#   all (default)                   smoke, then response-time. Stops if smoke fails.
#   smoke | response-time | burst   that test only. burst is an occasional stress check,
#                                   so it isn't part of all.

if [ -z "$ENVIRONMENT" ]; then
  echo "Error: ENVIRONMENT is not set" >&2
  exit 1
fi
export ENVIRONMENT

# The service's API key, sent as HTTP Basic credentials. In CDP these are secrets on
# this test suite. The client id is logged below; the secret is never printed.
for var in API_CLIENT_ID API_CLIENT_SECRET; do
  eval "value=\${$var}"
  if [ -z "$value" ]; then
    echo "Error: $var is not set. Add it as a secret on the test suite in the CDP Portal" >&2
    exit 1
  fi
done
unset value

PROFILE=${PROFILE:-all}
ROOT=$(cd "$(dirname "$0")" && pwd)
RESULTS=${ROOT}/results
LOGS=${RESULTS}/logs
TARGET=${SERVICE_URL:-https://waste-submit-reg-packaging-api.${ENVIRONMENT}.cdp-int.defra.cloud}

case "$PROFILE" in
  all) TESTS="smoke response-time" ;;
  smoke | response-time | burst) TESTS="$PROFILE" ;;
  *)
    echo "Error: unknown PROFILE '$PROFILE'. Use all, smoke, response-time or burst." >&2
    exit 2
    ;;
esac

rm -rf "$RESULTS"
mkdir -p "$LOGS"

echo "run_id=${RUN_ID:-local} environment=$ENVIRONMENT profile=$PROFILE upstream=${UPSTREAM:-stub} target=$TARGET client=$API_CLIENT_ID x_api_key=$([ -n "$X_API_KEY" ] && echo set || echo unset) base_url_ignored=${BASE_URL:-unset}"

ROWS=""
EXIT_CODE=0
SMOKE_FAILED=false

# One row per test: name, result class, result, stats cells, links.
add_row() {
  ROWS="${ROWS}<tr><td>$1</td><td class=\"$2\">$3</td>$4<td>$5</td></tr>
"
}

EMPTY_STATS='<td class="num">-</td><td class="num">-</td><td class="num">-</td><td class="num">-</td><td class="num">-</td><td>-</td><td>-</td>'

# Requests, avg, p95, failed %, checks %, p95 per endpoint and failed responses by status,
# from the summary.json the test's handleSummary wrote. Status 0 means no response at all.
stats_cells() {
  if [ ! -f "$1" ] || ! command -v jq >/dev/null 2>&1; then
    echo "$EMPTY_STATS"
    return
  fi
  jq -r '
    def ms(v): if v == null then "-" else ((v * 10 | round) / 10 | tostring) + " ms" end;
    def pct(v): if v == null then "-" else ((v * 10000 | round) / 100 | tostring) + "%" end;
    .metrics as $m |
    ([$m | to_entries[] | select(.key | startswith("http_req_duration{endpoint:"))
      | (.key | ltrimstr("http_req_duration{endpoint:") | rtrimstr("}")) + " " + ms(.value.values["p(95)"])]
      | join("<br>")) as $byEndpoint |
    ($m.failed_responses.values.count // 0) as $failedTotal |
    [$m | to_entries[] | select(.key | startswith("failed_responses{status:")) | select(.value.values.count > 0)
      | {status: (.key | ltrimstr("failed_responses{status:") | rtrimstr("}")), count: .value.values.count}] as $byStatus |
    ($failedTotal - ([$byStatus[].count] | add // 0)) as $otherStatuses |
    (([$byStatus[] | "\(.status): \(.count)"] + (if $otherStatuses > 0 then ["other: \($otherStatuses)"] else [] end))
      | join("<br>")) as $failures |
    "<td class=\"num\">" + (($m.http_reqs.values.count // 0) | tostring) + "</td>" +
    "<td class=\"num\">" + ms($m.http_req_duration.values.avg) + "</td>" +
    "<td class=\"num\">" + ms($m.http_req_duration.values["p(95)"]) + "</td>" +
    "<td class=\"num\">" + pct($m.http_req_failed.values.rate) + "</td>" +
    "<td class=\"num\">" + pct($m.checks.values.rate) + "</td>" +
    "<td>" + (if $byEndpoint == "" then "-" else $byEndpoint end) + "</td>" +
    "<td>" + (if $failures == "" then "-" else $failures end) + "</td>"
  ' "$1" 2>/dev/null || echo "$EMPTY_STATS"
}

for test in $TESTS; do
  if [ "$SMOKE_FAILED" = "true" ]; then
    echo "Skipping $test: smoke failed"
    add_row "$test" "skipped" "Not run" "$EMPTY_STATS" "Smoke failed, so the timed tests were skipped"
    continue
  fi

  echo ""
  echo "==== $test ===="
  mkdir -p "$RESULTS/$test"

  # The test's handleSummary (lib/summary.js) writes summary.html, summary.json and
  # junit.xml to RESULTS_DIR. k6 also exports its web dashboard as dashboard.html, with
  # charts over time; port -1 turns off the live server, which nothing connects to here.
  # POSIX sh has no pipefail, so k6's exit code is written to a file before tee hides it.
  {
    RESULTS_DIR="$RESULTS/$test" \
      K6_WEB_DASHBOARD=true \
      K6_WEB_DASHBOARD_PORT=-1 \
      K6_WEB_DASHBOARD_EXPORT="$RESULTS/$test/dashboard.html" \
      k6 run --no-color "$ROOT/tests/$test.js"
    echo $? >"$LOGS/$test.exit"
  } 2>&1 | tee "$LOGS/$test.log"
  rc=$(cat "$LOGS/$test.exit")
  rm -f "$LOGS/$test.exit"

  links=""
  for file in summary.html:Report dashboard.html:Dashboard summary.json:JSON junit.xml:JUnit; do
    if [ -f "$RESULTS/$test/${file%%:*}" ]; then
      links="${links}<a href=\"$test/${file%%:*}\">${file#*:}</a> · "
    fi
  done
  # k6 skips the dashboard for a run too short to chart (smoke, burst).
  links="${links}<a href=\"logs/$test.log\">Log</a>"
  stats=$(stats_cells "$RESULTS/$test/summary.json")

  case "$rc" in
    0) add_row "$test" "pass" "Passed" "$stats" "$links" ;;
    99)
      add_row "$test" "fail" "Failed" "$stats" "Thresholds not met. $links"
      EXIT_CODE=1
      ;;
    *)
      add_row "$test" "fail" "Error" "$stats" "k6 exited with $rc. $links"
      EXIT_CODE=1
      ;;
  esac

  if [ "$test" = "smoke" ] && [ "$rc" -ne 0 ]; then
    SMOKE_FAILED=true
  fi
done

if [ "$EXIT_CODE" -eq 0 ]; then OVERALL="Passed"; else OVERALL="Failed"; fi

# What the run ran against, from the stub.json the first test that ran wrote (lib/summary.js).
STUB_LINE="Upstream: not recorded."
for test in $TESTS; do
  file="$RESULTS/$test/stub.json"
  if [ -f "$file" ] && command -v jq >/dev/null 2>&1; then
    STUB_LINE=$(jq -r '
      if .used == true then
        "Upstream: waste-submit-stubs \(.version) at \(.url), epr-common-data-api \(.year) dataset \(.profile)" +
        (if .sizes then " (\(.sizes))" else "" end) +
        ", \(.rowCount) rows, \(.bytes) bytes, \(.submitterCount) submitters. Simulated latency \(.latencyMs) ms + 0 to \(.latencyJitterMs) ms."
      elif .used == false then
        "Upstream: \(.upstreamLabel) (UPSTREAM=real), \(.submitters) submitters for \(.packagingYear). " +
        (if .checkedAgainstStub then "Smoke compared its submitters with those of waste-submit-stubs, to show it was not reading from the stub: see the smoke checks."
         else "waste-submit-stubs was not reachable, so the run was not checked against it." end)
      else "Upstream: not recorded." end
    ' "$file" 2>/dev/null || echo "Upstream: not recorded.")
    echo "$STUB_LINE"
    break
  fi
done

cat >"$RESULTS/index.html" <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>waste-submit-performance-tests</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #0b0c0c; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .5rem; border-bottom: 1px solid #b1b4b6; }
  .pass { color: #00703c; font-weight: 600; }
  .fail { color: #d4351c; font-weight: 600; }
  .skipped { color: #505a5f; }
  .meta { color: #505a5f; }
  .num { text-align: right; white-space: nowrap; }
  .scroll { overflow-x: auto; }
</style>
</head>
<body>
<h1>waste-submit-reg-packaging-api performance: ${OVERALL}</h1>
<p class="meta">$(date -u +"%Y-%m-%d %H:%M:%S UTC") · environment ${ENVIRONMENT} · profile ${PROFILE} · run ${RUN_ID:-local}</p>
<p class="meta">${STUB_LINE}</p>
<p class="meta">Target ${TARGET}. Packaging year ${PACKAGING_YEAR:-2025}. Thresholds: p95 under ${P95_MS:-20000} ms per endpoint, errors under $(awk "BEGIN { print ${ERROR_RATE:-0.01} * 100 }")%.</p>
<div class="scroll">
<table>
<thead><tr><th>Test</th><th>Result</th><th class="num">Requests</th><th class="num">Avg</th><th class="num">p95</th><th class="num">Failed</th><th class="num">Checks</th><th>p95 by endpoint</th><th>Failures by status</th><th>Details</th></tr></thead>
<tbody>
${ROWS}</tbody>
</table>
</div>
<p class="meta">Report: every metric, threshold and check. Dashboard: k6's charts over time, only for runs long enough to chart. Failures by status: responses that weren't the expected status, where 0 means no response (DNS, TLS, refused connection or timeout). Log: k6's full output, with a <code>failed response</code> line for the first few of each, showing the URL, status, error and the start of the body.</p>
</body>
</html>
HTML

echo ""
echo "Overall: $OVERALL. Report: $RESULTS/index.html"

if [ -n "$RESULTS_OUTPUT_S3_PATH" ]; then
  ENDPOINT_ARG=""
  if [ -n "$S3_ENDPOINT" ]; then
    ENDPOINT_ARG="--endpoint-url=$S3_ENDPOINT"
  fi
  if aws $ENDPOINT_ARG s3 cp "$RESULTS" "$RESULTS_OUTPUT_S3_PATH" --recursive --only-show-errors; then
    echo "Results published to $RESULTS_OUTPUT_S3_PATH"
  else
    echo "Error: could not publish results to $RESULTS_OUTPUT_S3_PATH" >&2
    EXIT_CODE=1
  fi
else
  echo "RESULTS_OUTPUT_S3_PATH is not set, so nothing was uploaded"
fi

exit "$EXIT_CODE"
