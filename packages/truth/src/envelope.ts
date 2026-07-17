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
  "mkt-listing": "mktListing",
  // C5 K1 events (schemas/events/*, non-frozen, reversible)
  "ind-master": "indMaster",
  "ind-cross-parent": "indCrossParent",
  "ind-name-event": "indNameEvent",
  "ind-brand-template": "indBrandTemplate",
  "ind-life-event": "indLifeEvent",
  // C7 スライス2 クラッチ(匿名プール) events
  "ind-clutch": "indClutch",
  "ind-clutch-event": "indClutchEvent",
  "taxon-species": "taxonSpecies",
  "taxon-morph": "taxonMorph",
  "taxon-alias": "taxonAlias",
  "match-preference": "matchPreference",
  "obs-schedule": "obsSchedule",
  "obs-device": "obsDevice",
  "obs-annotation": "obsAnnotation",
  "obs-analysis": "obsAnalysis",
  "cusb-ingest": "cusbIngest",
  // C5 K3 economy/market events (schemas/events/*, non-frozen, reversible)
  "economy-pt-event": "economyPtEvent",
  "economy-contribution-event": "economyContributionEvent",
  "mkt-transaction-event": "mktTransactionEvent",
  "mkt-rating": "mktRating",
  "mkt-template": "mktTemplate",
  "mkt-post-office": "mktPostOffice",
  // round-16 D節(OQ-MKT/ROUTE-03) 市場バックエンド新要件(V3-IND-35/V3-MKT-61)
  "mkt-block": "mktBlock",
  "mkt-reservation": "mktReservation",
  "mkt-reservation-event": "mktReservationEvent",
  // round-15拡張(V3-GOV-35違法出品ユーザー自治)
  "mkt-listing-flag": "mktListingFlag",
  "social-eval": "socialEval",
  "social-platinum-vote": "socialPlatinumVote",
  "research-proposal": "researchProposal",
  "gmo-obligation": "gmoObligation",
  // C5 K4 UI/UX+設定+i18n events (schemas/events/*, non-frozen, reversible)
  "pref-set": "prefSet",
  "theme-pack": "themePack",
  "ui-template": "uiTemplate",
  "ui-vote": "uiVote",
  // C5 K5 research/wiki events (schemas/events/*, non-frozen, reversible).
  // condition is a shared component type (not an envelope-data target) but is
  // registered so content's relative $ref (condition.schema.json / PPR-02 単一
  // 正本)resolves in the same ajv instance — same pattern as cite-ref below.
  condition: "condition",
  content: "content",
  citation: "citation",
  project: "project",
  "mapping-event": "mappingEvent",
  category: "category",
  "task-node": "taskNode",
  "wiki-node": "wikiNode",
  // C5 K6 plaza/governance events (schemas/events/*, non-frozen, reversible).
  // cite-ref is a shared component type (not an envelope-data target) but is
  // registered so plaza-post's relative $ref resolves in the same ajv instance.
  "cite-ref": "citeRef",
  "plaza-post": "plazaPost",
  "plaza-stance": "plazaStance",
  "plaza-fork": "plazaFork",
  "plaza-signal": "plazaSignal",
  "plaza-summary": "plazaSummary",
  // round-16 裁定(OQ-PLZ-03)知の広場スレ解決マーク。
  "plaza-resolution": "plazaResolution",
  "gov-vote": "govVote",
  "gov-dispute": "govDispute",
  "gov-precedent": "govPrecedent",
  "gov-flag": "govFlag",
  // C5 K7 source events (schemas/events/*, non-frozen, reversible). lineage-meta
  // is a COMMON type (schemas/common/*), NOT an envelope-data target — its
  // validator name is registered here for validateLineageMeta but it is kept
  // OUT of EVENT_NAMES (never a dataschema target).
  "lineage-meta": "lineageMeta",
  placement: "placement",
  "device-binding": "deviceBinding",
  occupancy: "occupancy",
  "telemetry-ingest": "telemetryIngest",
  "consent-record": "consentRecord",
  "embedding-manifest": "embeddingManifest",
  "individual-key": "individualKey",
  "ledger-entry": "ledgerEntry",
  provenance: "provenance",
  "qr-token": "qrToken",
  "tag-event": "tagEvent",
  thumbnail: "thumbnail",
  "transfer-code": "transferCode",
  // C5 K8 process/culture events (schemas/events/*, non-frozen, reversible).
  // append-only via POST /events with envelope.id === domain_id (design-k8 §1.2).
  intent: "intent",
  "culture-template": "cultureTemplate",
  // L-PAY: PAY.JP 5%請求フロー events (schemas/events/*, non-frozen, reversible).
  // round-16 裁定 — gmo-obligation を継承する新規イベント型(型リネーム禁止・append)。
  "fee-invoice": "feeInvoice",
  "fee-settlement": "feeSettlement",
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

const EVENT_NAMES = new Set([
  "obs-capture",
  "obs-photo",
  "obs-template",
  "ind-qr",
  "mkt-listing",
  // C5 K1 — data validation MUST fire for these or putEvent stores unchecked
  // data at 202 permanently (Truth is INSERT ONLY, unfixable). See design-k1 §1.2.
  "ind-master",
  "ind-cross-parent",
  "ind-name-event",
  "ind-brand-template",
  "ind-life-event",
  // C7 スライス2 — data validation MUST fire or putEvent stores unchecked data
  // at 201 permanently (Truth is INSERT ONLY, unfixable).
  "ind-clutch",
  "ind-clutch-event",
  "taxon-species",
  "taxon-morph",
  "taxon-alias",
  "match-preference",
  "obs-schedule",
  "obs-device",
  "obs-annotation",
  "obs-analysis",
  "cusb-ingest",
  // C5 K3 — data validation MUST fire or putEvent stores unchecked data at 202
  // permanently (Truth is INSERT ONLY, unfixable). See design-k3 §2.1 批評家#1.
  "economy-pt-event",
  "economy-contribution-event",
  "mkt-transaction-event",
  "mkt-rating",
  "mkt-template",
  "mkt-post-office",
  // round-16 D節(OQ-MKT/ROUTE-03) — data validation MUST fire or putEvent stores
  // unchecked data at 201 permanently (Truth is INSERT ONLY, unfixable).
  "mkt-block",
  "mkt-reservation",
  "mkt-reservation-event",
  "mkt-listing-flag",
  "social-eval",
  "social-platinum-vote",
  "research-proposal",
  "gmo-obligation",
  // C5 K4 — data validation MUST fire or putEvent stores unchecked data at 202
  // permanently (Truth is INSERT ONLY, unfixable). See design-k4 §1.2 批評家#3.
  "pref-set",
  "theme-pack",
  "ui-template",
  "ui-vote",
  // C5 K5 — data validation MUST fire or putEvent stores unchecked data at 202
  // permanently (Truth is INSERT ONLY, unfixable). See design-k5 §2.2 批評家 major#1.
  "content",
  "citation",
  "project",
  "mapping-event",
  "category",
  "task-node",
  "wiki-node",
  // C5 K6 — data validation MUST fire or putEvent stores unchecked data at 202
  // permanently (Truth is INSERT ONLY, unfixable). See design-c5.md §K6 §2.2 批評家#1.
  // cite-ref is intentionally NOT here: it is a component type referenced by
  // plaza-post/gov-dispute, never a dataschema target itself.
  "plaza-post",
  "plaza-stance",
  "plaza-fork",
  "plaza-signal",
  "plaza-summary",
  // round-16 裁定(OQ-PLZ-03) — data validation MUST fire or putEvent stores
  // unchecked data at 201 permanently (Truth is INSERT ONLY, unfixable).
  "plaza-resolution",
  "gov-vote",
  "gov-dispute",
  "gov-precedent",
  "gov-flag",
  // C5 K7 — data validation MUST fire or putEvent stores unchecked data at 202
  // permanently (Truth is INSERT ONLY, unfixable). See design-k7 §1.2.
  // lineage-meta is intentionally NOT here: it is a shared provenance type
  // (schemas/common/*), never a dataschema target itself.
  "placement",
  "device-binding",
  "occupancy",
  "telemetry-ingest",
  // C5 K8 — data validation MUST fire or putEvent stores unchecked data at 202
  // permanently (Truth is INSERT ONLY, unfixable). See design-k8 §1.2 批評家F2.
  "intent",
  "culture-template",
  // L-PAY — data validation MUST fire or putEvent stores unchecked data at 201
  // permanently (Truth is INSERT ONLY, unfixable). round-16 PAY.JP 請求フロー.
  "fee-invoice",
  "fee-settlement",
]);

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
