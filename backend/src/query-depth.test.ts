import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSchema,
  getIntrospectionQuery,
  parse,
  specifiedRules,
  validate,
} from "graphql";
import { countOperationDepths } from "@graphile/depth-limit";
import { schema } from "./graphql.js";
import { createDepthValidationRule, MAX_QUERY_DEPTH } from "./query-depth.js";

/**
 * A recursive test schema makes valid over-depth operations possible.
 * No artificial relationship is added to the application schema.
 */
const recursiveSchema = buildSchema(/* GraphQL */ `
  type Query {
    node: Node
  }

  type Node {
    name: String!
    child: Node
    friends: [Node!]!
  }
`);

const atLimit = /* GraphQL */ `
  query AtLimit {
    node {
      child {
        child {
          child {
            name
          }
        }
      }
    }
  }
`;

const beyondLimit = /* GraphQL */ `
  query BeyondLimit {
    node {
      child {
        child {
          child {
            child {
              name
            }
          }
        }
      }
    }
  }
`;

function validateRecursive(source: string) {
  return validate(recursiveSchema, parse(source), [
    ...specifiedRules,
    createDepthValidationRule(),
  ]);
}

/**
 * node = level 1; three child selections = levels 2, 3, 4.
 * name is scalar, so the deepest object-selection level remains 4.
 */
test("accepts an operation exactly at the depth limit", () => {
  const depths = countOperationDepths(recursiveSchema, atLimit);

  assert.equal(depths.AtLimit?.$$depth, MAX_QUERY_DEPTH);
  assert.equal(validateRecursive(atLimit).length, 0);
});

/**
 * node = level 1; four child selections reach level 5.
 * The operation is valid GraphQL but exceeds our configured limit of 4.
 */
test("rejects an operation one level beyond the limit", () => {
  const document = parse(beyondLimit);

  assert.equal(validate(recursiveSchema, document).length, 0);

  const depths = countOperationDepths(recursiveSchema, beyondLimit);

  assert.equal(depths.BeyondLimit?.$$depth, 5);

  const errors = validateRecursive(beyondLimit);

  assert.ok(errors.length > 0);
  assert.match(errors[0]!.message, /depth/i);
});

/**
 * Expanding the named fragment gives five object-selection levels.
 * Hiding nesting behind a fragment must not bypass the rule.
 */
test("counts nested selections inside named fragments", () => {
  const source = /* GraphQL */ `
    query NamedFragment {
      node {
        ...NestedChildren
      }
    }

    fragment NestedChildren on Node {
      child {
        child {
          child {
            child {
              name
            }
          }
        }
      }
    }
  `;

  assert.equal(validate(recursiveSchema, parse(source)).length, 0);
  assert.ok(validateRecursive(source).length > 0);
});

/**
 * The inline fragment wrapper adds no level, but its fields reach level 5.
 */
test("counts nested selections inside inline fragments", () => {
  const source = /* GraphQL */ `
    query InlineFragment {
      node {
        ... on Node {
          child {
            child {
              child {
                child {
                  name
                }
              }
            }
          }
        }
      }
    }
  `;

  assert.equal(validate(recursiveSchema, parse(source)).length, 0);
  assert.ok(validateRecursive(source).length > 0);
});

/**
 * Object depth = 4: node -> friends -> friends -> friends.
 * List depth = 3, exceeding the separate list-depth limit of 2.
 */
test("also rejects excessive nested object lists", () => {
  const source = /* GraphQL */ `
    query NestedLists {
      node {
        friends {
          friends {
            friends {
              name
            }
          }
        }
      }
    }
  `;

  const errors = validateRecursive(source);

  assert.ok(errors.length > 0);
  assert.ok(errors.some((error) => /list depth/i.test(error.message)));
});

/**
 * The real posts query reaches exactly four object-selection levels:
 * posts -> edges -> node -> author. pageInfo is a shorter sibling path.
 */
test("preserves the application's paginated posts query", () => {
  const source = /* GraphQL */ `
    query Posts {
      posts(first: 5) {
        edges {
          node {
            id
            title
            status
            author {
              name
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const errors = validate(schema, parse(source), [
    ...specifiedRules,
    createDepthValidationRule(),
  ]);

  assert.equal(errors.length, 0);
});

/**
 * Introspection uses separate package defaults, not the application depth of 4.
 * This checks the generated standard query; the actual playground follows later.
 */
test("preserves standard schema introspection", () => {
  const errors = validate(schema, parse(getIntrospectionQuery()), [
    ...specifiedRules,
    createDepthValidationRule(),
  ]);

  assert.equal(errors.length, 0);
});
