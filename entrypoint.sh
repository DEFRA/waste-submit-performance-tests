#!/bin/sh
# Runs the k6 tests, writes results/index.html for the CDP Portal and, when
# RESULTS_OUTPUT_S3_PATH is set, uploads the results to S3.
#
# PROFILE picks the tests. CDP Portal passes it from the run's profile field.
#   all (default)                   smoke, then response-time and burst. Stops if smoke fails.
#   smoke | response-time | burst   that test only.

if [ -z "$ENVIRONMENT" ]; then
  echo "Error: ENVIRONMENT is not set" >&2
  exit 1
fi
export ENVIRONMENT

PROFILE=${PROFILE:-all}
ROOT=$(cd "$(dirname "$0")" && pwd)
RESULTS=${ROOT}/results
LOGS=${RESULTS}/logs
TARGET=${BASE_URL:-https://waste-submit-reg-packaging-api.${ENVIRONMENT}.cdp-int.defra.cloud}

case "$PROFILE" in
  all) TESTS="smoke response-time burst" ;;
  smoke | response-time | burst) TESTS="$PROFILE" ;;
  *)
    echo "Error: unknown PROFILE '$PROFILE'. Use all, smoke, response-time or burst." >&2
    exit 2
    ;;
esac

rm -rf "$RESULTS"
mkdir -p "$LOGS"

echo "run_id=${RUN_ID:-local} environment=$ENVIRONMENT profile=$PROFILE target=$TARGET"

ROWS=""
EXIT_CODE=0
SMOKE_FAILED=false

add_row() {
  ROWS="${ROWS}<tr><td>$1</td><td class=\"$2\">$3</td><td>$4</td></tr>
"
}

for test in $TESTS; do
  if [ "$SMOKE_FAILED" = "true" ]; then
    echo "Skipping $test: smoke failed"
    add_row "$test" "skipped" "Not run" "Smoke failed, so the timed tests were skipped"
    continue
  fi

  echo ""
  echo "==== $test ===="
  mkdir -p "$RESULTS/$test"

  # k6 exports its own HTML report when the test ends. Port -1 turns off the live
  # dashboard server, which nothing connects to here. POSIX sh has no pipefail, so
  # k6's exit code is written to a file before tee hides it.
  {
    K6_WEB_DASHBOARD=true \
      K6_WEB_DASHBOARD_PORT=-1 \
      K6_WEB_DASHBOARD_EXPORT="$RESULTS/$test/report.html" \
      k6 run --no-color --summary-export "$RESULTS/$test/summary.json" "$ROOT/tests/$test.js"
    echo $? >"$LOGS/$test.exit"
  } 2>&1 | tee "$LOGS/$test.log"
  rc=$(cat "$LOGS/$test.exit")
  rm -f "$LOGS/$test.exit"

  # k6 skips the HTML report for a run too short to chart (smoke, burst).
  links="<a href=\"$test/summary.json\">Summary</a> · <a href=\"logs/$test.log\">Log</a>"
  if [ -f "$RESULTS/$test/report.html" ]; then
    links="<a href=\"$test/report.html\">Report</a> · $links"
  fi

  case "$rc" in
    0) add_row "$test" "pass" "Passed" "$links" ;;
    99)
      add_row "$test" "fail" "Failed" "Thresholds not met. $links"
      EXIT_CODE=1
      ;;
    *)
      add_row "$test" "fail" "Error" "k6 exited with $rc. <a href=\"logs/$test.log\">Log</a>"
      EXIT_CODE=1
      ;;
  esac

  if [ "$test" = "smoke" ] && [ "$rc" -ne 0 ]; then
    SMOKE_FAILED=true
  fi
done

if [ "$EXIT_CODE" -eq 0 ]; then OVERALL="Passed"; else OVERALL="Failed"; fi

cat >"$RESULTS/index.html" <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>waste-submit-performance-tests</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #0b0c0c; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .5rem; border-bottom: 1px solid #b1b4b6; }
  .pass { color: #00703c; font-weight: 600; }
  .fail { color: #d4351c; font-weight: 600; }
  .skipped { color: #505a5f; }
  .meta { color: #505a5f; }
</style>
</head>
<body>
<h1>waste-submit-reg-packaging-api performance: ${OVERALL}</h1>
<p class="meta">$(date -u +"%Y-%m-%d %H:%M:%S UTC") · environment ${ENVIRONMENT} · profile ${PROFILE} · run ${RUN_ID:-local}</p>
<p class="meta">Target ${TARGET}. Thresholds: p95 under ${P95_MS:-2000} ms per endpoint, errors under $(awk "BEGIN { print ${ERROR_RATE:-0.01} * 100 }")%.</p>
<table>
<thead><tr><th>Test</th><th>Result</th><th>Details</th></tr></thead>
<tbody>
${ROWS}</tbody>
</table>
<p class="meta">k6 only draws an HTML report for runs long enough to chart, so the smoke and burst tests have a summary and log only.</p>
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
