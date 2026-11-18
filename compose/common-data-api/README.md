# epr-common-data-api stub

waste-submit-reg-packaging-api reads approved submissions from epr-common-data-api's
`GET /api/submissions/v1/pom/approved-submissions/{year}`. The local stack runs [WireMock](https://wiremock.org/) in its
place with these mappings:

| Mapping | Returns |
|---|---|
| `approved-submissions-2024.json` | Synthetic rows for 2024 in the SUB-410 response shape: a direct registrant (`11111111-…`) and a compliance scheme (`aaaaaaaa-…`) with four members, one of which left (`obligationStatus` `E`). These are the suite's default `SUBMITTER_IDS` |
| `approved-submissions-other-years.json` | `204 No Content` for any other year, which the service reads as no data |

All the data is made up. The rows follow SUB-410's `ApprovedSubmissionWithObligationsEntity`: one row per submitter,
producer and material, with every field present and empty ones `null`. They are the same rows as epr-local-environment's
stub, so if SUB-410's response changes, change them in both places. The stub answers in a millisecond or two, so local
timings leave out the real epr-common-data-api: they prove the scripts work, not how fast the service is.
