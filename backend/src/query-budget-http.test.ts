/**
 * Verify query-budget enforcement through real HTTP requests to a temporary
 * Express/graphql-http endpoint. Over-budget requests must invoke no resolvers,
 * while allowed queries, validation, operation selection, introspection, and
 * mutations retain their expected behavior. Stub resolvers isolate admission
 * checks from MongoDB and expose execution through call counters. This suite
 * tests handler integration, not the running main.ts application or load capacity.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { getIntrospectionQuery, type ExecutionResult } from "graphql";
import { createHandler } from "graphql-http/lib/use/express";
import { schema } from "./graphql.js";
import { executeWithQueryBudget } from "./execute-with-query-budget.js";

const helloQuery = /* GraphQL */ `
  query {
    hello
  }
`;

const invalidQuery = /* GraphQL */ `
  query {
    hello
    nonexistentField
  }
`;

const logoutMutation = /* GraphQL */ `
  mutation {
    logout
  }
`;

// Dynamic selection fragments cannot be formatted as static GraphQL documents.
const selections = Array.from(
  { length: 8 },
  (_, index) => `
    list${index}: posts(first: $count) {
      edges { node { id } }
    }
  `,
).join("\n");

const wideQuery = `
  query Wide($count: Int!) {
    ${selections}
  }
`;

const multipleOperations = `
  query Small {
    hello
  }

  ${wideQuery}
`;

interface GraphQLRequest {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

test("query budget over HTTP", async (t) => {
  let helloCalls = 0;
  let postsCalls = 0;
  let logoutCalls = 0;

  const app = express();

  app.all(
    "/graphql",
    createHandler({
      schema,
      execute: executeWithQueryBudget,
      rootValue: {
        hello: () => {
          helloCalls += 1;
          return "Hello over HTTP";
        },
        posts: () => {
          postsCalls += 1;
          return { edges: [] };
        },
        logout: () => {
          logoutCalls += 1;
          return true;
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
    request: GraphQLRequest,
    method: "GET" | "POST" = "POST",
    accept = "application/json",
  ) {
    let response: Response;

    if (method === "GET") {
      const url = new URL(endpoint);

      url.searchParams.set("query", request.query);

      if (request.variables) {
        url.searchParams.set("variables", JSON.stringify(request.variables));
      }

      if (request.operationName) {
        url.searchParams.set("operationName", request.operationName);
      }

      response = await fetch(url, {
        headers: {
          Accept: accept,
        },
      });
    } else {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: accept,
        },
        body: JSON.stringify(request),
      });
    }

    const body = (await response.json()) as ExecutionResult;

    return { response, body };
  }

  /**
   * hello = 1 point.
   * The resolver should execute once.
   */
  await t.test("executes an allowed query", async () => {
    helloCalls = 0;

    const { response, body } = await send({
      query: helloQuery,
    });

    assert.equal(response.status, 200);
    assert.equal(body.errors, undefined);
    assert.equal(body.data?.hello, "Hello over HTTP");
    assert.equal(helloCalls, 1);
  });

  /**
   * id                            = 1
   * node                          = 1 + 1 = 2
   * edges                         = 1 + 2 = 3
   *
   * count=1:
   *   each list                   = 10 + 1 * 3 = 13
   *   eight lists                 = 8 * 13 = 104, allowed
   *
   * count=20:
   *   each list                   = 10 + 20 * 3 = 70
   *   eight lists                 = 8 * 70 = 560, rejected
   *
   * The same document must be evaluated with each request's variables.
   */
  await t.test("applies request variables before execution", async () => {
    postsCalls = 0;

    const allowed = await send({
      query: wideQuery,
      variables: { count: 1 },
    });

    assert.equal(allowed.response.status, 200);
    assert.equal(allowed.body.errors, undefined);
    assert.equal(postsCalls, 8);

    postsCalls = 0;

    const rejected = await send({
      query: wideQuery,
      variables: { count: 20 },
    });

    assert.equal(rejected.body.data, undefined);
    assert.equal(rejected.body.errors?.length, 1);
    assert.equal(
      rejected.body.errors?.[0]?.extensions?.code,
      "QUERY_TOO_COMPLEX",
    );
    assert.equal(rejected.body.errors?.[0]?.extensions?.complexity, 560);
    assert.equal(rejected.body.errors?.[0]?.extensions?.maximumComplexity, 500);
    assert.equal(postsCalls, 0);
  });

  /**
   * Eight minimal 20-post lists cost 560.
   * Neither GET nor response-format negotiation may bypass the budget.
   */
  await t.test(
    "rejects excessive cost across methods and response formats",
    async () => {
      for (const method of ["GET", "POST"] as const) {
        for (const accept of [
          "application/json",
          "application/graphql-response+json",
        ]) {
          postsCalls = 0;

          const { response, body } = await send(
            {
              query: wideQuery,
              variables: { count: 20 },
            },
            method,
            accept,
          );

          assert.ok(response.headers.get("content-type")?.startsWith(accept));
          assert.equal(body.data, undefined);
          assert.equal(body.errors?.[0]?.extensions?.code, "QUERY_TOO_COMPLEX");
          assert.equal(postsCalls, 0);
        }
      }
    },
  );

  /**
   * Small costs 1.
   * The unselected Wide operation contributes no cost and executes no fields.
   */
  await t.test("honors operationName from the HTTP request", async () => {
    helloCalls = 0;
    postsCalls = 0;

    const { response, body } = await send({
      query: multipleOperations,
      operationName: "Small",
    });

    assert.equal(response.status, 200);
    assert.equal(body.errors, undefined);
    assert.equal(body.data?.hello, "Hello over HTTP");
    assert.equal(helloCalls, 1);
    assert.equal(postsCalls, 0);
  });

  /**
   * The unknown field fails standard validation.
   * Even the valid hello sibling must not execute.
   */
  await t.test("preserves standard HTTP validation", async () => {
    helloCalls = 0;

    const { body } = await send({
      query: invalidQuery,
    });

    assert.ok(body.errors?.length);
    assert.equal(body.data, undefined);
    assert.equal(helloCalls, 0);
  });

  /**
   * Generated schema introspection uses the same budget wrapper.
   * It should return schema data without invoking application data resolvers.
   */
  await t.test("supports schema introspection over HTTP", async () => {
    helloCalls = 0;
    postsCalls = 0;

    const { response, body } = await send({
      query: getIntrospectionQuery(),
    });

    assert.equal(response.status, 200);
    assert.equal(body.errors, undefined);
    assert.ok(body.data?.__schema);
    assert.equal(helloCalls, 0);
    assert.equal(postsCalls, 0);
  });

  /**
   * Mutations remain outside this query-only budget.
   * The stub checks handler integration, not actual logout authorization.
   */
  await t.test("preserves POST mutation execution", async () => {
    logoutCalls = 0;

    const { response, body } = await send({
      query: logoutMutation,
    });

    assert.equal(response.status, 200);
    assert.equal(body.errors, undefined);
    assert.equal(body.data?.logout, true);
    assert.equal(logoutCalls, 1);
  });
});
