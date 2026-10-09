# GraphQL request timing experiment

Compared page sizes 5 and 20, with and without author fields.
Each combination ran six times sequentially against the local Docker app.
The first run was excluded; timings below are medians of runs 2–6.

| Query | DB calls | Response bytes | Client duration |
|---|---:|---:|---:|
| 5 posts, no authors | 1 | 438 | 8.16 ms |
| 5 posts, with authors | 2 | 634 | 8.33 ms |
| 20 posts, no authors | 1 | 1394 | 6.71 ms |
| 20 posts, with authors | 2 | 2180 | 8.33 ms |

## Findings

- DataLoader fetched three unique authors for both page sizes.
- Author queries stayed at two database calls while response size grew.
- Database-operation timers include driver, network, and decoding time.
- HTTP timing ends when the server finishes handing off the response.
- curl timing includes connection setup and receiving the response.
- Request IDs correlate database operations with HTTP completion logs.

## Limitations

This small sequential local experiment is not a load test.
Timings vary and do not establish a reliable speed comparison.
Serialization and individual GraphQL execution phases were not timed
separately. Database-call count alone does not establish performance.
