#!/usr/bin/env node
// Multilingual Expansion Stage 4 — repeatable translation completeness audit.
//
// Compares every locale file in ../locales against en.json (the baseline).
// Flat leaf-key comparison (dot-path), not just top-level key counts — this
// is the same method used manually throughout the Stage 0/1 forensic audits
// to find that e.g. ar.json/hi.json/sw.json were only ~10% complete despite
// being fully wired into the running app.
//
// This tool only REPORTS. It never writes to a locale file, never marks a
// language "reviewed" or "approved" — per Stage 4's own rule, a high
// completion percentage is not proof of translation quality or human
// review. Use --json for machine-readable output (e.g. for a future CI gate
// or Stage 10's readiness table); default is a human-readable report.

const fs = require("fs");
const path = require("path");

const LOCALES_DIR = path.join(__dirname, "..", "locales");
const BASELINE_CODE = "en";

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, fullKey, out);
    } else {
      out[fullKey] = value;
    }
  }
  return out;
}

function extractInterpolationVars(value) {
  if (typeof value !== "string") return [];
  const matches = value.match(/\{\{\s*[\w.]+\s*\}\}/g) || [];
  return matches.map((m) => m.replace(/[{}]/g, "").trim()).sort();
}

function loadLocale(code) {
  const filePath = path.join(LOCALES_DIR, `${code}.json`);
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return { ok: true, data: JSON.parse(raw), raw };
  } catch (e) {
    return { ok: false, error: e.message, raw };
  }
}

function auditLocale(code, baselineFlat) {
  const loaded = loadLocale(code);
  if (!loaded.ok) {
    return { code, invalidJson: true, error: loaded.error };
  }
  const flat = flatten(loaded.data);
  const baselineKeys = Object.keys(baselineFlat);
  const targetKeys = new Set(Object.keys(flat));

  const missing = [];
  const empty = [];
  const identicalToEnglish = [];
  const interpolationMismatches = [];

  for (const key of baselineKeys) {
    if (!targetKeys.has(key)) {
      missing.push(key);
      continue;
    }
    const targetValue = flat[key];
    const baseValue = baselineFlat[key];
    if (typeof targetValue === "string" && targetValue.trim() === "") {
      empty.push(key);
    }
    if (code !== BASELINE_CODE && typeof targetValue === "string" && typeof baseValue === "string" && targetValue === baseValue && baseValue.trim() !== "") {
      identicalToEnglish.push(key);
    }
    const baseVars = extractInterpolationVars(baseValue);
    const targetVars = extractInterpolationVars(targetValue);
    if (baseVars.length > 0 && JSON.stringify(baseVars) !== JSON.stringify(targetVars)) {
      interpolationMismatches.push({ key, expected: baseVars, found: targetVars });
    }
  }

  const extra = baselineKeys.length
    ? [...targetKeys].filter((k) => !(k in baselineFlat))
    : [];

  const present = baselineKeys.length - missing.length;
  const completion = baselineKeys.length ? Math.round((present / baselineKeys.length) * 1000) / 10 : 0;

  return {
    code,
    invalidJson: false,
    baselineKeyCount: baselineKeys.length,
    presentKeyCount: present,
    missingKeyCount: missing.length,
    extraKeyCount: extra.length,
    completionPercent: completion,
    emptyValueCount: empty.length,
    identicalToEnglishCount: identicalToEnglish.length,
    interpolationMismatchCount: interpolationMismatches.length,
    missing,
    extra,
    empty,
    identicalToEnglish,
    interpolationMismatches,
  };
}

function main() {
  const asJson = process.argv.includes("--json");
  const baseline = loadLocale(BASELINE_CODE);
  if (!baseline.ok) {
    console.error(`FATAL: baseline en.json is invalid JSON: ${baseline.error}`);
    process.exit(1);
  }
  const baselineFlat = flatten(baseline.data);

  const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
  const codes = files.map((f) => f.replace(/\.json$/, "")).filter((c) => c !== BASELINE_CODE).sort();

  const results = codes.map((code) => auditLocale(code, baselineFlat));

  if (asJson) {
    console.log(JSON.stringify({ baseline: { code: BASELINE_CODE, keyCount: Object.keys(baselineFlat).length }, results }, null, 2));
    return;
  }

  console.log(`\nTranslation audit — baseline en.json: ${Object.keys(baselineFlat).length} leaf keys\n`);
  console.log("code".padEnd(8) + "complete%".padEnd(11) + "present".padEnd(9) + "missing".padEnd(9) + "extra".padEnd(7) + "empty".padEnd(7) + "=en".padEnd(6) + "interp");
  for (const r of results) {
    if (r.invalidJson) {
      console.log(`${r.code.padEnd(8)} INVALID JSON: ${r.error}`);
      continue;
    }
    console.log(
      r.code.padEnd(8) +
      `${r.completionPercent}%`.padEnd(11) +
      String(r.presentKeyCount).padEnd(9) +
      String(r.missingKeyCount).padEnd(9) +
      String(r.extraKeyCount).padEnd(7) +
      String(r.emptyValueCount).padEnd(7) +
      String(r.identicalToEnglishCount).padEnd(6) +
      String(r.interpolationMismatchCount)
    );
  }

  console.log(`\nNote: a high completion% is NOT proof of translation quality, human review, or production readiness — it only means a string exists for that key. See Stage 8 for the review-status workflow.`);
}

main();
