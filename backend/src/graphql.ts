import { buildSchema } from "graphql";

// 1. DEFINE WHAT CLIENTS CAN QUERY
export const schema = buildSchema(`
  type LearningCheck {
    id: ID!
    message: String!
  }

  type Query {
    hello: String!
    learningCheck(id: ID!): LearningCheck
  }
`);

// 2. DEFINE HOW THE ROOT QUERY FIELD GETS ITS VALUE
export const rootValue = {
  hello: (): string => {
    return "Hello from GraphQL Engineering Lab";
  },
};
