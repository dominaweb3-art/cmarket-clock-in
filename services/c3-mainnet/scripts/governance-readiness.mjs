import { loadCandidate, missingReadinessInputs } from "./governance-policy.mjs";

try {
  const missing = missingReadinessInputs(loadCandidate());
  console.log(
    "C3 governance: NO-GO (valid disabled candidate; not a deployment failure)",
  );
  for (const item of missing) console.log(`- missing: ${item}`);
  if (missing.length === 0)
    throw new Error("A disabled candidate cannot be deployment-ready");
} catch (error) {
  console.error(`C3 governance candidate INVALID: ${error.message}`);
  process.exitCode = 1;
}
