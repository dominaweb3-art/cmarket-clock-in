import process from 'node:process';
import { spawn } from 'node:child_process';
import pg from 'pg';

const REQUEST_ID = /^c3p-[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,95}$/;
const ERROR = 'C3_BUILDER_REQUEST_REJECTED';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function parseRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'configurationVersion,expectedRevision,intentId,operation' ||
    !REQUEST_ID.test(value.intentId) || !VERSION.test(value.configurationVersion) ||
    !['deposit', 'redemption'].includes(value.operation) ||
    !/^[1-9]\d{0,15}$/.test(value.expectedRevision)) throw new Error(ERROR);
  return value;
}

async function callSdkWithoutCredentials(context) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL('./sdk-worker.mjs', import.meta.url).pathname], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {},
    });
    let output = '';
    let excessive = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (Buffer.byteLength(output) > 48_000) { excessive = true; child.kill('SIGKILL'); }
    });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error(ERROR)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || excessive) return reject(new Error(ERROR));
      try { resolve(JSON.parse(output)); } catch { reject(new Error(ERROR)); }
    });
    child.stdin.end(JSON.stringify(context));
  });
}

async function readInput() {
  let text = '';
  let size = 0;
  for await (const chunk of process.stdin) {
    size += Buffer.byteLength(chunk);
    if (size > 1024) throw new Error(ERROR);
    text += chunk;
  }
  return parseRequest(JSON.parse(text));
}

async function loadContext(request) {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    max: 1, connectionTimeoutMillis: 3_000, statement_timeout: 5_000,
  });
  try {
    const result = await pool.query(`SELECT i.intent_id,i.kind,i.wallet,i.cluster,i.vault,i.share_mint,
      i.amount_base_units::text AS amount_base_units,i.configuration_hash,i.state,
      i.revision::text AS revision,i.expires_at,
      c.configuration_version,c.usdc_mint,c.rpc_https_url
      FROM c3.c3_pilot_intents i JOIN c3.c3_pilot_builder_configurations c
        ON i.configuration_hash=c.configuration_hash
      WHERE i.intent_id=$1`, [request.intentId]);
    const row = result.rows[0];
    if (result.rows.length !== 1 || !row || !HASH.test(row.configuration_hash) ||
      row.configuration_version !== request.configurationVersion ||
      row.revision !== request.expectedRevision || row.kind !== request.operation ||
      row.state !== (request.operation === 'deposit' ? 'draft' : 'redemption_draft') ||
      row.usdc_mint !== USDC || !Number.isFinite(row.expires_at?.getTime()) ||
      row.expires_at.getTime() <= Date.now()) throw new Error(ERROR);
    return {
      cluster: row.cluster,
      wallet: row.wallet,
      vault: row.vault,
      shareMint: row.share_mint,
      amountBaseUnits: row.amount_base_units,
      usdcMint: row.usdc_mint,
      rpcUrl: row.rpc_https_url,
      expiresAt: row.expires_at.toISOString(),
      operation: row.kind,
      positionVerified: false,
    };
  } finally {
    await pool.end();
  }
}

try {
  const request = await readInput();
  const output = await callSdkWithoutCredentials(await loadContext(request));
  const json = JSON.stringify(output);
  if (Buffer.byteLength(json) > 48_000) throw new Error(ERROR);
  process.stdout.write(json + '\n');
} catch {
  // Never echo DB, RPC, SDK, wallet or environment errors to logs.
  process.stderr.write(ERROR + '\n');
  process.exitCode = 2;
}
