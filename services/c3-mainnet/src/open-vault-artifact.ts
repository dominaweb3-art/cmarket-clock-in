/** Source-approved deployed binary verification. Public reads only; no deployment. */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { accountBytes, type OpenAccount } from "./open-state-semantics.ts";
import {
  requireOpenProductionPolicy,
  type OpenProductionPolicy,
} from "./open-production-policy.ts";
import {
  productionOwnerRpc,
  type OwnerReadonlyRpc,
} from "./open-owner-service.ts";
import { VAULT_PROGRAM } from "./open-v0-envelope.ts";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const reject = (v: unknown): void => {
  if (!v) throw Error("C3_OPEN_DEPLOYED_BINARY_UNVERIFIED");
};
export function verifyVaultArtifact(
  p: OpenProductionPolicy,
  program: OpenAccount,
  programData: OpenAccount,
  slot: number,
) {
  reject(
    p.programId === VAULT_PROGRAM.toBase58() &&
      program?.executable === true &&
      program.owner === LOADER &&
      Number.isSafeInteger(slot) &&
      slot > 0,
  );
  reject(
    Array.isArray(program.data) &&
      program.data.length === 2 &&
      program.data[1] === "base64" &&
      typeof program.data[0] === "string",
  );
  const raw = Buffer.from(program.data[0]!, "base64"),
    address = PublicKey.findProgramAddressSync(
      [new PublicKey(p.programId).toBuffer()],
      new PublicKey(LOADER),
    )[0].toBase58();
  reject(
    raw.toString("base64") === program.data[0] &&
      raw.length === 36 &&
      raw.readUInt32LE(0) === 2 &&
      new PublicKey(raw.subarray(4)).toBase58() === address,
  );
  const data = accountBytes(
    programData,
    LOADER,
    Buffer.from(programData?.data[0] ?? "", "base64").length,
  );
  reject(
    Number.isSafeInteger(p.binaryLength) &&
      p.binaryLength >= 4 &&
      data.length >= 45 + p.binaryLength &&
      data.readUInt32LE(0) === 3 &&
      data.readBigUInt64LE(4) <= BigInt(slot) &&
      data[12] === 1 &&
      new PublicKey(data.subarray(13, 45)).toBase58() === p.upgradeAuthority,
  );
  const binary = data.subarray(45, 45 + p.binaryLength);
  reject(
    binary.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) &&
      data.subarray(45 + p.binaryLength).every((v) => v === 0) &&
      createHash("sha256").update(binary).digest("hex") === p.binaryHash,
  );
  return { programData: address, binaryHash: p.binaryHash, slot };
}
export async function verifyProductionVaultArtifact(
  rpc: OwnerReadonlyRpc = productionOwnerRpc(),
) {
  const p = requireOpenProductionPolicy(),
    address = PublicKey.findProgramAddressSync(
      [new PublicKey(p.programId).toBuffer()],
      new PublicKey(LOADER),
    )[0].toBase58();
  const snap = (await rpc.read("getMultipleAccounts", [
    [p.programId, address],
    { commitment: "finalized", encoding: "base64" },
  ])) as { context: { slot: number }; value: OpenAccount[] };
  reject(snap?.value?.length === 2);
  return verifyVaultArtifact(
    p,
    snap.value[0]!,
    snap.value[1]!,
    snap.context.slot,
  );
}
