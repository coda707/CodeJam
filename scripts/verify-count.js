#!/usr/bin/env node
// Mechanical acceptance command for the two-Agent alternating count workflow.
//
// Reads a newline-delimited count file and verifies that it contains the exact
// sequence 1..N once each, in ascending order, with no duplicates and no gaps.
// Exits 0 on success and 1 on failure so it can be used directly as a
// `command` acceptance criterion value.
//
// Usage:
//   node scripts/verify-count.js count.txt
//   EXPECTED_COUNT=10 node scripts/verify-count.js count.txt
//
// Note: the MechanicalVerifier's command allowlist (verifier.ts) only admits
// `node --test`, `npm test`, `npm run build` and `npx vitest run`, so the
// automated demo (demo-counting-workflow.mjs) drives the check through
// `node --test count.test.mjs` instead of this script. Keep this as a manual /
// standalone checker for operator verification outside the verifier.
import { readFileSync } from "node:fs";

const file = process.argv[2];
const expected = Number(process.env.EXPECTED_COUNT ?? 10);

if (!file) {
  console.error("verify-count: missing count file argument");
  process.exit(1);
}
if (!Number.isInteger(expected) || expected < 1) {
  console.error("verify-count: EXPECTED_COUNT must be a positive integer");
  process.exit(1);
}

let lines;
try {
  lines = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
} catch {
  console.error(`verify-count: cannot read ${file}`);
  process.exit(1);
}

const numbers = lines.map((line) => Number(line));
const expectedSequence = Array.from({ length: expected }, (_, index) => index + 1);

if (
  numbers.length !== expected ||
  numbers.some((value) => !Number.isInteger(value)) ||
  numbers.some((value, index) => value !== expectedSequence[index])
) {
  console.error(
    `verify-count: sequence mismatch — expected ${expectedSequence.join(",")}, ` +
      `got ${numbers.join(",") || "(empty)"}`,
  );
  process.exit(1);
}

console.log(`verify-count: sequence ${expectedSequence.join(" ")} verified`);
process.exit(0);
