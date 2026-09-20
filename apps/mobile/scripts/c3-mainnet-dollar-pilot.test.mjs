import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  allocatePilotUsdc,
  estimateBountyUsdc,
  evaluatePilotReadiness,
  TOKEN_PROGRAM,
  UPGRADEABLE_LOADER,
} from '../../../scripts/lib/c3-mainnet-dollar-pilot.mjs'

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(
  fs.readFileSync(path.resolve(mobileDir, '../../config/c3/c3-mainnet-dollar-pilot-candidate.v1.json'), 'utf8'),
)

assert.deepEqual(allocatePilotUsdc(1_000_000n), {
  cbBtc: 400_000n,
  portalEth: 300_000n,
  wsol: 300_000n,
})
assert.throws(() => allocatePilotUsdc(999_999n), RangeError)
assert.equal(
  estimateBountyUsdc({ bountyLamports: 2_224_999n, solOutputLamports: 2_716_401n, solInputUsdcBaseUnits: 300_000n }),
  245_730n,
)
assert.equal(config.fees.collectionEnabled, false)
assert.equal(config.fees.skrDiscountEnabled, false)
assert.equal(config.network.capabilityEnabled, false)

const mint = (decimals) => ({
  value: {
    owner: TOKEN_PROGRAM,
    data: { parsed: { type: 'mint', info: { isInitialized: true, decimals } } },
  },
})

function readyFixture() {
  const candidate = structuredClone(config)
  candidate.deployment = {
    vaultAddress: candidate.symmetry.programId,
    shareMint: candidate.assets.inputUsdc.mint,
    configurationSquads: candidate.assets.cbBtc.mint,
    emergencySquads: candidate.assets.portalEth.mint,
    keeperPublicKey: candidate.assets.wsol.mint,
    jupiterProductionCredentialProvisioned: true,
    oneDollarUnsignedBuildSecurityApproved: true,
    securityApprovalRecorded: true,
    squadsApprovalRecorded: true,
  }
  const quotes = Object.fromEntries(
    candidate.pilot.quoteSizesUsdc.map((size) => [
      String(size),
      { cbBtc: { verified: true }, portalEth: { verified: true }, wsol: { verified: true } },
    ]),
  )
  return {
    config: candidate,
    evidence: {
      rpcHealth: 'ok',
      program: { value: { executable: true, owner: UPGRADEABLE_LOADER } },
      globalConfig: { value: { owner: candidate.symmetry.programId } },
      mints: {
        inputUsdc: mint(6),
        cbBtc: mint(8),
        portalEth: mint(8),
        wsol: mint(9),
      },
      quotes,
      pyth: { authenticated: true, fresh: true },
    },
  }
}

const baseline = readyFixture()
assert.equal(evaluatePilotReadiness(baseline.config, baseline.evidence).decision, 'GO')

for (const mutate of [
  ({ config: value }) => (value.network.cluster = 'devnet'),
  ({ config: value }) => (value.network.capabilityEnabled = true),
  ({ config: value }) => (value.methodology.cbBtcBps = 3_999),
  ({ config: value }) => (value.fees.collectionEnabled = true),
  ({ evidence }) => (evidence.mints.portalEth.value.owner = '11111111111111111111111111111111'),
  ({ evidence }) => (evidence.quotes['1'].cbBtc.verified = false),
  ({ evidence }) => (evidence.pyth.fresh = false),
  ({ evidence }) => (evidence.rpcHealth = 'unavailable'),
  ({ config: value }) => (value.deployment.jupiterProductionCredentialProvisioned = false),
  ({ config: value }) => (value.deployment.oneDollarUnsignedBuildSecurityApproved = false),
  ({ config: value }) => (value.deployment.securityApprovalRecorded = false),
]) {
  const fixture = readyFixture()
  mutate(fixture)
  assert.equal(evaluatePilotReadiness(fixture.config, fixture.evidence).decision, 'NO-GO')
}

assert.equal(evaluatePilotReadiness(config, {}).decision, 'NO-GO')
console.log('C3 Mainnet one-dollar pilot readiness tests passed.')
