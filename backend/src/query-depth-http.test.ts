import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { buildSchema, type ExecutionResult } from "graphql";
import { createHandler } from "graphql-http/lib/use/express";
import { executeWithQueryBudget } from "./execute-with-query-budget.js";

/**
 * Verify depth admission through real HTTP requests without MongoDB.
 * A valid depth-four query reaches the resolver. Deeper queries, including
 * fragment-based selections, must be rejected before any resolver executes.
 */
const testSchema = buildSchema(/* GraphQL */ `
  type Query {
    node: Node
  }

  type Node {
    name: String!
    child: Node
  }
`);

const allowedQuery = /* GraphQL */ `
  query Allowed {
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

const rejectedQuery = /* GraphQL */ `
  query TooDeep {
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

const rejectedFragmentQuery = /* GraphQL */ `
  query TooDeepWithFragment {
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

test("depth validation over HTTP", async (t) => {
  let resolverCalls = 0;

  const app = express();

  app.all(
    "/graphql",
    createHandler({
      schema: testSchema,
      execute: executeWithQueryBudget,
      rootValue: {
        node: () => {
          resolverCalls += 1;

          return {
            child: {
              child: {
                child: {
                  name: "Leaf",
                },
              },
            },
          };
        },
      },
    }),
  );

  const server = app.listen(0, "127.0.0.1");

  t.after(async () => {
    server.closeAllConnections();

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const endpoint = `http://127.0.0.1:${address.port}/graphql`;

  async function send(
    query: string,
    method: "GET" | "POST",
  ): Promise<{
    response: Response;
    body: ExecutionResult;
  }> {
    let response: Response;

    if (method === "GET") {
      const url = new URL(endpoint);
      url.searchParams.set("query", query);

      response = await fetch(url, {
        headers: { Accept: "application/json" },
      });
    } else {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query }),
      });
    }

    const body = (await response.json()) as ExecutionResult;

    return { response, body };
  }

  /**
   * node -> child -> child -> child = depth 4.
   * This reaches the allowed boundary without exceeding it.
   */
  await t.test("allows depth-four queries over GET and POST", async () => {
    for (const method of ["GET", "POST"] as const) {
      resolverCalls = 0;

      const { response, body } = await send(allowedQuery, method);

      assert.equal(response.status, 200);
      assert.equal(body.errors, undefined);
      assert.equal(resolverCalls, 1);

      assert.equal(
        JSON.stringify(body.data),
        JSON.stringify({
          node: {
            child: {
              child: {
                child: {
                  name: "Leaf",
                },
              },
            },
          },
        }),
      );
    }
  });

  /**
   * node plus four child selections = depth 5.
   * Expanding the fragment produces the same depth.
   * Both must fail before the root resolver starts.
   */
  await t.test("rejects excessive depth before execution", async () => {
    for (const query of [rejectedQuery, rejectedFragmentQuery]) {
      for (const method of ["GET", "POST"] as const) {
        resolverCalls = 0;

        const { body } = await send(query, method);

        assert.equal(body.data, undefined);
        assert.ok(body.errors?.length);
        assert.ok(body.errors.some((error) => /depth/i.test(error.message)));
        assert.equal(resolverCalls, 0);
      }
    }
  });
});
