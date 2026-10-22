import { buildSchema } from "graphql";

export const schema = buildSchema(/* GraphQL */ `
  type LearningCheck {
    id: ID!
    message: String!
  }

  type User {
    id: ID!
    name: String! @deprecated(reason: "Use displayName")
    displayName: String!
  }

  type Post {
    id: ID!
    title: String!
    author: User
    status: PostStatus!
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

  enum PostStatus {
    DRAFT
    PUBLISHED
  }

  input LoginInput {
    username: String!
    password: String!
  }

  input CreateDraftInput {
    title: String!
  }

  input UpdatePostInput {
    title: String!
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
    logout: Boolean
    createDraft(input: CreateDraftInput!): Post
    updatePost(id: ID!, input: UpdatePostInput!): Post
    publishPost(id: ID!): Post
  }

  type Query {
    hello: String!
    learningCheck(id: ID!): LearningCheck
    posts(first: Int = 5, after: String, status: PostStatus): PostConnection!
    me: AuthUser
    post(id: ID!): Post
  }
`);
