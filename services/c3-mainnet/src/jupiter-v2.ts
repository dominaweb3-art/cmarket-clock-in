/** Read-only Jupiter V2 Router boundary. A parsed response is NEVER an execution authorization. */
import { createHash } from "node:crypto";
import { C3_MAINNET } from "./constants.ts";

const ORIGIN = "https://api.jup.ag";
const MAX_RESPONSE_BYTES = 256_000;
// Conservative application bound for an unsigned v0 candidate. The final
// authority decision still requires resolved ALTs and <= 1,232 serialized bytes.
// `maxAccounts` is a routing hint, not a bound on returned instruction metas.
const MAX_INSTRUCTION_META_OCCURRENCES = 256;
const TIMEOUT_MS = 12_000;
const U64_MAX = (1n << 64n) - 1n;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const FRACTION = /^(?:0|1)(?:\.[0-9]{1,30})?$/;
let keylessQueue: Promise<unknown> = Promise.resolve();
let nextKeylessStart = 0;

export type RouterInstruction = Readonly<{
  programId: string;
  accounts: readonly Readonly<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>[];
  data: string;
}>;

export type RouterBuild = Readonly<{
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn";
  slippageBps: number;
  priceImpactPct: string;
  routePlan: readonly Readonly<{
    bps: number;
    swapInfo: Readonly<{
      ammKey: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
    }>;
  }>[];
  computeBudgetInstructions: readonly RouterInstruction[];
  setupInstructions: readonly RouterInstruction[];
  swapInstruction: RouterInstruction;
  cleanupInstruction: RouterInstruction | null;
  otherInstructions: readonly RouterInstruction[];
  tipInstruction: RouterInstruction | null;
  addressesByLookupTableAddress: Readonly<Record<string, readonly string[]>>;
  blockhashWithMetadata: Readonly<{
    blockhash: readonly number[];
    lastValidBlockHeight: number;
    fetchedAtEpochMs: number;
  }>;
}>;

export type RouterRequest = Readonly<{
  inputMint: string;
  outputMint: string;
  amount: bigint;
  taker: string;
  destinationTokenAccount?: string;
  slippageBps: number;
  maxAccounts: number;
}>;

export type RouterClientOptions = Readonly<{
  apiKey?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("C3_JUPITER_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

function address(value: unknown): string {
  if (typeof value !== "string" || !ADDRESS.test(value))
    throw new Error("C3_JUPITER_INVALID_ADDRESS");
  return value;
}

function amount(value: unknown, allowZero = false): bigint {
  if (typeof value !== "string" || !DECIMAL.test(value))
    throw new Error("C3_JUPITER_INVALID_AMOUNT");
  const parsed = BigInt(value);
  if (parsed > U64_MAX || (!allowZero && parsed === 0n))
    throw new Error("C3_JUPITER_INVALID_AMOUNT");
  return parsed;
}

function instruction(value: unknown): RouterInstruction {
  const raw = record(value);
  const programId = address(raw.programId);
  if (
    !Array.isArray(raw.accounts) ||
    raw.accounts.length > MAX_INSTRUCTION_META_OCCURRENCES
  )
    throw new Error("C3_JUPITER_INVALID_ACCOUNTS");
  const accounts = raw.accounts.map((item: unknown) => {
    const meta = record(item);
    if (
      typeof meta.isSigner !== "boolean" ||
      typeof meta.isWritable !== "boolean"
    )
      throw new Error("C3_JUPITER_INVALID_ACCOUNTS");
    return Object.freeze({
      pubkey: address(meta.pubkey),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    });
  });
  if (typeof raw.data !== "string" || raw.data.length > 16_384)
    throw new Error("C3_JUPITER_INVALID_INSTRUCTION");
  const bytes = Buffer.from(raw.data, "base64");
  if (bytes.toString("base64") !== raw.data)
    throw new Error("C3_JUPITER_INVALID_INSTRUCTION");
  return Object.freeze({
    programId,
    accounts: Object.freeze(accounts),
    data: raw.data,
  });
}

function instructions(value: unknown): readonly RouterInstruction[] {
  if (!Array.isArray(value) || value.length > 12)
    throw new Error("C3_JUPITER_INVALID_INSTRUCTIONS");
  return Object.freeze(value.map(instruction));
}

export function parseRouterBuild(
  value: unknown,
  expected: RouterRequest,
): RouterBuild {
  validateRequest(expected);
  const raw = record(value);
  if (
    address(raw.inputMint) !== expected.inputMint ||
    address(raw.outputMint) !== expected.outputMint ||
    amount(raw.inAmount) !== expected.amount ||
    raw.swapMode !== "ExactIn" ||
    raw.slippageBps !== expected.slippageBps
  )
    throw new Error("C3_JUPITER_QUOTE_MISMATCH");
  const output = amount(raw.outAmount);
  const minimum = amount(raw.otherAmountThreshold);
  const impact = String(raw.priceImpactPct);
  const [impactWhole, impactFraction = ""] = impact.split(".");
  const impactParts = FRACTION.test(impact)
    ? BigInt(impactWhole!) * 10n ** 30n + BigInt(impactFraction.padEnd(30, "0"))
    : 10n ** 30n;
  if (
    minimum > output ||
    typeof raw.priceImpactPct !== "string" ||
    !FRACTION.test(raw.priceImpactPct) ||
    impactParts > 5n * 10n ** 28n ||
    minimum < (output * BigInt(10_000 - expected.slippageBps)) / 10_000n
  )
    throw new Error("C3_JUPITER_PRICE_OR_MINIMUM_BOUND");
  if (
    !Array.isArray(raw.routePlan) ||
    raw.routePlan.length < 1 ||
    raw.routePlan.length > 8
  )
    throw new Error("C3_JUPITER_INVALID_ROUTE");
  const bpsByInput = new Map<string, number>();
  const inputByMint = new Map<string, bigint>();
  const outputByMint = new Map<string, bigint>();
  const routePlan = raw.routePlan.map((item: unknown) => {
    const route = record(item);
    const swapInfo = record(route.swapInfo);
    if (!Number.isSafeInteger(route.bps) || (route.bps as number) < 1)
      throw new Error("C3_JUPITER_INVALID_ROUTE");
    const inputMint = address(swapInfo.inputMint);
    const outputMint = address(swapInfo.outputMint);
    const inAmount = amount(swapInfo.inAmount);
    const outAmount = amount(swapInfo.outAmount);
    if (inputMint === outputMint) throw new Error("C3_JUPITER_INVALID_ROUTE");
    bpsByInput.set(
      inputMint,
      (bpsByInput.get(inputMint) ?? 0) + (route.bps as number),
    );
    inputByMint.set(inputMint, (inputByMint.get(inputMint) ?? 0n) + inAmount);
    outputByMint.set(
      outputMint,
      (outputByMint.get(outputMint) ?? 0n) + outAmount,
    );
    const parsed = Object.freeze({
      bps: route.bps as number,
      swapInfo: Object.freeze({
        ammKey: address(swapInfo.ammKey),
        inputMint,
        outputMint,
        inAmount: inAmount.toString(),
        outAmount: outAmount.toString(),
      }),
    });
    return parsed;
  });
  if (
    [...bpsByInput.values()].some((bps) => bps !== 10_000) ||
    inputByMint.get(expected.inputMint) !== expected.amount ||
    outputByMint.get(expected.outputMint) !== output ||
    outputByMint.has(expected.inputMint) ||
    inputByMint.has(expected.outputMint)
  )
    throw new Error("C3_JUPITER_INVALID_ROUTE");
  for (const [mint, spent] of inputByMint) {
    if (mint !== expected.inputMint && outputByMint.get(mint) !== spent)
      throw new Error("C3_JUPITER_INVALID_ROUTE");
  }
  const swapInstruction = instruction(raw.swapInstruction);
  if (
    swapInstruction.programId !== C3_MAINNET.jupiterProgram ||
    !swapInstruction.accounts.some(
      (meta) => meta.pubkey === expected.taker && meta.isSigner,
    )
  )
    throw new Error("C3_JUPITER_SWAP_AUTHORITY_MISMATCH");
  const lookupRaw = record(raw.addressesByLookupTableAddress);
  const lookups: Record<string, readonly string[]> = Object.create(
    null,
  ) as Record<string, readonly string[]>;
  if (Object.keys(lookupRaw).length > 8)
    throw new Error("C3_JUPITER_INVALID_LOOKUPS");
  for (const [key, list] of Object.entries(lookupRaw)) {
    address(key);
    if (!Array.isArray(list) || list.length > 256)
      throw new Error("C3_JUPITER_INVALID_LOOKUPS");
    lookups[key] = Object.freeze(list.map(address));
  }
  const blockhash = record(raw.blockhashWithMetadata);
  const fetchedAt = record(blockhash.fetchedAt);
  if (
    !Array.isArray(blockhash.blockhash) ||
    blockhash.blockhash.length !== 32 ||
    !blockhash.blockhash.every(
      (byte: unknown) =>
        Number.isInteger(byte) &&
        (byte as number) >= 0 &&
        (byte as number) <= 255,
    ) ||
    !Number.isSafeInteger(blockhash.lastValidBlockHeight) ||
    !Number.isSafeInteger(fetchedAt.secs_since_epoch) ||
    !Number.isSafeInteger(fetchedAt.nanos_since_epoch) ||
    (fetchedAt.nanos_since_epoch as number) < 0 ||
    (fetchedAt.nanos_since_epoch as number) >= 1_000_000_000
  )
    throw new Error("C3_JUPITER_INVALID_BLOCKHASH");
  const fetchedAtEpochMs =
    (fetchedAt.secs_since_epoch as number) * 1_000 +
    Math.floor((fetchedAt.nanos_since_epoch as number) / 1_000_000);
  if (!Number.isSafeInteger(fetchedAtEpochMs))
    throw new Error("C3_JUPITER_INVALID_BLOCKHASH");
  if (
    Date.now() - fetchedAtEpochMs > 30_000 ||
    fetchedAtEpochMs - Date.now() > 5_000
  )
    throw new Error("C3_JUPITER_STALE_QUOTE");
  const otherInstructions = instructions(raw.otherInstructions);
  if (raw.tipInstruction != null || otherInstructions.length !== 0)
    throw new Error("C3_JUPITER_UNEXPECTED_FEE_OR_INSTRUCTION");
  return Object.freeze({
    inputMint: expected.inputMint,
    outputMint: expected.outputMint,
    inAmount: expected.amount.toString(),
    outAmount: output.toString(),
    otherAmountThreshold: minimum.toString(),
    swapMode: "ExactIn" as const,
    slippageBps: expected.slippageBps,
    priceImpactPct: raw.priceImpactPct,
    routePlan: Object.freeze(routePlan),
    computeBudgetInstructions: instructions(raw.computeBudgetInstructions),
    setupInstructions: instructions(raw.setupInstructions),
    swapInstruction,
    cleanupInstruction:
      raw.cleanupInstruction == null
        ? null
        : instruction(raw.cleanupInstruction),
    otherInstructions,
    tipInstruction: null,
    addressesByLookupTableAddress: Object.freeze(lookups),
    blockhashWithMetadata: Object.freeze({
      blockhash: Object.freeze(blockhash.blockhash as number[]),
      lastValidBlockHeight: blockhash.lastValidBlockHeight as number,
      fetchedAtEpochMs,
    }),
  });
}

function validateRequest(request: RouterRequest): void {
  address(request.inputMint);
  address(request.outputMint);
  address(request.taker);
  if (request.destinationTokenAccount) address(request.destinationTokenAccount);
  if (
    typeof request.amount !== "bigint" ||
    request.amount <= 0n ||
    request.amount > U64_MAX ||
    !Number.isSafeInteger(request.slippageBps) ||
    request.slippageBps < 1 ||
    request.slippageBps > 100 ||
    request.inputMint === request.outputMint
  )
    throw new Error("C3_JUPITER_INVALID_REQUEST");
  if (
    !Number.isSafeInteger(request.maxAccounts) ||
    request.maxAccounts < 16 ||
    request.maxAccounts > 64
  )
    throw new Error("C3_JUPITER_INVALID_REQUEST");
}

async function readBounded(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (
    !contentType.toLowerCase().includes("application/json") ||
    contentLength > MAX_RESPONSE_BYTES ||
    !response.body
  )
    throw new Error("C3_JUPITER_UNEXPECTED_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.length;
      if (length > MAX_RESPONSE_BYTES)
        throw new Error("C3_JUPITER_RESPONSE_TOO_LARGE");
      chunks.push(result.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("C3_JUPITER_INVALID_JSON");
  }
}

function keyless<T>(task: () => Promise<T>): Promise<T> {
  const scheduled = keylessQueue
    .catch(() => undefined)
    .then(async () => {
      const wait = Math.max(0, nextKeylessStart - Date.now());
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      nextKeylessStart = Date.now() + 2_500;
      return task();
    });
  keylessQueue = scheduled;
  return scheduled;
}

export class JupiterV2ReadOnlyClient {
  readonly #apiKey: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #signal: AbortSignal | undefined;

  constructor(options: RouterClientOptions = {}) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#signal = options.signal;
  }

  async #get(path: string): Promise<unknown> {
    const execute = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const onAbort = () => controller.abort();
      this.#signal?.addEventListener("abort", onAbort, { once: true });
      try {
        if (this.#signal?.aborted) controller.abort();
        const headers: Record<string, string> = { Accept: "application/json" };
        if (this.#apiKey) headers["x-api-key"] = this.#apiKey;
        const response = await this.#fetch(new URL(path, ORIGIN), {
          method: "GET",
          headers,
          signal: controller.signal,
          redirect: "error",
        });
        if (response.status === 401 || response.status === 403)
          throw new Error("C3_JUPITER_CREDENTIAL_REQUIRED");
        if (!response.ok) throw new Error(`C3_JUPITER_HTTP_${response.status}`);
        return await readBounded(response);
      } finally {
        clearTimeout(timer);
        this.#signal?.removeEventListener("abort", onAbort);
      }
    };
    return this.#apiKey ? execute() : keyless(execute);
  }

  async getExactInQuote(request: RouterRequest): Promise<RouterBuild> {
    validateRequest(request);
    const params = new URLSearchParams({
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      amount: request.amount.toString(),
      taker: request.taker,
      slippageBps: String(request.slippageBps),
      maxAccounts: String(request.maxAccounts),
    });
    if (request.destinationTokenAccount)
      params.set("destinationTokenAccount", request.destinationTokenAccount);
    const response = await this.#get(`/swap/v2/build?${params}`);
    return parseRouterBuild(response, request);
  }

  buildRouterInstruction(build: RouterBuild): RouterInstruction {
    if (build.swapInstruction.programId !== C3_MAINNET.jupiterProgram)
      throw new Error("C3_JUPITER_PROGRAM_MISMATCH");
    return build.swapInstruction;
  }

  async getProgramRegistry(): Promise<Readonly<Record<string, string>>> {
    const response = record(await this.#get("/swap/v2/program-id-to-label"));
    const result: Record<string, string> = Object.create(null) as Record<
      string,
      string
    >;
    if (Object.keys(response).length > 500)
      throw new Error("C3_JUPITER_REGISTRY_TOO_LARGE");
    for (const [program, label] of Object.entries(response)) {
      address(program);
      if (typeof label !== "string" || label.length > 120)
        throw new Error("C3_JUPITER_INVALID_REGISTRY");
      result[program] = label;
    }
    return Object.freeze(result);
  }

  async healthCheck(): Promise<Readonly<{ ok: true; endpoint: string }>> {
    await this.getProgramRegistry();
    return Object.freeze({ ok: true, endpoint: `${ORIGIN}/swap/v2` });
  }
}

/** Sanitized fingerprint only. Do not persist raw instructions or API responses here. */
export function quoteFingerprint(build: RouterBuild): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        inputMint: build.inputMint,
        outputMint: build.outputMint,
        inAmount: build.inAmount,
        minimum: build.otherAmountThreshold,
        slippageBps: build.slippageBps,
        routePlan: build.routePlan,
        blockhash: build.blockhashWithMetadata.blockhash,
      }),
    )
    .digest("hex");
}
