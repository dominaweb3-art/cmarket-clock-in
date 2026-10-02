/** Finalized LOCAL-validator lifecycle proof. No synthetic RPC adapter or on-chain write. */
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { createHash, createPublicKey, verify } from "node:crypto";
import { decodeBase58 } from "../src/solana.ts";
import type { Pool } from "pg";
import { C3_MAINNET as c } from "../src/constants.ts";
import {
  VAULT_PROGRAM,
  VAULT_AUTHORITY,
  vaultAta,
} from "./jupiter-vault-cpi-inspection.ts";
export type LifecycleStage =
  "funded" | "active" | "redemption_requested" | "claimable" | "redeemed";
const check = (v: unknown, s: string) => {
  if (!v) throw Error("C3_LIFECYCLE_" + s);
};
const h = (b: Uint8Array) => createHash("sha256").update(b).digest();
const pda = (seed: string, key: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from(seed), key.toBuffer()],
    VAULT_PROGRAM,
  )[0];
/** Narrow inner semantics for the lifecycle methods exercised by this pilot. */
export function verifyLifecycleInner(
  name: string,
  instructions: readonly {
    program: string;
    accounts: readonly string[];
    data: Buffer;
  }[],
  named: ReadonlyMap<string, string>,
  amount: bigint,
): void {
  const exact = (accounts: readonly string[], fields: readonly string[]) =>
    accounts.length === fields.length &&
    fields.every((f, i) => accounts[i] === named.get(f));
  const token2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  const expected =
    name === "deposit_usdc" ||
    name === "issue_initial_shares" ||
    name === "create_redemption_intent" ||
    (name.includes("create_") && name.includes("settlement_plan"))
      ? 1
      : name === "claim_usdc"
        ? 2
        : 0;
  check(instructions.length === expected, "INNER_COUNT");
  for (const [i, ix] of instructions.entries()) {
    const d = ix.data;
    if (name === "deposit_usdc" || (name === "claim_usdc" && i === 1)) {
      check(
        ix.program === c.tokenProgram &&
          d.length === 10 &&
          d[0] === 12 &&
          d.readBigUInt64LE(1) === amount &&
          d[9] === 6 &&
          exact(
            ix.accounts,
            name === "deposit_usdc"
              ? ["owner_usdc", "usdc_mint", "vault_usdc", "owner"]
              : ["vault_usdc", "usdc_mint", "owner_usdc", "vault_authority"],
          ),
        "INNER_TRANSFER",
      );
    } else if (name === "issue_initial_shares" || name === "claim_usdc") {
      check(
        ix.program === token2022 &&
          d.length === 9 &&
          d[0] === (name === "issue_initial_shares" ? 7 : 8) &&
          d.readBigUInt64LE(1) === 1_000_000n &&
          exact(
            ix.accounts,
            name === "issue_initial_shares"
              ? ["share_mint", "owner_shares", "vault_authority"]
              : ["owner_shares", "share_mint", "owner"],
          ),
        "INNER_SHARES",
      );
    } else {
      check(
        ix.program === c.systemProgram &&
          d.length === 52 &&
          d.readUInt32LE(0) === 0 &&
          new PublicKey(d.subarray(20, 52)).equals(VAULT_PROGRAM) &&
          exact(
            ix.accounts,
            name === "create_redemption_intent"
              ? ["owner", "intent"]
              : ["keeper", "plan"],
          ),
        "INNER_CREATE",
      );
    }
  }
}
export async function verifyLocalLifecycle(
  pool: Pool,
  rpc: Connection,
  idl: Idl,
  intentId: string,
  to: LifecycleStage,
  signatures: readonly string[],
) {
  check(/^http:\/\/127\.0\.0\.1:\d+$/.test(rpc.rpcEndpoint), "LOCAL_REQUIRED");
  check(
    (await rpc.getGenesisHash()) !== c.genesisHash &&
      idl.address === VAULT_PROGRAM.toBase58(),
    "IDENTITY",
  );
  const row = (
    await pool.query("SELECT * FROM c3_open.intents WHERE intent_id=$1", [
      intentId,
    ])
  ).rows[0];
  check(row, "INTENT");
  const coder = new BorshCoder(idl),
    config = new PublicKey(row.vault);
  const cfgRaw = await rpc.getAccountInfo(config, "finalized");
  check(cfgRaw?.owner.equals(VAULT_PROGRAM), "CONFIG_OWNER");
  const cfg = coder.accounts.decode("VaultConfig", cfgRaw!.data) as Record<
    string,
    unknown
  >;
  const key = (v: unknown) => {
    check(v instanceof PublicKey, "KEY");
    return v as PublicKey;
  };
  check(
    key(cfg.allowlisted_owner).toBase58() === row.wallet &&
      key(cfg.share_mint).toBase58() === row.share_mint,
    "OWNER_SHARES",
  );
  check(
    key(cfg.usdc_mint).toBase58() === c.usdcMint &&
      key(cfg.btc_mint).toBase58() === c.cbBtcMint &&
      key(cfg.eth_mint).toBase58() === c.portalEthMint &&
      key(cfg.wsol_mint).toBase58() === c.wrappedSolMint,
    "MINTS",
  );
  const defs: Record<LifecycleStage, readonly string[]> = {
    funded: ["deposit_usdc", "create_deposit_settlement_plan"],
    active: ["record_deposit_settlement", "issue_initial_shares"],
    redemption_requested: [
      "create_redemption_intent",
      "lock_shares_for_redemption",
      "create_redemption_settlement_plan",
    ],
    claimable: ["record_redemption_settlement"],
    redeemed: ["claim_usdc"],
  };
  check(
    signatures.length === defs[to].length &&
      new Set(signatures).size === signatures.length,
    "SIGNATURE_SET",
  );
  let lastSlot = 0;
  const evidence: Buffer[] = [];
  let planAddress: string | null = null;
  let claimCredit = 0n;
  for (const [i, signature] of signatures.entries()) {
    const status = (
      await rpc.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    check(
      status?.confirmationStatus === "finalized" && status.err === null,
      "FINALITY",
    );
    const tx = await rpc.getTransaction(signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    check(
      tx &&
        tx.meta &&
        tx.meta.err === null &&
        tx.slot === status!.slot &&
        tx.slot >= lastSlot,
      "TRANSACTION",
    );
    lastSlot = tx!.slot;
    const msg = tx!.transaction.message;
    check(
      tx!.transaction.signatures[0] === signature &&
        tx!.transaction.signatures.length === msg.header.numRequiredSignatures,
      "SIGNATURE_BINDING",
    );
    const keys = msg.getAccountKeys(
      tx!.meta!.loadedAddresses
        ? {
            accountKeysFromLookups: tx!.meta!.loadedAddresses,
          }
        : undefined,
    );
    const ix = msg.compiledInstructions.filter((v) =>
      keys.get(v.programIdIndex)?.equals(VAULT_PROGRAM),
    );
    check(ix.length === 1, "OUTER_COUNT");
    check(
      msg.compiledInstructions.every((v) => {
        const program = keys.get(v.programIdIndex)?.toBase58();
        return (
          program === VAULT_PROGRAM.toBase58() ||
          (program === c.computeBudgetProgram &&
            ((v.data[0] === 2 && v.data.length === 5) ||
              (v.data[0] === 3 && v.data.length === 9)))
        );
      }),
      "UNEXPECTED_OUTER_INSTRUCTION",
    );
    for (let index = 0; index < msg.header.numRequiredSignatures; index++) {
      const signerKey = keys.get(index);
      check(
        signerKey &&
          verify(
            null,
            msg.serialize(),
            createPublicKey({
              key: Buffer.concat([
                Buffer.from("302a300506032b6570032100", "hex"),
                signerKey.toBuffer(),
              ]),
              format: "der",
              type: "spki",
            }),
            decodeBase58(tx!.transaction.signatures[index]!),
          ),
        "CRYPTOGRAPHIC_SIGNATURE",
      );
    }
    const name = defs[to][i]!,
      definition = idl.instructions.find((v) => v.name === name);
    check(definition, "IDL_METHOD");
    const instruction = ix[0]!;
    check(
      instruction.accountKeyIndexes.length === definition!.accounts.length,
      "EXTRA_ACCOUNTS",
    );
    check(
      Buffer.from(instruction.data)
        .subarray(0, 8)
        .equals(Buffer.from(definition!.discriminator)),
      "METHOD",
    );
    const named = new Map(
      definition!.accounts.map((a, index) => [
        a.name,
        keys.get(instruction.accountKeyIndexes[index]!)!.toBase58(),
      ]),
    );
    check(named.get("config") === row.vault, "CONFIG_BINDING");
    const ownerMethod = [
      "deposit_usdc",
      "issue_initial_shares",
      "create_redemption_intent",
      "lock_shares_for_redemption",
      "claim_usdc",
    ].includes(name);
    const signer = ownerMethod ? row.wallet : key(cfg.keeper).toBase58();
    check(named.get(ownerMethod ? "owner" : "keeper") === signer, "SIGNER");
    check(
      [...Array(msg.header.numRequiredSignatures).keys()].some(
        (index) => keys.get(index)?.toBase58() === signer,
      ),
      "REQUIRED_SIGNER",
    );
    for (const [field, mint] of [
      ["vault_usdc", c.usdcMint],
      ["vault_btc", c.cbBtcMint],
      ["vault_eth", c.portalEthMint],
      ["vault_wsol", c.wrappedSolMint],
    ])
      if (named.has(field!))
        check(named.get(field!) === vaultAta(mint!), "VAULT_ACCOUNT");
    if (named.has("plan")) planAddress = named.get("plan")!;
    // Every observed token delta is accounted for. No arbitrary user token debit.
    const pre = tx!.meta!.preTokenBalances,
      post = tx!.meta!.postTokenBalances;
    check(pre && post, "BALANCE_EVIDENCE");
    const mintChanges = new Map<string, bigint>();
    for (const b of pre!) {
      const after = post!.find((a) => a.accountIndex === b.accountIndex);
      check(
        after &&
          after.mint === b.mint &&
          after.owner === b.owner &&
          after.programId === b.programId,
        "TOKEN_ACCOUNT_CHANGED",
      );
      const delta =
        BigInt(after!.uiTokenAmount.amount) - BigInt(b.uiTokenAmount.amount);
      if (delta === 0n) continue;
      const address = keys.get(b.accountIndex)!.toBase58();
      check(
        b.mint === c.usdcMint || b.mint === row.share_mint,
        "UNRELATED_MINT_DELTA",
      );
      check(
        b.owner === row.wallet || b.owner === VAULT_AUTHORITY.toBase58(),
        "UNRELATED_OWNER_DELTA",
      );
      if (b.mint === c.usdcMint) {
        check(
          name === "deposit_usdc" || name === "claim_usdc",
          "UNEXPECTED_USDC",
        );
        check(
          address === vaultAta(c.usdcMint) ||
            address ===
              PublicKey.findProgramAddressSync(
                [
                  new PublicKey(row.wallet).toBuffer(),
                  new PublicKey(c.tokenProgram).toBuffer(),
                  new PublicKey(c.usdcMint).toBuffer(),
                ],
                new PublicKey(c.associatedTokenProgram),
              )[0].toBase58(),
          "USDC_DESTINATION",
        );
        if (name === "deposit_usdc")
          check(
            delta === (b.owner === row.wallet ? -1_000_000n : 1_000_000n),
            "DEPOSIT_AMOUNT",
          );
        else {
          check(
            delta !== 0n && (b.owner === row.wallet ? delta > 0n : delta < 0n),
            "CLAIM_DIRECTION",
          );
          if (b.owner === row.wallet) claimCredit += delta;
        }
      } else
        check(
          b.owner === row.wallet &&
            delta ===
              (name === "issue_initial_shares"
                ? 1_000_000n
                : name === "claim_usdc"
                  ? -1_000_000n
                  : 0n),
          "SHARE_EFFECT",
        );
      mintChanges.set(b.mint, (mintChanges.get(b.mint) ?? 0n) + delta);
    }
    check(
      post!.every((a) => pre!.some((b) => b.accountIndex === a.accountIndex)),
      "UNEXPECTED_TOKEN_CREATION",
    );
    if (name === "deposit_usdc")
      check(mintChanges.get(c.usdcMint) === 0n, "DEPOSIT_EFFECT_REQUIRED");
    if (name === "issue_initial_shares")
      check(
        mintChanges.get(row.share_mint) === 1_000_000n,
        "MINT_EFFECT_REQUIRED",
      );
    if (name === "claim_usdc")
      check(
        mintChanges.get(row.share_mint) === -1_000_000n &&
          mintChanges.get(c.usdcMint) === 0n,
        "CLAIM_BURN_EFFECT_REQUIRED",
      );
    check(tx!.meta!.innerInstructions, "INNER_EVIDENCE");
    const inner = tx!.meta!.innerInstructions!.flatMap((group) =>
      group.instructions.map((v) => ({
        program: keys.get(v.programIdIndex)!.toBase58(),
        accounts: v.accounts.map((n) => keys.get(n)!.toBase58()),
        data: Buffer.from(decodeBase58(v.data)),
      })),
    );
    verifyLifecycleInner(
      name,
      inner,
      named,
      name === "claim_usdc" ? claimCredit : 1_000_000n,
    );
    evidence.push(
      Buffer.from(
        JSON.stringify({
          signature,
          slot: tx!.slot,
          meta: tx!.meta,
          tx: tx!.transaction.message.serialize().toString(),
        }),
      ),
    );
  }
  const plan = new PublicKey(
    planAddress ??
      (to === "claimable" || to === "redeemed"
        ? row.redemption_plan
        : row.deposit_plan),
  );
  check(
    to === "redemption_requested" ||
      plan.toBase58() ===
        (to === "claimable" || to === "redeemed"
          ? row.redemption_plan
          : row.deposit_plan),
    "PLAN_BINDING",
  );
  const raw = await rpc.getAccountInfoAndContext(plan, {
    commitment: "finalized",
    minContextSlot: lastSlot,
  });
  check(raw.value?.owner.equals(VAULT_PROGRAM), "PLAN_OWNER");
  const state = coder.accounts.decode(
    "SettlementPlan",
    raw.value!.data,
  ) as Record<string, unknown>;
  check(
    key(state.vault).equals(config) &&
      key(state.wallet).toBase58() === row.wallet &&
      key(state.share_mint).toBase58() === row.share_mint &&
      pda("c3-plan-v1", key(state.intent)).equals(plan),
    "PLAN_CONTEXT",
  );
  const revision = to === "funded" || to === "redemption_requested" ? 0n : 3n;
  check(
    String(state.revision) === String(revision) &&
      Number(state.executed_bitmap) === (revision === 0n ? 0 : 7),
    "PLAN_REVISION",
  );
  const expectedLifecycle = {
    funded: 1,
    active: 3,
    redemption_requested: 4,
    claimable: 6,
    // claim_usdc mutates RedemptionIntent and VaultConfig, not SettlementPlan.
    // Never invent a plan transition not performed by the on-chain program.
    redeemed: 6,
  }[to];
  check(Number(state.lifecycle) === expectedLifecycle, "PLAN_LIFECYCLE");
  const intentRaw = await rpc.getAccountInfo(key(state.intent), {
    commitment: "finalized",
    minContextSlot: lastSlot,
  });
  check(intentRaw?.owner.equals(VAULT_PROGRAM), "ONCHAIN_INTENT_OWNER");
  const selling =
    to === "redemption_requested" || to === "claimable" || to === "redeemed";
  const intent = coder.accounts.decode(
    selling ? "RedemptionIntent" : "DepositIntent",
    intentRaw!.data,
  ) as Record<string, unknown>;
  check(
    key(intent.vault).equals(config) &&
      key(intent.wallet).toBase58() === row.wallet,
    "ONCHAIN_INTENT_BINDING",
  );
  check(
    Number(intent.status) ===
      {
        funded: 2,
        active: 5,
        redemption_requested: 2,
        claimable: 4,
        redeemed: 6,
      }[to],
    "ONCHAIN_INTENT_STATUS",
  );
  if (to === "redeemed") {
    check(
      BigInt(String(intent.usdc_returned)) === claimCredit &&
        claimCredit > 0n &&
        String(intent.usdc_returned) === String(intent.usdc_claimable) &&
        Number(cfg.lifecycle) === 4,
      "REDEMPTION_COMPLETED",
    );
  }
  evidence.push(intentRaw!.data);
  evidence.push(raw.value!.data, cfgRaw!.data);
  return Object.freeze({
    plan: plan.toBase58(),
    wallet: row.wallet as string,
    vault: row.vault as string,
    amount: 1_000_000n,
    chainRevision: revision,
    evidenceHash: h(Buffer.concat(evidence)).toString("hex"),
    ...(to === "redemption_requested"
      ? { redemptionPlan: plan.toBase58() }
      : {}),
  });
}
