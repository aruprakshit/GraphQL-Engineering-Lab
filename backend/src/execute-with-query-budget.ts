import {
  execute,
  getOperationAST,
  GraphQLError,
  specifiedRules,
  validate,
  type ExecutionArgs,
  type ExecutionResult,
} from "graphql";
import { getComplexity } from "graphql-query-complexity";
import {
  applicationCostEstimator,
  QUERY_COMPLEXITY_LIMIT,
} from "./query-complexity.js";
import { createDepthValidationRule } from "./query-depth.js";

export async function executeWithQueryBudget(
  args: ExecutionArgs,
): Promise<ExecutionResult> {
  // KEEP STANDARD GRAPHQL VALIDATION BEFORE COST ANALYSIS.
  const validationErrors = validate(args.schema, args.document, [
    ...specifiedRules,
    createDepthValidationRule(),
  ]);

  if (validationErrors.length > 0) {
    return { errors: validationErrors };
  }

  const operation = getOperationAST(args.document, args.operationName);

  // LET GRAPHQL REPORT MISSING/AMBIGUOUS OPERATION SELECTION.
  // MUTATIONS ARE OUTSIDE THIS QUERY-BUDGET POLICY.
  if (!operation || operation.operation !== "query") {
    return execute(args);
  }

  let complexity: number;

  try {
    complexity = getComplexity({
      schema: args.schema,
      query: args.document,
      variables: args.variableValues ?? {},
      operationName: args.operationName ?? undefined,
      estimators: [applicationCostEstimator],
      maxQueryNodes: 10_000,
    });
  } catch (error: unknown) {
    // INVALID VARIABLES/ARGUMENTS MUST NOT FALL THROUGH TO EXECUTION.
    if (error instanceof GraphQLError) {
      return { errors: [error] };
    }

    return {
      errors: [
        new GraphQLError("Query complexity could not be calculated", {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        }),
      ],
    };
  }

  if (complexity > QUERY_COMPLEXITY_LIMIT) {
    return {
      errors: [
        new GraphQLError("Query exceeds the complexity limit", {
          extensions: {
            code: "QUERY_TOO_COMPLEX",
            complexity,
            maximumComplexity: QUERY_COMPLEXITY_LIMIT,
          },
        }),
      ],
    };
  }

  return execute(args);
}
