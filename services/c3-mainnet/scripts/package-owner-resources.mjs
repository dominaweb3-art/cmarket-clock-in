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
  "f127863f6c6966713a0fa2b0284f93d264159ce95a3ef4b74d9aa00e8a3f4138"
)
  throw Error("C3_OWNER_REVIEWED_IDL_REQUIRED");
await mkdir(new URL("../resources/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../resources/c3_pilot_vault.json", import.meta.url),
  bytes,
);
