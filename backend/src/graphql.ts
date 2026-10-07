import { buildSchema } from "graphql";

export const schema = buildSchema(`
  type LearningCheck {
    id: ID!
    message: String!
  }

  type User {
    id: ID!
    name: String!
  }

  type Post {
    id: ID!
    title: String!
    author: User
  }

  type Query {
    hello: String!
    learningCheck(id: ID!): LearningCheck
    posts: [Post!]!
  }
`);
