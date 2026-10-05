/** Economic amendment proposal, NOT a swap authorization. Only the owner's
 * exact signed on-chain instruction can apply it. No automatic floor reduction. */
import { createHash } from "node:crypto";
import { canonicalize } from "./manifest.ts";
import { deriveQuoteMinimum } from "./quote-seal.ts";
import type {
  ValidatedQuoteMaterial,
  StoredQuoteContext,
} from "./open-quote-context.ts";
import { encodeBase58 } from "./solana.ts";
export type MinimumResolution = Readonly<{
  version: "c3-owner-minimum-resolution/v1";
  planHash: string;
  evidenceHash: string;
  leg: number;
  outputMint: string;
  oldMinimum: string;
  newMinimum: string;
  minima: readonly string[];
  quotedOutput: string;
  jupiterThreshold: string;
  slippageBps: number;
  quoteExpiresAt: number;
  contextHash: string;
  materialHash: string;
}>;
const digest = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
export function proposeMinimumResolution(
  pre: Buffer,
  context: StoredQuoteContext,
  material: ValidatedQuoteMaterial,
  now: number,
): MinimumResolution {
  if (
    pre.length !== 901 ||
    !Number.isSafeInteger(now) ||
    pre.readBigUInt64LE(716).toString() !== context.planRevision ||
    pre.readBigInt64LE(706) > BigInt(now) ||
    pre[714] !== (1 << context.leg) - 1 ||
    material.expiresAt <= BigInt(now) ||
    material.builderTimestamp < BigInt(now - 30) ||
    material.builderTimestamp > BigInt(now + 30) ||
    material.slippageBps > context.maxSlippageBps ||
    material.unsignedPacketBytes > 1232
  )
    throw Error("C3_MINIMUM_RESOLUTION_CONTEXT");
  const minima = [0, 1, 2].map((n) =>
    pre.readBigUInt64LE(672 + 8 * n).toString(),
  );
  const oldMinimum = minima[context.leg]!;
  if (material.quotedOutput >= BigInt(oldMinimum))
    throw Error("C3_MINIMUM_RESOLUTION_NOT_REQUIRED");
  const minimum = deriveQuoteMinimum(
    material.quotedOutput,
    material.slippageBps,
    material.jupiterThreshold,
  );
  minima[context.leg] = minimum.toString();
  const body = {
    version: "c3-owner-minimum-resolution/v1" as const,
    planHash: digest(pre),
    leg: context.leg,
    outputMint: encodeBase58(
      pre.subarray(256 + 32 * context.leg, 288 + 32 * context.leg),
    ),
    oldMinimum,
    newMinimum: minimum.toString(),
    minima: Object.freeze(minima),
    quotedOutput: material.quotedOutput.toString(),
    jupiterThreshold: material.jupiterThreshold.toString(),
    slippageBps: material.slippageBps,
    quoteExpiresAt: Math.min(Number(material.expiresAt), now + 30),
    contextHash: digest(canonicalize(context)),
    materialHash: digest(
      canonicalize(
        Object.fromEntries(
          Object.entries(material).map(([k, v]) => [
            k,
            typeof v === "bigint"
              ? v.toString()
              : Buffer.isBuffer(v)
                ? v.toString("hex")
                : v,
          ]),
        ),
      ),
    ),
  };
  return Object.freeze({ ...body, evidenceHash: digest(canonicalize(body)) });
}
export function validateMinimumResolution(
  r: MinimumResolution,
  pre: Buffer,
  now: number,
) {
  const { evidenceHash, ...body } = r;
  if (
    pre.length !== 901 ||
    r.version !== "c3-owner-minimum-resolution/v1" ||
    evidenceHash !== digest(canonicalize(body)) ||
    r.planHash !== digest(pre) ||
    !Number.isSafeInteger(now) ||
    r.quoteExpiresAt <= now ||
    r.quoteExpiresAt > now + 30 ||
    !Number.isInteger(r.leg) ||
    r.leg < 0 ||
    r.leg > 2 ||
    pre[714] !== (1 << r.leg) - 1 ||
    r.minima.length !== 3 ||
    r.outputMint !==
      encodeBase58(pre.subarray(256 + 32 * r.leg, 288 + 32 * r.leg)) ||
    r.oldMinimum !== pre.readBigUInt64LE(672 + 8 * r.leg).toString() ||
    !/^[a-f0-9]{64}$/.test(r.contextHash) ||
    !/^[a-f0-9]{64}$/.test(r.materialHash) ||
    ![
      r.oldMinimum,
      r.newMinimum,
      r.quotedOutput,
      r.jupiterThreshold,
      ...r.minima,
    ].every(
      (v) =>
        typeof v === "string" &&
        /^[1-9][0-9]{0,19}$/.test(v) &&
        BigInt(v) < 1n << 64n,
    ) ||
    BigInt(r.quotedOutput) >= BigInt(r.oldMinimum) ||
    r.newMinimum !==
      deriveQuoteMinimum(
        BigInt(r.quotedOutput),
        r.slippageBps,
        BigInt(r.jupiterThreshold),
      ).toString() ||
    r.minima.some(
      (v, n) =>
        v !==
        (n === r.leg
          ? r.newMinimum
          : pre.readBigUInt64LE(672 + 8 * n).toString()),
    )
  )
    throw Error("C3_MINIMUM_RESOLUTION_REVIEW");
}
/** Derive the ONLY permitted postimage from signed instruction bytes. This
 * also handles historical plain renewals; never infer a reduction from RPC. */
export function renewalPostimage(
  pre: Buffer,
  data: Buffer,
  revision: bigint,
  expiry: bigint,
): Buffer {
  const plain = createHash("sha256")
    .update("global:renew_settlement_plan")
    .digest()
    .subarray(0, 8);
  const economic = createHash("sha256")
    .update("global:resolve_settlement_minimums")
    .digest()
    .subarray(0, 8);
  if (
    pre.length !== 901 ||
    data.length < 24 ||
    pre.readBigUInt64LE(716) !== revision ||
    revision >= (1n << 64n) - 1n ||
    data.readBigUInt64LE(8) !== revision ||
    data.readBigInt64LE(16) !== expiry ||
    ![0, 1, 3].includes(pre[714]!) ||
    expiry <= pre.readBigInt64LE(706)
  )
    throw Error("C3_MINIMUM_RESOLUTION_PREIMAGE");
  const post = Buffer.from(pre);
  if (data.subarray(0, 8).equals(plain) && data.length === 24) {
    /* old floor retained */
  } else if (
    data.subarray(0, 8).equals(economic) &&
    data.length === 120 &&
    data.subarray(24, 56).toString("hex") === digest(pre) &&
    data.subarray(80, 112).some((v) => v !== 0) &&
    data.readBigInt64LE(112) > pre.readBigInt64LE(706) &&
    data.readBigInt64LE(112) <= expiry
  ) {
    let changed = false;
    for (let n = 0; n < 3; n++) {
      const v = data.readBigUInt64LE(56 + 8 * n),
        old = pre.readBigUInt64LE(672 + 8 * n);
      const next = pre[714] === 0 ? 0 : pre[714] === 1 ? 1 : 2;
      if (v === 0n || (n !== next && v !== old))
        throw Error("C3_MINIMUM_RESOLUTION_EXECUTED_LEG");
      changed ||= v !== old;
      post.writeBigUInt64LE(v, 672 + 8 * n);
    }
    if (!changed) throw Error("C3_MINIMUM_RESOLUTION_NO_CHANGE");
  } else throw Error("C3_MINIMUM_RESOLUTION_INSTRUCTION");
  post.writeBigInt64LE(expiry, 706);
  post.writeBigUInt64LE(revision + 1n, 716);
  post.fill(0, 860, 900);
  return post;
}
