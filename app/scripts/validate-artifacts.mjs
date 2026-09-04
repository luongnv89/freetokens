#!/usr/bin/env node
// Data-contract gate (issue #120, tasks.md Task 2.1): validates the GENERATED
// offers.json / offers.jsonl artifacts against schemas/offers-index.schema.json
// so a loader regression cannot silently ship a malformed index. The build
// fails naming the offending artifact and JSON pointer of the bad field.
//
// This governs the build OUTPUT only — schemas/offer.schema.json still governs
// the YAML source and is untouched.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "schemas",
  "offers-index.schema.json",
);

export class ArtifactSchemaError extends Error {}

let compiledIndex;
let compiledOffer;

function indexValidator() {
  if (!compiledIndex) {
    compiledIndex = new Ajv2020({ allErrors: true }).compile(
      JSON.parse(readFileSync(SCHEMA_PATH, "utf8")),
    );
  }
  return compiledIndex;
}

function offerValidator() {
  if (!compiledOffer) {
    // Each offers.jsonl line is one Offer entry, not a whole OffersIndex.
    const root = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
    compiledOffer = new Ajv2020({ allErrors: true }).compile({
      ...root.$defs.Offer,
      $schema: root.$schema,
    });
  }
  return compiledOffer;
}

export function formatSchemaErrors(errors) {
  return errors.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

/** Validate one parsed offers.json document against the index schema. */
export function validateIndexData(data, label = "offers.json") {
  const validate = indexValidator();
  if (!validate(data)) {
    throw new ArtifactSchemaError(
      `${label}: does not match schemas/offers-index.schema.json — ` +
        formatSchemaErrors(validate.errors),
    );
  }
  return true;
}

/** Validate every line of an offers.jsonl payload (one Offer object per line). */
export function validateJsonlText(text, label = "offers.jsonl") {
  const lines = text.trimEnd().split("\n");
  const validate = offerValidator();
  lines.forEach((line, i) => {
    let data;
    try {
      data = JSON.parse(line);
    } catch (exc) {
      throw new ArtifactSchemaError(
        `${label}:${i + 1}: invalid JSON (${exc.message})`,
      );
    }
    if (!validate(data)) {
      throw new ArtifactSchemaError(
        `${label}:${i + 1}: does not match schemas/offers-index.schema.json — ` +
          formatSchemaErrors(validate.errors),
      );
    }
  });
  return lines.length;
}
