import {
  assertValidSchema,
  BreakingChangeType,
  DangerousChangeType,
  findSchemaChanges,
  type GraphQLSchema,
} from "graphql";

const breakingTypes = new Set<string>(Object.values(BreakingChangeType));

const reviewTypes = new Set<string>(Object.values(DangerousChangeType));

/**
 * Compare the existing client contract with its proposed replacement.
 *
 * Breaking changes block compatibility.
 * Potentially dangerous changes are reported for review without blocking.
 * This checks schema structure, not resolver behavior or actual client usage.
 */
export function compareSchemas(
  baseline: GraphQLSchema,
  candidate: GraphQLSchema,
) {
  assertValidSchema(baseline);
  assertValidSchema(candidate);

  const changes = findSchemaChanges(baseline, candidate);

  return {
    breakingChanges: changes.filter((change) => breakingTypes.has(change.type)),
    reviewChanges: changes.filter((change) => reviewTypes.has(change.type)),
    informationalChanges: changes.filter(
      (change) =>
        !breakingTypes.has(change.type) && !reviewTypes.has(change.type),
    ),
  };
}
