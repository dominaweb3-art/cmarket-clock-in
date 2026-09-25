import { collectPythEvidence, PythEvidenceError } from "./pyth-evidence.ts";

// The key exists only in this short-lived process environment; no raw response is persisted.
try {
  const evidence = await collectPythEvidence(process.env.PYTH_API_KEY);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  if (error instanceof PythEvidenceError) {
    console.error(`Pyth read-only evidence blocked: ${error.message}`);
  } else {
    console.error(
      "Pyth read-only evidence blocked: unexpected sanitized error",
    );
  }
  process.exitCode = 1;
}
