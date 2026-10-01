/** Narrow, fail-closed decoder for direct legacy-token Whirlpool route_v2.
 * Layout independently read from Jupiter's actual Anchor IDL account through
 * official Mainnet RPC on 2026-10-01 (JSON SHA256 recorded in the QA evidence).
 * No dynamic IDL, label, API-provided discriminator or third-party decoder is
 * trusted at runtime. Other routes/variants require a separate source review.
 */
import type { RouterBuild } from "../src/jupiter-v2.ts";
import { C3_MAINNET } from "../src/constants.ts";
const DISCRIMINATOR = Buffer.from([187, 100, 250, 204, 49, 196, 175, 20]);
const WHIRLPOOL = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const EVENT_AUTHORITY = "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf";
const check = (c: unknown, code: string): void => {
  if (!c) throw new Error(`C3_ROUTE_V2_${code}`);
};
export function validateDirectWhirlpoolRoute(
  build: RouterBuild,
  expected: Readonly<{
    authority: string;
    source: string;
    destination: string;
    inputMint: string;
    outputMint: string;
    inputAmount: bigint;
    maxSlippageBps: number;
  }>,
): Readonly<{ aToB: boolean; pool: string; legacy: boolean }> {
  const data = Buffer.from(build.swapInstruction.data, "base64");
  check(data.toString("base64") === build.swapInstruction.data, "BASE64");
  check(data.length === 40 || data.length === 41, "LAYOUT");
  check(data.subarray(0, 8).equals(DISCRIMINATOR), "DISCRIMINATOR");
  check(
    data.readBigUInt64LE(8) === expected.inputAmount &&
      build.inAmount === expected.inputAmount.toString() &&
      data.readBigUInt64LE(16).toString() === build.outAmount &&
      build.inputMint === expected.inputMint &&
      build.outputMint === expected.outputMint,
    "AMOUNT_OR_MINT",
  );
  check(
    data.readUInt16LE(24) === build.slippageBps &&
      build.slippageBps > 0 &&
      build.slippageBps <= expected.maxSlippageBps &&
      expected.maxSlippageBps <= 100 &&
      data.readUInt16LE(26) === 0 &&
      data.readUInt16LE(28) === 0,
    "SLIPPAGE_OR_FEES",
  );
  check(data.readUInt32LE(30) === 1, "DIRECT_ROUTE_ONLY");
  // Swap::Whirlpool = 17, WhirlpoolSwapV2 = 47 in the observed Jupiter IDL.
  // Both contain a_to_b. V2's optional remaining-account slices must be None:
  // Token-2022 hooks and supplemental layouts are deliberately unsupported.
  const variant = data[34];
  check(
    (variant === 17 && data.length === 40) ||
      (variant === 47 && data.length === 41 && data[36] === 0),
    "UNREVIEWED_SWAP_VARIANT",
  );
  check(data[35] === 0 || data[35] === 1, "BOOLEAN");
  const bpsOffset = variant === 17 ? 36 : 37;
  check(
    data.readUInt16LE(bpsOffset) === 10000 &&
      data[bpsOffset + 2] === 0 &&
      data[bpsOffset + 3] === 1 &&
      build.routePlan.length === 1 &&
      build.routePlan[0]!.bps === 10000 &&
      build.routePlan[0]!.swapInfo.inputMint === expected.inputMint &&
      build.routePlan[0]!.swapInfo.outputMint === expected.outputMint &&
      build.routePlan[0]!.swapInfo.inAmount === build.inAmount &&
      build.routePlan[0]!.swapInfo.outAmount === build.outAmount,
    "ROUTE_GRAPH",
  );
  check(
    build.swapInstruction.programId === C3_MAINNET.jupiterProgram,
    "PROGRAM",
  );
  const fixed = [
    [expected.authority, true, false],
    [expected.source, false, true],
    [expected.destination, false, true],
    [expected.inputMint, false, false],
    [expected.outputMint, false, false],
    [C3_MAINNET.tokenProgram, false, false],
    [C3_MAINNET.tokenProgram, false, false],
    [expected.destination, false, true],
    [EVENT_AUTHORITY, false, false],
    [C3_MAINNET.jupiterProgram, false, false],
    [WHIRLPOOL, false, false],
  ] as const;
  check(
    fixed.every(([pubkey, isSigner, isWritable], i) => {
      const a = build.swapInstruction.accounts[i];
      return (
        a?.pubkey === pubkey &&
        a.isSigner === isSigner &&
        a.isWritable === isWritable
      );
    }),
    "ORDERED_FIXED_ACCOUNTS",
  );
  const pool = build.routePlan[0]!.swapInfo.ammKey;
  check(
    build.swapInstruction.accounts.some(
      (a) => a.pubkey === pool && a.isWritable && !a.isSigner,
    ),
    "POOL",
  );
  return Object.freeze({ aToB: data[35] === 1, pool, legacy: variant === 17 });
}
