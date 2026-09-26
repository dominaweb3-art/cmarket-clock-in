/** Disabled production interface. Reads durable intent metadata; chain-derived values remain unknown. */
import { C3_MAINNET_EXECUTION_CAPABILITY } from "./constants.ts";
import {
  C3_PILOT,
  C3_PILOT_DISABLED,
  inspectC3PilotConfiguration,
  type C3PilotPublicConfiguration,
} from "./pilot-config.ts";
import { DisabledPilotRepository, type PilotIntent } from "./pilot-postgres.ts";

const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export type PilotVaultSummary = Readonly<{
  targetBps: typeof C3_PILOT.targetBps;
  currentBps: null;
  navUsdcBaseUnits: null;
  shareSupplyBaseUnits: null;
  evidence: "unavailable";
  readiness: readonly string[];
}>;
export type PilotPosition = Readonly<{
  wallet: string;
  shareBalanceBaseUnits: null;
  estimatedValueUsdcBaseUnits: null;
  evidence: "unavailable";
  activity: readonly PilotIntent[];
}>;
export type PilotQuote = Readonly<{
  inputBaseUnits: bigint;
  outputBaseUnits: null;
  minimumOutputBaseUnits: null;
  networkCostBaseUnits: null;
  evidence: "unavailable";
  executable: false;
}>;

export interface C3OwnerPilotService {
  getVaultSummary(): Promise<PilotVaultSummary>;
  getUserC3Position(wallet: string): Promise<PilotPosition>;
  quoteDepositUsdc(amount: bigint): Promise<PilotQuote>;
  buildDepositIntent(wallet: string, amount: bigint): Promise<never>;
  recordWalletApproval(
    intentId: string,
    authorization: unknown,
  ): Promise<never>;
  recordSubmission(intentId: string, signature: string): Promise<never>;
  getIntentStatus(intentId: string): Promise<PilotIntent | null>;
  quoteRedeemToUsdc(shares: bigint): Promise<PilotQuote>;
  buildRedeemToUsdcIntent(wallet: string, shares: bigint): Promise<never>;
  getClaimStatus(intentId: string): Promise<PilotIntent | null>;
  reconcileIntent(intentId: string): Promise<never>;
  getActivity(wallet: string): Promise<readonly PilotIntent[]>;
}

/** No authorization bytes, signatures or private data are ever persisted by this API. */
export class DisabledC3OwnerPilotService implements C3OwnerPilotService {
  private readonly repository: DisabledPilotRepository;
  private readonly config: C3PilotPublicConfiguration;
  constructor(
    repository: DisabledPilotRepository,
    config: C3PilotPublicConfiguration,
  ) {
    this.repository = repository;
    this.config = config;
    if (C3_MAINNET_EXECUTION_CAPABILITY !== false)
      throw new Error("C3_MAINNET_CAPABILITY_INVALID");
  }

  async getVaultSummary(): Promise<PilotVaultSummary> {
    return Object.freeze({
      targetBps: C3_PILOT.targetBps,
      currentBps: null,
      navUsdcBaseUnits: null,
      shareSupplyBaseUnits: null,
      evidence: "unavailable",
      readiness: inspectC3PilotConfiguration(this.config),
    });
  }

  async getUserC3Position(wallet: string): Promise<PilotPosition> {
    if (!KEY.test(wallet)) throw new Error("C3_PILOT_INVALID_WALLET");
    return Object.freeze({
      wallet,
      shareBalanceBaseUnits: null,
      estimatedValueUsdcBaseUnits: null,
      evidence: "unavailable",
      activity: await this.repository.listActivity(wallet),
    });
  }

  async quoteDepositUsdc(amount: bigint): Promise<PilotQuote> {
    if (amount !== C3_PILOT.amountUsdcBaseUnits)
      throw new Error("C3_PILOT_EXACTLY_ONE_USDC_REQUIRED");
    return Object.freeze({
      inputBaseUnits: amount,
      outputBaseUnits: null,
      minimumOutputBaseUnits: null,
      networkCostBaseUnits: null,
      evidence: "unavailable",
      executable: false,
    });
  }

  buildDepositIntent(_wallet: string, _amount: bigint): Promise<never> {
    return Promise.reject(new Error(C3_PILOT_DISABLED));
  }
  recordWalletApproval(
    _intentId: string,
    _authorization: unknown,
  ): Promise<never> {
    return Promise.reject(new Error(C3_PILOT_DISABLED));
  }
  recordSubmission(_intentId: string, _signature: string): Promise<never> {
    return Promise.reject(new Error(C3_PILOT_DISABLED));
  }
  getIntentStatus(intentId: string): Promise<PilotIntent | null> {
    return this.repository.readIntent(intentId);
  }
  async quoteRedeemToUsdc(shares: bigint): Promise<PilotQuote> {
    if (shares <= 0n) throw new Error("C3_PILOT_INVALID_SHARE_AMOUNT");
    return Object.freeze({
      inputBaseUnits: shares,
      outputBaseUnits: null,
      minimumOutputBaseUnits: null,
      networkCostBaseUnits: null,
      evidence: "unavailable",
      executable: false,
    });
  }
  buildRedeemToUsdcIntent(_wallet: string, _shares: bigint): Promise<never> {
    return Promise.reject(new Error(C3_PILOT_DISABLED));
  }
  getClaimStatus(intentId: string): Promise<PilotIntent | null> {
    return this.repository.readIntent(intentId);
  }
  reconcileIntent(_intentId: string): Promise<never> {
    return Promise.reject(
      new Error("C3_PILOT_INDEPENDENT_RECONCILER_NOT_APPROVED"),
    );
  }
  getActivity(wallet: string): Promise<readonly PilotIntent[]> {
    return this.repository.listActivity(wallet);
  }
}
