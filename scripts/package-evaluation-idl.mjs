/** Package only the public interface produced by the exact Devnet build.
 * No binary, key, credential or signing artifact is copied into tracked files. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const source = new URL(
  "../artifacts/c3-devnet-evaluation/c3_pilot_vault.json",
  import.meta.url,
);
const destination = new URL(
  "../services/c3-mainnet/resources/c3_devnet_evaluation_vault.json",
  import.meta.url,
);
const bytes = readFileSync(source),
  idl = JSON.parse(bytes);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (
  idl.address !== "2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg" ||
  sha256 !== "dbf664b90cbe0555f11b2efeb790d52c6298257dbab517acfb1d944b9d43da7c"
)
  throw Error("EVAL_PUBLIC_IDL_BUILD_CHANGED_REVIEW_REQUIRED");
writeFileSync(destination, bytes);
console.log("PUBLIC_EVALUATION_IDL_PACKAGED; NO_PROGRAM_DEPLOYMENT");
