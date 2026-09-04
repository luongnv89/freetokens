#!/usr/bin/env node
// Generates app/src/types/offers-index.d.ts from schemas/offers-index.schema.json
// (issue #120, tasks.md Task 2.1): the Offer / OffersIndex types the React code
// consumes are derived from the frozen data contract, never hand-written, so a
// schema change that breaks a component is a compile error.
//
// The output is COMMITTED. Run `npm run gen:types` after changing the schema;
// tests/types-drift.test.mjs fails when the committed file is stale.
//
// Usage: node scripts/generate-types.mjs [--check]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(
  here,
  "..",
  "..",
  "schemas",
  "offers-index.schema.json",
);
const outPath = path.join(here, "..", "src", "types", "offers-index.d.ts");

const banner =
  "// GENERATED FILE — do not edit by hand.\n" +
  "// Source of truth: schemas/offers-index.schema.json (issue #120 data contract).\n" +
  "// Regenerate with `npm run gen:types` in app/.\n\n";

const check = process.argv.includes("--check");
const generated =
  banner + (await compileFromFile(schemaPath, { bannerComment: "" }));

if (check) {
  const committed = await readFile(outPath, "utf8");
  if (committed !== generated) {
    console.error(
      `${outPath} is stale relative to ${schemaPath}; run \`npm run gen:types\``,
    );
    process.exit(1);
  }
  console.log(
    `ok: ${path.relative(process.cwd(), outPath)} matches the schema`,
  );
} else {
  await writeFile(outPath, generated);
  console.log(`wrote ${path.relative(process.cwd(), outPath)}`);
}
