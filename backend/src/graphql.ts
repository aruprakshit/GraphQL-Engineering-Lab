import { buildSchema } from "graphql";

export const schema = buildSchema(/* GraphQL */ `
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
    posts(first: Int = 5, after: String): PostConnection!
  }

  type PostEdge {
    cursor: String!
    node: Post!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type PostConnection {
    edges: [PostEdge!]!
    pageInfo: PageInfo!
  }
`);
