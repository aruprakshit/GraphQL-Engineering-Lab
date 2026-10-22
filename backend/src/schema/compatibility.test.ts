import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSchema } from "graphql";
import { compareSchemas } from "./compatibility.js";

const baseline = buildSchema(/* GraphQL */ `
  type Query {
    user: User
  }

  type User {
    id: ID!
    name: String!
  }
`);

/**
 * An unchanged contract must remain compatible.
 */
test("accepts an unchanged schema", () => {
  const report = compareSchemas(baseline, baseline);

  assert.deepEqual(report.breakingChanges, []);
  assert.deepEqual(report.reviewChanges, []);
  assert.deepEqual(report.informationalChanges, []);
});

/**
 * Existing clients can still request name.
 * New clients can choose displayName instead.
 * Deprecation does not remove the old field.
 */
test("allows an additive field and deprecation", () => {
  const candidate = buildSchema(/* GraphQL */ `
    type Query {
      user: User
    }

    type User {
      id: ID!
      name: String! @deprecated(reason: "Use displayName")
      displayName: String!
    }
  `);

  const report = compareSchemas(baseline, candidate);

  assert.deepEqual(report.breakingChanges, []);
  assert.ok(
    report.informationalChanges.some((change) => change.type === "FIELD_ADDED"),
  );
});

/**
 * Old clients selecting name would fail validation after its removal.
 */
test("detects removal of an existing field", () => {
  const candidate = buildSchema(/* GraphQL */ `
    type Query {
      user: User
    }

    type User {
      id: ID!
    }
  `);

  const report = compareSchemas(baseline, candidate);

  assert.ok(
    report.breakingChanges.some((change) => change.type === "FIELD_REMOVED"),
  );
});

/**
 * Existing clients were promised a non-null name.
 * Changing String! to String weakens that output guarantee.
 */
test("detects weakening output nullability", () => {
  const candidate = buildSchema(/* GraphQL */ `
    type Query {
      user: User
    }

    type User {
      id: ID!
      name: String
    }
  `);

  const report = compareSchemas(baseline, candidate);

  assert.ok(
    report.breakingChanges.some(
      (change) => change.type === "FIELD_CHANGED_KIND",
    ),
  );
});

/**
 * Old clients call user without arguments.
 * A new required argument without a default invalidates those calls.
 */
test("detects adding a required argument", () => {
  const candidate = buildSchema(/* GraphQL */ `
    type Query {
      user(id: ID!): User
    }

    type User {
      id: ID!
      name: String!
    }
  `);

  const report = compareSchemas(baseline, candidate);

  assert.ok(
    report.breakingChanges.some(
      (change) => change.type === "REQUIRED_ARG_ADDED",
    ),
  );
});

/**
 * New enum values can surprise clients with exhaustive handling.
 * Report this for review without treating it as a structural blocker.
 */
test("reports enum additions for review", () => {
  const previous = buildSchema(/* GraphQL */ `
    enum Status {
      DRAFT
      PUBLISHED
    }

    type Query {
      status: Status
    }
  `);

  const candidate = buildSchema(/* GraphQL */ `
    enum Status {
      DRAFT
      PUBLISHED
      ARCHIVED
    }

    type Query {
      status: Status
    }
  `);

  const report = compareSchemas(previous, candidate);

  assert.deepEqual(report.breakingChanges, []);
  assert.ok(
    report.reviewChanges.some(
      (change) => change.type === "VALUE_ADDED_TO_ENUM",
    ),
  );
});
