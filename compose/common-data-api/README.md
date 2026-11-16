# epr-common-data-api stub

waste-submit-reg-packaging-api reads approved submissions from epr-common-data-api's
`GET /api/submissions/v1/pom/approved-submissions/{year}`. The local stack runs [WireMock](https://wiremock.org/) in its
place with these mappings:

| Mapping | Returns |
|---|---|
| `approved-submissions-2024.json` | Synthetic rows for 2024: a direct registrant (`11111111-…`) and a compliance scheme (`aaaaaaaa-…`) with four members, one of which left. These are the suite's default `SUBMITTER_IDS` |
| `approved-submissions-other-years.json` | `204 No Content` for any other year, which the service reads as no data |

All the data is made up. The rows follow the shape the service's `CommonDataApiApprovedSubmissionsProvider` reads; if
that changes, change them here too. The stub answers in a millisecond or two, so local timings leave out the real
epr-common-data-api: they prove the scripts work, not how fast the service is.
