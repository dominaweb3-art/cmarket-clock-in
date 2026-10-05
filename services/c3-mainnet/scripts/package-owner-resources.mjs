/** Build-time assembly only. No network, environment, key or deployment access.
 * Anchor's generated IDL must equal the independently reviewed exact digest. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const source = new URL(
  "../../../programs/c3-pilot-vault/target/idl/c3_pilot_vault.json",
  import.meta.url,
);
const bytes = await readFile(source);
if (
  createHash("sha256").update(bytes).digest("hex") !==
  "2620cc64a0335aef420f1e5722277f6967593e4d453ebf6684d79a12d74d1c13"
)
  throw Error("C3_OWNER_REVIEWED_IDL_REQUIRED");
await mkdir(new URL("../resources/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../resources/c3_pilot_vault.json", import.meta.url),
  bytes,
);
