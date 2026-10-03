/** Shared preparation/position core. Production wrapper is immutable gated;
 * isolated tests use the SAME compiler/repository with a read-only RPC port. */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  compileTrustedOwnerPacket,
  persistCompiledOwnerPacket,
  type OpenCompilerPolicy,
  type OpenOwnerAction,
  type OpenOwnerContext,
} from "./open-owner-compiler.ts";
import {
  accountBytes,
  openAddresses,
  verifyOpenConfig,
  verifyOpenShareMint,
  verifyOpenToken,
  verifyOpenPlan,
  type OpenAccount,
} from "./open-state-semantics.ts";
import { C3_MAINNET as c } from "./constants.ts";
import { publicKeyBytes } from "./solana.ts";
import { readIndependentOpenEvidence } from "./open-rpc-quorum.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import type { OwnerEffectManifest } from "./open-owner-effects.ts";
export interface OwnerReadonlyRpc {
  read(method: string, params: unknown[]): Promise<unknown>;
}
const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest("hex");
const demand = (v: unknown, reason: string): void => {
  if (!v) throw Error("C3_OWNER_SERVICE_" + reason);
};
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
async function state(
  pool: Pool,
  policy: OpenCompilerPolicy,
  intentId: string,
  rpc: OwnerReadonlyRpc,
) {
  const row = (
    await pool.query("SELECT * FROM c3_open.intents WHERE intent_id=$1", [
      intentId,
    ])
  ).rows[0];
  demand(
    row &&
      row.wallet === policy.wallet &&
      row.vault === policy.vault &&
      row.share_mint === policy.shareMint &&
      row.configuration_hash === policy.configurationHash,
    "SCOPE",
  );
  const a = openAddresses(policy),
    addresses = [
      policy.wallet,
      policy.vault,
      policy.shareMint,
      a.deposit,
      a.redemption,
      a.depositPlan,
      a.redemptionPlan,
      a.ownerUsdc,
      a.ownerShares,
      ...a.vaultTokens,
      CLOCK,
    ];
  const result = (await rpc.read("getMultipleAccounts", [
    addresses,
    { commitment: "finalized", encoding: "base64" },
  ])) as { context: { slot: number }; value: (OpenAccount | null)[] };
  demand(
    result &&
      Number.isSafeInteger(result.context?.slot) &&
      result.context.slot > 0 &&
      result.value?.length === addresses.length,
    "EVIDENCE",
  );
  const accounts = Object.fromEntries(
    addresses.map((addr, i) => [addr, result.value[i]!]),
  ) as Record<string, OpenAccount | null>;
  const clock = accountBytes(
    accounts[CLOCK],
    "Sysvar1111111111111111111111111111111111111",
    40,
  );
  const chainNow = Number(clock.readBigInt64LE(32));
  demand(Number.isSafeInteger(chainNow) && chainNow > 0, "CLOCK");
  return { row, accounts, slot: result.context.slot, chainNow };
}
export function compileEconomicManifest(
  policy: OpenCompilerPolicy,
  context: OpenOwnerContext,
  compiled: ReturnType<typeof compileTrustedOwnerPacket>,
  action: Exclude<OpenOwnerAction, "renew_plan">,
  rent: bigint,
): OwnerEffectManifest {
  const a = openAddresses(policy),
    token2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    selling = action === "claim" || action === "request_redemption",
    intent = selling ? a.redemption : a.deposit;
  const returned =
    action === "claim"
      ? accountBytes(
          context.accounts[a.redemption],
          policy.program,
          234,
          "RedemptionIntent",
        ).readBigUInt64LE(154)
      : 0n;
  const token = (
    account: string,
    owner: string,
    mint: string,
    program: string,
    delta: string,
  ) => ({ account, owner, mint, program, decimals: 6, delta });
  const tokens =
    action === "deposit"
      ? [
          token(
            a.ownerUsdc,
            policy.wallet,
            c.usdcMint,
            c.tokenProgram,
            "-1000000",
          ),
          token(
            a.vaultTokens[0]!,
            a.authority,
            c.usdcMint,
            c.tokenProgram,
            "1000000",
          ),
        ]
      : action === "issue_shares"
        ? [
            token(
              a.ownerShares,
              policy.wallet,
              policy.shareMint,
              token2022,
              "1000000",
            ),
          ]
        : action === "claim"
          ? [
              token(
                a.ownerShares,
                policy.wallet,
                policy.shareMint,
                token2022,
                "-1000000",
              ),
              token(
                a.ownerUsdc,
                policy.wallet,
                c.usdcMint,
                c.tokenProgram,
                returned.toString(),
              ),
              token(
                a.vaultTokens[0]!,
                a.authority,
                c.usdcMint,
                c.tokenProgram,
                (-returned).toString(),
              ),
            ]
          : [];
  const transfer = (amount: bigint) => {
    const b = Buffer.alloc(10);
    b[0] = 12;
    b.writeBigUInt64LE(amount, 1);
    b[9] = 6;
    return b;
  };
  const share = (op: number) => {
    const b = Buffer.alloc(9);
    b[0] = op;
    b.writeBigUInt64LE(1000000n, 1);
    return b;
  };
  const ix = (program: string, accounts: string[], data: Buffer) => ({
    program,
    accounts,
    dataHash: hash(data),
  });
  const create = () => {
    const b = Buffer.alloc(52);
    b.writeBigUInt64LE(rent, 4);
    b.writeBigUInt64LE(BigInt(selling ? 234 : 288), 12);
    Buffer.from(publicKeyBytes(policy.program)).copy(b, 20);
    return ix(c.systemProgram, [policy.wallet, intent], b);
  };
  const created = action === "deposit" || action === "request_redemption";
  const prefund =
      created && context.accounts[intent]
        ? BigInt(context.accounts[intent]!.lamports!)
        : 0n,
    funding = created ? (rent > prefund ? rent - prefund : 0n) : 0n;
  const initialize = () => {
    if (prefund === 0n) return [create()];
    const instructions: ReturnType<typeof ix>[] = [];
    if (funding > 0n) {
      const b = Buffer.alloc(12);
      b.writeUInt32LE(2);
      b.writeBigUInt64LE(funding, 4);
      instructions.push(ix(c.systemProgram, [policy.wallet, intent], b));
    }
    const allocate = Buffer.alloc(12);
    allocate.writeUInt32LE(8);
    allocate.writeBigUInt64LE(BigInt(selling ? 234 : 288), 4);
    instructions.push(ix(c.systemProgram, [intent], allocate));
    const assign = Buffer.alloc(36);
    assign.writeUInt32LE(1);
    Buffer.from(publicKeyBytes(policy.program)).copy(assign, 4);
    instructions.push(ix(c.systemProgram, [intent], assign));
    return instructions;
  };
  const inner =
    action === "deposit"
      ? [
          { index: 0, instructions: initialize() },
          {
            index: 1,
            instructions: [
              ix(
                c.tokenProgram,
                [a.ownerUsdc, c.usdcMint, a.vaultTokens[0]!, policy.wallet],
                transfer(1000000n),
              ),
            ],
          },
        ]
      : action === "request_redemption"
        ? [{ index: 0, instructions: initialize() }]
        : action === "issue_shares"
          ? [
              {
                index: 0,
                instructions: [
                  ix(
                    token2022,
                    [policy.shareMint, a.ownerShares, a.authority],
                    share(7),
                  ),
                ],
              },
            ]
          : [
              {
                index: 0,
                instructions: [
                  ix(
                    token2022,
                    [a.ownerShares, policy.shareMint, policy.wallet],
                    share(8),
                  ),
                  ix(
                    c.tokenProgram,
                    [a.vaultTokens[0]!, c.usdcMint, a.ownerUsdc, a.authority],
                    transfer(returned),
                  ),
                ],
              },
            ];
  const snapshots = [
    policy.vault,
    intent,
    policy.shareMint,
    a.ownerShares,
    ...a.vaultTokens,
    ...(action === "issue_shares"
      ? [a.depositPlan]
      : action === "claim"
        ? [a.redemptionPlan]
        : action === "request_redemption"
          ? [a.deposit, a.depositPlan]
          : []),
  ].map((address) => {
    const raw = context.accounts[address],
      owner =
        address === policy.shareMint || address === a.ownerShares
          ? token2022
          : a.vaultTokens.includes(address)
            ? c.tokenProgram
            : policy.program;
    const size =
      address === intent && created
        ? selling
          ? 234
          : 288
        : accountBytes(raw, owner).length;
    const disc =
      owner === policy.program
        ? createHash("sha256")
            .update(
              "account:" +
                (address === policy.vault
                  ? "VaultConfig"
                  : address === a.depositPlan || address === a.redemptionPlan
                    ? "SettlementPlan"
                    : address === a.deposit
                      ? "DepositIntent"
                      : "RedemptionIntent"),
            )
            .digest()
            .subarray(0, 8)
        : address === policy.shareMint
          ? Buffer.from([1, 0, 0, 0])
          : accountBytes(raw, owner).subarray(0, 32);
    return {
      address,
      owner,
      bytes: size,
      dataHash: hash(
        raw && !(address === intent && created)
          ? accountBytes(raw, owner)
          : disc,
      ),
      checks: [{ offset: 0, base64: disc.toString("base64") }],
    };
  });
  return {
    version: "c3-owner-effects/v2",
    semanticScope: policy,
    baseline: context.accounts,
    ...(created
      ? {
          initialization: {
            account: intent,
            space: selling ? 234 : 288,
            rent: rent.toString(),
          },
        }
      : {}),
    wallet: policy.wallet,
    messageHash: compiled.messageHash,
    action,
    program: policy.program,
    vault: policy.vault,
    shareMint: policy.shareMint,
    onchainIntent: intent,
    plan: selling ? a.redemptionPlan : a.depositPlan,
    planRevision: action === "request_redemption" ? "0" : context.chainRevision,
    inner,
    tokens,
    lamports: [
      {
        account: policy.wallet,
        minimum: (-funding - 100000n).toString(),
        maximum: (-funding - 1n).toString(),
      },
      ...(created
        ? [
            {
              account: intent,
              minimum: funding.toString(),
              maximum: funding.toString(),
            },
          ]
        : []),
    ],
    snapshots,
  };
}
export async function prepareOwnerFromDurableState(
  pool: Pool,
  policy: OpenCompilerPolicy,
  idl: Uint8Array,
  intentId: string,
  action: OpenOwnerAction,
  rpc: OwnerReadonlyRpc,
) {
  const s = await state(pool, policy, intentId, rpc);
  const previous = (
    await pool.query(
      "SELECT generation FROM c3_open.owner_requests WHERE intent_id=$1 AND action=$2 ORDER BY generation DESC LIMIT 1",
      [intentId, action],
    )
  ).rows[0];
  const block = (await rpc.read("getLatestBlockhash", [
    { commitment: "finalized" },
  ])) as { value: { blockhash: string; lastValidBlockHeight: number } };
  const context: OpenOwnerContext = {
    intentId,
    wallet: s.row.wallet,
    vault: s.row.vault,
    shareMint: s.row.share_mint,
    configurationHash: s.row.configuration_hash,
    state: s.row.state,
    dbRevision: s.row.db_revision,
    chainRevision: s.row.chain_revision,
    generation: previous ? (BigInt(previous.generation) + 1n).toString() : "1",
    expiry:
      action === "deposit"
        ? Math.min(
            s.chainNow + 120,
            Math.floor(s.row.expires_at.getTime() / 1000),
          )
        : s.chainNow + 120,
    chainNow: s.chainNow,
    observedSlot: s.slot,
    blockhash: block.value.blockhash,
    lastValidHeight: block.value.lastValidBlockHeight,
    accounts: s.accounts,
  };
  const compiled = compileTrustedOwnerPacket(policy, context, idl, action);
  const rent =
    action === "deposit" || action === "request_redemption"
      ? await rpc.read("getMinimumBalanceForRentExemption", [
          action === "deposit" ? 288 : 234,
          { commitment: "finalized" },
        ])
      : 0;
  demand(Number.isSafeInteger(rent) && Number(rent) >= 0, "RENT");
  // Manifest and request MUST be one transaction; a crash cannot expose an
  // unsigned request without its economic policy. Added argument is server-only.
  const manifest =
    action === "renew_plan"
      ? null
      : compileEconomicManifest(
          policy,
          context,
          compiled,
          action,
          BigInt(Number(rent)),
        );
  return persistCompiledOwnerPacket(
    pool,
    policy,
    context,
    compiled,
    action,
    manifest,
  );
}
export async function readOwnerPosition(
  pool: Pool,
  policy: OpenCompilerPolicy,
  intentId: string,
  rpc: OwnerReadonlyRpc,
) {
  const s = await state(pool, policy, intentId, rpc),
    a = openAddresses(policy),
    cfg = verifyOpenConfig(policy, s.accounts[policy.vault]!),
    mint = verifyOpenShareMint(policy, s.accounts[policy.shareMint]!);
  const shares = verifyOpenToken(
    s.accounts[a.ownerShares]!,
    policy.wallet,
    policy.shareMint,
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  );
  const reserves = a.vaultTokens.map((addr, i) =>
    verifyOpenToken(
      s.accounts[addr]!,
      a.authority,
      [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint][i]!,
    ),
  );
  demand(
    shares === mint.supply &&
      (mint.supply === cfg.sharesIssued ||
        (cfg.lifecycle === 4 && mint.supply === 0n)),
    "SHARE_SUPPLY",
  );
  const plan = s.row.redemption_plan ?? s.row.deposit_plan;
  let progress: number | null = null;
  if (s.accounts[plan])
    progress = verifyOpenPlan(
      policy,
      plan,
      s.accounts[plan]!,
      s.row.chain_revision,
    ).bitmap;
  const unresolved = (
    await pool.query(
      "SELECT r.request_id,s.signature FROM c3_open.owner_requests r LEFT JOIN c3_open.owner_submissions s USING(request_id) LEFT JOIN c3_open.owner_effect_receipts e USING(request_id) LEFT JOIN c3_open.owner_request_outcomes o USING(request_id) LEFT JOIN c3_open.plan_generations g USING(request_id) WHERE r.intent_id=$1 AND e.request_id IS NULL AND o.request_id IS NULL AND g.request_id IS NULL",
      [intentId],
    )
  ).rows;
  return {
    intentId,
    wallet: policy.wallet,
    shareMint: policy.shareMint,
    shareUnits: shares.toString(),
    shareDecimals: 6,
    supply: mint.supply.toString(),
    state: s.row.state,
    chainRevision: s.row.chain_revision,
    slot: s.slot,
    progress,
    reserves: reserves.map((v) => v.toString()),
    unresolved,
    scope: "MAINNET_INDEPENDENT_RPC",
    nav: null,
    navStatus: "PRICING_NOT_RECONCILED",
  };
}
export function productionOwnerRpc(
  fetcher: typeof fetch = fetch,
): OwnerReadonlyRpc {
  const policy = requireOpenProductionPolicy();
  return {
    read: async (method, params) => {
      const pair = (await readIndependentOpenEvidence(
        policy.providers,
        method,
        params,
        fetcher,
      )) as { primary: unknown };
      return pair.primary;
    },
  };
}
