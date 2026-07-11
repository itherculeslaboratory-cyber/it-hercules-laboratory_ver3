#!/usr/bin/env node
// GATE: C-USB component structure (V3-OTH-02). Every component that declares a
// manifest.json (= is onboarded as a C-USB unit, V3-FND-14) must be complete:
//   manifest has {id, entrypoint, inputs, outputs, tests, golden}
//   FAITHFUL: manifest.entrypoint file EXISTS (not hardcoded run.py — wiki-ingest
//             declares parity_check.py and has no run.py)
//   manifest.tests path EXISTS, manifest.golden path EXISTS, README.md EXISTS
// Components without a manifest are not yet onboarded (e.g. obs-manifest is K1's
// to onboard) and are skipped — onboarding = adding the manifest, which then gates.
// checkComponent(dir) is exported/pure(fs) for --selftest.
import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const REQUIRED = ["id", "entrypoint", "inputs", "outputs", "tests", "golden"];

/** Return a list of structural violations for one component directory (empty = ok). */
export function checkComponent(dir) {
  const name = dir.split(/[\\/]/).pop();
  const out = [];
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return [`${name}: missing manifest.json`];

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return [`${name}: unparsable manifest.json (${e.message})`];
  }

  for (const key of REQUIRED)
    if (!(key in manifest)) out.push(`${name}: manifest missing "${key}"`);

  // entrypoint / tests / golden are declared paths that must actually exist
  for (const key of ["entrypoint", "tests", "golden"]) {
    const rel = manifest[key];
    if (typeof rel === "string" && !existsSync(join(dir, rel)))
      out.push(`${name}: manifest.${key} "${rel}" does not exist`);
  }

  if (!existsSync(join(dir, "README.md"))) out.push(`${name}: missing README.md`);
  return out;
}

function runGate() {
  const root = process.cwd();
  const base = join(root, "components");
  const violations = [];
  if (!existsSync(base)) return violations;
  for (const name of readdirSync(base)) {
    if (name === "__pycache__") continue;
    const dir = join(base, name);
    if (!statSync(dir).isDirectory()) continue;
    if (!existsSync(join(dir, "manifest.json"))) continue; // not onboarded yet
    violations.push(...checkComponent(dir));
  }
  return violations;
}

function selftest() {
  const base = mkdtempSync(join(tmpdir(), "lintcomp-"));
  let failed = false;
  const assert = (cond, label) => {
    console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`);
    if (!cond) failed = true;
  };
  const makeValid = (dirName) => {
    const dir = join(base, dirName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run.py"), "# entry\n");
    writeFileSync(join(dir, "tests.py"), "# tests\n");
    writeFileSync(join(dir, "golden.json"), "{}\n");
    writeFileSync(join(dir, "README.md"), "# c\n");
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        id: dirName,
        entrypoint: "run.py",
        inputs: [],
        outputs: [],
        tests: "tests.py",
        golden: "golden.json",
      }),
    );
    return dir;
  };

  try {
    assert(checkComponent(makeValid("ok")).length === 0, "valid component clean");

    const noManifest = join(base, "no-manifest");
    mkdirSync(noManifest, { recursive: true });
    assert(checkComponent(noManifest).length > 0, "missing manifest flagged");

    const noEntry = makeValid("no-entry");
    rmSync(join(noEntry, "run.py"));
    assert(
      checkComponent(noEntry).some((v) => v.includes("entrypoint")),
      "missing entrypoint file flagged",
    );

    const noTests = makeValid("no-tests");
    rmSync(join(noTests, "tests.py"));
    assert(checkComponent(noTests).some((v) => v.includes("tests")), "missing tests flagged");

    const noGolden = makeValid("no-golden");
    rmSync(join(noGolden, "golden.json"));
    assert(checkComponent(noGolden).some((v) => v.includes("golden")), "missing golden flagged");

    const noReadme = makeValid("no-readme");
    rmSync(join(noReadme, "README.md"));
    assert(checkComponent(noReadme).some((v) => v.includes("README")), "missing README flagged");

    const badKey = makeValid("bad-key");
    writeFileSync(
      join(badKey, "manifest.json"),
      JSON.stringify({ id: "x", entrypoint: "run.py", tests: "tests.py", golden: "golden.json" }),
    );
    assert(
      checkComponent(badKey).some((v) => v.includes('"inputs"')),
      "missing required key flagged",
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }

  if (failed) {
    console.error("lint-components --selftest FAILED");
    process.exit(1);
  }
  console.log("lint-components --selftest OK");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.includes("--selftest")) {
    selftest();
  } else {
    const violations = runGate();
    if (violations.length) {
      console.error("component lint FAILED:");
      for (const v of violations) console.error("  - " + v);
      process.exit(1);
    }
    console.log("component lint OK");
  }
}
