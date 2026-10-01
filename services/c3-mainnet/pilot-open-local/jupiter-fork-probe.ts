/** Cloned-state experiment. Mainnet requests are read-only; ONLY local RPC simulation. */
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Ed25519Program,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
} from "@solana/web3.js";
import { C3_MAINNET } from "../src/constants.ts";
import { JupiterV2ReadOnlyClient } from "../src/jupiter-v2.ts";
import { validateDirectWhirlpoolRoute } from "./jupiter-route-v2.ts";
import { JupiterOpenBuilder } from "./jupiter-open-builder.ts";
import type { StoredQuoteContext } from "./open-quote.ts";
import {
  deriveQuoteMinimum,
  encodeQuoteSealV1,
  quoteIdForNonce,
} from "../src/quote-seal.ts";
import { quoteAltContentsHash } from "../src/quote-alt.ts";
import {
  inspectUnsignedEnvelope,
  VAULT_AUTHORITY,
  VAULT_PROGRAM,
  vaultAta,
} from "./jupiter-vault-cpi-inspection.ts";

const root = fileURLToPath(
  new URL("../../../programs/c3-pilot-vault/", import.meta.url),
);
const binary = join(root, "target/jupiter-fork-probe/c3_pilot_vault.so");
const results = join(root, "results");
mkdirSync(results, { recursive: true });
const directory = mkdtempSync(join(results, "jupiter-clone-"));
const dumps = join(directory, "accounts");
mkdirSync(dumps);
// macOS Unix sockets require a short ledger path. It remains inside this
// worktree and is ignored; never reset or reuse another test's ledger.
const ledger = mkdtempSync(
  join(fileURLToPath(new URL("../../../", import.meta.url)), ".c3fork-"),
);
const digest = (...parts: Uint8Array[]) =>
  createHash("sha256").update(Buffer.concat(parts)).digest();
const key = (value: string) => new PublicKey(value);
const remote = new Connection("https://api.mainnet-beta.solana.com", {
  commitment: "finalized",
  disableRetryOnRateLimit: true,
  fetch: (url, init) =>
    fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }),
});
const fixtureAccounts = new Set<string>();
const copied = new Map<string, AccountInfo<Buffer>>();
const normalizedProgramData = new Map<
  string,
  { originalDeploymentSlot: string; elfSha256: string }
>();
const permittedAbsentOracles = new Set<string>();
const observedAbsentOracles = new Set<string>();
let cloneSlot = 0;
let stage = "read-only-clone";
let validator: ReturnType<typeof spawn> | undefined;
let canonicalMeasurement: Record<string, unknown> | null = null;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function dump(
  address: string,
  account: AccountInfo<Buffer>,
  fixture = false,
): void {
  let localData = account.data;
  // Match Agave's official try_transform_program_data(): local genesis cannot
  // retain a deployment slot from a different fork. Only the loader metadata
  // slot is zeroed. Program ELF, authority and all route/ALT data stay exact.
  // https://github.com/anza-xyz/agave/blob/v3.1.10/test-validator/src/lib.rs#L177
  if (
    !fixture &&
    account.owner.toBase58() ===
      "BPFLoaderUpgradeab1e11111111111111111111111" &&
    account.data.length >= 45 &&
    account.data.readUInt32LE(0) === 3
  ) {
    if (!account.data.subarray(45, 49).equals(Buffer.from([127, 69, 76, 70])))
      throw new Error("C3_FORK_PROGRAMDATA_NOT_ELF");
    normalizedProgramData.set(address, {
      originalDeploymentSlot: account.data.readBigUInt64LE(4).toString(),
      elfSha256: digest(account.data.subarray(45)).toString("hex"),
    });
    localData = Buffer.from(account.data);
    localData.writeBigUInt64LE(0n, 4);
  }
  writeFileSync(
    join(dumps, address + ".json"),
    JSON.stringify({
      pubkey: address,
      account: {
        lamports: account.lamports,
        data: [localData.toString("base64"), "base64"],
        owner: account.owner.toBase58(),
        executable: account.executable,
        rentEpoch: 0,
      },
    }),
  );
  if (fixture) fixtureAccounts.add(address);
  else copied.set(address, account);
}
function tokenFixture(address: string, mint: string, amount: bigint): void {
  const data = Buffer.alloc(165);
  key(mint).toBuffer().copy(data);
  VAULT_AUTHORITY.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  const native = mint === C3_MAINNET.wrappedSolMint;
  if (native) {
    data.writeUInt32LE(1, 109);
    data.writeBigUInt64LE(2_039_280n, 113);
  }
  dump(
    address,
    {
      data,
      owner: key(C3_MAINNET.tokenProgram),
      lamports: Number(2_039_280n + (native ? amount : 0n)),
      executable: false,
    },
    true,
  );
}
async function clone(addresses: string[], refresh = false): Promise<void> {
  const unique = [...new Set(addresses)].filter(
    (address) =>
      (refresh || !copied.has(address)) &&
      !fixtureAccounts.has(address) &&
      !address.startsWith("Sysvar") &&
      !new Set<string>([
        C3_MAINNET.tokenProgram,
        C3_MAINNET.systemProgram,
        C3_MAINNET.associatedTokenProgram,
        C3_MAINNET.computeBudgetProgram,
      ]).has(address),
  );
  for (let offset = 0; offset < unique.length; offset += 50) {
    const batch = unique.slice(offset, offset + 50);
    const response = await remote.getMultipleAccountsInfoAndContext(
      batch.map(key),
      "finalized",
    );
    cloneSlot = Math.max(cloneSlot, response.context.slot);
    for (let i = 0; i < batch.length; i++) {
      const account = response.value[i];
      if (!account && permittedAbsentOracles.has(batch[i]!)) {
        // Official Whirlpool legacy swap accepts its derived readonly oracle
        // as an uninitialized system account. Preserve observed absence, not
        // invented pool/oracle data, and disclose it separately in evidence.
        observedAbsentOracles.add(batch[i]!);
        dump(
          batch[i]!,
          {
            owner: SystemProgram.programId,
            lamports: 0,
            data: Buffer.alloc(0),
            executable: false,
          },
          true,
        );
        continue;
      }
      if (!account)
        throw new Error("C3_FORK_PUBLIC_ACCOUNT_MISSING:" + batch[i]);
      dump(batch[i]!, account);
    }
    await delay(500);
  }
}
async function port(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("C3_FORK_PORT"));
      server.close(() => resolve(address.port));
    });
  });
}
function ed25519(
  publicKey: Buffer,
  message: Buffer,
  signature: Buffer,
): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey,
    message,
    signature,
  });
}
function vec(bytes: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}
async function main(): Promise<void> {
  const validatorArgument = process.argv.indexOf("--validator");
  const validatorBinary =
    validatorArgument < 0
      ? "solana-test-validator"
      : process.argv[validatorArgument + 1];
  if (!validatorBinary) throw new Error("C3_FORK_VALIDATOR_PATH_MISSING");
  const validatorVersion = execFileSync(validatorBinary, ["--version"], {
    encoding: "utf8",
    timeout: 15000,
  }).trim();
  if (!existsSync(binary)) throw new Error("C3_FORK_PROBE_BINARY_MISSING");
  if ((await remote.getGenesisHash()) !== C3_MAINNET.genesisHash)
    throw new Error("C3_FORK_MAINNET_IDENTITY");
  const payer = new PublicKey(
    digest(Buffer.from("c3-fork-public-measurement-payer")),
  );
  // A public synthetic payer, no private wallet key. Signature checking is
  // explicitly disabled ONLY on the local simulation RPC below.
  const quoteKey = generateKeyPairSync("ed25519");
  const authorityBytes = Buffer.from(
    quoteKey.publicKey.export({ format: "der", type: "spki" }),
  ).subarray(-32);
  const assetArgument = process.argv.indexOf("--asset");
  const asset = assetArgument < 0 ? "btc" : process.argv[assetArgument + 1];
  if (asset !== "btc" && asset !== "eth" && asset !== "sol")
    throw new Error("C3_FORK_ASSET_INVALID");
  const assetMint = {
    btc: C3_MAINNET.cbBtcMint,
    eth: C3_MAINNET.portalEthMint,
    sol: C3_MAINNET.wrappedSolMint,
  }[asset];
  const selling = process.argv.includes("--sell");
  const amountBps = asset === "btc" ? 4_000n : 3_000n;
  const amountArgument = process.argv.indexOf("--amount");
  const specifiedAmount =
    amountArgument < 0 ? undefined : process.argv[amountArgument + 1];
  if (
    selling &&
    (!specifiedAmount || !/^[1-9][0-9]{0,19}$/.test(specifiedAmount))
  )
    throw new Error("C3_FORK_SELL_INPUT_EVIDENCE_REQUIRED");
  const legInput = selling
    ? BigInt(specifiedAmount!)
    : (1_000_000n * amountBps) / 10_000n;
  if (legInput > (1n << 64n) - 1n) throw new Error("C3_FORK_AMOUNT_OVERFLOW");
  const inputMint = selling ? assetMint : C3_MAINNET.usdcMint;
  const outputMint = selling ? C3_MAINNET.usdcMint : assetMint;
  const source = vaultAta(inputMint),
    destination = vaultAta(outputMint);
  for (const address of [
    payer.toBase58(),
    VAULT_AUTHORITY.toBase58(),
    new PublicKey(authorityBytes).toBase58(),
  ])
    dump(
      address,
      {
        owner: SystemProgram.programId,
        lamports: 1_000_000_000,
        data: Buffer.alloc(0),
        executable: false,
      },
      true,
    );
  tokenFixture(source, inputMint, selling ? legInput : 1_000_000n);
  tokenFixture(destination, outputMint, 0n);
  const request = {
    inputMint,
    outputMint,
    amount: legInput,
    taker: VAULT_AUTHORITY.toBase58(),
    destinationTokenAccount: destination,
    slippageBps: 100,
    maxAccounts: process.argv.includes("--compact") ? 16 : 32,
  };
  const dexArgument = process.argv.indexOf("--dexes");
  const diagnosticDexes =
    dexArgument < 0 ? undefined : process.argv[dexArgument + 1];
  if (
    dexArgument >= 0 &&
    (!diagnosticDexes || !/^[A-Za-z0-9 ,_-]{1,120}$/.test(diagnosticDexes))
  )
    throw new Error("C3_FORK_DEX_FILTER_INVALID");
  // A route filter improves repeatability of the clone, NEVER approves a DEX
  // or makes it a production-allowed program. Only the official GET is used.
  const client = new JupiterV2ReadOnlyClient({
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== "https://api.jup.ag" || init?.method !== "GET")
        throw new Error("C3_FORK_OFFICIAL_READ_ONLY_REQUIRED");
      if (diagnosticDexes && url.pathname === "/swap/v2/build")
        url.searchParams.set("dexes", diagnosticDexes);
      return fetch(url, init);
    },
  });
  const first = await client.getExactInQuote(request);
  if (diagnosticDexes === "Whirlpool" && first.routePlan.length === 1) {
    const oracle = PublicKey.findProgramAddressSync(
      [
        Buffer.from("oracle"),
        key(first.routePlan[0]!.swapInfo.ammKey).toBuffer(),
      ],
      key("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"),
    )[0].toBase58();
    const occurrences = first.swapInstruction.accounts.filter(
      (meta) => meta.pubkey === oracle,
    );
    if (
      occurrences.length === 1 &&
      !occurrences[0]!.isWritable &&
      !occurrences[0]!.isSigner
    )
      permittedAbsentOracles.add(oracle);
  }
  await clone([
    ...first.swapInstruction.accounts.map((meta) => meta.pubkey),
    ...Object.keys(first.addressesByLookupTableAddress),
    C3_MAINNET.jupiterProgram,
  ]);
  // Upgradeable executable accounts point to a separate code account. Clone
  // that exact public ProgramData too; no npm fork or mock Jupiter is used.
  const codeAccounts: string[] = [];
  for (const account of copied.values())
    if (account.executable) {
      if (
        account.owner.toBase58() ===
        "BPFLoader2111111111111111111111111111111111"
      ) {
        if (
          !account.data
            .subarray(0, 4)
            .equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
        )
          throw new Error("C3_FORK_LEGACY_PROGRAM_NOT_ELF");
        continue; // This public loader stores its complete ELF in this account.
      }
      if (
        account.owner.toBase58() !==
          "BPFLoaderUpgradeab1e11111111111111111111111" ||
        account.data.length !== 36 ||
        account.data.readUInt32LE() !== 2
      )
        throw new Error("C3_FORK_UNSUPPORTED_PUBLIC_LOADER");
      codeAccounts.push(new PublicKey(account.data.subarray(4, 36)).toBase58());
    }
  await clone(codeAccounts);
  if (
    permittedAbsentOracles.size &&
    copied.get(first.routePlan[0]!.swapInfo.ammKey)?.owner.toBase58() !==
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
  )
    throw new Error("C3_FORK_WHIRLPOOL_OWNER_MISMATCH");
  // Warmed public program binaries are reused, but execution never reuses the
  // warm-up quote. Clone the FINAL quote's exact route immediately before
  // starting the isolated validator. In particular readonly Jupiter accounts
  // may rotate between builds; their existence is not permission to omit them.
  stage = "fresh-quote-exact-snapshot";
  const build = await client.getExactInQuote(request);
  if (diagnosticDexes === "Whirlpool")
    validateDirectWhirlpoolRoute(build, {
      authority: VAULT_AUTHORITY.toBase58(),
      source,
      destination,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      inputAmount: request.amount,
      maxSlippageBps: 100,
    });
  if (diagnosticDexes === "Whirlpool" && build.routePlan.length === 1) {
    const oracle = PublicKey.findProgramAddressSync(
      [
        Buffer.from("oracle"),
        key(build.routePlan[0]!.swapInfo.ammKey).toBuffer(),
      ],
      key("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"),
    )[0].toBase58();
    if (
      build.swapInstruction.accounts.some(
        (meta) => meta.pubkey === oracle && !meta.isWritable && !meta.isSigner,
      )
    )
      permittedAbsentOracles.add(oracle);
  }
  await clone(
    [
      ...build.swapInstruction.accounts.map((meta) => meta.pubkey),
      ...Object.keys(build.addressesByLookupTableAddress),
    ],
    true,
  );
  const newCode: string[] = [];
  for (const meta of build.swapInstruction.accounts) {
    const account = copied.get(meta.pubkey);
    if (!account?.executable) continue;
    if (
      account.owner.toBase58() ===
        "BPFLoaderUpgradeab1e11111111111111111111111" &&
      account.data.length === 36 &&
      account.data.readUInt32LE() === 2
    )
      newCode.push(new PublicKey(account.data.subarray(4, 36)).toBase58());
    else if (
      account.owner.toBase58() !== "BPFLoader2111111111111111111111111111111111"
    )
      throw new Error("C3_FORK_UNSUPPORTED_PUBLIC_LOADER");
  }
  await clone(newCode);
  stage = "start-isolated-validator";
  const rpcPort = await port();
  const faucetPort = await port();
  const gossipPort = await port();
  validator = spawn(
    validatorBinary,
    [
      "--ledger",
      ledger,
      "--account-dir",
      dumps,
      "--clone-feature-set",
      "--url",
      "https://api.mainnet-beta.solana.com",
      "--bpf-program",
      VAULT_PROGRAM.toBase58(),
      binary,
      "--warp-slot",
      String(cloneSlot + 100),
      "--slots-per-epoch",
      "8192",
      "--rpc-port",
      String(rpcPort),
      "--faucet-port",
      String(faucetPort),
      "--gossip-port",
      String(gossipPort),
      "--bind-address",
      "127.0.0.1",
      "--limit-ledger-size",
      "1000",
      "--log",
    ],
    {
      cwd: ledger,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        RUST_LOG:
          "info,solana_bpf_loader_program=debug,solana_program_runtime=debug,solana_sbpf=debug",
      },
    },
  );
  const log = join(directory, "validator.log");
  validator.stdout?.on("data", (chunk) => appendFileSync(log, chunk));
  validator.stderr?.on("data", (chunk) => appendFileSync(log, chunk));
  const local = new Connection(`http://127.0.0.1:${rpcPort}`, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(5_000) }),
  });
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (validator.exitCode !== null)
      throw new Error("C3_FORK_VALIDATOR_EXITED");
    try {
      await local.getSlot();
      ready = true;
      break;
    } catch {
      await delay(1000);
    }
  }
  if (!ready) throw new Error("C3_FORK_VALIDATOR_START_TIMEOUT");
  if ((await local.getGenesisHash()) === C3_MAINNET.genesisHash)
    throw new Error("C3_FORK_LOCAL_RPC_REQUIRED");
  stage = "fresh-route-against-cloned-accounts";
  const quoteExpiresAtMs =
    build.blockhashWithMetadata.fetchedAtEpochMs + 30_000;
  if (Date.now() >= quoteExpiresAtMs)
    throw new Error("C3_FORK_QUOTE_EXPIRED_REBUILD_REQUIRED");
  for (const meta of build.swapInstruction.accounts)
    if (
      !copied.has(meta.pubkey) &&
      !fixtureAccounts.has(meta.pubkey) &&
      !meta.pubkey.startsWith("Sysvar") &&
      meta.pubkey !== C3_MAINNET.tokenProgram
    )
      throw new Error("C3_FORK_FRESH_ROUTE_CHANGED:" + meta.pubkey);
  const altNames = Object.keys(build.addressesByLookupTableAddress);
  const altRaw = altNames.map((address) => {
    const account = copied.get(address);
    if (!account) throw new Error("C3_FORK_FRESH_ALT_MISSING");
    return { address, owner: account.owner.toBase58(), data: account.data };
  });
  const alts = altRaw.map(
    (account) =>
      new AddressLookupTableAccount({
        key: key(account.address),
        state: AddressLookupTableAccount.deserialize(account.data),
      }),
  );
  for (const table of alts)
    if (
      JSON.stringify(table.state.addresses.map((value) => value.toBase58())) !==
      JSON.stringify(build.addressesByLookupTableAddress[table.key.toBase58()])
    )
      throw new Error("C3_FORK_ALT_CONTENTS_CHANGED");
  const clock = await local.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  if (!clock) throw new Error("C3_FORK_CLOCK_MISSING");
  const now = clock.data.readBigInt64LE(32);
  const slot = clock.data.readBigUInt64LE(0);
  if (process.argv.includes("--canonical-measure")) {
    // Measurement uses the exact already-cloned fresh route. It is NOT a
    // reconciler-enrolled context or a proof of durable on-chain authorization.
    const config = PublicKey.findProgramAddressSync(
      [Buffer.from("c3-vault-v1")],
      VAULT_PROGRAM,
    )[0];
    const context: StoredQuoteContext = {
      keeper: payer.toBase58(),
      governance: payer.toBase58(),
      policy: PublicKey.findProgramAddressSync(
        [Buffer.from("c3-quote-policy-v1"), config.toBuffer()],
        VAULT_PROGRAM,
      )[0].toBase58(),
      reviewedPrograms: [
        C3_MAINNET.jupiterProgram,
        "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
        C3_MAINNET.tokenProgram,
        "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      ],
      genesisHash: key(await local.getGenesisHash())
        .toBuffer()
        .toString("hex"),
      vault: config.toBase58(),
      configVersion: "1",
      registry: PublicKey.findProgramAddressSync(
        [Buffer.from("c3-route-reg-v1"), config.toBuffer()],
        VAULT_PROGRAM,
      )[0].toBase58(),
      registryRevision: "1",
      registryHash: digest(Buffer.from("measurement-only-registry")).toString(
        "hex",
      ),
      plan: new PublicKey(Buffer.alloc(32, 8)).toBase58(),
      planRevision: "0",
      intent: new PublicKey(Buffer.alloc(32, 9)).toBase58(),
      wallet: payer.toBase58(),
      leg: asset === "btc" ? 0 : asset === "eth" ? 1 : 2,
      direction: selling ? 2 : 1,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      source,
      destination,
      routerProgram: C3_MAINNET.jupiterProgram,
      policyRevision: "1",
      inputAmount: request.amount.toString(),
      authority: authorityBytes.toString("hex"),
      maxSlippageBps: 100,
      maxQuoteAgeSeconds: 30,
      planExpiresAt: (now + 120n).toString(),
      configurationHash: digest(
        Buffer.from("measurement-only-config"),
      ).toString("hex"),
    };
    class FrozenFreshRoute extends JupiterV2ReadOnlyClient {
      override async getExactInQuote() {
        return build;
      }
    }
    try {
      const material = await new JupiterOpenBuilder(
        local,
        new FrozenFreshRoute(),
      ).validateAndBuild(context);
      canonicalMeasurement = {
        status: "PACKET_FITS",
        maximumPacketBytes: material.unsignedPacketBytes,
        trustedContextEnrolled: false,
        onchainAuthorizationVerified: false,
      };
    } catch (error) {
      canonicalMeasurement = {
        status: "BLOCKED",
        error: error instanceof Error ? error.message : "MEASUREMENT_FAILED",
        trustedContextEnrolled: false,
        onchainAuthorizationVerified: false,
      };
    }
  }
  const altHash = quoteAltContentsHash(altRaw, slot);
  const raw = Buffer.from(build.swapInstruction.data, "base64");
  const flags = Buffer.from(
    build.swapInstruction.accounts.map(
      (meta) => Number(meta.isSigner) | (Number(meta.isWritable) << 1),
    ),
  );
  const accounts = [
    { pubkey: payer, isSigner: true, isWritable: true },
    {
      pubkey: new PublicKey(authorityBytes),
      isSigner: false,
      isWritable: false,
    },
    { pubkey: VAULT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: key(source), isSigner: false, isWritable: true },
    { pubkey: key(destination), isSigner: false, isWritable: true },
    {
      pubkey: key(C3_MAINNET.jupiterProgram),
      isSigner: false,
      isWritable: false,
    },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    {
      pubkey: key(C3_MAINNET.tokenProgram),
      isSigner: false,
      isWritable: false,
    },
    ...build.swapInstruction.accounts.map((meta) => ({
      pubkey: key(meta.pubkey),
      isSigner: false,
      isWritable: meta.isWritable,
    })),
    ...altNames.map((address) => ({
      pubkey: key(address),
      isSigner: false,
      isWritable: false,
    })),
  ];
  const probe = new TransactionInstruction({
    programId: VAULT_PROGRAM,
    keys: accounts,
    data: Buffer.concat([
      digest(Buffer.from("global:local_jupiter_probe")).subarray(0, 8),
      vec(raw),
      vec(flags),
    ]),
  });
  const blockhash = (await local.getLatestBlockhash()).blockhash;
  const placeholder = ed25519(
    authorityBytes,
    Buffer.alloc(300),
    Buffer.alloc(64),
  );
  const compile = (verification: TransactionInstruction) =>
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        verification,
        probe,
      ],
    }).compileToV0Message(alts);
  const initial = compile(placeholder),
    keys = initial.getAccountKeys({ addressLookupTableAccounts: alts });
  const count = Buffer.alloc(2);
  count.writeUInt16LE(build.swapInstruction.accounts.length);
  const metaParts = build.swapInstruction.accounts.map((meta, index) => {
    const i = Buffer.alloc(2);
    i.writeUInt16LE(index);
    const actual =
      initial.compiledInstructions[2]!.accountKeyIndexes[8 + index]!;
    if (!keys.get(actual)?.equals(key(meta.pubkey)))
      throw new Error("C3_FORK_ACCOUNT_ORDER");
    const executable =
      copied.get(meta.pubkey)?.executable ??
      meta.pubkey === C3_MAINNET.tokenProgram;
    return Buffer.concat([
      i,
      key(meta.pubkey).toBuffer(),
      Buffer.from([
        flags[index]!,
        Number(initial.isAccountWritable(actual)),
        Number(executable),
      ]),
    ]);
  });
  const nonce = randomBytes(32);
  const payload = encodeQuoteSealV1({
    contextHash: digest(
      Buffer.from("c3-jupiter-fork-context"),
      VAULT_PROGRAM.toBuffer(),
      VAULT_AUTHORITY.toBuffer(),
      key(source).toBuffer(),
      key(destination).toBuffer(),
      key(request.inputMint).toBuffer(),
      key(request.outputMint).toBuffer(),
      key(C3_MAINNET.jupiterProgram).toBuffer(),
    ),
    quoteId: quoteIdForNonce(nonce),
    nonce,
    inputAmount: request.amount,
    quotedOutput: BigInt(build.outAmount),
    slippageBps: 100,
    minimumOutput: deriveQuoteMinimum(
      BigInt(build.outAmount),
      100,
      BigInt(build.otherAmountThreshold),
    ),
    routeHash: digest(Buffer.from(JSON.stringify(build.routePlan))),
    instructionHash: digest(Buffer.from("c3-router-data-v1"), raw),
    accountMetasHash: digest(
      Buffer.from("c3-ordered-metas-v3"),
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
      digest(Buffer.from("c3-isolated-registry-v1")),
      count,
      ...metaParts,
    ),
    altCount: altNames.length,
    altContentsHash: altHash,
    builderTimestamp: now,
    builderSlot: slot,
    expiresAt: BigInt(Math.floor(quoteExpiresAtMs / 1000)),
    expiresSlot: slot + 100n,
  });
  const signature = sign(null, payload, quoteKey.privateKey);
  const message = compile(ed25519(authorityBytes, payload, signature));
  const size = inspectUnsignedEnvelope(message);
  if (!size.fits)
    throw new Error("C3_FORK_COMPLETE_TRANSACTION_SIZE:" + size.bytes);
  if (Date.now() >= quoteExpiresAtMs)
    throw new Error("C3_FORK_QUOTE_EXPIRED_REBUILD_REQUIRED");
  stage = "local-real-jupiter-cpi-simulation";
  const simulation = await local.simulateTransaction(
    new VersionedTransaction(message),
    {
      sigVerify: false,
      innerInstructions: true,
      accounts: { encoding: "base64", addresses: [source, destination] },
    },
  );
  const output = simulation.value.accounts?.[1];
  const sourceOut = simulation.value.accounts?.[0];
  const adversarial: {
    test: string;
    rejected: boolean;
    reachedJupiter: boolean;
  }[] = [];
  if (!simulation.value.err) {
    const runAttack = async (
      test: string,
      alteredProbe: TransactionInstruction,
      verification: TransactionInstruction,
    ) => {
      const attack = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          verification,
          alteredProbe,
        ],
      }).compileToV0Message(alts);
      if (!inspectUnsignedEnvelope(attack).fits)
        throw new Error("C3_FORK_ATTACK_SIZE_INVALID");
      const result = await local.simulateTransaction(
        new VersionedTransaction(attack),
        { sigVerify: false },
      );
      const rejected = result.value.err !== null;
      const reachedJupiter =
        result.value.logs?.some((line) =>
          line.includes(`Program ${C3_MAINNET.jupiterProgram} invoke`),
        ) ?? false;
      adversarial.push({ test, rejected, reachedJupiter });
      if (!rejected || reachedJupiter)
        throw new Error("C3_FORK_ATTACK_NOT_REJECTED_BEFORE_CPI:" + test);
    };
    const original = ed25519(authorityBytes, payload, signature);
    const copy = () =>
      new TransactionInstruction({
        programId: probe.programId,
        keys: probe.keys.map((meta) => ({ ...meta })),
        data: Buffer.from(probe.data),
      });
    const dataMutation = copy();
    dataMutation.data[12] = dataMutation.data[12]! ^ 1;
    await runAttack("instruction bytes substituted", dataMutation, original);
    const roleMutation = copy();
    roleMutation.data[16 + raw.length] =
      roleMutation.data[16 + raw.length]! ^ 1;
    await runAttack(
      "per-occurrence signer role substituted",
      roleMutation,
      original,
    );
    const accountMutation = copy();
    [accountMutation.keys[9], accountMutation.keys[10]] = [
      accountMutation.keys[10]!,
      accountMutation.keys[9]!,
    ];
    await runAttack("ordered metas reordered", accountMutation, original);
    const destinationMutation = copy();
    destinationMutation.keys[4] = {
      ...destinationMutation.keys[4]!,
      pubkey: key(source),
    };
    await runAttack("destination substituted", destinationMutation, original);
    if (altNames.length) {
      const tableMutation = copy();
      tableMutation.keys[tableMutation.keys.length - 1] = {
        pubkey: key(C3_MAINNET.tokenProgram),
        isSigner: false,
        isWritable: false,
      };
      await runAttack("ALT account substituted", tableMutation, original);
    }
    const tamperedMinimum = Buffer.from(payload);
    tamperedMinimum.writeBigUInt64LE(1n, 131);
    await runAttack(
      "minimum changed after signature",
      copy(),
      ed25519(authorityBytes, tamperedMinimum, signature),
    );
    await runAttack(
      "signed minimum below policy",
      copy(),
      ed25519(
        authorityBytes,
        tamperedMinimum,
        sign(null, tamperedMinimum, quoteKey.privateKey),
      ),
    );
    const expired = Buffer.from(payload);
    expired.writeBigInt64LE(now, 284);
    await runAttack(
      "signed quote expired",
      copy(),
      ed25519(
        authorityBytes,
        expired,
        sign(null, expired, quoteKey.privateKey),
      ),
    );
  }
  const amount = (account: typeof output) => {
    if (!account) return null;
    const encoded = account.data[0];
    if (typeof encoded !== "string")
      throw new Error("C3_FORK_ACCOUNT_DATA_MISSING");
    const data = Buffer.from(encoded, "base64");
    if (data.length !== 165) throw new Error("C3_FORK_ACCOUNT_DATA_INVALID");
    return data.readBigUInt64LE(64).toString();
  };
  const evidence = {
    decision: simulation.value.err ? "BLOCKED" : "ISOLATED_CPI_EXECUTED",
    stage,
    mainnetExecution: false,
    mainnetAssetAcquisition: false,
    mockRouterUsed: false,
    canonicalMetaAndWhirlpoolRoleValidatorUsed: true,
    canonicalDurableIntentAuthorizationUsed: false,
    canonicalMeasurement,
    adversarial,
    fixtureAccounts: [...fixtureAccounts],
    absentOnMainnetReadonlyWhirlpoolOracles: [...observedAbsentOracles],
    rentEpochNormalizedToZero: true,
    programDataLoaderSlotsNormalizedToZero: [...normalizedProgramData].map(
      ([address, evidence]) => ({ address, ...evidence }),
    ),
    clonedSnapshotSlot: cloneSlot,
    validatorVersion,
    runtimeFeaturesClonedFromOfficialMainnet: true,
    diagnosticDexes: diagnosticDexes ?? null,
    clonedPublicAccounts: [...copied].map(([address, account]) => ({
      address,
      owner: account.owner.toBase58(),
      executable: account.executable,
      sha256: digest(account.data).toString("hex"),
    })),
    asset,
    direction: selling ? "sell" : "buy",
    allocationBps: amountBps.toString(),
    input: request.amount.toString(),
    quotedOutput: build.outAmount,
    minimum: build.otherAmountThreshold,
    authorizedMinimum: payload.readBigUInt64LE(131).toString(),
    slippageBps: build.slippageBps,
    quoteFetchedAtMs: build.blockhashWithMetadata.fetchedAtEpochMs,
    quoteExpiresAtMs,
    quoteFingerprint: digest(Buffer.from(JSON.stringify(build))).toString(
      "hex",
    ),
    apiSetupInstructionsNotExecuted: build.setupInstructions.length,
    apiCleanupInstructionNotExecuted: build.cleanupInstruction !== null,
    serializedBytes: size.bytes,
    altCount: alts.length,
    error: simulation.value.err,
    unitsConsumed: simulation.value.unitsConsumed,
    logs: simulation.value.logs,
    simulationInnerInstructions: simulation.value.innerInstructions ?? null,
    sourceAfter: amount(sourceOut),
    destinationAfter: amount(output),
  };
  writeFileSync(
    join(directory, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...evidence,
        clonedPublicAccounts: copied.size,
        evidencePath: join(directory, "evidence.json"),
      },
      null,
      2,
    ),
  );
  if (simulation.value.err) process.exitCode = 2;
}
main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        decision: "BLOCKED",
        stage,
        error: error instanceof Error ? error.message : "C3_FORK_UNKNOWN",
        mainnetExecution: false,
        evidenceDirectory: directory,
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (validator && validator.exitCode === null) {
      validator.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => validator!.once("exit", resolve)),
        delay(5000),
      ]);
      if (validator.exitCode === null) validator.kill("SIGKILL");
    }
  });
