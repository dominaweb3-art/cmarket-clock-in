import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { PublicKey } from '@solana/web3.js';

import { buildUnsigned, USDC } from '../src/builder.mjs';
import { inspectUnsignedSequence } from '../../c3-mainnet/src/pilot-builder-boundary.ts';
import { C3_MAINNET_EXECUTION_CAPABILITY } from '../../c3-mainnet/src/constants.ts';

const require = createRequire(import.meta.url);
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const sdk = require('@symmetry-hq/sdk/package.json');
const integrity = lock.packages['node_modules/@symmetry-hq/sdk']?.integrity ===
  'sha512-yopoVu6VnFiktGsjgeJ2dbFX8pdciePK7BUFNbUYb5wAto6DQqVq6a51qE33dRT6BRkL/ANBpKZEJgqpJX+KMA==';
let foundationCommitted = false;
try {
  execFileSync('git', ['merge-base', '--is-ancestor', '891300b', 'HEAD'], {
    cwd: new URL('../../..', import.meta.url), stdio: 'ignore',
  });
  foundationCommitted = true;
} catch { /* not the expected Git checkpoint */ }
const flags = {
  M5A_FOUNDATION_COMMITTED: foundationCommitted,
  BUILDER_PACKAGE_ISOLATED: true,
  SDK_VERSION_PINNED: sdk.version === '1.0.22',
  SDK_INTEGRITY_VERIFIED: integrity,
  DEPOSIT_FIXTURE_BUILT: false,
  DEPOSIT_TRANSACTIONS_VALIDATED: false,
  REDEMPTION_CANDIDATE_BUILT: false,
  AUTHORIZATION_MANIFEST_DURABLE: false,
  RPC_RECONCILIATION_IMPLEMENTED: false,
  C3_VAULT_CONFIGURED: false,
  C3_SHARE_MINT_CONFIGURED: false,
  OWNER_WALLET_CONFIGURED: false,
  TWO_RPC_PROVIDERS_CONFIGURED: false,
  MAINNET_EXECUTION_ENABLED: C3_MAINNET_EXECUTION_CAPABILITY,
  PHONE_REQUIRED_NEXT: false,
};
let structureInspected = false;
try {
  const wallet = new PublicKey(Buffer.alloc(32, 7)).toBase58();
  const vault = 'AwDFvjEPPwdF1YgXV8asNt6LeEFDduinYneCn6mHDAsh';
  const shareMint = '9ihGfswnUZ6MysSR3KgmrZ57FXDVAiAQ6sEHwLuWwzJ4';
  const candidate = await buildUnsigned({
    cluster: 'mainnet-beta', wallet, vault, shareMint, usdcMint: USDC,
    amountBaseUnits: '1000000', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    rpcUrl: 'https://api.mainnet-beta.solana.com', operation: 'deposit', positionVerified: false,
  });
  flags.DEPOSIT_FIXTURE_BUILT = candidate.transactions.length === 2;
  const heights = candidate.transactions.map(tx => tx.sdkLastValidBlockHeight);
  inspectUnsignedSequence(candidate.transactions, {
    wallet, vault, shareMint, operation: 'deposit', amountBaseUnits: 1_000_000n,
    observedBlockHeight: Math.min(...heights) - 100, lookupEvidence: [],
  });
  structureInspected = true; // Not exhaustive semantic authorization.
} catch { /* Readiness is evidence-only; never print provider errors. */ }
for (const [name, value] of Object.entries(flags)) console.log(`${name}: ${value}`);
console.log('DEPOSIT_STRUCTURE_INSPECTED: ' + structureInspected);
console.log('REDEMPTION_TYPED_GATE: true');
console.log('RPC_INTAKE_INTERFACES_ONLY: true');
const executionGo = structureInspected && flags.DEPOSIT_TRANSACTIONS_VALIDATED &&
  flags.AUTHORIZATION_MANIFEST_DURABLE && flags.RPC_RECONCILIATION_IMPLEMENTED &&
  flags.C3_VAULT_CONFIGURED && flags.C3_SHARE_MINT_CONFIGURED &&
  flags.OWNER_WALLET_CONFIGURED && flags.TWO_RPC_PROVIDERS_CONFIGURED &&
  flags.MAINNET_EXECUTION_ENABLED;
console.log('OVERALL_EXECUTION_GO: ' + executionGo);
// A readiness command must fail CI while semantic authorization/deployment is absent.
if (!executionGo) process.exitCode = 1;
