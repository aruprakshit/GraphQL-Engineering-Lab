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

  enum AccountRole {
    USER
    ADMIN
  }

  input LoginInput {
    username: String!
    password: String!
  }

  type AuthUser {
    id: ID!
    name: String!
    role: AccountRole!
  }

  type LoginPayload {
    user: AuthUser!
  }

  type Mutation {
    login(input: LoginInput!): LoginPayload
  }

  type Query {
    hello: String!
    learningCheck(id: ID!): LearningCheck
    posts(first: Int = 5, after: String): PostConnection!
  }
`);
