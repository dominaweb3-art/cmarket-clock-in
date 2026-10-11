/** Public, read-only evidence: never loads identities or authorizes a wallet. */
import { readFileSync } from "node:fs";
import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { evaluationRpc } from "../src/evaluation-rpc.ts";
import { EVALUATION, evaluationPdas } from "../src/evaluation-scope.ts";
import { EvaluationClient } from "../src/evaluation-client.ts";
import {
  evaluationPosition,
  type EvaluationAccounts,
} from "../src/evaluation-state.ts";
import { marketReference } from "../src/evaluation-market-reference.ts";
const wallet = process.argv[2];
if (!wallet)
  throw Error(
    "Usage: node --experimental-strip-types scripts/evaluation-market-reference-probe.ts PUBLIC_WALLET",
  );
new PublicKey(wallet);
const rpc = evaluationRpc();
if ((await rpc.getGenesisHash()) !== EVALUATION.genesis)
  throw Error("WRONG_NETWORK");
const idl = JSON.parse(
  readFileSync(
    new URL("../resources/c3_devnet_evaluation_vault.json", import.meta.url),
    "utf8",
  ),
) as Idl;
const { vault } = evaluationPdas(wallet);
const raw = await rpc.getAccountInfo(vault, "finalized");
if (!raw || raw.owner.toBase58() !== EVALUATION.program)
  throw Error("VERIFIED_VAULT_REQUIRED");
const decoded = new BorshAccountsCoder(idl).decode(
  "VaultConfig",
  raw.data,
) as Record<string, unknown>;
const client = new EvaluationClient(idl, {
  wallet,
  version: BigInt(String(decoded.config_version)),
  shareMint: String(decoded.share_mint),
  usdcMint: String(decoded.usdc_mint),
  btcMint: String(decoded.btc_mint),
  ethMint: String(decoded.eth_mint),
  solMint: String(decoded.wsol_mint),
});
const named = client.accounts(client.intent("deposit"));
const addresses = [
  vault,
  new PublicKey(client.config.shareMint),
  named.owner_shares!,
  named.owner_usdc!,
  named.vault_usdc!,
  named.vault_btc!,
  named.vault_eth!,
  named.vault_wsol!,
  client.intent("deposit"),
  client.intent("redemption"),
];
const snapshot = await rpc.getMultipleAccountsInfoAndContext(addresses, {
  commitment: "finalized",
});
const accounts: EvaluationAccounts = new Map(
  addresses.map((address, i) => {
    const r = snapshot.value[i];
    return [
      address.toBase58(),
      r
        ? {
            owner: r.owner.toBase58(),
            executable: r.executable,
            lamports: r.lamports,
            data: [r.data.toString("base64"), "base64"],
          }
        : null,
    ];
  }),
);
const p = evaluationPosition(client, accounts);
const result = await marketReference({
  deposited: p.deposited,
  sharesIssued: p.sharesIssued,
  shares: p.shares,
  depositTime: p.depositTime,
  saleTime: p.saleTime,
  lifecycle: p.lifecycle,
});
console.log(
  JSON.stringify(
    {
      cluster: EVALUATION.cluster,
      finalizedSlot: snapshot.context.slot,
      vault: vault.toBase58(),
      currentShares: p.shares.toString(),
      testUsdcReturned: p.returned.toString(),
      reference: result,
    },
    null,
    2,
  ),
);
if (result.status !== "available") process.exitCode = 1;
