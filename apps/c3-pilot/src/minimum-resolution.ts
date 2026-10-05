import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
export type MinimumResolutionReview = Readonly<{
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
export function validateResolutionReview(
  v: MinimumResolutionReview,
  now: number,
) {
  const fields = [
    "version",
    "planHash",
    "evidenceHash",
    "leg",
    "outputMint",
    "oldMinimum",
    "newMinimum",
    "minima",
    "quotedOutput",
    "jupiterThreshold",
    "slippageBps",
    "quoteExpiresAt",
    "contextHash",
    "materialHash",
  ];
  if (
    !v ||
    Object.keys(v).sort().join() !== fields.sort().join() ||
    v.version !== "c3-owner-minimum-resolution/v1" ||
    ![v.planHash, v.evidenceHash, v.contextHash, v.materialHash].every(
      (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s),
    ) ||
    !Number.isInteger(v.leg) ||
    v.leg < 0 ||
    v.leg > 2 ||
    !Array.isArray(v.minima) ||
    v.minima.length !== 3 ||
    typeof v.outputMint !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.outputMint) ||
    ![
      v.oldMinimum,
      v.newMinimum,
      v.quotedOutput,
      v.jupiterThreshold,
      ...v.minima,
    ].every(
      (s) =>
        typeof s === "string" &&
        /^[1-9][0-9]{0,19}$/.test(s) &&
        BigInt(s) < 1n << 64n,
    ) ||
    !Number.isSafeInteger(v.quoteExpiresAt) ||
    v.quoteExpiresAt <= now ||
    v.quoteExpiresAt > now + 30 ||
    !Number.isInteger(v.slippageBps) ||
    v.slippageBps < 1 ||
    v.slippageBps > 100
  )
    throw Error("C3_OWNER_ECONOMIC_REVIEW_INVALID");
  const out = BigInt(v.quotedOutput),
    threshold = BigInt(v.jupiterThreshold),
    floor = (out * BigInt(10000 - v.slippageBps)) / 10000n;
  if (
    threshold > out ||
    BigInt(v.oldMinimum) <= out ||
    v.newMinimum !== (threshold > floor ? threshold : floor).toString() ||
    v.minima[v.leg] !== v.newMinimum
  )
    throw Error("C3_OWNER_ECONOMIC_MINIMUM_INVALID");
  const { evidenceHash, ...body } = v;
  const canonical = (x: unknown): string => {
    if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
    if (x && typeof x === "object")
      return (
        "{" +
        Object.entries(x)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => JSON.stringify(k) + ":" + canonical(val))
          .join(",") +
        "}"
      );
    return JSON.stringify(x);
  };
  const digest = Array.from(sha256(utf8ToBytes(canonical(body))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== evidenceHash)
    throw Error("C3_OWNER_ECONOMIC_EVIDENCE_CHANGED");
}
