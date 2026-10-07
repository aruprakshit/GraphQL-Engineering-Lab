import type { Db } from "mongodb";
import { GraphQLError, buildSchema } from "graphql";
import type { PostDocument, UserDocument } from "./models.js";

// 1. DEFINE WHAT CLIENTS CAN QUERY
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

// DEPENDENCIES AVAILABLE TO RESOLVERS
export interface GraphQLContext {
  database: Db;
  logDatabaseCall: (operation: string) => void;
}

// SHAPE OF THE STORED MONGODB DOCUMENT
interface LearningCheckDocument {
  _id: string;
  message: string;
}

// RESOLVE ROOT QUERY FIELDS
export const rootValue = {
  hello: (): string => {
    return "Hello from GraphQL Engineering Lab";
  },
  learningCheck: async ({ id }: { id: string }, context: GraphQLContext) => {
    try {
      // 1. FETCH THE DOCUMENT USING THE REQUESTED ID
      const document = await context.database
        .collection<LearningCheckDocument>("learning_checks")
        .findOne({ _id: id });

      // 2. RETURN NULL WHEN NO DOCUMENT EXISTS
      if (!document) {
        return null;
      }

      // 3. MAP DATABASE FIELDS TO THE GRAPHQL CONTRACT
      return {
        id: document._id,
        message: document.message,
      };
    } catch (error: unknown) {
      // 4. LOG INTERNAL DETAILS AND EXPOSE A GENERIC ERROR
      console.error("Failed to resolve learningCheck:", error);

      throw new GraphQLError("Database temporarily unavailable", {
        extensions: {
          code: "SERVICE_UNAVAILABLE",
        },
      });
    }
  },
  posts: async (_args: unknown, context: GraphQLContext) => {
    try {
      // 1. FETCH A BOUNDED LIST OF POSTS
      context.logDatabaseCall("posts.find");

      const posts = await context.database
        .collection<PostDocument>("posts")
        .find({})
        .sort({ _id: 1 })
        .limit(5)
        .toArray();

      // 2. MAP EACH POST AND PROVIDE ITS AUTHOR RESOLVER
      return posts.map((post) => ({
        id: post._id,
        title: post.title,

        // GraphQL calls this function only if author is selected.
        author: async () => {
          try {
            context.logDatabaseCall(`users.findOne authorId=${post.authorId}`);

            const user = await context.database
              .collection<UserDocument>("users")
              .findOne({ _id: post.authorId });

            if (!user) {
              return null;
            }

            return {
              id: user._id,
              name: user.name,
            };
          } catch (error: unknown) {
            console.error("Failed to resolve post author:", error);

            throw new GraphQLError("Database temporarily unavailable", {
              extensions: { code: "SERVICE_UNAVAILABLE" },
            });
          }
        },
      }));
    } catch (error: unknown) {
      console.error("Failed to resolve posts:", error);

      throw new GraphQLError("Database temporarily unavailable", {
        extensions: { code: "SERVICE_UNAVAILABLE" },
      });
    }
  },
};
