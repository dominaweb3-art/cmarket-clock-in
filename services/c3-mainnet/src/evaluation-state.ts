/** Finalized Devnet account semantics. Pricing is explicitly simulated and
 * cannot change verified ownership or authorize any debit. */
import { PublicKey } from "@solana/web3.js";
import {
  accountBytes,
  verifyOpenToken,
  verifyShareMintForAuthority,
  type OpenAccount,
} from "./open-state-semantics.ts";
import {
  EVALUATION,
  evaluationAmount,
  evaluationSeed,
} from "./evaluation-scope.ts";
import {
  EvaluationClient,
  EVAL_SHARES,
  EVAL_TOKEN,
  type EvaluationConfig,
  type EvaluationOwnerAction,
} from "./evaluation-client.ts";

const check = (v: unknown, code: string): void => {
  if (!v) throw Error("EVAL_STATE_" + code);
};
const key = (b: Buffer, offset: number) =>
  new PublicKey(b.subarray(offset, offset + 32)).toBase58();
export function verifyEvaluationConfig(
  client: EvaluationClient,
  raw: OpenAccount,
) {
  const b = accountBytes(raw, EVALUATION.program, 546, "VaultConfig"),
    c = client.config;
  const seed = evaluationSeed(
    "c3-authority-v1",
    client.config.wallet,
    client.config.version,
  );
  const bump = PublicKey.findProgramAddressSync([seed], client.program)[1];
  check(
    b[8] === 1 &&
      b.readBigUInt64LE(9) === c.version &&
      key(b, 17) === EVALUATION.governance &&
      key(b, 49) === EVALUATION.governance &&
      key(b, 81) === EVALUATION.keeper &&
      key(b, 113) === c.wallet,
    "ROLES",
  );
  const accounts = client.accounts(client.intent("deposit"));
  [c.usdcMint, c.btcMint, c.ethMint, c.solMint, c.shareMint].forEach(
    (mint, i) => check(key(b, 146 + 32 * i) === mint, "MINTS"),
  );
  ["vault_usdc", "vault_btc", "vault_eth", "vault_wsol"].forEach((name, i) =>
    check(key(b, 306 + i * 32) === accounts[name]!.toBase58(), "ATAS"),
  );
  check(
    [4000, 3000, 3000].every(
      (weight, i) => b.readUInt16LE(434 + i * 2) === weight,
    ) &&
      (c.version === 1n
        ? [EVALUATION.amount, EVALUATION.maximumAmount].some(
            (limit) => limit === b.readBigUInt64LE(440),
          )
        : [200_000_000n, EVALUATION.maximumAmount].includes(
            b.readBigUInt64LE(440),
          )) &&
      b.readBigUInt64LE(448) === b.readBigUInt64LE(440) &&
      b.readBigUInt64LE(456) <= 1n &&
      b.readBigUInt64LE(464) <= 1n &&
      b.readBigUInt64LE(472) <= b.readBigUInt64LE(440) &&
      b[480]! <= 4 &&
      b[481] === bump &&
      [0, 1].includes(b[145]!) &&
      b.subarray(482).every((n) => n === 0),
    "LIMITS",
  );
  return {
    paused: b[145] === 1,
    lifecycle: b[480]!,
    deposits: b.readBigUInt64LE(456),
    redemptions: b.readBigUInt64LE(464),
    issued: b.readBigUInt64LE(472),
    bytes: b,
  };
}
export type EvaluationAccounts = ReadonlyMap<string, OpenAccount | null>;
/** Historical amounts come from the finalized, owner-bound deposit account;
 * issued shares remain history after burning and are never a current balance. */
export function evaluationDepositHistory(
  decoded: Record<string, unknown>,
  issued: bigint,
) {
  const units = (value: unknown) => {
    const text = String(value);
    check(/^(0|[1-9][0-9]{0,19})$/.test(text), "DEPOSIT_HISTORY_AMOUNT");
    return BigInt(text);
  };
  const deposited = units(decoded.deposited),
    sharesIssued = units(decoded.shares_issued);
  check(
    deposited === evaluationAmount(String(deposited)) &&
      sharesIssued === issued &&
      (sharesIssued === 0n || sharesIssued === deposited),
    "DEPOSIT_HISTORY_BINDING",
  );
  return { deposited, sharesIssued };
}
/** Snapshot only; never treated as transaction-effect confirmation by itself. */
export function evaluationPosition(
  client: EvaluationClient,
  accounts: EvaluationAccounts,
) {
  const required = (address: string) => {
    const a = accounts.get(address);
    check(a, "MISSING_ACCOUNT");
    return a!;
  };
  const config = verifyEvaluationConfig(
    client,
    required(client.vault.toBase58()),
  );
  const share = verifyShareMintForAuthority(
    client.authority.toBase58(),
    required(client.config.shareMint),
    client.amount,
  );
  const named = client.accounts(client.intent("deposit"));
  const shares = verifyOpenToken(
    required(named.owner_shares!.toBase58()),
    client.config.wallet,
    client.config.shareMint,
    EVAL_SHARES.toBase58(),
  );
  check(
    shares === share.supply &&
      (share.supply === 0n || share.supply === client.amount),
    "SHARE_SUPPLY",
  );
  const inventory = [
    client.config.usdcMint,
    client.config.btcMint,
    client.config.ethMint,
    client.config.solMint,
  ].map((mint, i) =>
    verifyOpenToken(
      required(
        named[
          ["vault_usdc", "vault_btc", "vault_eth", "vault_wsol"][i]!
        ]!.toBase58(),
      ),
      client.authority.toBase58(),
      mint,
      EVAL_TOKEN.toBase58(),
    ),
  );
  let depositStatus: number | null = null;
  let deposited = 0n,
    sharesIssued = 0n;
  let depositTime: number | null = null,
    saleTime: number | null = null;
  const depositRaw = accounts.get(client.intent("deposit").toBase58());
  if (depositRaw) {
    const decoded = client.coder.accounts.decode(
      "DepositIntent",
      accountBytes(depositRaw, EVALUATION.program, undefined, "DepositIntent"),
    ) as Record<string, unknown>;
    check(
      (decoded.wallet as PublicKey).equals(client.owner) &&
        (decoded.vault as PublicKey).equals(client.vault) &&
        BigInt(String(decoded.amount)) === client.amount &&
        BigInt(String(decoded.config_version)) === client.config.version,
      "DEPOSIT_BINDING",
    );
    depositStatus = Number(decoded.status);
    depositTime = Number(String(decoded.created_at));
    check(Number.isSafeInteger(depositTime) && depositTime > 0, "DEPOSIT_TIME");
    ({ deposited, sharesIssued } = evaluationDepositHistory(
      decoded,
      config.issued,
    ));
  }
  let claimable = 0n,
    returned = 0n,
    redemptionStatus: number | null = null;
  const r = accounts.get(client.intent("redemption").toBase58());
  if (r) {
    const b = accountBytes(
      r,
      EVALUATION.program,
      undefined,
      "RedemptionIntent",
    );
    const decoded = client.coder.accounts.decode(
      "RedemptionIntent",
      b,
    ) as Record<string, unknown>;
    check(
      (decoded.wallet as PublicKey).equals(client.owner) &&
        (decoded.vault as PublicKey).equals(client.vault),
      "REDEMPTION_OWNER",
    );
    claimable = BigInt(String(decoded.usdc_claimable));
    returned = BigInt(String(decoded.usdc_returned));
    redemptionStatus = Number(decoded.status);
    saleTime = Number(String(decoded.created_at));
    check(
      Number.isSafeInteger(saleTime) &&
        saleTime > 0 &&
        depositTime !== null &&
        saleTime >= depositTime,
      "SALE_TIME",
    );
    check(returned === 0n || returned === claimable, "CLAIM_ACCOUNTING");
    if (config.lifecycle !== 4)
      check(inventory[0]! >= claimable, "CLAIM_BACKING");
  }
  return {
    ...config,
    shares,
    shareSupply: share.supply,
    inventory,
    depositStatus,
    deposited,
    sharesIssued,
    depositTime,
    saleTime,
    redemptionStatus,
    claimable,
    returned,
    simulatedAssets: true as const,
    cluster: EVALUATION.cluster,
  };
}
/** Public display amount, not the historical gross redemption entitlement.
 * The verified account retains usdc_claimable after a full claim. */
export function evaluationAvailableClaim(
  position: Pick<
    ReturnType<typeof evaluationPosition>,
    "claimable" | "returned"
  >,
) {
  check(
    position.claimable >= 0n &&
      position.returned >= 0n &&
      (position.returned === 0n || position.returned === position.claimable),
    "CLAIM_ACCOUNTING",
  );
  return position.claimable - position.returned;
}
export function assertEvaluationAction(
  action: EvaluationOwnerAction,
  position: Omit<
    ReturnType<typeof evaluationPosition>,
    "deposited" | "sharesIssued" | "depositTime" | "saleTime"
  >,
) {
  check(!position.paused || action === "claim", "PAUSED");
  if (action === "deposit")
    check(
      position.lifecycle === 0 &&
        position.deposits === 0n &&
        position.shareSupply === 0n,
      "ONE_LIFETIME_DEPOSIT",
    );
  else if (action === "issue_shares")
    check(
      position.lifecycle === 1 &&
        position.depositStatus === 3 &&
        position.shares === 0n &&
        position.inventory.slice(1).every((n) => n > 0n),
      "UNSETTLED",
    );
  else if (action === "request_redemption")
    check(
      position.lifecycle === 2 &&
        position.shares > 0n &&
        position.shares === position.issued &&
        position.redemptions === 0n,
      "NOT_ACTIVE",
    );
  else if (action === "claim")
    check(
      position.lifecycle === 3 &&
        position.redemptionStatus === 4 &&
        position.claimable > 0n &&
        position.returned === 0n &&
        position.shares > 0n &&
        position.shares === position.issued,
      "NOT_CLAIMABLE",
    );
  else if (action === "recover_deposit_plan")
    check(
      position.lifecycle === 1 &&
        position.depositStatus === 2 &&
        position.shares === 0n &&
        position.inventory.slice(1).every((n) => n === 0n),
      "NO_UNSWAPPED_DEPOSIT",
    );
  else if (action === "renew_plan")
    check(
      (position.lifecycle === 1 && position.depositStatus === 2) ||
        (position.lifecycle === 3 && position.redemptionStatus === 2),
      "NO_PENDING_PLAN",
    );
  else throw Error("EVAL_OWNER_ACTION");
}
/** Configuration parser accepts only names/keys from the private server DB row. */
export function evaluationConfigFromRow(
  wallet: string,
  row: Record<string, unknown>,
): EvaluationConfig {
  check(
    row.simulated_assets === true &&
      row.mainnet_enabled === false &&
      row.genesis === EVALUATION.genesis,
    "CONFIG_SCOPE",
  );
  return {
    wallet,
    version: BigInt(String(row.round ?? "1")),
    depositAmount: evaluationAmount(String(row.deposit_amount ?? "1000000")),
    usdcMint: String(row.usdc_mint),
    btcMint: String(row.btc_mint),
    ethMint: String(row.eth_mint),
    solMint: String(row.sol_mint),
    shareMint: String(row.share_mint),
  };
}
