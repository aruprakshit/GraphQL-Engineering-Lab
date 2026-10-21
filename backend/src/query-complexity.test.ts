import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, validate } from "graphql";
import { getComplexity } from "graphql-query-complexity";
import { schema } from "./graphql.js";
import {
  applicationCostEstimator,
  QUERY_COMPLEXITY_LIMIT,
} from "./query-complexity.js";

/**
 * How score() obtains a number:
 * 1. parse() turns the operation text into an abstract syntax tree (AST).
 * 2. validate() checks the document against the schema; no resolvers execute.
 * 3. getComplexity() walks the selected operation, expanding fragments and
 *    resolving argument/default values and @include/@skip conditions.
 * 4. Our estimator receives each field's already calculated childComplexity:
 *      ordinary field = 1 + childComplexity
 *      Post.author    = 5 + childComplexity
 *      Query.posts    = 10 + pageSize * childComplexity
 * 5. Sibling field costs are added; root field costs give the operation score.
 *
 * A scalar has no children, so childComplexity = 0 and its cost is 1.
 * Query/fragment syntax and variable declarations add no independent cost.
 * These are estimated work units, not measured milliseconds or DB calls.
 */
function score(
  source: string,
  variables: Record<string, unknown> = {},
  operationName?: string,
): number {
  const document = parse(source);

  const errors = validate(schema, document);
  assert.equal(errors.length, 0);

  return getComplexity({
    schema,
    query: document,
    variables,
    operationName,
    estimators: [applicationCostEstimator],
    maxQueryNodes: 10_000,
  });
}

/**
 * Query 1:
 *   hello: no children          = 1 + 0 = 1
 *   operation                   = 1
 *
 * Query 2:
 *   id: no children             = 1 + 0 = 1
 *   title: no children          = 1 + 0 = 1
 *   post childComplexity        = id + title = 1 + 1 = 2
 *   post (ordinary object)      = 1 + 2 = 3
 *   operation                   = 3
 *
 * The post ID argument is not itself a selected field and adds no cost.
 */
test("scores scalar and ordinary object selections", () => {
  const scalar = /* GraphQL */ `
    query {
      hello
    }
  `;

  const object = /* GraphQL */ `
    query {
      post(id: "post-1") {
        id
        title
      }
    }
  `;

  assert.equal(score(scalar), 1);
  assert.equal(score(object), 3);
});

/**
 * id                            = 1
 * node childComplexity          = id = 1
 * node                          = 1 + 1 = 2
 * edges childComplexity         = node = 2
 * edges                         = 1 + 2 = 3
 * posts childComplexity         = edges = 3
 * pageSize: first omitted       = schema default 5
 * posts                         = 10 + 5 * 3 = 25
 * operation                     = 25
 */
test("uses the default page size when first is omitted", () => {
  const source = /* GraphQL */ `
    query {
      posts {
        edges {
          node {
            id
          }
        }
      }
    }
  `;

  assert.equal(score(source), 25);
});

/**
 * Both queries have identical selected children:
 *   id                          = 1
 *   node                        = 1 + id = 2
 *   edges                       = 1 + node = 3
 *   posts childComplexity       = 3
 *
 * first: 2                      => 10 + 2 * 3  = 16
 * first: 20                     => 10 + 20 * 3 = 70
 *
 * Lists are not multiplied automatically by their type. Our Query.posts
 * estimator deliberately multiplies the whole connection selection once.
 */
test("larger pages have a higher estimated cost", () => {
  const small = /* GraphQL */ `
    query {
      posts(first: 2) {
        edges {
          node {
            id
          }
        }
      }
    }
  `;

  const large = /* GraphQL */ `
    query {
      posts(first: 20) {
        edges {
          node {
            id
          }
        }
      }
    }
  `;

  assert.equal(score(small), 16);
  assert.equal(score(large), 70);
});

/**
 * id = 1; node = 1 + 1 = 2; edges = 1 + 2 = 3.
 * posts childComplexity         = 3
 *
 * No supplied count:
 *   operation variable default  = 7 (overrides schema field default 5)
 *   posts                       = 10 + 7 * 3 = 31
 *
 * Supplied { count: 3 }:
 *   supplied variable wins      = 3
 *   posts                       = 10 + 3 * 3 = 19
 *
 * The variable is used as the multiplier, not charged as another field.
 */
test("uses pagination variables and operation variable defaults", () => {
  const source = /* GraphQL */ `
    query Posts($count: Int = 7) {
      posts(first: $count) {
        edges {
          node {
            id
          }
        }
      }
    }
  `;

  assert.equal(score(source), 31);
  assert.equal(score(source, { count: 3 }), 19);
});

/**
 * id                            = 1
 * name                          = 1
 * author childComplexity        = name = 1
 * author (special weight)       = 5 + 1 = 6
 * node childComplexity          = id + author = 1 + 6 = 7
 * node                          = 1 + 7 = 8
 * edges                         = 1 + 8 = 9
 * posts childComplexity         = edges = 9
 * posts(first: 2)               = 10 + 2 * 9 = 28
 * operation                     = 28
 *
 * DataLoader may reuse authors, but this estimate conservatively charges
 * each requested post's author selection; it does not predict cache hits.
 */
test("charges author work inside the page multiplier", () => {
  const source = /* GraphQL */ `
    query {
      posts(first: 2) {
        edges {
          node {
            id
            author {
              name
            }
          }
        }
      }
    }
  `;

  assert.equal(score(source), 28);
});

/**
 * Each alias selects: id = 1; node = 2; edges = 3.
 * first: posts(first: 2)         = 10 + 2 * 3 = 16
 * second: posts(first: 2)        = 10 + 2 * 3 = 16
 * operation (sum of root fields)= 16 + 16 = 32
 *
 * An alias changes the response key, not the schema field name: both
 * fields still use the Query.posts estimator. There is no extra root cost.
 */
test("counts separately aliased post lists", () => {
  const source = /* GraphQL */ `
    query {
      first: posts(first: 2) {
        edges {
          node {
            id
          }
        }
      }
      second: posts(first: 2) {
        edges {
          node {
            id
          }
        }
      }
    }
  `;

  assert.equal(score(source), 32);
});

/**
 * Both fragment forms select exactly the same Post fields:
 *   id                          = 1
 *   name                        = 1
 *   author                      = 5 + name = 6
 *   node                        = 1 + id + author = 1 + 1 + 6 = 8
 *   edges                       = 1 + node = 9
 *   posts(first: 2)             = 10 + 2 * 9 = 28
 *
 * Named fragment result         = 28
 * Inline fragment result        = 28
 * Fragment wrappers add no independent cost; their selected fields count.
 */
test("includes fields selected through named and inline fragments", () => {
  const named = /* GraphQL */ `
    query {
      posts(first: 2) {
        edges {
          node {
            ...PostFields
          }
        }
      }
    }

    fragment PostFields on Post {
      id
      author {
        name
      }
    }
  `;

  const inline = /* GraphQL */ `
    query {
      posts(first: 2) {
        edges {
          node {
            ... on Post {
              id
              author {
                name
              }
            }
          }
        }
      }
    }
  `;

  assert.equal(score(named), 28);
  assert.equal(score(inline), 28);
});

/**
 * withAuthor: false => author selection is excluded:
 *   id = 1; node = 1 + 1 = 2; edges = 1 + 2 = 3
 *   posts                       = 10 + 2 * 3 = 16
 *
 * withAuthor: true => author selection is included:
 *   name = 1; author = 5 + 1 = 6
 *   node = 1 + id + author = 1 + 1 + 6 = 8
 *   edges = 1 + 8 = 9
 *   posts                       = 10 + 2 * 9 = 28
 *
 * The directive itself adds no field cost. Its value decides which work
 * contributes to the estimate; an excluded author has no base cost either.
 */
test("uses directive variables when estimating selected work", () => {
  const source = /* GraphQL */ `
    query Posts($withAuthor: Boolean!) {
      posts(first: 2) {
        edges {
          node {
            id
            author @include(if: $withAuthor) {
              name
            }
          }
        }
      }
    }
  `;

  assert.equal(score(source, { withAuthor: false }), 16);
  assert.equal(score(source, { withAuthor: true }), 28);
});

/**
 * Selected operation Small:
 *   hello                       = 1
 *   Larger is not selected      = no contribution
 *   operation score             = 1
 *
 * Selected operation Larger:
 *   id = 1; node = 2; edges = 3
 *   posts(first: 20)            = 10 + 20 * 3 = 70
 *   Small is not selected       = no contribution
 *   operation score             = 70
 *
 * The two scores are not added because only one operation is requested.
 */
test("scores only the selected named operation", () => {
  const source = /* GraphQL */ `
    query Small {
      hello
    }

    query Larger {
      posts(first: 20) {
        edges {
          node {
            id
          }
        }
      }
    }
  `;

  assert.equal(score(source, {}, "Small"), 1);
  assert.equal(score(source, {}, "Larger"), 70);
});

/**
 * Each of eight separate aliases selects:
 *   id = 1; node = 2; edges = 3
 *   posts(first: 20)            = 10 + 20 * 3 = 70
 *
 * All eight root fields         = 70 + 70 + 70 + 70 + 70 + 70 + 70 + 70
 *                               = 8 * 70 = 560
 * Budget                        = 500
 * Excess                        = 560 - 500 = 60
 *
 * Every list is within its page-size limit, but the combined score exceeds
 * the operation budget. This test calculates only; HTTP rejection is not wired.
 */
test("repeated bounded lists can exceed the overall budget", () => {
  // These are interpolated selection fragments, not standalone documents.
  // Keep them as ordinary templates; Prettier cannot format their dynamic AST.
  const selections = Array.from(
    { length: 8 },
    (_, index) => `
      list${index}: posts(first: 20) {
        edges { node { id } }
      }
    `,
  ).join("\n");

  const complexity = score(`query { ${selections} }`);

  assert.equal(complexity, 560);
  assert.ok(complexity > QUERY_COMPLEXITY_LIMIT);
});
