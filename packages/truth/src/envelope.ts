// Envelope + frozen-schema validation. schemas/ is the SSOT — the JSON Schema
// files are imported (bundler/vitest resolves the JSON at build/run time from
// the repo files; no shape is duplicated in code). Ajv draft 2020-12.
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv/dist/2020";

import envelopeSchema from "../../../schemas/events/envelope.schema.json";
import consentRecord from "../../../schemas/frozen/consent-record.schema.json";
import embeddingManifest from "../../../schemas/frozen/embedding-manifest.schema.json";
import individualKey from "../../../schemas/frozen/individual-key.schema.json";
import ledgerEntry from "../../../schemas/frozen/ledger-entry.schema.json";
import provenance from "../../../schemas/frozen/provenance.schema.json";
import qrToken from "../../../schemas/frozen/qr-token.schema.json";
import tagEvent from "../../../schemas/frozen/tag-event.schema.json";
import thumbnail from "../../../schemas/frozen/thumbnail.schema.json";
import transferCode from "../../../schemas/frozen/transfer-code.schema.json";

const FROZEN: Record<string, object> = {
  "consent-record": consentRecord,
  "embedding-manifest": embeddingManifest,
  "individual-key": individualKey,
  "ledger-entry": ledgerEntry,
  provenance,
  "qr-token": qrToken,
  "tag-event": tagEvent,
  thumbnail,
  "transfer-code": transferCode,
};

// strict:false — frozen schemas carry x_ihl_* self-description keywords.
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

const compiled = new Map<string, ValidateFunction>();
function validatorFor(name: string): ValidateFunction {
  let v = compiled.get(name);
  if (!v) {
    const schema = name === "envelope" ? envelopeSchema : FROZEN[name];
    if (!schema) throw new Error(`Unknown frozen schema: ${name}`);
    v = ajv.compile(schema);
    compiled.set(name, v);
  }
  return v;
}

function run(name: string, data: unknown): { valid: boolean; errors: string[] } {
  const validate = validatorFor(name);
  const valid = validate(data) as boolean;
  return {
    valid,
    errors: (validate.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
    ),
  };
}

/**
 * Map a dataschema URI-reference to a frozen schema name, matching either the
 * repo path (schemas/frozen/<name>.schema.json) or the published $id
 * (https://schemas.it-hercules.uk/frozen/<name>.schema.json). null = not a
 * frozen schema (data validation is then out of C1 scope).
 */
export function frozenSchemaFor(dataschema: string): string | null {
  const m = dataschema.match(/(?:^|\/)frozen\/([a-z0-9-]+)\.schema\.json$/);
  return m && m[1] in FROZEN ? m[1] : null;
}

/** Validate data against one of the schemas/frozen/* contracts (CL-02..13). */
export function validateFrozen(
  name: string,
  data: unknown,
): { valid: boolean; errors: string[] } {
  return run(name, data);
}

/**
 * Validate a full event envelope (schemas/events/envelope.schema.json).
 * When dataschema points at a frozen schema, data is validated against it too.
 */
export function validateEnvelope(envelope: unknown): {
  valid: boolean;
  errors: string[];
} {
  const outer = run("envelope", envelope);
  if (!outer.valid) return outer;

  const e = envelope as { dataschema?: unknown; data?: unknown };
  if (typeof e.dataschema === "string") {
    const name = frozenSchemaFor(e.dataschema);
    if (name) {
      const inner = run(name, e.data);
      if (!inner.valid) {
        return {
          valid: false,
          errors: inner.errors.map((msg) => `data (${name}): ${msg}`),
        };
      }
    }
  }
  return { valid: true, errors: [] };
}
