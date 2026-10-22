import assert from "node:assert/strict";
import { test } from "node:test";
import { graphql, isObjectType } from "graphql";
import { schema } from "../graphql.js";

/**
 * Deprecation is schema metadata, not removal.
 * Verify the actual application schema advertises the migration correctly.
 */
test("exposes the public-user deprecation through introspection", async () => {
  const source = /* GraphQL */ `
    query UserMigrationMetadata {
      __type(name: "User") {
        fields(includeDeprecated: true) {
          name
          isDeprecated
          deprecationReason
        }
      }
    }
  `;

  const result = await graphql({ schema, source });

  assert.equal(result.errors, undefined);
  assert.equal(
    JSON.stringify(result.data),
    JSON.stringify({
      __type: {
        fields: [
          {
            name: "id",
            isDeprecated: false,
            deprecationReason: null,
          },
          {
            name: "name",
            isDeprecated: true,
            deprecationReason: "Use displayName",
          },
          {
            name: "displayName",
            isDeprecated: false,
            deprecationReason: null,
          },
        ],
      },
    }),
  );
});

/**
 * This migration concerns public User only.
 * Authentication payloads retain their existing AuthUser contract.
 */
test("leaves AuthUser unchanged", () => {
  const type = schema.getType("AuthUser");

  assert.ok(isObjectType(type));

  const fields = type.getFields();

  assert.deepEqual(Object.keys(fields).sort(), ["id", "name", "role"]);
  assert.equal(fields.name?.deprecationReason, undefined);
});
