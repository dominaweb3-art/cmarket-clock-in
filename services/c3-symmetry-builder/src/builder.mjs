import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SymmetryCore } = require('@symmetry-hq/sdk');
const { Connection, PublicKey } = require('@solana/web3.js');

export const SDK_VERSION = '1.0.22';
export const SDK_INTEGRITY = 'sha512-yopoVu6VnFiktGsjgeJ2dbFX8pdciePK7BUFNbUYb5wAto6DQqVq6a51qE33dRT6BRkL/ANBpKZEJgqpJX+KMA==';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function createReadOnlyConnection(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('C3_BUILDER_RPC_NOT_HTTPS'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password ||
    parsed.search || parsed.hash || parsed.port && parsed.port !== '443')
    throw new Error('C3_BUILDER_RPC_NOT_HTTPS');
  const connection = new Connection(url, { commitment: 'finalized', confirmTransactionInitialTimeout: 8_000 });
  for (const method of ['sendTransaction', 'sendRawTransaction', 'simulateTransaction', 'confirmTransaction', 'requestAirdrop']) {
    connection[method] = () => { throw new Error('C3_BUILDER_CHAIN_ACTION_FORBIDDEN'); };
  }
  return connection;
}

function safeKey(key) {
  if (typeof key !== 'string' || !KEY.test(key)) throw new Error('C3_BUILDER_INVALID_PUBLIC_KEY');
  return new PublicKey(key).toBase58();
}

function encodeSequence(sequence) {
  if (!sequence || !Array.isArray(sequence.batches)) throw new Error('C3_BUILDER_INVALID_SDK_SEQUENCE');
  const transactions = sequence.batches.flatMap(batch => {
    if (!Array.isArray(batch.transactions)) throw new Error('C3_BUILDER_INVALID_SDK_BATCH');
    return batch.transactions.map(tx => {
      if (typeof tx.tx_b64 !== 'string' || tx.tx_b64.length > 8_192 ||
        Buffer.from(tx.tx_b64, 'base64').toString('base64') !== tx.tx_b64) {
        throw new Error('C3_BUILDER_INVALID_SDK_BYTES');
      }
      return {
        unsignedTransactionBase64: tx.tx_b64,
        sdkMessageVersion: tx.message_version,
        sdkPayer: tx.payer,
        sdkRecentBlockhash: tx.recent_blockhash,
        sdkLastValidBlockHeight: tx.last_valid_block_height ?? null,
      };
    });
  });
  if (transactions.length < 1 || transactions.length > 4) throw new Error('C3_BUILDER_INVALID_TRANSACTION_COUNT');
  return transactions;
}

export async function buildUnsigned(context) {
  if (!context || context.cluster !== 'mainnet-beta' || context.usdcMint !== USDC ||
    context.amountBaseUnits !== '1000000' || !context.expiresAt || Date.parse(context.expiresAt) <= Date.now()) {
    throw new Error('C3_BUILDER_CONTEXT_NOT_APPROVED');
  }
  const wallet = safeKey(context.wallet);
  safeKey(context.vault);
  const shareMint = safeKey(context.shareMint);
  const sdk = new SymmetryCore({ connection: createReadOnlyConnection(context.rpcUrl), network: 'mainnet' });
  let sequence;
  if (context.operation === 'deposit') {
    sequence = await sdk.buyVaultTx({
      buyer: wallet,
      vault_mint: shareMint,
      contributions: [{ mint: USDC, amount: 1_000_000 }],
      rebalance_slippage_bps: 100,
      per_trade_rebalance_slippage_bps: 100,
      min_bounty_amount: 0,
      max_bounty_amount: 0,
    });
  } else if (context.operation === 'redemption') {
    if (!context.positionVerified || !/^\d+$/.test(context.shareAmountBaseUnits ?? '') ||
      BigInt(context.shareAmountBaseUnits) > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { code: 'C3_REDEMPTION_REQUIRES_DEPLOYED_POSITION' };
    }
    sequence = await sdk.sellVaultTx({
      seller: wallet,
      vault_mint: shareMint,
      withdraw_amount: Number(context.shareAmountBaseUnits),
      keep_tokens: [],
    });
  } else {
    throw new Error('C3_BUILDER_INVALID_OPERATION');
  }
  return {
    code: 'C3_UNSIGNED_CANDIDATE_REQUIRES_EXTERNAL_VALIDATION',
    mode: context.operation === 'redemption' ? 'EXPERIMENTAL_VENDOR_CONFIRMED_USDC_MODE' : 'DEPOSIT_CANDIDATE',
    builderVersion: 'c3-symmetry-builder/0.1.0',
    sdkVersion: SDK_VERSION,
    sdkIntegrity: SDK_INTEGRITY,
    expiresAt: context.expiresAt,
    expectedEffectsStatus: 'UNVERIFIED_CANDIDATE',
    transactions: encodeSequence(sequence),
  };
}
