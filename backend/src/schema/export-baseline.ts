import { mkdir, writeFile } from "node:fs/promises";
import { lexicographicSortSchema, printSchema } from "graphql";
import { schema } from "../graphql.js";

/**
 * Capture the existing public schema before evolving it.
 *
 * Sorting gives the generated file a stable order for review.
 * The exclusive-write flag prevents accidentally replacing an existing
 * baseline and hiding changes that the compatibility check should detect.
 */
const directory = new URL("../../schema/", import.meta.url);
const destination = new URL("baseline.graphql", directory);

const document = printSchema(lexicographicSortSchema(schema));

await mkdir(directory, { recursive: true });

await writeFile(destination, `${document}\n`, {
  encoding: "utf8",
  flag: "wx",
});

console.log("Schema baseline created: schema/baseline.graphql");
