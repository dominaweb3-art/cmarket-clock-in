import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateC3CandidateFee, C3_FEE_POLICY } from '../constants/c3-fee-policy.ts'
import { READINESS_CONSTANTS, evaluateC3DevnetReadiness } from '../../../scripts/lib/c3-devnet-readiness.mjs'

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidate = JSON.parse(
  fs.readFileSync(path.resolve(mobileDir, '../../config/c3/c3-devnet-candidate.v1.json'), 'utf8'),
)

assert.equal(
  candidate.methodology.bitcoinBps + candidate.methodology.ethereumBps + candidate.methodology.solanaBps,
  10_000,
)
assert.equal(C3_FEE_POLICY.collectionEnabled, false)
assert.equal(C3_FEE_POLICY.skrDiscountEnabled, false)
assert.deepEqual(calculateC3CandidateFee(5_000_000n, 'buy', false), {
  grossBaseUnits: 5_000_000n,
  feeBaseUnits: 7_500n,
  netBaseUnits: 4_992_500n,
  rateUnits: 150n,
  rateDenominator: 100_000n,
  roundingExcessNumerator: 0n,
})
assert.equal(calculateC3CandidateFee(5_000_000n, 'sell', true).feeBaseUnits, 3_750n)
assert.deepEqual(calculateC3CandidateFee(1n, 'buy', false), {
  grossBaseUnits: 1n,
  feeBaseUnits: 1n,
  netBaseUnits: 0n,
  rateUnits: 150n,
  rateDenominator: 100_000n,
  roundingExcessNumerator: 99_850n,
})
assert.throws(() => calculateC3CandidateFee(-1n, 'buy', false), RangeError)

function account(owner, options = {}) {
  return {
    value: {
      owner,
      executable: options.executable ?? false,
      data: options.mint
        ? { parsed: { type: 'mint', info: { isInitialized: true, decimals: options.decimals } } }
        : ['AA==', 'base64'],
    },
  }
}

function readyFixture() {
  const config = structuredClone(candidate)
  config.assets.bitcoin.mint = '11111111111111111111111111111112'
  config.assets.ethereum.mint = '11111111111111111111111111111113'
  config.share.accounting = 'verified program test vectors'
  config.metadata.uri = 'https://example.invalid/c3dev.json'
  config.deployment = {
    vaultId: 42,
    expectedShareMint: '11111111111111111111111111111114',
    expectedVaultPda: '11111111111111111111111111111115',
    creationPlanSha256: 'a'.repeat(64),
    squadsApprovalEvidence: 'https://example.invalid/squads/proposal/42',
  }
  config.authorities.creator = '11111111111111111111111111111111'
  config.authorities.hostFeeDestination = READINESS_CONSTANTS.TOKEN_PROGRAM
  config.authorities.configuration = config.symmetry.programId
  config.authorities.emergency = READINESS_CONSTANTS.PYTH_RECEIVER_PROGRAM
  config.authorities.keeper = config.symmetry.associatedTokenProgram
  const mintEvidence = {
    inputUsdc: account(READINESS_CONSTANTS.TOKEN_PROGRAM, { mint: true, decimals: 6 }),
    bitcoin: account(READINESS_CONSTANTS.TOKEN_PROGRAM, { mint: true, decimals: 8 }),
    ethereum: account(READINESS_CONSTANTS.TOKEN_PROGRAM, { mint: true, decimals: 8 }),
    solana: account(READINESS_CONSTANTS.TOKEN_PROGRAM, { mint: true, decimals: 9 }),
  }
  const oracleEvidence = Object.fromEntries(
    ['bitcoin', 'ethereum', 'solana'].map((name) => [
      name,
      { account: account(READINESS_CONSTANTS.PYTH_RECEIVER_PROGRAM), fresh: true },
    ]),
  )
  return {
    config,
    evidence: {
      rpcHealth: 'ok',
      program: account(READINESS_CONSTANTS.UPGRADEABLE_LOADER, { executable: true }),
      globalConfig: account(config.symmetry.programId),
      symmetryUsdc: account(READINESS_CONSTANTS.TOKEN_PROGRAM, { mint: true, decimals: 6 }),
      mints: mintEvidence,
      oracles: oracleEvidence,
      routes: { bitcoin: { verified: true }, ethereum: { verified: true }, solana: { verified: true } },
    },
  }
}

const baseline = readyFixture()
assert.equal(evaluateC3DevnetReadiness(baseline.config, baseline.evidence).decision, 'GO')

for (const mutate of [
  ({ config }) => (config.network.cluster = 'mainnet-beta'),
  ({ config }) => (config.assets.bitcoin.mint = null),
  ({ config }) => (config.assets.inputUsdc.mint = 'not-a-mint'),
  ({ config }) => (config.assets.bitcoin.productionForbidden = false),
  ({ config }) => (config.authorities.emergency = 'PLACEHOLDER'),
  ({ config }) => (config.authorities.emergency = config.authorities.configuration),
  ({ config }) => (config.deployment.creationPlanSha256 = null),
  ({ config }) => (config.share.accounting = 'UNVERIFIED'),
  ({ evidence }) => (evidence.mints.ethereum.value.owner = '11111111111111111111111111111111'),
  ({ evidence }) => (evidence.oracles.bitcoin.fresh = false),
  ({ evidence }) => (evidence.oracles.ethereum.account = null),
  ({ evidence }) => (evidence.routes.solana.verified = false),
]) {
  const fixture = readyFixture()
  mutate(fixture)
  assert.equal(evaluateC3DevnetReadiness(fixture.config, fixture.evidence).decision, 'NO-GO')
}

assert.equal(evaluateC3DevnetReadiness(candidate, {}).decision, 'NO-GO')
console.log('C3 Devnet deployment specification security checks passed.')
