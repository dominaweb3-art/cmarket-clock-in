/** Server-only deterministic TEST liquidity envelope. Never describes a
 * Jupiter quote or real asset price. Budgets come from decoded on-chain plans. */
import { createHash } from "node:crypto";
import { PublicKey, type AccountMeta } from "@solana/web3.js";
import {
  EvaluationClient,
  evaluationAta,
  EVAL_TOKEN,
} from "./evaluation-client.ts";
import { EVALUATION } from "./evaluation-scope.ts";
import {
  encodeQuoteSealV1,
  quoteContextHash,
  quoteIdForNonce,
  deriveQuoteMinimum,
  type QuoteSealV1,
} from "./quote-seal.ts";
const digest = (...bytes: Uint8Array[]) =>
  createHash("sha256").update(Buffer.concat(bytes)).digest();
const u64 = (n: bigint) => {
  if (n < 0n || n > (1n << 64n) - 1n) throw Error("EVAL_ROUTE_U64");
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const check = (v: unknown): void => {
  if (!v) throw Error("EVAL_ROUTE_CONTEXT_REJECTED");
};
export type EvaluationPlanContext = Readonly<{
  plan: string;
  intent: string;
  direction: 1 | 2;
  leg: number;
  revision: bigint;
  registryRevision: bigint;
  registryHash: Uint8Array;
  policyRevision: bigint;
  inputBudget: bigint;
  minimumOutput: bigint;
  created: bigint;
  expires: bigint;
  slot: bigint;
  registryExpiresSlot: bigint;
}>;
export function evaluationTestRoute(
  client: EvaluationClient,
  context: EvaluationPlanContext,
  nonce: Uint8Array,
) {
  const { direction, leg } = context;
  check(
    Number.isInteger(leg) &&
      leg >= 0 &&
      leg <= 2 &&
      (direction === 1 || direction === 2),
  );
  check(
    context.registryRevision > 0n &&
      context.policyRevision > 0n &&
      context.registryHash.length === 32 &&
      context.registryHash.some((b) => b !== 0),
  );
  check(
    context.revision >= 0n &&
      context.created > 0n &&
      context.expires > context.created &&
      context.expires - context.created <= 120n &&
      context.registryExpiresSlot > context.slot,
  );
  const intent = client.intent(direction === 1 ? "deposit" : "redemption");
  const plan = client.pda("c3-plan-v1", intent);
  check(
    context.intent === intent.toBase58() && context.plan === plan.toBase58(),
  );
  const names = client.accounts(intent);
  const assets = [
    client.config.btcMint,
    client.config.ethMint,
    client.config.solMint,
  ];
  const vaultAssets = [names.vault_btc!, names.vault_eth!, names.vault_wsol!];
  const inputMint = new PublicKey(
    direction === 1 ? client.config.usdcMint : assets[leg]!,
  );
  const outputMint = new PublicKey(
    direction === 1 ? assets[leg]! : client.config.usdcMint,
  );
  const source = direction === 1 ? names.vault_usdc! : vaultAssets[leg]!;
  const destination = direction === 1 ? vaultAssets[leg]! : names.vault_usdc!;
  const input = context.inputBudget;
  check(input > 0n);
  if (direction === 1)
    check(
      input === (EVALUATION.amount * BigInt(EVALUATION.weights[leg]!)) / 10000n,
    );
  // Sale uses ONLY the plan's acquired-asset budget, never total ATA balance.
  const output = direction === 1 ? input / 10n : (input * 99n) / 10n;
  check(output > 0n && output <= (1n << 64n) - 1n);
  const quoted = (output * 10000n + 9899n) / 9900n;
  const minimum = deriveQuoteMinimum(
    quoted,
    100,
    output,
    context.minimumOutput,
  );
  check(minimum <= output); // simulated router must really deliver the signed floor
  const router = new PublicKey(EVALUATION.router);
  const pool = PublicKey.findProgramAddressSync(
    [Buffer.from("liquidity")],
    router,
  )[0];
  const keys: AccountMeta[] = [
    { pubkey: client.authority, isSigner: true, isWritable: false },
    ...[
      source,
      destination,
      evaluationAta(inputMint, pool),
      evaluationAta(outputMint, pool),
    ].map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    ...[pool, inputMint, outputMint, EVAL_TOKEN].map((pubkey) => ({
      pubkey,
      isSigner: false,
      isWritable: false,
    })),
  ];
  const data = Buffer.alloc(25);
  digest(Buffer.from("global:swap")).copy(data, 0, 0, 8);
  u64(input).copy(data, 8);
  u64(output).copy(data, 16);
  const count = Buffer.alloc(2);
  count.writeUInt16LE(keys.length);
  const metas = Buffer.concat([
    count,
    ...keys.map((key, index) => {
      const i = Buffer.alloc(2);
      i.writeUInt16LE(index);
      return Buffer.concat([
        i,
        key.pubkey.toBuffer(),
        Buffer.from([
          Number(key.isSigner) | (Number(key.isWritable) << 1),
          Number(key.isWritable),
          Number(key.pubkey.equals(EVAL_TOKEN)),
        ]),
      ]);
    }),
  ]);
  const registry = client.pda("c3-route-reg-v1", client.vault);
  const policy = client.pda("c3-quote-policy-v1", client.vault);
  const routeHash = digest(Buffer.from("c3-evaluation-test-route-v1"), data);
  const seal: QuoteSealV1 = {
    contextHash: quoteContextHash({
      genesisHash: new PublicKey(EVALUATION.genesis).toBytes(),
      vault: client.vault.toBase58(),
      configVersion: 1n,
      registry: registry.toBase58(),
      registryRevision: context.registryRevision,
      registryHash: context.registryHash,
      plan: plan.toBase58(),
      planRevision: context.revision,
      intent: intent.toBase58(),
      wallet: client.owner.toBase58(),
      leg,
      direction,
      inputMint: inputMint.toBase58(),
      outputMint: outputMint.toBase58(),
      source: source.toBase58(),
      destination: destination.toBase58(),
      routerProgram: router.toBase58(),
      policyRevision: context.policyRevision,
    }),
    quoteId: quoteIdForNonce(nonce),
    nonce: Buffer.from(nonce),
    inputAmount: input,
    quotedOutput: quoted,
    slippageBps: 100,
    minimumOutput: minimum,
    routeHash,
    instructionHash: digest(Buffer.from("c3-router-data-v1"), data),
    accountMetasHash: digest(
      Buffer.from("c3-ordered-metas-v3"),
      u64(context.registryRevision),
      context.registryHash,
      metas,
    ),
    altCount: 0,
    altContentsHash: Buffer.alloc(32),
    builderTimestamp: context.created,
    builderSlot: context.slot,
    expiresAt:
      context.expires < context.created + 30n
        ? context.expires
        : context.created + 30n,
    expiresSlot:
      // Slots are not seconds. Finalized authorization followed by execution
      // observed 64 slots in only 16 seconds on Devnet. Keep an independent
      // finite slot ceiling; the unchanged 30-second on-chain policy remains
      // authoritative even if slots advance more slowly or rapidly.
      context.registryExpiresSlot < context.slot + 128n
        ? context.registryExpiresSlot
        : context.slot + 128n,
  };
  const payload = encodeQuoteSealV1(seal);
  check(payload.length === 300);
  const idempotency = digest(
    Buffer.from("c3-evaluation-leg-v1"),
    plan.toBuffer(),
    u64(context.revision),
    Buffer.from([leg]),
  );
  const authorization = PublicKey.findProgramAddressSync(
    [Buffer.from("c3-swap-auth-v1"), plan.toBuffer(), idempotency],
    client.program,
  )[0];
  const quoteReceipt = PublicKey.findProgramAddressSync(
    [Buffer.from("c3-quote-receipt-v1"), Buffer.from(seal.quoteId)],
    client.program,
  )[0];
  return {
    seal,
    payload,
    data,
    keys,
    input,
    output,
    plan,
    intent,
    registry,
    policy,
    source,
    destination,
    router,
    authorization,
    quoteReceipt,
    idempotency,
    flags: Buffer.from(
      keys.map((k) => Number(k.isSigner) | (Number(k.isWritable) << 1)),
    ),
  };
}
