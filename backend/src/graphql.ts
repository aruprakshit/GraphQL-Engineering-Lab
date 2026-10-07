import type { Db } from "mongodb";
import { GraphQLError, buildSchema } from "graphql";

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

// DEPENDENCIES AVAILABLE TO RESOLVERS
export interface GraphQLContext {
  database: Db;
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
};
