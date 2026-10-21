import type { ComplexityEstimator } from "graphql-query-complexity";
import { validatePageSize } from "./pagination.js";

/**
 * Initial learning budget, chosen together with the weights below.
 *
 * A minimal 20-post list costs 10 + 20 * 3 = 70. Seven separately aliased
 * lists cost 490; eight cost 560 and exceed this budget. A richer selection
 * reaches the limit sooner because each selected field contributes cost.
 *
 * 500 is a provisional policy choice, not a measured safe capacity, time
 * limit, memory limit, or guaranteed number of database operations. We will
 * test representative queries and playground introspection before enabling
 * rejection, then calibrate the policy using load tests and traces.
 */
export const QUERY_COMPLEXITY_LIMIT = 500;

/**
 * Estimate requested work using relative points, calculated from leaves up.
 * The library sums sibling costs and supplies their total as childComplexity.
 * A scalar has childComplexity = 0. Our estimator supplies the field's total
 * cost, including its children; the library does not add those children again.
 *
 * These initial weights make the learning model easy to explain:
 *   1  = baseline for an ordinary selected field
 *   5  = higher base weight for Post.author relationship resolution
 *   10 = higher base weight for each Query.posts list invocation
 *
 * They are not benchmark-derived ratios: author is not proven five times
 * slower than a scalar, and posts is not proven ten times slower. Cost also
 * does not predict exact DB calls, cache hits, latency, or response bytes.
 *
 * Other fields currently receive the baseline, including database-backed
 * fields such as Query.post and Query.me. This is an intentionally incomplete
 * performance model; future schema fields, especially additional lists, need
 * explicit review. Mutation hashing/writes are not accurately modeled by these
 * query-focused weights and retain their separate authentication protections.
 */
export const applicationCostEstimator: ComplexityEstimator = ({
  type,
  field,
  args,
  childComplexity,
}) => {
  if (type.name === "Query" && field.name === "posts") {
    const pageSize = validatePageSize(args.first);

    // 10: charge a fixed base for each list invocation, even if it ultimately
    // returns no posts. It represents list setup/query overhead in our model,
    // not ten DB calls. Separate aliases each incur this base cost.
    //
    // pageSize * childComplexity: larger requested pages multiply selected
    // work. Use the requested bound, not a database count; estimation must
    // happen before resolvers and must not query MongoDB to calculate cost.
    // validatePageSize shares the resolver's default of 5 and maximum of 20.
    //
    // We multiply the whole connection selection conservatively, including
    // pageInfo metadata that is actually returned once per connection. This
    // avoids special traversal logic for the edges/node wrappers at this stage.
    // The extra lookahead document used for hasNextPage is not modeled exactly.
    //
    // Example: edges { node { id } } costs 1 + (1 + 1) = 3.
    // With first: 20, the total is 10 + 20 * 3 = 70.
    return 10 + pageSize * childComplexity;
  }

  if (type.name === "Post" && field.name === "author") {
    // 5: distinguish relationship resolution from an ordinary field. Loading
    // an author involves DataLoader scheduling/cache lookup and potentially
    // database work; it deserves more weight than copying a stored scalar.
    //
    // We conservatively charge every selected author's work even though the
    // request-scoped loader can batch/deduplicate IDs. We do not assume a cache
    // hit or one database call per author, nor equate five points to either.
    //
    // Example: author { name } costs 5 + 1 = 6. When nested under posts,
    // this cost is included in the children multiplied by the requested size.
    return 5 + childComplexity;
  }

  // 1: every ordinary field contributes a baseline so wide selections are
  // not free. Adding childComplexity accounts for the selected nested work.
  //
  // Scalar: id = 1 + 0 = 1.
  // Ordinary object: node { id title } = 1 + (1 + 1) = 3.
  // A field omitted by the operation contributes no selected-field cost.
  return 1 + childComplexity;
};
