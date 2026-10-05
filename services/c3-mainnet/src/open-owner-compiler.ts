/** Server-owned compiler: caller selects only an action/intent. All keys,
 * permissions, amounts and instruction bytes come from reviewed policy + IDL.
 * No wallet callback, signer, broadcast or caller-provided template. */
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { canonicalize } from "./manifest.ts";
import { C3_MAINNET as c } from "./constants.ts";
import { publicKeyBytes, decodeVersionedMessage } from "./solana.ts";
import {
  openAddresses,
  verifyOpenConfig,
  verifyOpenShareMint,
  verifyOpenToken,
  verifyOpenPlan,
  verifyOpenIntent,
  SHARE_TOKEN_PROGRAM,
  type OpenSemanticScope,
  type OpenAccount,
} from "./open-state-semantics.ts";
import type { OwnerEffectManifest } from "./open-owner-effects.ts";
export type OpenOwnerAction =
  "deposit" | "issue_shares" | "request_redemption" | "claim" | "renew_plan";
export type OpenCompilerPolicy = OpenSemanticScope &
  Readonly<{
    version: "c3-owner-compiler/v1";
    idlHash: string;
    configurationHash: string;
    registryRevision: string;
    quotePolicyRevision: string;
  }>;
export type OpenOwnerContext = Readonly<{
  intentId: string;
  wallet: string;
  vault: string;
  shareMint: string;
  configurationHash: string;
  state: string;
  dbRevision: string;
  chainRevision: string;
  generation: string;
  expiry: number;
  chainNow: number;
  observedSlot?: number;
  blockhash: string;
  lastValidHeight: number;
  accounts: Readonly<Record<string, OpenAccount | null>>;
}>;
const requireValue = (v: unknown, code: string): void => {
  if (!v) throw Error("C3_OWNER_COMPILER_" + code);
};
const hash = (b: Uint8Array | string) =>
  createHash("sha256").update(b).digest("hex");
type Ix = {
  program: string;
  data: string;
  accounts: { address: string; signer: boolean; writable: boolean }[];
};
type Idl = {
  address: string;
  instructions: {
    name: string;
    discriminator: number[];
    accounts: { name: string; signer?: boolean; writable?: boolean }[];
    args: { name: string; type: string }[];
  }[];
};
const short = (n: number) => {
  requireValue(Number.isInteger(n) && n >= 0 && n < 65536, "VECTOR");
  const v: number[] = [];
  do {
    const b = n & 127;
    n >>>= 7;
    v.push(b | (n ? 128 : 0));
  } while (n);
  return Buffer.from(v);
};
/** Canonical v0 without ALTs: owner packets are small and need no lookup trust. */
export function compileOwnerV0(
  wallet: string,
  blockhash: string,
  instructions: readonly Ix[],
) {
  const keys = new Map<
    string,
    { address: string; signer: boolean; writable: boolean }
  >();
  keys.set(wallet, { address: wallet, signer: true, writable: true });
  for (const ix of instructions) {
    publicKeyBytes(ix.program);
    if (!keys.has(ix.program))
      keys.set(ix.program, {
        address: ix.program,
        signer: false,
        writable: false,
      });
    for (const a of ix.accounts) {
      publicKeyBytes(a.address);
      requireValue(!a.signer || a.address === wallet, "EXTRA_SIGNER");
      const prior = keys.get(a.address);
      keys.set(a.address, {
        ...a,
        signer: a.signer || !!prior?.signer,
        writable: a.writable || !!prior?.writable,
      });
    }
  }
  const rank = (k: { signer: boolean; writable: boolean }) =>
    k.signer ? (k.writable ? 0 : 1) : k.writable ? 2 : 3;
  const all = [...keys.values()].sort((a, b) => rank(a) - rank(b));
  requireValue(
    all.length <= 256 &&
      all.filter((k) => k.signer).length === 1 &&
      instructions.every((ix) => !keys.get(ix.program)?.writable),
    "PRIVILEGES",
  );
  const index = (address: string) =>
    all.findIndex((k) => k.address === address);
  const message = Buffer.concat([
    Buffer.from([
      128,
      1,
      0,
      all.filter((k) => !k.signer && !k.writable).length,
    ]),
    short(all.length),
    ...all.map((k) => Buffer.from(publicKeyBytes(k.address))),
    Buffer.from(publicKeyBytes(blockhash)),
    short(instructions.length),
    ...instructions.map((ix) => {
      const data = Buffer.from(ix.data, "base64");
      return Buffer.concat([
        Buffer.from([index(ix.program)]),
        short(ix.accounts.length),
        Buffer.from(ix.accounts.map((a) => index(a.address))),
        short(data.length),
        data,
      ]);
    }),
    Buffer.from([0]),
  ]);
  const packet = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), message]);
  requireValue(packet.length <= 1232, "SIZE");
  const decoded = decodeVersionedMessage(message.toString("base64"), []);
  requireValue(
    decoded.requiredSignatures === 1 &&
      decoded.staticAccounts[0]?.address === wallet,
    "MESSAGE",
  );
  return {
    packet,
    messageHash: hash(message),
    instructions: decoded.instructions,
  };
}
export function compileTrustedOwnerPacket(
  policy: OpenCompilerPolicy,
  context: OpenOwnerContext,
  idlBytes: Uint8Array,
  action: OpenOwnerAction,
) {
  requireValue(
    policy.version === "c3-owner-compiler/v1" &&
      /^[a-f0-9]{64}$/.test(policy.idlHash) &&
      hash(idlBytes) === policy.idlHash,
    "IDL_HASH",
  );
  requireValue(
    context.wallet === policy.wallet &&
      context.vault === policy.vault &&
      context.shareMint === policy.shareMint &&
      context.configurationHash === policy.configurationHash &&
      /^[1-9][0-9]*$/.test(context.dbRevision) &&
      /^(0|[1-9][0-9]*)$/.test(context.chainRevision) &&
      /^[1-9][0-9]*$/.test(context.generation),
    "DURABLE_SCOPE",
  );
  requireValue(
    Number.isSafeInteger(context.chainNow) &&
      Number.isSafeInteger(context.expiry) &&
      context.expiry > context.chainNow + 5 &&
      context.expiry <= context.chainNow + 1800 &&
      Number.isSafeInteger(context.lastValidHeight) &&
      context.lastValidHeight > 0,
    "EXPIRY",
  );
  const idl = JSON.parse(Buffer.from(idlBytes).toString()) as Idl;
  requireValue(idl.address === policy.program, "PROGRAM");
  const a = openAddresses(policy),
    config = verifyOpenConfig(policy, context.accounts[policy.vault]!),
    mint = verifyOpenShareMint(policy, context.accounts[policy.shareMint]!);
  requireValue(
    !config.paused || action === "claim" || action === "renew_plan",
    "PAUSED",
  );
  const ownerUsdc = verifyOpenToken(
      context.accounts[a.ownerUsdc]!,
      policy.wallet,
      c.usdcMint,
    ),
    ownerShares = verifyOpenToken(
      context.accounts[a.ownerShares]!,
      policy.wallet,
      policy.shareMint,
      SHARE_TOKEN_PROGRAM,
    );
  const quantities = a.vaultTokens.map((addr, i) =>
    verifyOpenToken(
      context.accounts[addr]!,
      a.authority,
      [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint][i]!,
    ),
  );
  const states = {
    deposit: ["draft"],
    issue_shares: ["buying"],
    request_redemption: ["active"],
    claim: ["claimable"],
    renew_plan: ["funded", "buying", "redemption_requested", "selling"],
  };
  requireValue(states[action]?.includes(context.state), "STATE");
  requireValue(
    mint.supply === config.sharesIssued && ownerShares === mint.supply,
    "SHARES_BACKING",
  );
  const vacant = (raw: OpenAccount | null | undefined) =>
    !raw ||
    (raw.owner === c.systemProgram &&
      raw.executable === false &&
      raw.data.length === 2 &&
      raw.data[0] === "" &&
      raw.data[1] === "base64" &&
      Number.isSafeInteger(raw.lamports) &&
      raw.lamports! >= 0);
  if (action === "deposit")
    requireValue(
      ownerUsdc >= 1000000n &&
        mint.supply === 0n &&
        config.lifecycle === 0 &&
        config.bytes.readBigUInt64LE(456) === 0n &&
        config.bytes.readBigUInt64LE(464) === 0n &&
        vacant(context.accounts[a.deposit]),
      "DEPOSIT_LIMIT",
    );
  if (action === "request_redemption") {
    requireValue(
      ownerShares === 1000000n &&
        config.lifecycle === 2 &&
        config.bytes.readBigUInt64LE(456) === 1n &&
        config.bytes.readBigUInt64LE(464) === 0n &&
        vacant(context.accounts[a.redemption]),
      "REDEMPTION_LIMIT",
    );
    const d = verifyOpenIntent(
      policy,
      context.accounts[a.deposit]!,
      false,
      [5],
    );
    requireValue(
      d.readBigUInt64LE(186) === 1000000n &&
        [162, 170, 178].every(
          (o, i) =>
            d.readBigUInt64LE(o) > 0n &&
            quantities[i + 1]! >= d.readBigUInt64LE(o),
        ),
      "REDEMPTION_BACKING",
    );
  }
  const selling =
    action === "request_redemption" ||
    action === "claim" ||
    (action === "renew_plan" &&
      ["selling", "redemption_requested"].includes(context.state));
  const planAddress = selling ? a.redemptionPlan : a.depositPlan;
  if (
    action === "issue_shares" ||
    action === "claim" ||
    action === "renew_plan"
  ) {
    const p = verifyOpenPlan(
      policy,
      planAddress,
      context.accounts[planAddress]!,
      context.chainRevision,
    );
    if (action === "renew_plan")
      requireValue(
        p.bitmap !== 7 &&
          p.expiresAt <= BigInt(context.chainNow) &&
          (p.activeAuthorization.every((v) => v === 0) ||
            p.bytes.readBigInt64LE(892) <= BigInt(context.chainNow)),
        "RENEWAL_PENDING_OR_LIVE",
      );
    else
      requireValue(
        p.bitmap === 7 && p.activeAuthorization.every((v) => v === 0),
        "LEGS_NOT_SETTLED",
      );
    const d = verifyOpenIntent(
      policy,
      context.accounts[selling ? a.redemption : a.deposit]!,
      selling,
      action === "renew_plan" ? [2] : selling ? [4] : [3],
    );
    if (action !== "renew_plan")
      requireValue(
        d
          .subarray(selling ? 170 : 224, selling ? 202 : 256)
          .equals(p.bytes.subarray(724, 756)),
        "SETTLEMENT_ID",
      );
    if (action === "issue_shares")
      requireValue(
        p.direction === 1 &&
          p.outputs.every(
            (v, i) =>
              quantities[i + 1]! >= v && v === d.readBigUInt64LE(162 + i * 8),
          ),
        "BUY_RESERVES",
      );
    if (action === "claim") {
      const total = p.outputs.reduce((s, v) => s + v, 0n);
      requireValue(
        p.direction === 2 &&
          total < 1n << 64n &&
          quantities[0]! >= total &&
          total === d.readBigUInt64LE(154) &&
          d.readBigUInt64LE(162) === 0n &&
          p.budgets.every((v, i) => v === d.readBigUInt64LE(122 + i * 8)),
        "CLAIM_RESERVES",
      );
    }
  }
  const accounts: Record<string, string> = {
    owner: policy.wallet,
    config: policy.vault,
    intent: selling ? a.redemption : a.deposit,
    deposit: a.deposit,
    plan: planAddress,
    vault_authority: a.authority,
    owner_usdc: a.ownerUsdc,
    owner_shares: a.ownerShares,
    share_mint: policy.shareMint,
    usdc_mint: c.usdcMint,
    token_program: c.tokenProgram,
    share_token_program: SHARE_TOKEN_PROGRAM,
    system_program: c.systemProgram,
    vault_usdc: a.vaultTokens[0]!,
    vault_btc: a.vaultTokens[1]!,
    vault_eth: a.vaultTokens[2]!,
    vault_wsol: a.vaultTokens[3]!,
  };
  const names =
    action === "deposit"
      ? ["create_deposit_intent", "deposit_usdc"]
      : action === "request_redemption"
        ? ["create_redemption_intent", "lock_shares_for_redemption"]
        : [
            action === "issue_shares"
              ? "issue_initial_shares"
              : action === "claim"
                ? "claim_usdc"
                : "renew_settlement_plan",
          ];
  const instructions = names.map((name): Ix => {
    const def = idl.instructions.find((ix) => ix.name === name);
    requireValue(
      def &&
        def.discriminator.length === 8 &&
        Buffer.from(def.discriminator).equals(
          createHash("sha256")
            .update("global:" + name)
            .digest()
            .subarray(0, 8),
        ),
      "IDL_METHOD",
    );
    const args = name.startsWith("create_")
      ? Buffer.alloc(32)
      : name === "renew_settlement_plan"
        ? Buffer.alloc(16)
        : Buffer.alloc(0);
    if (args.length === 32) {
      args.writeBigUInt64LE(1n);
      args.writeBigUInt64LE(1000000n, 8);
      args.writeBigUInt64LE(1n, 16);
      args.writeBigInt64LE(BigInt(context.expiry), 24);
    }
    if (args.length === 16) {
      args.writeBigUInt64LE(BigInt(context.chainRevision));
      args.writeBigInt64LE(BigInt(context.expiry), 8);
    }
    requireValue(
      def!.args.length === args.length / 8 &&
        def!.args.every((v) => v.type === "u64" || v.type === "i64"),
      "IDL_ARGS",
    );
    return {
      program: policy.program,
      data: Buffer.concat([Buffer.from(def!.discriminator), args]).toString(
        "base64",
      ),
      accounts: def!.accounts.map((field) => {
        requireValue(
          accounts[field.name] && (!field.signer || field.name === "owner"),
          "IDL_ACCOUNT",
        );
        return {
          address: accounts[field.name]!,
          signer: field.signer === true,
          writable: field.writable === true,
        };
      }),
    };
  });
  const compiled = compileOwnerV0(
    policy.wallet,
    context.blockhash,
    instructions,
  );
  // Manifest is derived from the compiler result, never from HTTP fields.
  const manifest = {
    version: "c3-owner-authorization/v2",
    intentId: context.intentId,
    wallet: policy.wallet,
    vault: policy.vault,
    action,
    generation: context.generation,
    dbRevision: context.dbRevision,
    chainRevision: context.chainRevision,
    configurationHash: policy.configurationHash,
    registryRevision: policy.registryRevision,
    quotePolicyRevision: policy.quotePolicyRevision,
    idlHash: policy.idlHash,
    expiry: context.expiry,
    blockhash: context.blockhash,
    lastValidHeight: context.lastValidHeight,
    messageHash: compiled.messageHash,
    instructions: compiled.instructions,
    accountEvidenceHash: hash(canonicalize(context.accounts)),
    shareMint: policy.shareMint,
    plan: planAddress,
    budgets: ["400000", "300000", "300000"],
    feesEnabled: false,
  };
  return {
    ...compiled,
    manifest,
    manifestHash: hash(canonicalize(manifest)),
    accounts,
  };
}
/** Short SERIALIZABLE CAS; RPC/IDL validation must finish before entering. */
export async function persistCompiledOwnerPacket(
  pool: Pool,
  policy: OpenCompilerPolicy,
  context: OpenOwnerContext,
  compiled: ReturnType<typeof compileTrustedOwnerPacket>,
  action: OpenOwnerAction,
  effects: OwnerEffectManifest | null,
) {
  const requestId = randomUUID(),
    client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const row = (
      await client.query(
        "SELECT *,clock_timestamp() AS now FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
        [context.intentId],
      )
    ).rows[0];
    requireValue(
      row &&
        row.wallet === policy.wallet &&
        row.vault === policy.vault &&
        row.configuration_hash === policy.configurationHash &&
        row.db_revision === context.dbRevision &&
        row.chain_revision === context.chainRevision &&
        row.state === context.state &&
        row.now.getTime() < context.expiry * 1000,
      "CAS",
    );
    requireValue(
      !(
        await client.query(
          `SELECT 1 FROM c3_open.legs WHERE intent_id=$1 AND state IN ('signed','submitted','uncertain','manual_review','reconciliation_required')
      UNION ALL SELECT 1 FROM c3_open.signing_requests s JOIN c3_open.quote_authorizations q USING(quote_id) WHERE q.intent_id=$1 AND s.state<>'result'
      UNION ALL SELECT 1 FROM c3_open.owner_requests r LEFT JOIN c3_open.owner_effect_receipts e USING(request_id) LEFT JOIN c3_open.owner_request_outcomes o USING(request_id) LEFT JOIN c3_open.plan_generations g USING(request_id) WHERE r.intent_id=$1 AND e.request_id IS NULL AND o.request_id IS NULL AND g.request_id IS NULL LIMIT 1`,
          [context.intentId],
        )
      ).rowCount,
      "RECONCILE_FIRST",
    );
    const prior = (
      await client.query(
        "SELECT request_id,generation FROM c3_open.owner_requests WHERE intent_id=$1 AND action=$2 ORDER BY generation DESC LIMIT 1",
        [context.intentId, action],
      )
    ).rows[0];
    requireValue(
      context.generation ===
        (prior ? (BigInt(prior.generation) + 1n).toString() : "1"),
      "GENERATION_CAS",
    );
    if (prior)
      requireValue(
        (
          await client.query(
            "SELECT 1 FROM c3_open.owner_request_outcomes WHERE request_id=$1 UNION ALL SELECT 1 FROM c3_open.plan_generations WHERE request_id=$1",
            [prior.request_id],
          )
        ).rowCount,
        "PRIOR_UNRESOLVED",
      );
    await client.query(
      "INSERT INTO c3_open.owner_requests(request_id,intent_id,action,expected_db_revision,expected_chain_revision,message_hash,blockhash,last_valid_height,expires_at,generation,predecessor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        requestId,
        context.intentId,
        action,
        context.dbRevision,
        context.chainRevision,
        Buffer.from(compiled.messageHash, "hex"),
        context.blockhash,
        context.lastValidHeight,
        new Date(context.expiry * 1000),
        context.generation,
        prior?.request_id ?? null,
      ],
    );
    await client.query(
      "INSERT INTO c3_open.owner_authorization_manifests(request_id,policy_hash,manifest,manifest_hash,pre_accounts) VALUES($1,$2,$3,$4,$5)",
      [
        requestId,
        hash(canonicalize(policy)),
        compiled.manifest,
        Buffer.from(compiled.manifestHash, "hex"),
        context.accounts,
      ],
    );
    if (effects)
      await client.query(
        "INSERT INTO c3_open.owner_economic_manifests(request_id,manifest,manifest_hash) VALUES($1,$2,$3)",
        [requestId, effects, Buffer.from(hash(canonicalize(effects)), "hex")],
      );
    const barrierAccounts = [
      ...new Set([
        policy.vault,
        ...decodeVersionedMessage(
          compiled.packet.subarray(65).toString("base64"),
          [],
        )
          .staticAccounts.filter((k) => k.writable)
          .map((k) => k.address),
      ]),
    ];
    requireValue(
      barrierAccounts.every((addr) => Object.hasOwn(context.accounts, addr)),
      "BASELINE_MISSING",
    );
    const created = action === "deposit" || action === "request_redemption";
    const stateHash = hash(
      canonicalize(
        barrierAccounts.map((address) => {
          const raw = context.accounts[address];
          const vacant =
            created &&
            address === compiled.accounts.intent &&
            (!raw ||
              (raw.owner === c.systemProgram &&
                !raw.executable &&
                raw.data[0] === ""));
          return {
            address,
            value: vacant
              ? null
              : raw
                ? {
                    owner: raw.owner,
                    executable: raw.executable,
                    data: raw.data[0],
                  }
                : null,
          };
        }),
      ),
    );
    await client.query(
      "INSERT INTO c3_open.owner_expiry_barriers(request_id,accounts,state_hash) VALUES($1,$2,$3)",
      [requestId, barrierAccounts, Buffer.from(stateHash, "hex")],
    );
    if (action === "renew_plan") {
      const plan = compiled.manifest.plan,
        pre = Buffer.from(context.accounts[plan]!.data[0]!, "base64");
      requireValue(
        Number.isSafeInteger(context.observedSlot) && context.observedSlot! > 0,
        "OBSERVED_SLOT",
      );
      await client.query(
        "INSERT INTO c3_open.renewal_requests(request_id,intent_id,plan,expected_db_revision,expected_chain_revision,expires_at,pre_state,message_hash,observed_slot,blockhash,last_valid_block_height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          requestId,
          context.intentId,
          plan,
          context.dbRevision,
          context.chainRevision,
          context.expiry,
          pre,
          Buffer.from(compiled.messageHash, "hex"),
          context.observedSlot,
          context.blockhash,
          context.lastValidHeight,
        ],
      );
    }
    await client.query("COMMIT");
    return {
      requestId,
      intentId: context.intentId,
      action,
      wallet: policy.wallet,
      expiry: context.expiry,
      messageHash: compiled.messageHash,
      packet: compiled.packet.toString("base64"),
      ...(action === "renew_plan"
        ? {
            chainRevision: context.chainRevision,
            planDirection:
              compiled.manifest.plan === compiled.accounts.plan &&
              compiled.accounts.intent === compiled.accounts.deposit
                ? "buy"
                : "sell",
          }
        : {}),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
