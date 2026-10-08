# MongoDB query-plan experiment

Query: posts filtered by authorId = "user-1", sorted by _id,
with a limit of 21.

| Metric | Before | After |
|---|---:|---:|
| Returned documents | 11 | 11 |
| Keys examined | 30 | 11 |
| Documents examined | 30 | 11 |
| Execution time | 6 ms | 15 ms |

Before: the _id_ index supplied ordering, but FETCH inspected
all 30 documents to filter by author.

After: posts_author_id, defined as { authorId: 1, _id: 1 },
restricted the index scan to the author's 11 posts.
Neither plan required a separate SORT stage.

The experiment demonstrates reduced examined data.
Individual timings do not establish a latency improvement.

The compound index consumes storage and adds write maintenance.
It supports author-filtered queries; existing unfiltered GraphQL
pagination continues to use the _id_ index.

Index creation command: docker compose exec backend npm run db:indexes.
Running it twice succeeded without creating duplicate indexes.
