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
  "7fdf9c352cd1f28f95f8d72b1280af857c0ee8cc0f9f1991fe78088cce7e5eeb"
)
  throw Error("C3_OWNER_REVIEWED_IDL_REQUIRED");
await mkdir(new URL("../resources/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../resources/c3_pilot_vault.json", import.meta.url),
  bytes,
);
