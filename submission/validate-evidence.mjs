#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const canonical =
  "4UgAEFftkfDzQix9UjoHbLFWchLqQ3ZtGb9rZvSaugC2HrRVHud2NayLQyAJaaobU8yz3wCp1bwJcja9UMjcf3Dd";
const canonicalUrl = `https://explorer.solana.com/tx/${canonical}?cluster=devnet`;

// Keep rejected historical spellings split so this validator never flags its
// own source while checking every other tracked submission file.
const rejectedVariants = [
  ["4UgAEFftkfDzQix9UjoHbLFWchLqQ3ZtGb9rZvSaugC2HRV", "Hud2NayLQyAJaobU8yz3wCp1bwJcja9UMjcf3Dd"].join(""),
];

const files = execFileSync("git", ["ls-files", "submission"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((file) => !file.endsWith(".png") && file !== "submission/validate-evidence.mjs");

const evidenceFiles = files.filter((file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
});
const text = evidenceFiles.map((file) => readFileSync(file, "utf8")).join("\n");

const failures = [];
if (!text.includes(canonical)) failures.push("canonical signature is missing");
if (!text.includes(canonicalUrl)) failures.push("canonical Devnet Explorer URL is missing");
for (const variant of rejectedVariants) {
  if (text.includes(variant)) failures.push("a rejected historical signature variant remains");
}

const signatureLike = text.match(/4Ug[A-Za-z0-9]{80,}/g) ?? [];
for (const candidate of signatureLike) {
  if (candidate !== canonical) failures.push("a non-canonical signature-like value remains");
}

if (failures.length) {
  console.error(`CLOCK IN evidence validation failed: ${[...new Set(failures)].join("; ")}`);
  process.exit(1);
}

console.log(`CLOCK IN evidence validation passed for ${evidenceFiles.length} tracked text files.`);
