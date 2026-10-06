import { buildSchema } from "graphql";

// 1. DEFINE WHAT CLIENTS CAN QUERY
export const schema = buildSchema(`
  type Query {
    hello: String!
  }
`);

// 2. DEFINE HOW THE ROOT QUERY FIELD GETS ITS VALUE
export const rootValue = {
  hello: (): string => {
    return "Hello from GraphQL Engineering Lab";
  },
};
