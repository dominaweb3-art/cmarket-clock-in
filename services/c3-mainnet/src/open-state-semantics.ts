/** Fixed reviewed account layouts. RPC agreement/hashes never replace these
 * semantic proofs. No RPC, wallet, signing or runtime capability override. */
import { createHash } from "node:crypto";
import { C3_MAINNET as c } from "./constants.ts";
import {
  encodeBase58,
  publicKeyBytes,
  findProgramAddress,
  deriveAssociatedTokenAddress,
} from "./solana.ts";

export const SHARE_TOKEN_PROGRAM =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export type OpenAccount = Readonly<{
  owner: string;
  executable: boolean;
  data: readonly string[];
  lamports?: number;
}>;
export type OpenSemanticScope = Readonly<{
  program: string;
  vault: string;
  wallet: string;
  shareMint: string;
  governance: string;
  keeper: string;
  maxSlippageBps: number;
}>;
const demand = (v: unknown, reason: string): void => {
  if (!v) throw Error("C3_OPEN_STATE_" + reason);
};
export function accountBytes(
  raw: OpenAccount | null | undefined,
  owner: string,
  size?: number,
  name?: string,
): Buffer {
  demand(
    raw &&
      raw.owner === owner &&
      raw.executable === false &&
      raw.data?.[1] === "base64" &&
      raw.data.length === 2,
    "OWNER",
  );
  const b = Buffer.from(raw!.data[0]!, "base64");
  demand(
    b.toString("base64") === raw!.data[0] &&
      (size === undefined || b.length === size),
    "ENCODING",
  );
  if (name)
    demand(
      b.subarray(0, 8).equals(
        createHash("sha256")
          .update("account:" + name)
          .digest()
          .subarray(0, 8),
      ),
      "DISCRIMINATOR",
    );
  return b;
}
const key = (b: Buffer, offset: number) =>
  encodeBase58(b.subarray(offset, offset + 32));
export function openAddresses(scope: OpenSemanticScope) {
  for (const k of [
    scope.program,
    scope.vault,
    scope.wallet,
    scope.shareMint,
    scope.governance,
    scope.keeper,
  ])
    publicKeyBytes(k);
  const authority = findProgramAddress(
    [Buffer.from("c3-authority-v1")],
    scope.program,
  ).address;
  demand(
    findProgramAddress([Buffer.from("c3-vault-v1")], scope.program).address ===
      scope.vault,
    "VAULT_PDA",
  );
  const nonce = Buffer.alloc(8);
  nonce.writeBigUInt64LE(1n);
  const intent = (name: string) =>
    findProgramAddress(
      [
        Buffer.from(name),
        publicKeyBytes(scope.vault),
        publicKeyBytes(scope.wallet),
        nonce,
      ],
      scope.program,
    ).address;
  const deposit = intent("deposit"),
    redemption = intent("redemption");
  const plan = (i: string) =>
    findProgramAddress(
      [Buffer.from("c3-plan-v1"), publicKeyBytes(i)],
      scope.program,
    ).address;
  const assets = [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint];
  return {
    authority,
    deposit,
    redemption,
    depositPlan: plan(deposit),
    redemptionPlan: plan(redemption),
    vaultTokens: assets.map((m) => deriveAssociatedTokenAddress(authority, m)),
    ownerUsdc: deriveAssociatedTokenAddress(scope.wallet, c.usdcMint),
    ownerShares: findProgramAddress(
      [
        publicKeyBytes(scope.wallet),
        publicKeyBytes(SHARE_TOKEN_PROGRAM),
        publicKeyBytes(scope.shareMint),
      ],
      c.associatedTokenProgram,
    ).address,
  };
}
export function verifyOpenConfig(scope: OpenSemanticScope, raw: OpenAccount) {
  const b = accountBytes(raw, scope.program, 546, "VaultConfig"),
    a = openAddresses(scope);
  demand(
    b[8] === 1 &&
      b.readBigUInt64LE(9) === 1n &&
      key(b, 17) === scope.governance &&
      key(b, 81) === scope.keeper &&
      key(b, 113) === scope.wallet &&
      key(b, 274) === scope.shareMint &&
      [0, 1].includes(b[145]!) &&
      b[481] ===
        findProgramAddress([Buffer.from("c3-authority-v1")], scope.program)
          .bump,
    "CONFIG",
  );
  [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint].forEach(
    (mint, i) =>
      demand(
        key(b, 146 + i * 32) === mint &&
          key(b, 306 + i * 32) === a.vaultTokens[i],
        "ASSET",
      ),
  );
  demand(
    [4000, 3000, 3000].every((n, i) => b.readUInt16LE(434 + i * 2) === n) &&
      b.readBigUInt64LE(440) === 1000000n &&
      b.readBigUInt64LE(448) === 1000000n &&
      b.readBigUInt64LE(456) <= 1n &&
      b.readBigUInt64LE(464) <= 1n &&
      b.readBigUInt64LE(472) <= 1000000n &&
      b[480]! <= 4 &&
      b.subarray(482).every((n) => n === 0),
    "LIMITS",
  );
  return {
    bytes: b,
    paused: b[145] === 1,
    lifecycle: b[480]!,
    sharesIssued: b.readBigUInt64LE(472),
  };
}
export function verifyOpenShareMint(
  scope: OpenSemanticScope,
  raw: OpenAccount,
) {
  return verifyShareMintForAuthority(openAddresses(scope).authority, raw);
}
/** Same strict SPL-2022 layout validation, independent of network/PDA derivation.
 * Does not grant a production capability or relax the production scope. */
export function verifyShareMintForAuthority(
  authority: string,
  raw: OpenAccount,
) {
  publicKeyBytes(authority);
  const b = accountBytes(raw, SHARE_TOKEN_PROGRAM);
  demand(
    b.length >= 170 &&
      b.readUInt32LE(0) === 1 &&
      key(b, 4) === authority &&
      b[44] === 6 &&
      b[45] === 1 &&
      b.readBigUInt64LE(36) <= 1000000n,
    "SHARE_MINT",
  );
  const freeze = b.readUInt32LE(46);
  demand(
    (freeze === 0 && b.subarray(50, 82).every((v) => v === 0)) ||
      (freeze === 1 && key(b, 50) === authority),
    "FREEZE_AUTHORITY",
  );
  demand(
    b.subarray(82, 165).every((v) => v === 0) && b[165] === 1,
    "MINT_PADDING",
  );
  let offset = 166,
    nonTransferable = false;
  while (offset < b.length) {
    if (b.subarray(offset).every((v) => v === 0)) break;
    demand(offset + 4 <= b.length, "EXTENSION_TRUNCATED");
    const type = b.readUInt16LE(offset),
      length = b.readUInt16LE(offset + 2);
    // Current reviewed pilot permits ONLY NonTransferable (9, length 0).
    // No permanent delegate, transfer hook, fee, close authority or metadata override.
    demand(
      type === 9 && length === 0 && !nonTransferable,
      "EXTENSION_NOT_APPROVED",
    );
    nonTransferable = true;
    offset += 4;
  }
  demand(nonTransferable, "NONTRANSFERABLE_REQUIRED");
  return { supply: b.readBigUInt64LE(36), bytes: b };
}
export function verifyOpenToken(
  raw: OpenAccount,
  owner: string,
  mint: string,
  program: string = TOKEN_PROGRAM,
) {
  const b = accountBytes(raw, program);
  demand(
    (program === TOKEN_PROGRAM ? b.length === 165 : b.length >= 165) &&
      key(b, 0) === mint &&
      key(b, 32) === owner &&
      b[108] === 1 &&
      b.readUInt32LE(72) === 0 &&
      b.readUInt32LE(129) === 0 &&
      b.readBigUInt64LE(121) === 0n,
    "TOKEN_AUTHORITY",
  );
  if (program === SHARE_TOKEN_PROGRAM) {
    demand(b.length >= 174 && b[165] === 2, "TOKEN_EXTENSION_LAYOUT");
    const found = new Set<number>();
    let offset = 166;
    while (offset < b.length) {
      if (b.subarray(offset).every((v) => v === 0)) break;
      demand(offset + 4 <= b.length, "TOKEN_EXTENSION_TRUNCATED");
      const type = b.readUInt16LE(offset),
        length = b.readUInt16LE(offset + 2);
      demand(
        [7, 13].includes(type) && length === 0 && !found.has(type),
        "TOKEN_EXTENSION_UNAPPROVED",
      );
      found.add(type);
      offset += 4;
    }
    demand(found.has(7) && found.has(13), "TOKEN_NONTRANSFERABLE_REQUIRED");
  }
  return b.readBigUInt64LE(64);
}
export function verifyOpenPlan(
  scope: OpenSemanticScope,
  address: string,
  raw: OpenAccount,
  revision: string,
) {
  const b = accountBytes(raw, scope.program, 901, "SettlementPlan"),
    a = openAddresses(scope),
    direction = b[145];
  demand(direction === 1 || direction === 2, "DIRECTION");
  const buying = direction === 1,
    intent = buying ? a.deposit : a.redemption;
  demand(
    address === (buying ? a.depositPlan : a.redemptionPlan) &&
      b[900] ===
        findProgramAddress(
          [Buffer.from("c3-plan-v1"), publicKeyBytes(intent)],
          scope.program,
        ).bump &&
      b[8] === 2 &&
      b.readBigUInt64LE(9) === 1n &&
      key(b, 17) === scope.vault &&
      key(b, 49) === intent &&
      key(b, 81) === scope.wallet &&
      key(b, 113) === scope.shareMint &&
      b.readBigUInt64LE(146) === 1000000n &&
      b.readBigUInt64LE(716).toString() === revision &&
      key(b, 544) === c.jupiterProgram,
    "PLAN_BINDING",
  );
  const bitmap = b[714]!,
    lifecycle = b[715]!;
  const completed = [0, 1, 3, 7].indexOf(bitmap);
  demand(
    completed >= 0 &&
      BigInt(revision) >= BigInt(completed) &&
      (lifecycle ===
        (bitmap === 7
          ? buying
            ? 3
            : 6
          : bitmap === 0
            ? buying
              ? 1
              : 4
            : buying
              ? 2
              : 5) ||
        (bitmap !== 0 && bitmap !== 7 && lifecycle === 9)),
    "PROGRESS",
  );
  demand(
    b.readUInt16LE(696) > 0 &&
      b.readUInt16LE(696) <= scope.maxSlippageBps &&
      b.readBigInt64LE(706) > b.readBigInt64LE(698) &&
      b.subarray(724, 756).some((v) => v !== 0),
    "QUOTE_POLICY",
  );
  const outputs: bigint[] = [],
    budgets: bigint[] = [],
    minima: bigint[] = [];
  for (let i = 0; i < 3; i++) {
    const asset = [c.cbBtcMint, c.portalEthMint, c.wrappedSolMint][i]!,
      input = buying ? c.usdcMint : asset,
      output = buying ? asset : c.usdcMint;
    demand(
      b.readUInt16LE(154 + i * 2) === [4000, 3000, 3000][i] &&
        key(b, 160 + i * 32) === input &&
        key(b, 256 + i * 32) === output &&
        key(b, 352 + i * 32) ===
          deriveAssociatedTokenAddress(a.authority, input) &&
        key(b, 448 + i * 32) ===
          deriveAssociatedTokenAddress(a.authority, output),
      "PLAN_ACCOUNTS",
    );
    const actual = b.readBigUInt64LE(756 + i * 8),
      budget = b.readBigUInt64LE(780 + i * 8),
      received = b.readBigUInt64LE(804 + i * 8),
      minimum = b.readBigUInt64LE(672 + i * 8);
    demand(
      budget > 0n &&
        minimum > 0n &&
        (!buying || budget === [400000n, 300000n, 300000n][i]) &&
        (bitmap & (1 << i)
          ? actual === budget && received >= minimum
          : actual === 0n && received === 0n),
      "INVENTORY",
    );
    outputs.push(received);
    budgets.push(budget);
    minima.push(minimum);
  }
  return {
    bytes: b,
    direction,
    bitmap,
    lifecycle,
    revision: b.readBigUInt64LE(716),
    budgets,
    outputs,
    minima,
    expiresAt: b.readBigInt64LE(706),
    activeAuthorization: b.subarray(860, 892),
  };
}
/** Intent identity and acquired inventory are program evidence, never a client
 * declaration. A completed plan alone cannot authorize shares or redemption. */
export function verifyOpenIntent(
  scope: OpenSemanticScope,
  raw: OpenAccount,
  selling: boolean,
  statuses: readonly number[],
) {
  const b = accountBytes(
    raw,
    scope.program,
    selling ? 234 : 288,
    selling ? "RedemptionIntent" : "DepositIntent",
  );
  demand(
    b[8] === 1 &&
      b.readBigUInt64LE(9) === 1n &&
      key(b, 17) === scope.vault &&
      key(b, 49) === scope.wallet &&
      b.readBigUInt64LE(81) === 1n &&
      b.readBigUInt64LE(114) === 1000000n &&
      statuses.includes(b[113]!),
    "INTENT_BINDING",
  );
  demand(
    b.readBigUInt64LE(89) > 0n && b.readBigInt64LE(105) > b.readBigInt64LE(97),
    "INTENT_TIME",
  );
  if (!selling)
    demand(
      b.readBigUInt64LE(122) === 1000000n &&
        [4000, 3000, 3000].every((w, i) => b.readUInt16LE(194 + i * 2) === w),
      "DEPOSIT_INVENTORY",
    );
  return b;
}
