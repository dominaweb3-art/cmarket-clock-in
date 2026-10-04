/** Persistent LOCAL bank with public Jupiter/Whirlpool state. Never Mainnet writes.
 * Only the initial owner USDC account is a synthetic genesis fixture. Vault
 * inventory starts at zero; sells MUST use inventory produced in this bank.
 */
import { createHash } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import {
  Connection,
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
  type AccountInfo,
} from "@solana/web3.js";
import { C3_MAINNET as c } from "../src/constants.ts";
import { type RouterBuild } from "../src/jupiter-v2.ts";
import { verifyWhirlpoolTick } from "./whirlpool-tick.ts";
import { verifyWhirlpoolOracle } from "../src/open-whirlpool-oracle.ts";
import {
  VAULT_PROGRAM,
  VAULT_AUTHORITY,
} from "./jupiter-vault-cpi-inspection.ts";
const WHIRL = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const root = fileURLToPath(
  new URL("../../../programs/c3-pilot-vault/", import.meta.url),
);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      if (!a || typeof a === "string") return reject(Error("C3_BANK_PORT"));
      s.close(() => resolve(a.port));
    });
  });
}
async function rpcPair(): Promise<number> {
  for (let n = 0; n < 8; n++) {
    const port = await freePort();
    const servers = [createServer(), createServer()];
    try {
      await Promise.all(
        servers.map(
          (s, i) =>
            new Promise<void>((resolve, reject) => {
              s.once("error", reject);
              s.listen(port + i, "127.0.0.1", resolve);
            }),
        ),
      );
      return port;
    } catch {
      /* bounded port selection, not transaction retry */
    } finally {
      await Promise.all(
        servers.map(
          (s) =>
            new Promise<void>((r) => {
              if (s.listening) s.close(() => r());
              else r();
            }),
        ),
      );
    }
  }
  throw Error("C3_BANK_RPC_PAIR_UNAVAILABLE");
}
export class CloneBank {
  readonly directory = mkdtempSync(join(root, "results/jupiter-cycle-"));
  readonly dumps = join(this.directory, "accounts");
  readonly remote = new Connection("https://api.mainnet-beta.solana.com", {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }),
  });
  private readonly accounts = new Map<string, AccountInfo<Buffer>>();
  private readonly fixtures = new Set<string>();
  private child: ChildProcess | null = null;
  private maxSlot = 0;
  constructor() {
    mkdirSync(this.dumps);
  }
  fixture(address: string, account: AccountInfo<Buffer>): void {
    if (this.child) throw Error("C3_BANK_RUNNING_FIXTURE_FORBIDDEN");
    this.fixtures.add(address);
    this.dump(address, account);
  }
  private dump(address: string, account: AccountInfo<Buffer>): void {
    let data = account.data;
    if (
      account.owner.toBase58() === LOADER &&
      data.length >= 45 &&
      data.readUInt32LE() === 3
    ) {
      if (!data.subarray(45, 49).equals(Buffer.from([127, 69, 76, 70])))
        throw Error("C3_BANK_ELF");
      data = Buffer.from(data);
      data.writeBigUInt64LE(0n, 4);
    }
    writeFileSync(
      join(this.dumps, address + ".json"),
      JSON.stringify({
        pubkey: address,
        account: {
          lamports: account.lamports,
          data: [data.toString("base64"), "base64"],
          owner: account.owner.toBase58(),
          executable: account.executable,
          rentEpoch: 0,
        },
      }),
    );
    this.accounts.set(address, account);
  }
  async warmLookupTable(address: string): Promise<void> {
    if (this.child) throw Error("C3_BANK_RUNNING_REMOTE_OVERWRITE_FORBIDDEN");
    const result = await this.remote.getAccountInfoAndContext(
      new PublicKey(address),
      "finalized",
    );
    const account = result.value;
    if (
      !account ||
      account.owner.toBase58() !==
        "AddressLookupTab1e1111111111111111111111111" ||
      account.executable
    )
      throw Error("C3_BANK_ALT_OWNER");
    const table = AddressLookupTableAccount.deserialize(account.data);
    if (
      table.deactivationSlot !== 0xffffffffffffffffn ||
      !table.addresses.length ||
      table.addresses.length > 256 ||
      table.lastExtendedSlot >= result.context.slot
    )
      throw Error("C3_BANK_ALT_UNUSABLE");
    this.maxSlot = Math.max(this.maxSlot, result.context.slot);
    // Preserve the complete original authority metadata and resolved contents.
    // The fresh builder independently binds/validates the selected table again.
    this.dump(address, account);
  }
  async warmPool(address: string): Promise<void> {
    if (this.child) throw Error("C3_BANK_RUNNING_REMOTE_OVERWRITE_FORBIDDEN");
    const pool = new PublicKey(address),
      info = await this.remote.getAccountInfoAndContext(pool, "finalized");
    const d = info.value?.data;
    if (
      !d ||
      info.value!.owner.toBase58() !== WHIRL ||
      d.length !== 653 ||
      !d.subarray(0, 8).equals(Buffer.from("3f95d10ce1806309", "hex"))
    )
      throw Error("C3_BANK_POOL_LAYOUT");
    const a = new PublicKey(d.subarray(101, 133)).toBase58(),
      b = new PublicKey(d.subarray(181, 213)).toBase58();
    const allowed = [
      c.usdcMint,
      c.cbBtcMint,
      c.portalEthMint,
      c.wrappedSolMint,
    ] as readonly string[];
    if (
      !allowed.includes(a) ||
      !allowed.includes(b) ||
      ![a, b].includes(c.usdcMint)
    )
      throw Error("C3_BANK_POOL_MINTS");
    this.maxSlot = Math.max(this.maxSlot, info.context.slot);
    this.dump(address, info.value!);
    const spacing = d.readUInt16LE(41),
      tick = d.readInt32LE(81);
    if (spacing === 0) throw Error("C3_BANK_TICK_SPACING");
    const width = 88 * spacing,
      start = Math.floor(tick / width) * width;
    const arrays = Array.from({ length: 13 }, (_, i) => start + (i - 6) * width)
      .filter((v) => v >= -443636 && v <= 443636)
      .map((v) => ({
        start: v,
        key: PublicKey.findProgramAddressSync(
          [Buffer.from("tick_array"), pool.toBuffer(), Buffer.from(String(v))],
          new PublicKey(WHIRL),
        )[0],
      }));
    const addresses = [
      new PublicKey(d.subarray(133, 165)),
      new PublicKey(d.subarray(213, 245)),
      ...arrays.map((v) => v.key),
      PublicKey.findProgramAddressSync(
        [Buffer.from("oracle"), pool.toBuffer()],
        new PublicKey(WHIRL),
      )[0],
    ];
    const snapshot = await this.remote.getMultipleAccountsInfoAndContext(
      addresses,
      "finalized",
    );
    this.maxSlot = Math.max(this.maxSlot, snapshot.context.slot);
    snapshot.value.forEach((account, i) => {
      if (!account) {
        if (i < 2) throw Error("C3_BANK_POOL_VAULT_MISSING");
        return;
      }
      if (i < 2) {
        if (
          account.owner.toBase58() !== c.tokenProgram ||
          account.data.length !== 165 ||
          new PublicKey(account.data.subarray(0, 32)).toBase58() !==
            [a, b][i] ||
          !new PublicKey(account.data.subarray(32, 64)).equals(pool)
        )
          throw Error("C3_BANK_POOL_VAULT");
      } else if (i === addresses.length - 1) {
        verifyWhirlpoolOracle(
          addresses[i]!,
          pool,
          account.owner,
          account.data,
          account.executable,
        );
      } else {
        const array = arrays[i - 2]!;
        if (account.owner.toBase58() !== WHIRL)
          throw Error("C3_BANK_TICK_ARRAY_OWNER");
        verifyWhirlpoolTick(account.data, pool, array.start);
      }
      this.dump(addresses[i]!.toBase58(), account);
    });
  }
  /** Discover a bounded authentic pool set BEFORE funding the cloned bank.
   * Fresh routes still pass verifyRoute; this never overwrites a running bank.
   */
  async warmAssetPairPools(): Promise<void> {
    if (this.child) throw Error("C3_BANK_RUNNING_REMOTE_OVERWRITE_FORBIDDEN");
    if ((await this.remote.getGenesisHash()) !== c.genesisHash)
      throw Error("C3_BANK_REMOTE_IDENTITY");
    const pools = new Set<string>();
    for (const asset of [c.cbBtcMint, c.portalEthMint, c.wrappedSolMint]) {
      for (const [a, b] of [
        [c.usdcMint, asset],
        [asset, c.usdcMint],
      ]) {
        const rows = await this.remote.getProgramAccounts(
          new PublicKey(WHIRL),
          {
            commitment: "finalized",
            dataSlice: { offset: 0, length: 0 },
            filters: [
              { dataSize: 653 },
              { memcmp: { offset: 101, bytes: a! } },
              { memcmp: { offset: 181, bytes: b! } },
            ],
          },
        );
        for (const row of rows) {
          if (
            !row.account.owner.equals(new PublicKey(WHIRL)) ||
            row.account.executable
          )
            throw Error("C3_BANK_DISCOVERED_POOL_OWNER");
          pools.add(row.pubkey.toBase58());
        }
        if (pools.size > 96) throw Error("C3_BANK_POOL_DISCOVERY_LIMIT");
        await wait(500);
      }
    }
    for (const pool of pools) {
      await this.warmPool(pool);
      await wait(500);
    }
    appendFileSync(
      join(this.directory, "preparation.jsonl"),
      JSON.stringify({
        kind: "official-pool-discovery",
        pools: [...pools],
        at: new Date().toISOString(),
      }) + "\n",
    );
  }
  async warm(build: RouterBuild): Promise<void> {
    if (this.child) throw Error("C3_BANK_RUNNING_REMOTE_OVERWRITE_FORBIDDEN");
    if ((await this.remote.getGenesisHash()) !== c.genesisHash)
      throw Error("C3_BANK_REMOTE_IDENTITY");
    const oracles = new Set(
      build.routePlan.map((p) =>
        PublicKey.findProgramAddressSync(
          [Buffer.from("oracle"), new PublicKey(p.swapInfo.ammKey).toBuffer()],
          new PublicKey(WHIRL),
        )[0].toBase58(),
      ),
    );
    const queue = [
      ...build.swapInstruction.accounts.map((m) => m.pubkey),
      ...Object.keys(build.addressesByLookupTableAddress),
      c.jupiterProgram,
      build.inputMint,
      build.outputMint,
    ];
    const seen = new Set<string>();
    while (queue.length) {
      const batch = [...new Set(queue.splice(0, 40))].filter(
        (a) =>
          !seen.has(a) &&
          !this.fixtures.has(a) &&
          a !== VAULT_AUTHORITY.toBase58() &&
          !a.startsWith("Sysvar") &&
          !new Set<string>([
            c.systemProgram,
            c.tokenProgram,
            c.associatedTokenProgram,
            c.computeBudgetProgram,
          ]).has(a),
      );
      if (!batch.length) continue;
      const v = await this.remote.getMultipleAccountsInfoAndContext(
        batch.map((a) => new PublicKey(a)),
        "finalized",
      );
      this.maxSlot = Math.max(this.maxSlot, v.context.slot);
      for (const [i, a] of batch.entries()) {
        seen.add(a);
        const account = v.value[i];
        if (!account) {
          const meta = build.swapInstruction.accounts.find(
            (m) => m.pubkey === a,
          );
          if (oracles.has(a) && meta && !meta.isSigner && !meta.isWritable) {
            this.dump(a, {
              owner: SystemProgram.programId,
              data: Buffer.alloc(0),
              lamports: 0,
              executable: false,
            });
            continue;
          }
          appendFileSync(
            join(this.directory, "preparation.jsonl"),
            JSON.stringify({
              kind: "missing-fresh-account",
              address: a,
              meta: meta ?? null,
              route: build.routePlan,
              alt: Object.keys(build.addressesByLookupTableAddress),
              at: new Date().toISOString(),
            }) + "\n",
          );
          throw Error("C3_BANK_PUBLIC_ACCOUNT_MISSING:" + a);
        }
        this.dump(a, account);
        if (
          account.executable &&
          account.owner.toBase58() === LOADER &&
          account.data.length === 36 &&
          account.data.readUInt32LE() === 2
        )
          queue.push(new PublicKey(account.data.subarray(4, 36)).toBase58());
        if (
          account.executable &&
          account.owner.toBase58() !== LOADER &&
          account.owner.toBase58() !==
            "BPFLoader2111111111111111111111111111111111"
        )
          throw Error("C3_BANK_UNREVIEWED_LOADER");
      }
      await wait(500);
    }
    for (const route of build.routePlan)
      await this.warmPool(route.swapInfo.ammKey);
  }
  async start(): Promise<Connection> {
    if (this.child) throw Error("C3_BANK_ALREADY_STARTED");
    const binary = process.env.C3_LOCAL_VALIDATOR_BIN;
    if (
      !binary ||
      !/^solana-test-validator 3\.1\.10\b/.test(
        execFileSync(binary, ["--version"], {
          encoding: "utf8",
          timeout: 15_000,
        }).trim(),
      )
    )
      throw Error("C3_BANK_PINNED_AGAVE_3_1_10_REQUIRED");
    const ledger = mkdtempSync(
      join(fileURLToPath(new URL("../../../", import.meta.url)), ".c3cycle-"),
    );
    const rpc = await rpcPair(),
      faucet = await freePort(),
      gossip = await freePort();
    this.child = spawn(
      binary,
      [
        "--ledger",
        ledger,
        "--account-dir",
        this.dumps,
        "--clone-feature-set",
        "--url",
        "https://api.mainnet-beta.solana.com",
        "--bpf-program",
        VAULT_PROGRAM.toBase58(),
        join(root, "target/local-jupiter-cycle/c3_pilot_vault.so"),
        "--warp-slot",
        // Warp at an epoch boundary: Agave resets epoch_start_timestamp to
        // genesis time while warping. A mid-epoch target advances Clock by
        // the elapsed fraction of that synthetic epoch and expires live quotes.
        // This changes no quote lifetime, ALT contents or security policy.
        String(Math.ceil((this.maxSlot + 100) / 8192) * 8192),
        "--slots-per-epoch",
        "8192",
        "--rpc-port",
        String(rpc),
        "--faucet-port",
        String(faucet),
        "--gossip-port",
        String(gossip),
        "--bind-address",
        "127.0.0.1",
        "--limit-ledger-size",
        "1000",
        "--log",
      ],
      { cwd: ledger, stdio: ["ignore", "pipe", "pipe"] },
    );
    const log = join(this.directory, "validator.log");
    this.child.stdout?.on("data", (v) => appendFileSync(log, v));
    this.child.stderr?.on("data", (v) => appendFileSync(log, v));
    const connection = new Connection(`http://127.0.0.1:${rpc}`, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }),
    });
    for (let n = 0; n < 90; n++) {
      if (this.child.exitCode !== null) throw Error("C3_BANK_EXITED");
      try {
        await connection.getSlot();
        if ((await connection.getGenesisHash()) === c.genesisHash)
          throw Error("C3_BANK_MAINNET_FORBIDDEN");
        return connection;
      } catch {
        await wait(1000);
      }
    }
    throw Error("C3_BANK_START_TIMEOUT");
  }
  async verifyRoute(connection: Connection, build: RouterBuild): Promise<void> {
    if (
      !this.child ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(connection.rpcEndpoint) ||
      (await connection.getGenesisHash()) === c.genesisHash
    )
      throw Error("C3_BANK_LOCAL_REQUIRED");
    // A fresh route must resolve in the SAME bank. Never inject liquidity or
    // inventory after a purchase. Missing accounts require a new bounded run.
    const required = [
      ...new Set([
        ...build.swapInstruction.accounts.map((m) => m.pubkey),
        ...Object.keys(build.addressesByLookupTableAddress),
      ]),
    ];
    const infos = await connection.getMultipleAccountsInfo(
      required.map((a) => new PublicKey(a)),
    );
    for (const [i, a] of required.entries())
      if (
        !infos[i] &&
        !a.startsWith("Sysvar") &&
        a !== VAULT_AUTHORITY.toBase58()
      ) {
        const oracle = build.routePlan.some(
          (p) =>
            PublicKey.findProgramAddressSync(
              [
                Buffer.from("oracle"),
                new PublicKey(p.swapInfo.ammKey).toBuffer(),
              ],
              new PublicKey(WHIRL),
            )[0].toBase58() === a,
        );
        const m = build.swapInstruction.accounts.find((m) => m.pubkey === a);
        if (!oracle || !m || m.isWritable || m.isSigner)
          throw Error("C3_BANK_FRESH_ROUTE_MISSING:" + a);
      }
  }
  close(): void {
    this.child?.kill("SIGTERM");
  }
  writeReport(report: Record<string, unknown>): void {
    writeFileSync(
      join(this.directory, "report.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
export const cycleHash = (v: Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
