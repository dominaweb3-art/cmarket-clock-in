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
import { assertProductionEnrollment } from "./open-owner-trust.ts";
import {
  accountBytes,
  openAddresses,
  verifyOpenConfig,
  verifyOpenShareMint,
  verifyOpenToken,
  verifyOpenPlan,
  verifyOpenIntent,
  type OpenSemanticScope,
  type OpenAccount,
} from "./open-state-semantics.ts";
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
  version: "c3-owner-effects/v1" | "c3-owner-effects/v2";
  semanticScope?: OpenSemanticScope;
  baseline?: Readonly<Record<string, OpenAccount | null>>;
  initialization?: Readonly<{ account: string; space: number; rent: string }>;
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
/** V2 proves plan progress, acquired inventory, reserves and mint policy rather
 * than accepting a predicted post-state hash as economic certification. */
export function verifyOwnerSemanticState(
  m: OwnerEffectManifest,
  values: unknown[],
) {
  check(
    m.version === "c3-owner-effects/v2" && m.semanticScope && m.baseline,
    "SEMANTIC_CONTEXT",
  );
  const scope = m.semanticScope!;
  check(
    scope.program === m.program &&
      scope.vault === m.vault &&
      scope.wallet === m.wallet &&
      scope.shareMint === m.shareMint,
    "SEMANTIC_SCOPE",
  );
  const post = new Map(
      m.snapshots.map((s, i) => [s.address, values[i] as OpenAccount]),
    ),
    a = openAddresses(scope);
  const cfg = verifyOpenConfig(scope, post.get(m.vault)!),
    mint = verifyOpenShareMint(scope, post.get(m.shareMint)!);
  const reserves = a.vaultTokens.map((addr, i) =>
    verifyOpenToken(
      post.get(addr)!,
      a.authority,
      [
        C3_MAINNET.usdcMint,
        C3_MAINNET.cbBtcMint,
        C3_MAINNET.portalEthMint,
        C3_MAINNET.wrappedSolMint,
      ][i]!,
    ),
  );
  check(
    mint.supply === cfg.sharesIssued ||
      (m.action === "claim" &&
        mint.supply === 0n &&
        cfg.sharesIssued === 1000000n),
    "MINT_SUPPLY",
  );
  const cfgBefore = accountBytes(
      m.baseline![m.vault],
      m.program,
      546,
      "VaultConfig",
    ),
    cfgAfter = cfg.bytes;
  // Only lifecycle/counters/issued supply may change for these exact owner actions.
  const allowed =
    m.action === "deposit"
      ? [
          [456, 464],
          [480, 481],
        ]
      : m.action === "issue_shares"
        ? [[472, 481]]
        : m.action === "request_redemption"
          ? [
              [464, 472],
              [480, 481],
            ]
          : [[480, 481]];
  for (let i = 0; i < cfgBefore.length; i++)
    check(
      allowed.some(([start, end]) => i >= start! && i < end!) ||
        cfgBefore[i] === cfgAfter[i],
      "CONFIG_MUTATION",
    );
  const intent = verifyOpenIntent(
    scope,
    post.get(m.onchainIntent)!,
    m.action === "claim" || m.action === "request_redemption",
    [
      { deposit: 2, issue_shares: 5, request_redemption: 2, claim: 6 }[
        m.action
      ],
    ],
  );
  if (m.action === "issue_shares" || m.action === "claim") {
    const prior = verifyOpenIntent(
      scope,
      m.baseline![m.onchainIntent]!,
      m.action === "claim",
      [m.action === "claim" ? 4 : 3],
    );
    const changes =
      m.action === "claim"
        ? [
            [113, 114],
            [162, 170],
          ]
        : [
            [113, 114],
            [186, 194],
          ];
    for (let i = 0; i < intent.length; i++)
      check(
        changes.some(([s, e]) => i >= s! && i < e!) || intent[i] === prior[i],
        "INTENT_MUTATION",
      );
  }
  if (m.action === "request_redemption") {
    const deposit = verifyOpenIntent(scope, post.get(a.deposit)!, false, [5]),
      before = accountBytes(
        m.baseline![a.deposit],
        m.program,
        288,
        "DepositIntent",
      );
    check(
      deposit.equals(before) &&
        [122, 130, 138].every(
          (o, i) =>
            intent.readBigUInt64LE(o) ===
              deposit.readBigUInt64LE(162 + i * 8) &&
            reserves[i + 1]! >= intent.readBigUInt64LE(o),
        ) &&
        intent.readBigUInt64LE(146) ===
          verifyOpenToken(
            m.baseline![a.vaultTokens[0]!]!,
            a.authority,
            C3_MAINNET.usdcMint,
          ),
      "REDEMPTION_INVENTORY",
    );
  }
  if (m.action === "issue_shares" || m.action === "claim") {
    const plan = verifyOpenPlan(
        scope,
        m.plan,
        post.get(m.plan)!,
        m.planRevision,
      ),
      before = accountBytes(
        m.baseline![m.plan],
        m.program,
        901,
        "SettlementPlan",
      );
    check(
      before.equals(plan.bytes) &&
        plan.bitmap === 7 &&
        plan.activeAuthorization.every((v) => v === 0) &&
        intent
          .subarray(
            m.action === "claim" ? 170 : 224,
            m.action === "claim" ? 202 : 256,
          )
          .equals(plan.bytes.subarray(724, 756)),
      "PLAN_MUTATION_OR_INCOMPLETE",
    );
    if (m.action === "issue_shares") {
      const intent = accountBytes(
        post.get(m.onchainIntent),
        m.program,
        288,
        "DepositIntent",
      );
      check(
        plan.direction === 1 &&
          mint.supply === 1000000n &&
          plan.outputs.every(
            (v, i) =>
              v === intent.readBigUInt64LE(162 + i * 8) &&
              reserves[i + 1]! >= v,
          ),
        "BACKED_BUY_INVENTORY",
      );
    } else {
      const intent = accountBytes(
          post.get(m.onchainIntent),
          m.program,
          234,
          "RedemptionIntent",
        ),
        prior = accountBytes(
          m.baseline![m.onchainIntent],
          m.program,
          234,
          "RedemptionIntent",
        );
      const returned = plan.outputs.reduce((sum, v) => sum + v, 0n);
      check(
        returned < 1n << 64n &&
          plan.direction === 2 &&
          plan.budgets.every(
            (v, i) => v === intent.readBigUInt64LE(122 + i * 8),
          ) &&
          returned === intent.readBigUInt64LE(154) &&
          returned === intent.readBigUInt64LE(162) &&
          prior.readBigUInt64LE(162) === 0n &&
          mint.supply === 0n &&
          verifyOpenToken(
            post.get(a.ownerShares)!,
            scope.wallet,
            scope.shareMint,
            "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
          ) === 0n,
        "BACKED_REDEMPTION",
      );
      const baselineReserve = verifyOpenToken(
        m.baseline![a.vaultTokens[0]!]!,
        a.authority,
        C3_MAINNET.usdcMint,
      );
      check(
        baselineReserve >= returned &&
          reserves[0] === baselineReserve - returned,
        "RESERVES",
      );
    }
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
    ["c3-owner-effects/v1", "c3-owner-effects/v2"].includes(manifest.version) &&
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
  let expectedInner = manifest.inner,
    expectedLamports = manifest.lamports;
  if (manifest.initialization) {
    const init = manifest.initialization;
    check(
      manifest.version === "c3-owner-effects/v2" &&
        ["deposit", "request_redemption"].includes(manifest.action) &&
        init.account === manifest.onchainIntent &&
        init.space === (manifest.action === "deposit" ? 288 : 234),
      "INITIALIZATION_SCOPE",
    );
    const before = manifest.baseline?.[init.account];
    check(
      !before ||
        (before.owner === C3_MAINNET.systemProgram &&
          !before.executable &&
          before.data[0] === "" &&
          before.data[1] === "base64"),
      "INITIALIZATION_BASELINE",
    );
    const index = addresses.indexOf(init.account);
    const preBalances = meta.preBalances as unknown[];
    check(
      index >= 0 &&
        Array.isArray(preBalances) &&
        preBalances.length === addresses.length &&
        Number.isSafeInteger(preBalances[index]) &&
        Number(preBalances[index]) >= 0 &&
        Number.isSafeInteger(meta.fee) &&
        Number(meta.fee) > 0 &&
        Number(meta.fee) <= 100000,
      "INITIALIZATION_BALANCE",
    );
    const prefund = BigInt(Number(preBalances[index])),
      rent = uint(init.rent),
      funding = rent > prefund ? rent - prefund : 0n;
    const ix = (accounts: string[], data: Buffer) => ({
      program: C3_MAINNET.systemProgram,
      accounts,
      dataHash: digest(data),
    });
    const setup: ReturnType<typeof ix>[] = [];
    if (prefund === 0n) {
      const b = Buffer.alloc(52);
      b.writeBigUInt64LE(rent, 4);
      b.writeBigUInt64LE(BigInt(init.space), 12);
      Buffer.from(publicKeyBytes(manifest.program)).copy(b, 20);
      setup.push(ix([manifest.wallet, init.account], b));
    } else {
      if (funding > 0n) {
        const b = Buffer.alloc(12);
        b.writeUInt32LE(2);
        b.writeBigUInt64LE(funding, 4);
        setup.push(ix([manifest.wallet, init.account], b));
      }
      const b = Buffer.alloc(12);
      b.writeUInt32LE(8);
      b.writeBigUInt64LE(BigInt(init.space), 4);
      setup.push(ix([init.account], b));
      const assign = Buffer.alloc(36);
      assign.writeUInt32LE(1);
      Buffer.from(publicKeyBytes(manifest.program)).copy(assign, 4);
      setup.push(ix([init.account], assign));
    }
    expectedInner = manifest.inner.map((g) =>
      g.index === 0 ? { index: 0, instructions: setup } : g,
    );
    expectedLamports = [
      {
        account: manifest.wallet,
        minimum: (-funding - BigInt(Number(meta.fee))).toString(),
        maximum: (-funding - BigInt(Number(meta.fee))).toString(),
      },
      {
        account: init.account,
        minimum: funding.toString(),
        maximum: funding.toString(),
      },
    ];
  }
  check(
    new Set(inner.map((v) => v.index)).size === inner.length &&
      canonicalize(inner) === canonicalize(expectedInner),
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
      new Set(expectedLamports.map((v) => v.account)).size ===
        expectedLamports.length,
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
      expected = expectedLamports.find((v) => v.account === address);
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
    expectedLamports.every((v) => addresses.includes(v.account)),
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
        (manifest.version === "c3-owner-effects/v2" ||
          digest(bytes) === expected.dataHash),
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
  if (manifest.version === "c3-owner-effects/v2")
    verifyOwnerSemanticState(manifest, snapshot.value as unknown[]);
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
  await assertProductionEnrollment(pool, policy, requestId, "request");
  const r = (
    await pool.query(
      `SELECT r.*,s.signature,m.manifest,m.manifest_hash,a.manifest AS authorization_manifest,a.manifest_hash AS authorization_hash,a.pre_accounts,i.wallet,i.vault,i.share_mint,i.configuration_hash,i.state,i.deposit_plan,i.redemption_plan FROM c3_open.owner_requests r JOIN c3_open.owner_submissions s USING(request_id) JOIN c3_open.owner_economic_manifests m USING(request_id) JOIN c3_open.owner_authorization_manifests a USING(request_id) JOIN c3_open.intents i USING(intent_id) WHERE r.request_id=$1`,
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
    digest(canonicalize(r.authorization_manifest)) ===
      r.authorization_hash.toString("hex") &&
      r.authorization_manifest.messageHash === r.message_hash.toString("hex") &&
      r.authorization_manifest.intentId === r.intent_id &&
      r.authorization_manifest.action === r.action &&
      canonicalize(r.pre_accounts) === canonicalize(manifest.baseline),
    "AUTHORIZATION_BINDING",
  );
  check(
    manifest.version === "c3-owner-effects/v2" &&
      manifest.semanticScope?.governance === policy.governance &&
      manifest.semanticScope?.keeper === policy.keeper &&
      manifest.semanticScope?.maxSlippageBps === policy.maxSlippageBps,
    "PRODUCTION_SEMANTICS_REQUIRED",
  );
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
  const prior = (
    await pool.query(
      "SELECT evidence_hash FROM c3_open.owner_effect_receipts WHERE request_id=$1",
      [requestId],
    )
  ).rows[0];
  if (prior)
    return {
      status: "already_reconciled" as const,
      evidenceHash: prior.evidence_hash.toString("hex"),
    };
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
