import { readFile } from "node:fs/promises";
import { buildSchema } from "graphql";
import { schema } from "../graphql.js";
import { compareSchemas } from "./compatibility.js";

const baselineFile = new URL("../../schema/baseline.graphql", import.meta.url);

const baselineSource = await readFile(baselineFile, "utf8");
const baseline = buildSchema(baselineSource);

const report = compareSchemas(baseline, schema);

for (const change of report.reviewChanges) {
  console.warn(`REVIEW ${change.type}: ${change.description}`);
}

if (report.breakingChanges.length > 0) {
  for (const change of report.breakingChanges) {
    console.error(`BREAKING ${change.type}: ${change.description}`);
  }

  process.exitCode = 1;
} else {
  console.log("Schema compatibility check passed: no breaking changes.");
}
