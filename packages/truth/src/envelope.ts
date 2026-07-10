// Envelope + frozen/event-schema validation. schemas/ is the SSOT.
//
// Validators are PRECOMPILED (ajv standalone) into ./generated/validators.cjs
// rather than compiled at runtime: the Workers runtime (workerd) forbids
// `new Function`, so `ajv.compile()` throws in a deployed worker / wrangler dev.
// The generated code is byte-identical to what ajv would generate at runtime,
// so validation semantics (valid + errors) are unchanged (CL-01..13 parity).
// Regenerate with: node scripts/codegen-validators.mjs
import validators from "./generated/validators.cjs";

type ValidateFn = ((data: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string }> | null;
};

// kebab schema name (as used in dataschema paths) -> generated export name.
const VALIDATOR_NAME: Record<string, string> = {
  envelope: "envelope",
  "obs-capture": "obsCapture",
  "obs-photo": "obsPhoto",
  "obs-template": "obsTemplate",
  "ind-qr": "indQr",
  "consent-record": "consentRecord",
  "embedding-manifest": "embeddingManifest",
  "individual-key": "individualKey",
  "ledger-entry": "ledgerEntry",
  provenance: "provenance",
  "qr-token": "qrToken",
  "tag-event": "tagEvent",
  thumbnail: "thumbnail",
  "transfer-code": "transferCode",
};

const FROZEN_NAMES = new Set([
  "consent-record",
  "embedding-manifest",
  "individual-key",
  "ledger-entry",
  "provenance",
  "qr-token",
  "tag-event",
  "thumbnail",
  "transfer-code",
]);

const EVENT_NAMES = new Set(["obs-capture", "obs-photo", "obs-template", "ind-qr"]);

function validatorFor(name: string): ValidateFn {
  const exportName = VALIDATOR_NAME[name];
  const v = exportName
    ? (validators as unknown as Record<string, ValidateFn>)[exportName]
    : undefined;
  if (!v) throw new Error(`Unknown schema: ${name}`);
  return v;
}

function run(name: string, data: unknown): { valid: boolean; errors: string[] } {
  const validate = validatorFor(name);
  const valid = validate(data);
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
  return m && FROZEN_NAMES.has(m[1]) ? m[1] : null;
}

/** Map a dataschema URI-reference to a schemas/events/* data schema name. */
export function eventSchemaFor(dataschema: string): string | null {
  const m = dataschema.match(/(?:^|\/)events\/([a-z0-9-]+)\.schema\.json$/);
  return m && EVENT_NAMES.has(m[1]) ? m[1] : null;
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
    const name = frozenSchemaFor(e.dataschema) ?? eventSchemaFor(e.dataschema);
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
