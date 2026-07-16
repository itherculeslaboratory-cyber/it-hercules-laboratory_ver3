#!/usr/bin/env node
// codegen: schemas/**/*.schema.json -> packages/truth/src/generated/validators.mjs
//
// WHY: Ajv compiles JSON Schema to a validator by generating JS with `new
// Function`. The Cloudflare Workers runtime (workerd) forbids runtime code
// generation ("Code generation from strings disallowed"), so `ajv.compile()`
// at request time throws. Ajv "standalone" mode emits the SAME generated code
// ahead of time as a plain module — identical validation logic, zero runtime
// eval. envelope.ts imports these instead of compiling at runtime.
//
// Output is CommonJS (.cjs): the standalone code pulls ajv runtime helpers via
// require(), which native ESM (vitest) can't run but a .cjs module can — and
// esbuild (wrangler) bundles it for the worker. envelope.ts default-imports it.
//
// Direction is ONE-WAY: schemas/ -> generated. Never edit the output; fix the
// schema and re-run (逆流禁止 — AGENTS.md「スキーマの正本」).
//
// Usage:
//   node scripts/codegen-validators.mjs          # regenerate in place
//   node scripts/codegen-validators.mjs --check   # regen to temp, byte-compare
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(join(ROOT, "packages", "truth", "package.json"));
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const standaloneCode = require("ajv/dist/standalone").default;

const OUT = join(ROOT, "packages", "truth", "src", "generated", "validators.cjs");

// exportName (valid JS id) -> schema file under schemas/. Fixed order = stable output.
// Must stay in sync with envelope.ts VALIDATORS map.
const SCHEMAS = [
  ["envelope", "events/envelope.schema.json"],
  ["obsCapture", "events/obs-capture.schema.json"],
  ["obsPhoto", "events/obs-photo.schema.json"],
  ["obsTemplate", "events/obs-template.schema.json"],
  ["indQr", "events/ind-qr.schema.json"],
  ["mktListing", "events/mkt-listing.schema.json"],
  // C5 K1 events (must match envelope.ts VALIDATOR_NAME + EVENT_NAMES)
  ["indMaster", "events/ind-master.schema.json"],
  ["indCrossParent", "events/ind-cross-parent.schema.json"],
  ["indNameEvent", "events/ind-name-event.schema.json"],
  ["indBrandTemplate", "events/ind-brand-template.schema.json"],
  ["indLifeEvent", "events/ind-life-event.schema.json"],
  // C7 スライス2 クラッチ(匿名プール) events (must match envelope.ts VALIDATOR_NAME + EVENT_NAMES)
  ["indClutch", "events/ind-clutch.schema.json"],
  ["indClutchEvent", "events/ind-clutch-event.schema.json"],
  ["taxonSpecies", "events/taxon-species.schema.json"],
  ["taxonMorph", "events/taxon-morph.schema.json"],
  ["taxonAlias", "events/taxon-alias.schema.json"],
  ["matchPreference", "events/match-preference.schema.json"],
  ["obsSchedule", "events/obs-schedule.schema.json"],
  ["obsDevice", "events/obs-device.schema.json"],
  ["obsAnnotation", "events/obs-annotation.schema.json"],
  ["obsAnalysis", "events/obs-analysis.schema.json"],
  ["cusbIngest", "events/cusb-ingest.schema.json"],
  // C5 K3 economy/market events (must match envelope.ts VALIDATOR_NAME + EVENT_NAMES)
  ["economyPtEvent", "events/economy-pt-event.schema.json"],
  ["economyContributionEvent", "events/economy-contribution-event.schema.json"],
  ["mktTransactionEvent", "events/mkt-transaction-event.schema.json"],
  ["mktRating", "events/mkt-rating.schema.json"],
  ["mktTemplate", "events/mkt-template.schema.json"],
  ["mktPostOffice", "events/mkt-post-office.schema.json"],
  ["socialEval", "events/social-eval.schema.json"],
  ["socialPlatinumVote", "events/social-platinum-vote.schema.json"],
  ["researchProposal", "events/research-proposal.schema.json"],
  ["gmoObligation", "events/gmo-obligation.schema.json"],
  // C5 K4 UI/UX+設定+i18n events (must match envelope.ts VALIDATOR_NAME + EVENT_NAMES)
  ["prefSet", "events/pref-set.schema.json"],
  ["themePack", "events/theme-pack.schema.json"],
  ["uiTemplate", "events/ui-template.schema.json"],
  ["uiVote", "events/ui-vote.schema.json"],
  // C5 K5 research/wiki events (must match envelope.ts VALIDATOR_NAME + EVENT_NAMES)
  ["content", "events/content.schema.json"],
  ["citation", "events/citation.schema.json"],
  ["project", "events/project.schema.json"],
  ["mappingEvent", "events/mapping-event.schema.json"],
  ["category", "events/category.schema.json"],
  ["taskNode", "events/task-node.schema.json"],
  ["wikiNode", "events/wiki-node.schema.json"],
  // C5 K6 plaza/governance events (must match envelope.ts VALIDATOR_NAME + EVENT_NAMES).
  // citeRef is registered first so plaza-post's relative $ref (cite-ref.schema.json)
  // resolves against its $id in the same ajv instance.
  ["citeRef", "events/cite-ref.schema.json"],
  ["plazaPost", "events/plaza-post.schema.json"],
  ["plazaStance", "events/plaza-stance.schema.json"],
  ["plazaFork", "events/plaza-fork.schema.json"],
  ["plazaSignal", "events/plaza-signal.schema.json"],
  ["plazaSummary", "events/plaza-summary.schema.json"],
  ["govVote", "events/gov-vote.schema.json"],
  ["govDispute", "events/gov-dispute.schema.json"],
  ["govPrecedent", "events/gov-precedent.schema.json"],
  ["govFlag", "events/gov-flag.schema.json"],
  // C5 K7 source events + lineage-meta common type (must match envelope.ts
  // VALIDATOR_NAME; the 4 src events are also in EVENT_NAMES, lineageMeta is not).
  ["lineageMeta", "common/lineage-meta.schema.json"],
  ["placement", "events/placement.schema.json"],
  ["deviceBinding", "events/device-binding.schema.json"],
  ["occupancy", "events/occupancy.schema.json"],
  ["telemetryIngest", "events/telemetry-ingest.schema.json"],
  // C5 K8 process/culture events (must match envelope.ts VALIDATOR_NAME + EVENT_NAMES)
  ["intent", "events/intent.schema.json"],
  ["cultureTemplate", "events/culture-template.schema.json"],
  // L-PAY PAY.JP 5%請求フロー events (must match envelope.ts VALIDATOR_NAME + EVENT_NAMES)
  ["feeInvoice", "events/fee-invoice.schema.json"],
  ["feeSettlement", "events/fee-settlement.schema.json"],
  ["consentRecord", "frozen/consent-record.schema.json"],
  ["embeddingManifest", "frozen/embedding-manifest.schema.json"],
  ["individualKey", "frozen/individual-key.schema.json"],
  ["ledgerEntry", "frozen/ledger-entry.schema.json"],
  ["provenance", "frozen/provenance.schema.json"],
  ["qrToken", "frozen/qr-token.schema.json"],
  ["tagEvent", "frozen/tag-event.schema.json"],
  ["thumbnail", "frozen/thumbnail.schema.json"],
  ["transferCode", "frozen/transfer-code.schema.json"],
];

function generate() {
  // Same ajv config as the former runtime path (strict:false, allErrors), plus
  // code.source/esm to emit a standalone ES module.
  const ajv = new (Ajv2020.default ?? Ajv2020)({
    strict: false,
    allErrors: true,
    code: { source: true },
  });
  (addFormats.default ?? addFormats)(ajv);

  const refs = {};
  for (const [exportName, rel] of SCHEMAS) {
    const schema = JSON.parse(readFileSync(join(ROOT, "schemas", rel), "utf8"));
    ajv.addSchema(schema, exportName);
    refs[exportName] = exportName;
  }
  const banner =
    "// GENERATED FILE — do not edit by hand.\n" +
    "// source: schemas/**/*.schema.json (ajv standalone CJS; runtime-eval-free)\n" +
    "// direction: schemas/ -> generated (one-way; edit the schema, then re-run)\n" +
    "// regenerate: node scripts/codegen-validators.mjs\n";
  return banner + standaloneCode(ajv, refs).replace(/\r\n/g, "\n");
}

const out = generate();
if (process.argv.includes("--check")) {
  const committed = existsSync(OUT) ? readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : null;
  if (committed !== out) {
    console.error("codegen-validators --check FAILED: packages/truth/src/generated/validators.mjs is out of sync with schemas/.");
    console.error("fix: node scripts/codegen-validators.mjs  (never hand-edit generated files)");
    process.exit(1);
  }
  console.log("codegen-validators --check OK");
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out, "utf8");
  console.log(`codegen-validators OK: wrote ${OUT}`);
}
