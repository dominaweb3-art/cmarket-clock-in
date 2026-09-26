import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { PublicKey } from '@solana/web3.js';

import { buildUnsigned, createReadOnlyConnection, USDC } from '../src/builder.mjs';
import {
  inspectUnsignedSequence,
  assertSemanticAuthorizationAvailable,
  requestIsolatedCandidate,
  parseCandidateResponse,
} from '../../c3-mainnet/src/pilot-builder-boundary.ts';

const wallet = new PublicKey(Buffer.alloc(32, 7)).toBase58();
const vault = 'AwDFvjEPPwdF1YgXV8asNt6LeEFDduinYneCn6mHDAsh';
const shareMint = '9ihGfswnUZ6MysSR3KgmrZ57FXDVAiAQ6sEHwLuWwzJ4';
const rpcUrl = 'https://api.mainnet-beta.solana.com';
const context = {
  cluster: 'mainnet-beta', wallet, vault, shareMint, usdcMint: USDC,
  amountBaseUnits: '1000000', expiresAt: new Date(Date.now() + 300_000).toISOString(),
  rpcUrl, operation: 'deposit', positionVerified: false,
};

test('owner-only SDK process forbids chain actions and refuses unverified redemption', async () => {
  const readOnly = createReadOnlyConnection(rpcUrl);
  assert.throws(() => readOnly.sendRawTransaction(Buffer.from([1])), /FORBIDDEN/);
  assert.throws(() => createReadOnlyConnection('http://localhost:8899'), /NOT_HTTPS/);
  assert.deepEqual(await buildUnsigned({ ...context, operation: 'redemption' }),
    { code: 'C3_REDEMPTION_REQUIRES_DEPLOYED_POSITION' });
  await assert.rejects(buildUnsigned({ ...context, amountBaseUnits: '2000000' }), /NOT_APPROVED/);
});

test('credential-free SDK child accepts only sealed context and returns a typed redemption gate', () => {
  const result = spawnSync(process.execPath, [new URL('../src/sdk-worker.mjs', import.meta.url).pathname], {
    input: JSON.stringify({ ...context, operation: 'redemption' }), encoding: 'utf8',
    env: {}, timeout: 5_000, maxBuffer: 60_000,
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { code: 'C3_REDEMPTION_REQUIRES_DEPLOYED_POSITION' });
  assert(!result.stdout.includes('PGHOST'));
});

test('fresh public non-C3 fixture builds 2 unsigned v0 candidates; structural inspection is not semantic authorization', async () => {
  const candidate = await buildUnsigned(context);
  assert.equal(parseCandidateResponse(candidate).transactions.length, 2);
  assert.throws(() => parseCandidateResponse({ ...candidate, sdkVersion: '9.9.9' }), /INVALID_RESPONSE/);
  assert.throws(() => parseCandidateResponse({ ...candidate, sdkIntegrity: 'sha512-fake' }), /INVALID_RESPONSE/);
  assert.throws(() => parseCandidateResponse({ ...candidate, secret: 'unexpected' }), /INVALID_RESPONSE/);
  assert.equal(candidate.transactions.length, 2);
  const finalHeights = candidate.transactions.map(tx => tx.sdkLastValidBlockHeight);
  assert(finalHeights.every(value => Number.isSafeInteger(value)));
  const expected = {
    wallet, vault, shareMint, operation: 'deposit', amountBaseUnits: 1_000_000n,
    observedBlockHeight: Math.min(...finalHeights) - 100, lookupEvidence: [],
  };
  const inspected = inspectUnsignedSequence(candidate.transactions, expected);
  assert.equal(inspected.length, 2);
  assert(inspected.every(tx => tx.serializedSize <= 1232));
  assert.throws(() => assertSemanticAuthorizationAvailable(), /SEMANTIC_POLICY_MISSING/);
  assert.throws(() => inspectUnsignedSequence(candidate.transactions.slice(1), expected), /COUNT_MISMATCH/);
  assert.throws(() => inspectUnsignedSequence([...candidate.transactions].reverse(), expected), /STRUCTURE_MISMATCH/);
  assert.throws(() => inspectUnsignedSequence(candidate.transactions, { ...expected, wallet: vault }), /WALLET_OR_MESSAGE_MISMATCH/);
  assert.throws(() => inspectUnsignedSequence(candidate.transactions, { ...expected, vault: wallet }), /STRUCTURE_MISMATCH/);
  assert.throws(() => inspectUnsignedSequence(candidate.transactions, { ...expected, shareMint: wallet }), /STRUCTURE_MISMATCH/);
  assert.throws(() => inspectUnsignedSequence(candidate.transactions, { ...expected, amountBaseUnits: 2_000_000n }), /AMOUNT_MISMATCH/);
  assert.throws(() => inspectUnsignedSequence(candidate.transactions, { ...expected, observedBlockHeight: Math.max(...finalHeights) }), /STALE_BLOCKHASH/);
  const signed = Buffer.from(candidate.transactions[0].unsignedTransactionBase64, 'base64');
  signed[1] = 1;
  assert.throws(() => inspectUnsignedSequence([
    { ...candidate.transactions[0], unsignedTransactionBase64: signed.toString('base64') }, candidate.transactions[1],
  ], expected), /SIGNED_PAYLOAD_FORBIDDEN/);
  const feePayerChanged = Buffer.from(candidate.transactions[0].unsignedTransactionBase64, 'base64');
  feePayerChanged.set(new PublicKey(vault).toBuffer(), 70);
  assert.throws(() => inspectUnsignedSequence([
    { ...candidate.transactions[0], unsignedTransactionBase64: feePayerChanged.toString('base64') }, candidate.transactions[1],
  ], expected), /WALLET_OR_MESSAGE_MISMATCH/);
  const substituteKey = (transaction, from, to) => {
    const bytes = Buffer.from(transaction.unsignedTransactionBase64, 'base64');
    const location = bytes.indexOf(new PublicKey(from).toBuffer());
    assert(location > 0);
    bytes.set(new PublicKey(to).toBuffer(), location);
    return { ...transaction, unsignedTransactionBase64: bytes.toString('base64') };
  };
  const sourceUsdc = '7EJSueeCjseYzghxU2XhcGEUn7RJDh43Z2dL6dvGy9mw';
  const vaultUsdc = 'DzFZmcJvxKF71pXo9WKvgLf7m6XpudqmEq6qRvhmwHCt';
  for (const address of [sourceUsdc, vaultUsdc]) {
    assert.throws(() => inspectUnsignedSequence([
      candidate.transactions[0], substituteKey(candidate.transactions[1], address, wallet),
    ], expected), /STRUCTURE_MISMATCH/);
  }
  assert.throws(() => inspectUnsignedSequence([
    substituteKey(candidate.transactions[0], 'BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate', vault),
    candidate.transactions[1],
  ], expected), /UNKNOWN_PROGRAM/);
  const tooLarge = Buffer.concat([Buffer.from(candidate.transactions[0].unsignedTransactionBase64, 'base64'), Buffer.alloc(260)]);
  assert.throws(() => inspectUnsignedSequence([
    { ...candidate.transactions[0], unsignedTransactionBase64: tooLarge.toString('base64') }, candidate.transactions[1],
  ], expected), /SIZE_BOUND/);
  assert.throws(() => inspectUnsignedSequence([
    { ...candidate.transactions[0], sdkPayer: vault }, candidate.transactions[1],
  ], expected), /WALLET_OR_MESSAGE_MISMATCH/);
  assert.throws(() => inspectUnsignedSequence([
    { ...candidate.transactions[0], unsignedTransactionBase64: '%%%!' }, candidate.transactions[1],
  ], expected), /NONCANONICAL_TRANSACTION/);
  const changed = Buffer.from(candidate.transactions[1].unsignedTransactionBase64, 'base64');
  const discriminator = Buffer.from('585c9edb5347efa4', 'hex');
  const location = changed.indexOf(discriminator);
  assert(location > 0);
  changed[location + 8] ^= 1;
  assert.throws(() => inspectUnsignedSequence([
    candidate.transactions[0], { ...candidate.transactions[1], unsignedTransactionBase64: changed.toString('base64') },
  ], expected), /STRUCTURE_MISMATCH/);
  assert.match(createHash('sha256').update(inspected[0].decoded.messageBase64).digest('hex'), /^[a-f0-9]{64}$/);
});

test('builder caller bounds request, timeout, output and JSON', async () => {
  const workerPath = new URL('./fake-worker.mjs', import.meta.url).pathname;
  const request = {
    intentId: 'c3p-' + 'a'.repeat(32), configurationVersion: 'candidate/v1',
    operation: 'deposit', expectedRevision: '1',
  };
  assert.deepEqual(await requestIsolatedCandidate(request, { workerPath }), { code: 'C3_REDEMPTION_REQUIRES_DEPLOYED_POSITION' });
  await assert.rejects(requestIsolatedCandidate({ ...request, wallet }, { workerPath }), /INVALID_REQUEST/);
  await assert.rejects(requestIsolatedCandidate({ ...request, configurationVersion: 'timeout' },
    { workerPath, timeoutMs: 30 }), /TIMED_OUT/);
  await assert.rejects(requestIsolatedCandidate({ ...request, configurationVersion: 'oversize' },
    { workerPath }), /OUTPUT_TOO_LARGE/);
  await assert.rejects(requestIsolatedCandidate({ ...request, configurationVersion: 'malformed' },
    { workerPath }), /MALFORMED_JSON/);
});
