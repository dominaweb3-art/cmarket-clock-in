/** Devnet-only finalized owner effects. No caller success flags, transactions,
 * private keys, RPC transport or monetary price are accepted as authorization. */
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import {
  EvaluationClient,
  EVAL_TOKEN,
  EVAL_SHARES,
  type EvaluationOwnerAction,
} from "./evaluation-client.ts";
import { EVALUATION } from "./evaluation-scope.ts";
import { decodeBase58 } from "./solana.ts";
import { accountBytes, type OpenAccount } from "./open-state-semantics.ts";
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("EVAL_EFFECT_" + code);
};
const hash = (b: Uint8Array | string) =>
  createHash("sha256").update(b).digest();
const uint = (v: unknown) => {
  check(typeof v === "string" && /^(0|[1-9]\d{0,19})$/.test(v), "INTEGER");
  const n = BigInt(v as string);
  check(n <= (1n << 64n) - 1n, "INTEGER");
  return n;
};
export function verifyEvaluationOwnerEffects(
  client: EvaluationClient,
  action: EvaluationOwnerAction,
  approvedHash: Buffer,
  signature: string,
  tx: VersionedTransactionResponse,
  preAccounts: Readonly<Record<string, OpenAccount | null>>,
) {
  const meta = tx.meta,
    msg = tx.transaction.message;
  check(
    meta &&
      meta.err === null &&
      meta.innerInstructions &&
      meta.preTokenBalances &&
      meta.postTokenBalances,
    "MISSING_EVIDENCE",
  );
  check(
    msg.version === 0 &&
      msg.addressTableLookups.length === 0 &&
      msg.header.numRequiredSignatures === 1 &&
      msg.staticAccountKeys[0]?.equals(client.owner) &&
      tx.transaction.signatures.length === 1 &&
      tx.transaction.signatures[0] === signature &&
      hash(msg.serialize()).equals(approvedHash),
    "MESSAGE_BINDING",
  );
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      client.owner.toBuffer(),
    ]),
    format: "der",
    type: "spki",
  });
  check(
    verify(null, msg.serialize(), key, decodeBase58(signature)),
    "SIGNATURE",
  );
  const names =
    action === "request_redemption" || action === "claim"
      ? client.accounts(client.intent("redemption"))
      : client.accounts(client.intent("deposit"));
  const outerNames =
    action === "deposit"
      ? ["create_deposit_intent", "deposit_usdc"]
      : action === "request_redemption"
        ? ["create_redemption_intent", "lock_shares_for_redemption"]
        : [action === "claim" ? "claim_usdc" : "issue_initial_shares"];
  check(msg.compiledInstructions.length === outerNames.length, "OUTER_COUNT");
  msg.compiledInstructions.forEach((ix, i) => {
    const definition = client.idl.instructions.find(
      (v) => v.name === outerNames[i],
    )!;
    check(
      msg.staticAccountKeys[ix.programIdIndex]?.equals(client.program) &&
        ix.accountKeyIndexes.length === definition.accounts.length &&
        Buffer.from(ix.data)
          .subarray(0, 8)
          .equals(Buffer.from(definition.discriminator)),
      "OUTER_INSTRUCTION",
    );
    definition.accounts.forEach((a, j) =>
      check(
        msg.staticAccountKeys[ix.accountKeyIndexes[j]!]?.equals(names[a.name]!),
        "ORDERED_ACCOUNT",
      ),
    );
  });
  let claim = 0n;
  if (action === "claim") {
    const raw = preAccounts[client.intent("redemption").toBase58()];
    check(raw, "CLAIM_BASELINE");
    const r = client.coder.accounts.decode(
      "RedemptionIntent",
      accountBytes(raw!, EVALUATION.program, undefined, "RedemptionIntent"),
    ) as Record<string, unknown>;
    check(
      (r.wallet as PublicKey).equals(client.owner) &&
        (r.vault as PublicKey).equals(client.vault) &&
        r.status === 4 &&
        BigInt(String(r.usdc_returned)) === 0n,
      "CLAIM_BASELINE",
    );
    claim = uint(String(r.usdc_claimable));
    check(claim > 0n, "CLAIM_BASELINE");
  }
  const account = (index: number) => {
    const k = msg.staticAccountKeys[index];
    check(k, "ACCOUNT_INDEX");
    return k!.toBase58();
  };
  const mint = new PublicKey(client.config.usdcMint).toBuffer();
  const transferData = (amount: bigint) => {
    const d = Buffer.alloc(10);
    d[0] = 12;
    d.writeBigUInt64LE(amount, 1);
    d[9] = 6;
    return d;
  };
  const shareData = (burn: boolean) => {
    const d = Buffer.alloc(9);
    d[0] = burn ? 8 : 7;
    d.writeBigUInt64LE(EVALUATION.amount, 1);
    return d;
  };
  let createRent = 0n;
  const expected: {
    index: number;
    instructions: {
      program: string;
      accounts: string[];
      data?: Buffer;
      create?: boolean;
    }[];
  }[] = [];
  if (action === "deposit" || action === "request_redemption")
    expected.push({
      index: 0,
      instructions: [
        {
          program: SystemProgram.programId.toBase58(),
          accounts: [client.owner.toBase58(), names.intent!.toBase58()],
          create: true,
        },
      ],
    });
  if (action === "deposit")
    expected.push({
      index: 1,
      instructions: [
        {
          program: EVAL_TOKEN.toBase58(),
          accounts: [
            names.owner_usdc!.toBase58(),
            new PublicKey(mint).toBase58(),
            names.vault_usdc!.toBase58(),
            client.owner.toBase58(),
          ],
          data: transferData(EVALUATION.amount),
        },
      ],
    });
  if (action === "issue_shares")
    expected.push({
      index: 0,
      instructions: [
        {
          program: EVAL_SHARES.toBase58(),
          accounts: [
            client.config.shareMint,
            names.owner_shares!.toBase58(),
            client.authority.toBase58(),
          ],
          data: shareData(false),
        },
      ],
    });
  if (action === "claim")
    expected.push({
      index: 0,
      instructions: [
        {
          program: EVAL_SHARES.toBase58(),
          accounts: [
            names.owner_shares!.toBase58(),
            client.config.shareMint,
            client.owner.toBase58(),
          ],
          data: shareData(true),
        },
        {
          program: EVAL_TOKEN.toBase58(),
          accounts: [
            names.vault_usdc!.toBase58(),
            client.config.usdcMint,
            names.owner_usdc!.toBase58(),
            client.authority.toBase58(),
          ],
          data: transferData(claim),
        },
      ],
    });
  const actual = meta!.innerInstructions!.filter(
    (group) => group.instructions.length > 0,
  );
  check(actual.length === expected.length, "INNER_COUNT");
  expected.forEach((e, i) => {
    const group = actual[i]!;
    check(
      group.index === e.index &&
        group.instructions.length === e.instructions.length,
      "INNER_COUNT",
    );
    e.instructions.forEach((x, j) => {
      const ix = group.instructions[j]!,
        bytes = Buffer.from(decodeBase58(ix.data));
      check(
        account(ix.programIdIndex) === x.program &&
          ix.accounts.length === x.accounts.length &&
          ix.accounts.every((a, k) => account(a) === x.accounts[k]),
        "HOSTILE_INNER_ACCOUNT",
      );
      if (x.create) {
        check(
          bytes.length === 52 &&
            bytes.readUInt32LE(0) === 0 &&
            bytes.readBigUInt64LE(12) ===
              (action === "deposit" ? 288n : 234n) &&
            new PublicKey(bytes.subarray(20)).equals(client.program),
          "HOSTILE_SYSTEM_CREATE",
        );
        createRent = bytes.readBigUInt64LE(4);
        check(createRent > 0n, "RENT");
      } else check(bytes.equals(x.data!), "HOSTILE_INNER_DATA");
    });
  });
  const deltas = new Map<string, bigint>();
  if (action === "deposit") {
    deltas.set(names.owner_usdc!.toBase58(), -EVALUATION.amount);
    deltas.set(names.vault_usdc!.toBase58(), EVALUATION.amount);
  }
  if (action === "issue_shares")
    deltas.set(names.owner_shares!.toBase58(), EVALUATION.amount);
  if (action === "claim") {
    deltas.set(names.owner_shares!.toBase58(), -EVALUATION.amount);
    deltas.set(names.vault_usdc!.toBase58(), -claim);
    deltas.set(names.owner_usdc!.toBase58(), claim);
  }
  const pre = meta!.preTokenBalances!,
    post = meta!.postTokenBalances!;
  check(
    pre.length === post.length &&
      new Set(pre.map((v) => v.accountIndex)).size === pre.length &&
      new Set(post.map((v) => v.accountIndex)).size === post.length,
    "TOKEN_SET",
  );
  const observed = new Set<string>();
  for (const before of pre) {
    const after = post.find((v) => v.accountIndex === before.accountIndex);
    check(
      after &&
        before.owner &&
        before.programId &&
        before.owner === after.owner &&
        before.mint === after.mint &&
        before.programId === after.programId &&
        before.uiTokenAmount.decimals === after.uiTokenAmount.decimals,
      "TOKEN_IDENTITY",
    );
    const address = account(before.accountIndex),
      expectedDelta = deltas.get(address) ?? 0n;
    const delta =
      uint(after!.uiTokenAmount.amount) - uint(before.uiTokenAmount.amount);
    check(delta === expectedDelta, "UNEXPECTED_TOKEN_EFFECT");
    if (deltas.has(address)) {
      const shares = address === names.owner_shares!.toBase58();
      check(
        before.mint ===
          (shares ? client.config.shareMint : client.config.usdcMint) &&
          before.owner ===
            (address === names.vault_usdc!.toBase58()
              ? client.authority.toBase58()
              : client.owner.toBase58()) &&
          before.programId === (shares ? EVAL_SHARES : EVAL_TOKEN).toBase58() &&
          before.uiTokenAmount.decimals === 6,
        "TOKEN_DESTINATION",
      );
      observed.add(address);
    }
  }
  check(observed.size === deltas.size, "TOKEN_EVIDENCE_MISSING");
  check(
    meta!.preBalances.length === msg.staticAccountKeys.length &&
      meta!.postBalances.length === meta!.preBalances.length &&
      Number.isSafeInteger(meta!.fee) &&
      meta!.fee >= 0,
    "SOL_EVIDENCE",
  );
  for (let i = 0; i < meta!.preBalances.length; i++) {
    const before = meta!.preBalances[i]!,
      after = meta!.postBalances[i]!;
    check(
      Number.isSafeInteger(before) &&
        before >= 0 &&
        Number.isSafeInteger(after) &&
        after >= 0,
      "SOL_INTEGER",
    );
    const expectedDelta =
      i === 0
        ? -BigInt(meta!.fee) - createRent
        : account(i) === names.intent!.toBase58()
          ? createRent
          : 0n;
    check(
      BigInt(after) - BigInt(before) === expectedDelta,
      "UNEXPECTED_SOL_EFFECT",
    );
  }
  check(Number.isSafeInteger(tx.slot) && tx.slot > 0, "SLOT");
  return {
    slot: tx.slot,
    claim,
    evidenceHash: hash(
      JSON.stringify({
        signature,
        messageHash: approvedHash.toString("hex"),
        slot: tx.slot,
        meta,
      }),
    ),
  };
}
