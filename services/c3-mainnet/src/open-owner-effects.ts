/** Pure semantic verifier and durable CAS promotion. An identical RPC reply,
 * signature receipt or caller 'success' flag is never economic evidence.
 * Manifests are immutable SERVER-generated policy, not HTTP request fields. */
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import type { Pool } from "pg";
import { canonicalize } from "./manifest.ts";
import {
  decodeBase58,
  decodeVersionedMessage,
  encodeBase58,
  publicKeyBytes,
  findProgramAddress,
  deriveAssociatedTokenAddress,
} from "./solana.ts";
import { C3_MAINNET } from "./constants.ts";
import { collectFinalizedOpenEconomicEvidence } from "./open-economic-quorum.ts";
import { readIndependentOpenEvidence } from "./open-rpc-quorum.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
const digest = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("C3_OWNER_EFFECT_" + code);
};
const object = (v: unknown): Record<string, unknown> => {
  check(v && typeof v === "object" && !Array.isArray(v), "SHAPE");
  return v as Record<string, unknown>;
};
const uint = (v: unknown) => {
  check(typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v), "INTEGER");
  const n = BigInt(v as string);
  check(n < 1n << 64n, "OVERFLOW");
  return n;
};
export type OwnerEffectManifest = Readonly<{
  version: "c3-owner-effects/v1";
  wallet: string;
  messageHash: string;
  action: "deposit" | "issue_shares" | "request_redemption" | "claim";
  program: string;
  vault: string;
  shareMint: string;
  onchainIntent: string;
  plan: string;
  planRevision: string;
  inner: readonly Readonly<{
    index: number;
    instructions: readonly Readonly<{
      program: string;
      accounts: readonly string[];
      dataHash: string;
    }>[];
  }>[];
  tokens: readonly Readonly<{
    account: string;
    owner: string;
    mint: string;
    program: string;
    decimals: number;
    delta: string;
  }>[];
  lamports: readonly Readonly<{
    account: string;
    minimum: string;
    maximum: string;
  }>[];
  snapshots: readonly Readonly<{
    address: string;
    owner: string;
    bytes: number;
    dataHash: string;
    checks: readonly Readonly<{ offset: number; base64: string }>[];
  }>[];
}>;
/** Reviewed Anchor account layouts, independently checked against the IDL in
 * regression tests. Never infer lifecycle from a client flag or target weights. */
function verifyOwnerProgramState(m: OwnerEffectManifest, values: unknown[]) {
  const account = (
    address: string,
    owner: string,
    size: number,
    name?: string,
  ) => {
    const index = m.snapshots.findIndex((s) => s.address === address);
    check(index >= 0, "STATE_ACCOUNT_MISSING");
    const raw = object(values[index]);
    check(
      raw.owner === owner &&
        raw.executable === false &&
        Array.isArray(raw.data) &&
        raw.data[1] === "base64",
      "STATE_OWNER",
    );
    const data = raw.data as unknown[];
    const b = Buffer.from(String(data[0]), "base64");
    check(b.length === size, "STATE_LAYOUT");
    if (name)
      check(
        b.subarray(0, 8).equals(
          createHash("sha256")
            .update("account:" + name)
            .digest()
            .subarray(0, 8),
        ),
        "STATE_DISCRIMINATOR",
      );
    return b;
  };
  const cfg = account(m.vault, m.program, 546, "VaultConfig");
  const equal = (b: Buffer, o: number, k: string) =>
    b.subarray(o, o + 32).equals(Buffer.from(publicKeyBytes(k)));
  check(
    cfg[8] === 1 &&
      cfg.readBigUInt64LE(9) === 1n &&
      equal(cfg, 113, m.wallet) &&
      equal(cfg, 274, m.shareMint) &&
      cfg.readUInt16LE(434) === 4000 &&
      cfg.readUInt16LE(436) === 3000 &&
      cfg.readUInt16LE(438) === 3000,
    "CONFIGURATION",
  );
  for (const [offset, mint] of [
    [146, C3_MAINNET.usdcMint],
    [178, C3_MAINNET.cbBtcMint],
    [210, C3_MAINNET.portalEthMint],
    [242, C3_MAINNET.wrappedSolMint],
  ] as const)
    check(equal(cfg, offset, mint), "CONFIG_MINT");
  const selling = m.action === "request_redemption" || m.action === "claim",
    intent = account(
      m.onchainIntent,
      m.program,
      selling ? 234 : 288,
      selling ? "RedemptionIntent" : "DepositIntent",
    );
  check(
    intent[8] === 1 &&
      intent.readBigUInt64LE(9) === 1n &&
      equal(intent, 17, m.vault) &&
      equal(intent, 49, m.wallet) &&
      intent.readBigUInt64LE(81) === 1n &&
      intent.readBigUInt64LE(114) === 1000000n,
    "ONCHAIN_INTENT",
  );
  const states = {
    deposit: [2, 1],
    issue_shares: [5, 2],
    request_redemption: [2, 3],
    claim: [6, 4],
  }[m.action];
  check(intent[113] === states[0] && cfg[480] === states[1], "ONCHAIN_STATUS");
  if (m.action === "deposit")
    check(intent.readBigUInt64LE(122) === 1000000n, "ONCHAIN_DEPOSIT");
  if (m.action === "issue_shares")
    check(
      intent.readBigUInt64LE(186) === 1000000n &&
        cfg.readBigUInt64LE(472) === 1000000n &&
        [162, 170, 178].every((o) => intent.readBigUInt64LE(o) > 0n),
      "ONCHAIN_SHARES",
    );
  if (m.action === "claim") {
    const returned = intent.readBigUInt64LE(162);
    check(
      returned > 0n &&
        returned === intent.readBigUInt64LE(154) &&
        m.tokens.some(
          (t) =>
            t.mint === C3_MAINNET.usdcMint &&
            t.owner === m.wallet &&
            t.delta === returned.toString(),
        ),
      "ONCHAIN_CLAIM",
    );
  }
}
/** Matching every token/lamport delta and EVERY ordered inner instruction
 * rejects extra mints, drains, delegates, CPI/authority changes and closures. */
export function verifyOwnerEconomicEffects(
  manifest: OwnerEffectManifest,
  signature: string,
  wireResponse: unknown,
  jsonResponse: unknown,
  snapshotResponse: unknown,
) {
  check(
    manifest.version === "c3-owner-effects/v1" &&
      /^[a-f0-9]{64}$/.test(manifest.messageHash),
    "MANIFEST",
  );
  check(
    ["deposit", "issue_shares", "request_redemption", "claim"].includes(
      manifest.action,
    ),
    "ACTION",
  );
  for (const k of [
    manifest.program,
    manifest.wallet,
    manifest.vault,
    manifest.shareMint,
    manifest.onchainIntent,
    manifest.plan,
  ])
    publicKeyBytes(k);
  uint(manifest.planRevision);
  const authority = findProgramAddress(
    [Buffer.from("c3-authority-v1")],
    manifest.program,
  ).address;
  const ownerUsdc = deriveAssociatedTokenAddress(
      manifest.wallet,
      C3_MAINNET.usdcMint,
    ),
    vaultUsdc = deriveAssociatedTokenAddress(authority, C3_MAINNET.usdcMint);
  const token2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  const ownerShares = findProgramAddress(
    [
      publicKeyBytes(manifest.wallet),
      publicKeyBytes(token2022),
      publicKeyBytes(manifest.shareMint),
    ],
    C3_MAINNET.associatedTokenProgram,
  ).address;
  const shape = (
    account: string,
    owner: string,
    mint: string,
    program: string,
    delta: string,
  ) => ({ account, owner, mint, program, decimals: 6, delta });
  const received =
    manifest.action === "claim"
      ? manifest.tokens.find((t) => t.account === ownerUsdc)?.delta
      : "0";
  if (manifest.action === "claim")
    check(typeof received === "string" && uint(received) > 0n, "CLAIM_CREDIT");
  const requiredTokens =
    manifest.action === "deposit"
      ? [
          shape(
            ownerUsdc,
            manifest.wallet,
            C3_MAINNET.usdcMint,
            C3_MAINNET.tokenProgram,
            "-1000000",
          ),
          shape(
            vaultUsdc,
            authority,
            C3_MAINNET.usdcMint,
            C3_MAINNET.tokenProgram,
            "1000000",
          ),
        ]
      : manifest.action === "issue_shares"
        ? [
            shape(
              ownerShares,
              manifest.wallet,
              manifest.shareMint,
              token2022,
              "1000000",
            ),
          ]
        : manifest.action === "claim"
          ? [
              shape(
                ownerShares,
                manifest.wallet,
                manifest.shareMint,
                token2022,
                "-1000000",
              ),
              shape(
                ownerUsdc,
                manifest.wallet,
                C3_MAINNET.usdcMint,
                C3_MAINNET.tokenProgram,
                received!,
              ),
              shape(
                vaultUsdc,
                authority,
                C3_MAINNET.usdcMint,
                C3_MAINNET.tokenProgram,
                "-" + received,
              ),
            ]
          : [];
  check(
    canonicalize(manifest.tokens) === canonicalize(requiredTokens),
    "ACTION_ECONOMICS",
  );
  check(
    manifest.snapshots.some(
      (s) => s.address === manifest.vault && s.owner === manifest.program,
    ) &&
      manifest.snapshots.some(
        (s) =>
          s.address === manifest.onchainIntent && s.owner === manifest.program,
      ) &&
      new Set(manifest.snapshots.map((s) => s.address)).size ===
        manifest.snapshots.length,
    "MANDATORY_CONTEXT",
  );
  const wireTx = object(wireResponse),
    tx = object(jsonResponse),
    meta = object(tx.meta),
    body = object(tx.transaction);
  check(
    wireTx.slot === tx.slot &&
      Number.isSafeInteger(tx.slot) &&
      Number(tx.slot) > 0 &&
      canonicalize(wireTx.meta) === canonicalize(tx.meta),
    "WIRE_EVIDENCE",
  );
  check(
    Array.isArray(wireTx.transaction) &&
      wireTx.transaction[1] === "base64" &&
      typeof wireTx.transaction[0] === "string",
    "WIRE",
  );
  const encoded = wireTx.transaction as string[],
    packet = Buffer.from(encoded[0]!, "base64");
  check(
    packet.toString("base64") === encoded[0] &&
      packet.length <= 1232 &&
      packet[0] === 1,
    "WIRE_SIZE",
  );
  const message = packet.subarray(65),
    decoded = decodeVersionedMessage(message.toString("base64"), []);
  check(
    decoded.messageHash === manifest.messageHash &&
      decoded.requiredSignatures === 1 &&
      decoded.staticAccounts[0]?.address === manifest.wallet &&
      decoded.staticAccounts[0]?.writable &&
      encodeBase58(packet.subarray(1, 65)) === signature &&
      canonicalize(body.signatures) === canonicalize([signature]) &&
      decoded.lookupTables.length === 0,
    "MESSAGE",
  );
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKeyBytes(manifest.wallet)),
    ]),
    format: "der",
    type: "spki",
  });
  check(verify(null, message, key, packet.subarray(1, 65)), "SIGNATURE");
  check(
    meta.err === null && Array.isArray(meta.innerInstructions),
    "INNER_MISSING",
  );
  const addresses = decoded.staticAccounts.map((k) => k.address),
    inner = (meta.innerInstructions as unknown[]).map((v) => {
      const group = object(v);
      check(
        Number.isSafeInteger(group.index) &&
          Number(group.index) >= 0 &&
          Number(group.index) < decoded.instructions.length &&
          Array.isArray(group.instructions),
        "INNER_INDEX",
      );
      return {
        index: group.index,
        instructions: (group.instructions as unknown[]).map((v) => {
          const ix = object(v);
          check(
            Number.isSafeInteger(ix.programIdIndex) &&
              Array.isArray(ix.accounts) &&
              typeof ix.data === "string",
            "INNER_SHAPE",
          );
          const program = addresses[Number(ix.programIdIndex)];
          check(program, "INNER_PROGRAM");
          return {
            program,
            accounts: (ix.accounts as unknown[]).map((n) => {
              check(
                Number.isSafeInteger(n) && addresses[Number(n)],
                "INNER_ACCOUNT",
              );
              return addresses[Number(n)];
            }),
            dataHash: digest(decodeBase58(ix.data as string)),
          };
        }),
      };
    });
  check(
    new Set(inner.map((v) => v.index)).size === inner.length &&
      canonicalize(inner) === canonicalize(manifest.inner),
    "HOSTILE_INNER",
  );
  const balances = (value: unknown) => {
    check(Array.isArray(value), "TOKEN_MISSING");
    const map = new Map<
      number,
      {
        account: string;
        owner: unknown;
        mint: unknown;
        program: unknown;
        decimals: unknown;
        amount: bigint;
      }
    >();
    for (const entry of value as unknown[]) {
      const b = object(entry),
        a = object(b.uiTokenAmount);
      check(
        Number.isSafeInteger(b.accountIndex) &&
          addresses[Number(b.accountIndex)] &&
          !map.has(Number(b.accountIndex)) &&
          typeof b.owner === "string" &&
          typeof b.mint === "string" &&
          typeof b.programId === "string" &&
          Number.isInteger(a.decimals),
        "TOKEN_SHAPE",
      );
      map.set(Number(b.accountIndex), {
        account: addresses[Number(b.accountIndex)]!,
        owner: b.owner,
        mint: b.mint,
        program: b.programId,
        decimals: a.decimals,
        amount: uint(a.amount),
      });
    }
    return map;
  };
  const pre = balances(meta.preTokenBalances),
    post = balances(meta.postTokenBalances),
    seen = new Set<string>();
  check(
    pre.size === post.size &&
      new Set(manifest.tokens.map((v) => v.account)).size ===
        manifest.tokens.length,
    "TOKEN_SET",
  );
  for (const [index, b] of pre) {
    const after = post.get(index);
    check(
      after &&
        canonicalize({ ...b, amount: "0" }) ===
          canonicalize({ ...after, amount: "0" }),
      "TOKEN_IDENTITY",
    );
    const delta = after!.amount - b.amount,
      expected = manifest.tokens.find((t) => t.account === b.account);
    if (expected) {
      check(
        expected.owner === b.owner &&
          expected.mint === b.mint &&
          expected.program === b.program &&
          expected.decimals === b.decimals &&
          /^-?(0|[1-9][0-9]{0,19})$/.test(expected.delta) &&
          delta === BigInt(expected.delta),
        "TOKEN_EFFECT",
      );
      seen.add(b.account);
    } else check(delta === 0n, "UNRELATED_TOKEN_DELTA");
  }
  check(seen.size === manifest.tokens.length, "TOKEN_EFFECT_MISSING");
  check(
    Array.isArray(meta.preBalances) &&
      Array.isArray(meta.postBalances) &&
      meta.preBalances.length === addresses.length &&
      meta.postBalances.length === addresses.length &&
      new Set(manifest.lamports.map((v) => v.account)).size ===
        manifest.lamports.length,
    "LAMPORT_EVIDENCE",
  );
  for (const [i, address] of addresses.entries()) {
    const a = (meta.preBalances as unknown[])[i],
      b = (meta.postBalances as unknown[])[i];
    check(
      Number.isSafeInteger(a) &&
        Number(a) >= 0 &&
        Number.isSafeInteger(b) &&
        Number(b) >= 0,
      "LAMPORT_INTEGER",
    );
    const delta = BigInt(Number(b)) - BigInt(Number(a)),
      expected = manifest.lamports.find((v) => v.account === address);
    if (expected) {
      check(
        /^-?(0|[1-9][0-9]{0,19})$/.test(expected.minimum) &&
          /^-?(0|[1-9][0-9]{0,19})$/.test(expected.maximum) &&
          BigInt(expected.minimum) <= BigInt(expected.maximum) &&
          delta >= BigInt(expected.minimum) &&
          delta <= BigInt(expected.maximum),
        "LAMPORT_EFFECT",
      );
    } else check(delta === 0n, "UNRELATED_SOL_DELTA");
  }
  check(
    manifest.lamports.every((v) => addresses.includes(v.account)),
    "UNUSED_LAMPORT_EXPECTATION",
  );
  const snapshot = object(snapshotResponse),
    ctx = object(snapshot.context);
  check(
    Number.isSafeInteger(ctx.slot) &&
      Number(ctx.slot) >= Number(tx.slot) &&
      Array.isArray(snapshot.value) &&
      snapshot.value.length === manifest.snapshots.length &&
      manifest.snapshots.length >= 2,
    "SNAPSHOT",
  );
  for (const [i, expected] of manifest.snapshots.entries()) {
    const a = object((snapshot.value as unknown[])[i]);
    check(
      a.owner === expected.owner &&
        a.executable === false &&
        Array.isArray(a.data) &&
        a.data[1] === "base64" &&
        typeof a.data[0] === "string",
      "SNAPSHOT_OWNER",
    );
    const bytes = Buffer.from((a.data as string[])[0]!, "base64");
    check(
      bytes.toString("base64") === (a.data as string[])[0] &&
        bytes.length === expected.bytes &&
        expected.checks.length > 0 &&
        /^[a-f0-9]{64}$/.test(expected.dataHash) &&
        digest(bytes) === expected.dataHash,
      "SNAPSHOT_BYTES",
    );
    for (const f of expected.checks) {
      const wanted = Buffer.from(f.base64, "base64");
      check(
        Number.isSafeInteger(f.offset) &&
          f.offset >= 0 &&
          wanted.length > 0 &&
          wanted.toString("base64") === f.base64 &&
          f.offset + wanted.length <= bytes.length &&
          bytes.subarray(f.offset, f.offset + wanted.length).equals(wanted),
        "SNAPSHOT_STATE",
      );
    }
  }
  verifyOwnerProgramState(manifest, snapshot.value as unknown[]);
  return {
    slot: Number(tx.slot),
    evidenceHash: digest(
      canonicalize({
        signature,
        manifestHash: digest(canonicalize(manifest)),
        wire: wireTx,
        transaction: tx,
        snapshot,
      }),
    ),
  };
}
/** Requires source approval; caller supplies only a public persisted request ID.
 * Immutable manifest + DB scope are loaded here, never supplied by a client. */
export async function reconcileProductionOwnerEconomics(
  pool: Pool,
  requestId: string,
  fetcher: typeof fetch = fetch,
) {
  const policy = requireOpenProductionPolicy();
  const r = (
    await pool.query(
      `SELECT r.*,s.signature,m.manifest,m.manifest_hash,i.wallet,i.vault,i.share_mint,i.configuration_hash,i.state,i.deposit_plan,i.redemption_plan FROM c3_open.owner_requests r JOIN c3_open.owner_submissions s USING(request_id) JOIN c3_open.owner_economic_manifests m USING(request_id) JOIN c3_open.intents i USING(intent_id) WHERE r.request_id=$1`,
      [requestId],
    )
  ).rows[0];
  check(
    r &&
      r.wallet === policy.wallet &&
      r.vault === policy.vault &&
      r.configuration_hash === policy.configurationHash,
    "POLICY_BINDING",
  );
  const manifest = r.manifest as OwnerEffectManifest;
  check(
    digest(canonicalize(manifest)) === r.manifest_hash.toString("hex") &&
      manifest.messageHash === r.message_hash.toString("hex") &&
      manifest.wallet === r.wallet,
    "IMMUTABLE_MANIFEST",
  );
  const selling = r.action === "request_redemption" || r.action === "claim";
  const nonce = Buffer.alloc(8);
  nonce.writeBigUInt64LE(1n);
  const onchainIntent = findProgramAddress(
    [
      Buffer.from(selling ? "redemption" : "deposit"),
      publicKeyBytes(policy.vault),
      publicKeyBytes(policy.wallet),
      nonce,
    ],
    policy.programId,
  ).address;
  const plan = findProgramAddress(
    [Buffer.from("c3-plan-v1"), publicKeyBytes(onchainIntent)],
    policy.programId,
  ).address;
  check(
    manifest.action === r.action &&
      manifest.program === policy.programId &&
      manifest.vault === policy.vault &&
      manifest.shareMint === r.share_mint &&
      manifest.onchainIntent === onchainIntent &&
      manifest.plan === plan &&
      (!selling
        ? plan === r.deposit_plan
        : r.action === "request_redemption" || plan === r.redemption_plan),
    "TRUSTED_SCOPE",
  );
  check(
    manifest.planRevision ===
      (r.action === "request_redemption" ? "0" : r.expected_chain_revision),
    "CHAIN_REVISION",
  );
  const collected = await collectFinalizedOpenEconomicEvidence(
    policy.providers,
    r.signature,
    manifest.snapshots.map((v) => v.address),
    1,
    fetcher,
  );
  const wire = (await readIndependentOpenEvidence(
    policy.providers,
    "getTransaction",
    [
      r.signature,
      {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
        encoding: "base64",
      },
    ],
    fetcher,
  )) as { primary: unknown; secondary: unknown };
  const proof = verifyOwnerEconomicEffects(
    manifest,
    r.signature,
    wire.primary,
    collected.transaction.primary,
    collected.snapshots.primary,
  );
  verifyOwnerEconomicEffects(
    manifest,
    r.signature,
    wire.secondary,
    collected.transaction.secondary,
    collected.snapshots.secondary,
  );
  const next = {
    deposit: ["draft", "funded"],
    issue_shares: ["buying", "active"],
    request_redemption: ["active", "redemption_requested"],
    claim: ["claimable", "redeemed"],
  }[r.action as "deposit" | "issue_shares" | "request_redemption" | "claim"];
  check(next, "ACTION");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const current = (
      await c.query(
        "SELECT * FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
        [r.intent_id],
      )
    ).rows[0];
    const existing = (
      await c.query(
        "SELECT evidence_hash FROM c3_open.owner_effect_receipts WHERE request_id=$1",
        [requestId],
      )
    ).rows[0];
    if (existing) {
      await c.query("COMMIT");
      return { status: "already_reconciled" as const };
    }
    check(
      current.db_revision === r.expected_db_revision &&
        current.chain_revision === r.expected_chain_revision &&
        current.state === next![0],
      "CAS",
    );
    if (r.action === "issue_shares")
      check(
        (
          await c.query(
            "SELECT 1 FROM c3_open.legs WHERE intent_id=$1 AND ordinal BETWEEN 0 AND 2 AND state='confirmed'",
            [r.intent_id],
          )
        ).rowCount === 3,
        "UNSETTLED_BUY",
      );
    if (r.action === "claim")
      check(
        (
          await c.query(
            "SELECT 1 FROM c3_open.legs WHERE intent_id=$1 AND ordinal BETWEEN 3 AND 5 AND state='confirmed'",
            [r.intent_id],
          )
        ).rowCount === 3,
        "UNSETTLED_SELL",
      );
    check(
      !(
        await c.query(
          "SELECT 1 FROM c3_open.owner_request_outcomes WHERE request_id=$1",
          [requestId],
        )
      ).rowCount,
      "CLOSED_REQUEST",
    );
    await c.query(
      "INSERT INTO c3_open.owner_message_receipts(request_id,slot,evidence_hash) VALUES($1,$2,$3) ON CONFLICT(request_id) DO NOTHING",
      [requestId, proof.slot, Buffer.from(proof.evidenceHash, "hex")],
    );
    await c.query(
      "INSERT INTO c3_open.owner_effect_receipts(request_id,lifecycle_stage,evidence_hash) VALUES($1,$2,$3)",
      [requestId, next![1], Buffer.from(proof.evidenceHash, "hex")],
    );
    await c.query(
      "UPDATE c3_open.intents SET state=$2,db_revision=db_revision+1,chain_revision=$3,redemption_plan=COALESCE(redemption_plan,$4),updated_at=clock_timestamp() WHERE intent_id=$1",
      [
        r.intent_id,
        next![1],
        manifest.planRevision,
        r.action === "request_redemption" ? manifest.plan : null,
      ],
    );
    await c.query(
      "INSERT INTO c3_open.events(event_id,intent_id,idempotency_hash,db_revision,state,evidence_hash) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        r.intent_id,
        digest("owner-effect:" + requestId),
        (BigInt(current.db_revision) + 1n).toString(),
        next![1],
        proof.evidenceHash,
      ],
    );
    await c.query("COMMIT");
    return {
      status: "economic_effects_reconciled" as const,
      evidenceHash: proof.evidenceHash,
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
