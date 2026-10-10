import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 1,
  duration: "30s",
  summaryTrendStats: ["avg", "min", "med", "max", "p(95)"],
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate==0"],
  },
};

const query = `
  query LoadTestPosts {
    posts(first: 20) {
      edges {
        node {
          id
          title
          author {
            id
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

export default function () {
  // 1. SEND THE FIXED GRAPHQL OPERATION
  const response = http.post(
    "http://backend:4000/graphql",
    JSON.stringify({ query }),
    {
      headers: {
        "Content-Type": "application/json",
      },
      tags: {
        name: "LoadTestPosts",
      },
      timeout: "10s",
    },
  );

  // 2. PARSE THE RESPONSE WITHOUT HIDING NON-JSON FAILURES
  let body = null;

  try {
    body = response.json();
  } catch {
    // The checks below will report an invalid response.
  }

  // 3. VERIFY HTTP AND GRAPHQL SUCCESS
  check(response, {
    "HTTP status is 200": (res) => res.status === 200,
    "response contains JSON": () => body !== null,
    "no GraphQL errors": () =>
      body !== null &&
      (body.errors === undefined ||
        (Array.isArray(body.errors) && body.errors.length === 0)),
    "returns 20 posts with authors": () => {
      const edges = body?.data?.posts?.edges;

      return (
        Array.isArray(edges) &&
        edges.length === 20 &&
        edges.every(
          (edge) =>
            typeof edge.node?.id === "string" &&
            typeof edge.node?.author?.id === "string" &&
            typeof edge.node?.author?.name === "string",
        )
      );
    },
  });
}
