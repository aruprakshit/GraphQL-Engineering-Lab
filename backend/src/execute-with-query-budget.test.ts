import assert from "node:assert/strict";
import { test } from "node:test";
import { schema } from "./graphql.js";
import { executeWithQueryBudget } from "./execute-with-query-budget.js";
import { getIntrospectionQuery, parse } from "graphql";
import { getComplexity } from "graphql-query-complexity";
import {
  applicationCostEstimator,
  QUERY_COMPLEXITY_LIMIT,
} from "./query-complexity.js";

// Each minimal list costs 10 + first * 3.
// Eight lists cost:
//   first: 1  => 8 * (10 + 1 * 3)  = 104
//   first: 20 => 8 * (10 + 20 * 3) = 560
const listSelections = Array.from(
  { length: 8 },
  (_, index) => `
    list${index}: posts(first: $count) {
      edges { node { id } }
    }
  `,
).join("\n");

const wideDocument = parse(`
  query Wide($count: Int!) {
    ${listSelections}
  }
`);

/**
 * hello = 1, below the 500-point budget.
 * The resolver executes once and its result is returned.
 */
test("executes an allowed query", async () => {
  let calls = 0;

  const result = await executeWithQueryBudget({
    schema,
    document: parse(/* GraphQL */ `
      query {
        hello
      }
    `),
    rootValue: {
      hello: () => {
        calls += 1;
        return "Budget check passed";
      },
    },
  });

  assert.equal(result.errors, undefined);
  assert.equal(result.data?.hello, "Budget check passed");
  assert.equal(calls, 1);
});

/**
 * The same document costs 104 with count=1 and 560 with count=20.
 * Variables must affect admission on every execution.
 */
test("uses request variables and rejects before invoking resolvers", async () => {
  let calls = 0;

  const rootValue = {
    posts: () => {
      calls += 1;
      return { edges: [] };
    },
  };

  const allowed = await executeWithQueryBudget({
    schema,
    document: wideDocument,
    variableValues: { count: 1 },
    rootValue,
  });

  assert.equal(allowed.errors, undefined);
  assert.equal(calls, 8);

  calls = 0;

  const rejected = await executeWithQueryBudget({
    schema,
    document: wideDocument,
    variableValues: { count: 20 },
    rootValue,
  });

  assert.equal(rejected.data, undefined);
  assert.equal(rejected.errors?.length, 1);
  assert.equal(rejected.errors?.[0]?.extensions.code, "QUERY_TOO_COMPLEX");
  assert.equal(rejected.errors?.[0]?.extensions.complexity, 560);
  assert.equal(rejected.errors?.[0]?.extensions.maximumComplexity, 500);
  assert.equal(calls, 0);
});

/**
 * The unknown field fails standard validation.
 * Even the valid hello sibling must not execute.
 */
test("preserves standard validation before execution", async () => {
  let calls = 0;

  const result = await executeWithQueryBudget({
    schema,
    document: parse(/* GraphQL */ `
      query {
        hello
        nonexistentField
      }
    `),
    rootValue: {
      hello: () => {
        calls += 1;
        return "Unexpected execution";
      },
    },
  });

  assert.ok(result.errors?.length);
  assert.equal(result.data, undefined);
  assert.match(
    result.errors[0]!.message,
    /Cannot query field "nonexistentField"/,
  );
  assert.equal(calls, 0);
});

/**
 * count=21 violates the existing page-size policy.
 * A failed cost calculation must not bypass admission.
 */
test("rejects invalid pagination before resolver execution", async () => {
  let calls = 0;

  const result = await executeWithQueryBudget({
    schema,
    document: wideDocument,
    variableValues: { count: 21 },
    rootValue: {
      posts: () => {
        calls += 1;
        return { edges: [] };
      },
    },
  });

  assert.equal(result.data, undefined);
  assert.equal(result.errors?.[0]?.extensions.code, "BAD_USER_INPUT");
  assert.equal(calls, 0);
});

/**
 * Small costs 1. Wide costs 560 with count=20.
 * Only the operation identified by operationName controls admission.
 */
test("checks only the selected operation", async () => {
  let calls = 0;

  const document = parse(`
    query Small {
      hello
    }

    query Wide($count: Int!) {
      ${listSelections}
    }
  `);

  const rootValue = {
    hello: () => {
      calls += 1;
      return "Small operation";
    },
    posts: () => {
      calls += 1;
      return { edges: [] };
    },
  };

  const small = await executeWithQueryBudget({
    schema,
    document,
    operationName: "Small",
    rootValue,
  });

  assert.equal(small.errors, undefined);
  assert.equal(small.data?.hello, "Small operation");
  assert.equal(calls, 1);

  calls = 0;

  const wide = await executeWithQueryBudget({
    schema,
    document,
    operationName: "Wide",
    variableValues: { count: 20 },
    rootValue,
  });

  assert.equal(wide.errors?.[0]?.extensions.code, "QUERY_TOO_COMPLEX");
  assert.equal(calls, 0);
});

/**
 * Two named operations without operationName are ambiguous.
 * GraphQL reports the selection error; neither resolver executes.
 */
test("preserves ambiguous-operation errors", async () => {
  let calls = 0;

  const result = await executeWithQueryBudget({
    schema,
    document: parse(/* GraphQL */ `
      query First {
        hello
      }

      query Second {
        hello
      }
    `),
    rootValue: {
      hello: () => {
        calls += 1;
        return "Unexpected execution";
      },
    },
  });

  assert.ok(result.errors?.length);
  assert.equal(result.data, undefined);
  assert.equal(calls, 0);
});

/**
 * PostFields:
 *   id                          = 1
 *   author { name }             = 5 + 1 = 6
 *   node                        = 1 + 1 + 6 = 8
 *   edges                       = 1 + 8 = 9
 *   each posts(first: 20)        = 10 + 20 * 9 = 190
 *   three aliases               = 3 * 190 = 570
 *
 * Fragment syntax must not hide selected work from the budget.
 */
test("rejects over-budget fragment selections before execution", async () => {
  let calls = 0;

  const result = await executeWithQueryBudget({
    schema,
    document: parse(/* GraphQL */ `
      query {
        first: posts(first: 20) {
          edges {
            node {
              ...PostFields
            }
          }
        }
        second: posts(first: 20) {
          edges {
            node {
              ...PostFields
            }
          }
        }
        third: posts(first: 20) {
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
    `),
    rootValue: {
      posts: () => {
        calls += 1;
        return { edges: [] };
      },
    },
  });

  assert.equal(result.data, undefined);
  assert.equal(result.errors?.length, 1);
  assert.equal(result.errors?.[0]?.extensions.code, "QUERY_TOO_COMPLEX");
  assert.equal(result.errors?.[0]?.extensions.complexity, 570);
  assert.equal(calls, 0);
});

/**
 * Each separately aliased hello costs 1.
 * 500 aliases = 500 points: accepted.
 * 501 aliases = 501 points: rejected.
 *
 * The policy rejects scores greater than the limit, not equal to it.
 */
test("accepts the exact budget and rejects one point above it", async () => {
  for (const count of [QUERY_COMPLEXITY_LIMIT, QUERY_COMPLEXITY_LIMIT + 1]) {
    let calls = 0;

    const selections = Array.from(
      { length: count },
      (_, index) => `greeting${index}: hello`,
    ).join("\n");

    const result = await executeWithQueryBudget({
      schema,
      document: parse(`query { ${selections} }`),
      rootValue: {
        hello: () => {
          calls += 1;
          return "Hello";
        },
      },
    });

    if (count === QUERY_COMPLEXITY_LIMIT) {
      assert.equal(result.errors, undefined);
      assert.ok(result.data);
      assert.equal(Object.keys(result.data).length, count);
      assert.equal(calls, count);
    } else {
      assert.equal(result.data, undefined);
      assert.equal(result.errors?.[0]?.extensions.code, "QUERY_TOO_COMPLEX");
      assert.equal(result.errors?.[0]?.extensions.complexity, count);
      assert.equal(calls, 0);
    }
  }
});

/**
 * Standard introspection describes schema types and fields.
 * Its score is calculated from the actual generated document instead of
 * hard-coding a total that could change with GraphQL's query generator.
 *
 * This deliberately checks introspection against the same budget.
 * There is no blanket exemption based on an operation name.
 */
test("supports standard schema introspection within the budget", async () => {
  const document = parse(getIntrospectionQuery());

  const complexity = getComplexity({
    schema,
    query: document,
    estimators: [applicationCostEstimator],
    maxQueryNodes: 10_000,
  });

  assert.ok(
    complexity <= QUERY_COMPLEXITY_LIMIT,
    `Introspection costs ${complexity}; budget is ${QUERY_COMPLEXITY_LIMIT}`,
  );

  const result = await executeWithQueryBudget({
    schema,
    document,
  });

  assert.equal(result.errors, undefined);
  assert.ok(result.data?.__schema);

  const serialized = JSON.stringify(result.data);

  assert.ok(serialized.includes('"name":"Query"'));
  assert.ok(serialized.includes('"name":"PostStatus"'));
});

/**
 * The client-controlled name "IntrospectionQuery" does not grant an exemption.
 * Eight minimal 20-post lists still cost 8 * 70 = 560.
 */
test("does not exempt a query merely named IntrospectionQuery", async () => {
  let calls = 0;

  const selections = Array.from(
    { length: 8 },
    (_, index) => `
      list${index}: posts(first: 20) {
        edges { node { id } }
      }
    `,
  ).join("\n");

  const result = await executeWithQueryBudget({
    schema,
    document: parse(`
      query IntrospectionQuery {
        ${selections}
      }
    `),
    rootValue: {
      posts: () => {
        calls += 1;
        return { edges: [] };
      },
    },
  });

  assert.equal(result.errors?.[0]?.extensions.code, "QUERY_TOO_COMPLEX");
  assert.equal(calls, 0);
});

/**
 * A cyclic fragment is invalid GraphQL.
 * Standard validation must reject it before cost analysis or execution.
 */
test("preserves fragment-cycle validation errors", async () => {
  let calls = 0;

  const result = await executeWithQueryBudget({
    schema,
    document: parse(/* GraphQL */ `
      query {
        post(id: "post-1") {
          ...Loop
        }
      }

      fragment Loop on Post {
        id
        ...Loop
      }
    `),
    rootValue: {
      post: () => {
        calls += 1;
        return null;
      },
    },
  });

  assert.ok(result.errors?.length);
  assert.equal(result.data, undefined);
  assert.equal(calls, 0);
});

/**
 * This ticket applies the budget to queries only.
 * Mutation execution still reaches its resolver. The real logout resolver
 * remains responsible for its request guard and session revocation.
 */
test("preserves mutation execution", async () => {
  let calls = 0;

  const result = await executeWithQueryBudget({
    schema,
    document: parse(/* GraphQL */ `
      mutation {
        logout
      }
    `),
    rootValue: {
      logout: () => {
        calls += 1;
        return true;
      },
    },
  });

  assert.equal(result.errors, undefined);
  assert.equal(result.data?.logout, true);
  assert.equal(calls, 1);
});
