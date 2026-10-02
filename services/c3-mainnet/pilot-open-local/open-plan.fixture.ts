/** Synthetic test state, encoded by the generated Anchor IDL, not hand-written
 * offsets copied from the verifier. Never authorizes a production operation.
 */
import { readFileSync } from "node:fs";
import { BorshCoder, BN, type Idl } from "@coral-xyz/anchor";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { VAULT_PROGRAM } from "./jupiter-vault-cpi-inspection.ts";
import type { StoredQuoteContext } from "./open-quote.ts";
const idl = JSON.parse(
  readFileSync(
    new URL(
      "../../../programs/c3-pilot-vault/target/idl/c3_pilot_vault.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Idl;
const coder = new BorshCoder(idl);
const zero = () => Array.from(Buffer.alloc(32));
export async function finalizedPlanFixture(
  context: StoredQuoteContext,
  seal: Buffer,
  debit: string,
  credit: string,
): Promise<AccountInfo<Buffer>> {
  const k = (s: string) => new PublicKey(s),
    n = (s: string | bigint | number) => new BN(String(s));
  const leg = context.leg;
  const inputs = [n(0), n(0), n(0)],
    outputs = [n(0), n(0), n(0)],
    routes = [zero(), zero(), zero()],
    minimums = [n(0), n(0), n(0)];
  inputs[leg] = n(debit);
  outputs[leg] = n(credit);
  routes[leg] = Array.from(seal.subarray(139, 171));
  minimums[leg] = n(seal.readBigUInt64LE(131));
  const [, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("c3-plan-v1"), k(context.intent).toBuffer()],
    VAULT_PROGRAM,
  );
  const data = await coder.accounts.encode("SettlementPlan", {
    schema_version: 2,
    config_version: n(context.configVersion),
    vault: k(context.vault),
    intent: k(context.intent),
    wallet: k(context.wallet),
    share_mint: k(context.vault),
    direction: context.direction,
    amount: n(1000000),
    weights: [4000, 3000, 3000],
    input_mints: [
      k(context.inputMint),
      k(context.inputMint),
      k(context.inputMint),
    ],
    output_mints: [
      k(context.outputMint),
      k(context.outputMint),
      k(context.outputMint),
    ],
    source_accounts: [k(context.source), k(context.source), k(context.source)],
    destination_accounts: [
      k(context.destination),
      k(context.destination),
      k(context.destination),
    ],
    router_program: k(context.routerProgram),
    route_hashes: routes,
    minimum_outputs: minimums,
    max_slippage_bps: context.maxSlippageBps,
    quote_created_at: n(seal.readBigInt64LE(268)),
    expires_at: n(context.planExpiresAt),
    executed_bitmap: (1 << (leg + 1)) - 1,
    lifecycle:
      leg === 2
        ? context.direction === 1
          ? 3
          : 6
        : context.direction === 1
          ? 2
          : 5,
    revision: n(BigInt(context.planRevision) + 1n),
    idempotency: zero(),
    actual_inputs: inputs,
    input_budgets: inputs,
    actual_outputs: outputs,
    failure_evidence: zero(),
    active_swap_authorization: zero(),
    active_swap_expires_at: n(0),
    bump,
  });
  return {
    data,
    owner: VAULT_PROGRAM,
    executable: false,
    lamports: 10000000,
    rentEpoch: 0,
  };
}
