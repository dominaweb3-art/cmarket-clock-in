#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import bs58 from 'bs58'
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'

const mobileDir = path.resolve(new URL('.', import.meta.url).pathname, '..')
const generatedResultsDir = path.join(mobileDir, 'dist', 'generated-results')
const resultPath = path.join(generatedResultsDir, 'c3-core-mainnet-build-simulation.json')
const rpcUrl = 'https://api.mainnet.solana.com'
const buildUrl = 'https://api.jup.ag/swap/v2/build'
const programLabelsUrl = 'https://api.jup.ag/swap/v1/program-id-to-label'
const mainnetUsdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const cbBtcMint = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'
const portalEthMint = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'
const wrappedSolMint = 'So11111111111111111111111111111111111111112'
const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const token2022Program = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const systemProgram = '11111111111111111111111111111111'
const associatedTokenProgram = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const computeBudgetProgram = 'ComputeBudget111111111111111111111111111111'
const testAddress = process.env.C3_MAINNET_TEST_ADDRESS || 'DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej'
const maxTransactionBytes = 1232
const maxComputeUnits = 1_400_000
const slippageBps = 100
const blockhashSlotsToExpiry = 150

const purchases = [
  { totalUsdc: 50, cbBtcUsdc: 20, portalEthUsdc: 15, solUsdc: 15 },
  { totalUsdc: 100, cbBtcUsdc: 40, portalEthUsdc: 30, solUsdc: 30 },
  { totalUsdc: 500, cbBtcUsdc: 200, portalEthUsdc: 150, solUsdc: 150 },
]

const knownProgramLabels = {
  [systemProgram]: 'System Program',
  [tokenProgram]: 'SPL Token Program',
  [token2022Program]: 'SPL Token-2022 Program',
  [associatedTokenProgram]: 'Associated Token Program',
  [computeBudgetProgram]: 'Compute Budget Program',
}

function parseEnvLine(line) {
  const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
  if (!match) return null
  let value = match[2]
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return [match[1], value]
}

async function loadValueByName(name) {
  if (process.env[name]) return process.env[name]
  for (const filename of ['.env', '.env.local']) {
    try {
      const contents = await fs.readFile(path.join(mobileDir, filename), 'utf8')
      for (const line of contents.split(/\r?\n/)) {
        const parsed = parseEnvLine(line)
        if (parsed?.[0] === name) return parsed[1]
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return null
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function toBaseUnits(usdc) {
  return String(Math.round(usdc * 1_000_000))
}

function decodeBlockhash(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return bs58.encode(Buffer.from(value))
  throw new Error('Jupiter returned an invalid blockhash format')
}

function toInstruction(payload) {
  return new TransactionInstruction({
    programId: new PublicKey(payload.programId),
    keys: payload.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(payload.data, 'base64'),
  })
}

function flattenBuildInstructions(build) {
  return [
    ...(build.computeBudgetInstructions || []),
    ...(build.setupInstructions || []),
    ...(build.otherInstructions || []),
    ...(build.swapInstruction ? [build.swapInstruction] : []),
    ...(build.cleanupInstruction ? [build.cleanupInstruction] : []),
    ...(build.tipInstruction ? [build.tipInstruction] : []),
  ]
}

function buildInstructionCounts(build) {
  return {
    computeBudget: build.computeBudgetInstructions?.length || 0,
    setup: build.setupInstructions?.length || 0,
    other: build.otherInstructions?.length || 0,
    swap: build.swapInstruction ? 1 : 0,
    cleanup: build.cleanupInstruction ? 1 : 0,
    tip: build.tipInstruction ? 1 : 0,
    total: flattenBuildInstructions(build).length,
  }
}

function lookupTablesFromBuild(build) {
  return Object.entries(build.addressesByLookupTableAddress || {}).map(
    ([key, addresses]) =>
      new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: {
          deactivationSlot: BigInt('18446744073709551615'),
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          addresses: addresses.map((address) => new PublicKey(address)),
        },
      }),
  )
}

function compileUnsignedTransaction(builds, connection) {
  const latest = builds.reduce((current, build) =>
    Number(build.blockhashWithMetadata.lastValidBlockHeight) >
    Number(current.blockhashWithMetadata.lastValidBlockHeight)
      ? build
      : current,
  )
  const lookupTables = new Map()
  for (const build of builds) {
    for (const table of lookupTablesFromBuild(build)) lookupTables.set(table.key.toBase58(), table)
  }
  const instructions = builds.flatMap(flattenBuildInstructions).map(toInstruction)
  const message = new TransactionMessage({
    payerKey: new PublicKey(testAddress),
    recentBlockhash: decodeBlockhash(latest.blockhashWithMetadata.blockhash),
    instructions,
  }).compileToV0Message([...lookupTables.values()])
  const transaction = new VersionedTransaction(message)
  return { transaction, lookupTables: [...lookupTables.values()], instructions, connection }
}

function accountSummary(transaction) {
  const message = transaction.message
  const requiredSigners = message.staticAccountKeys
    .slice(0, message.header.numRequiredSignatures)
    .map((key) => key.toBase58())
  return {
    feePayer: message.staticAccountKeys[0]?.toBase58() || null,
    requiredSigners,
    staticAccountCount: message.staticAccountKeys.length,
    lookupTableCount: message.addressTableLookups.length,
    lookupTableAddresses: message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58()),
    compiledInstructionCount: message.compiledInstructions.length,
  }
}

function instructionSummary(build, expectedLeg) {
  const instructions = flattenBuildInstructions(build)
  return instructions.map((instruction) => ({
    programId: instruction.programId,
    accountCount: instruction.accounts.length,
    signerAccounts: instruction.accounts.filter((account) => account.isSigner).map((account) => account.pubkey),
    writableAccounts: instruction.accounts.filter((account) => account.isWritable).map((account) => account.pubkey),
    dataBytes: Buffer.from(instruction.data, 'base64').length,
    role:
      instruction === build.swapInstruction
        ? 'swap'
        : instruction === build.cleanupInstruction
          ? 'cleanup'
          : 'supporting',
    expectedOutputMint: expectedLeg.outputMint,
  }))
}

function unique(values) {
  return [...new Set(values)]
}

function decodeU32(data) {
  if (data.length < 4) return null
  return data.readUInt32LE(0)
}

function decodeU8(data) {
  return data.length ? data.readUInt8(0) : null
}

function structuralChecks(build, transaction, leg, treasuryAddress) {
  const instructions = flattenBuildInstructions(build)
  const outputAta =
    leg.asset === 'SOL'
      ? testAddress
      : getAssociatedTokenAddressSync(
          new PublicKey(leg.outputMint),
          new PublicKey(testAddress),
          false,
          new PublicKey(tokenProgram),
          new PublicKey(associatedTokenProgram),
        ).toBase58()
  const signerAccounts = unique(
    instructions.flatMap((instruction) =>
      instruction.accounts.filter((account) => account.isSigner).map((account) => account.pubkey),
    ),
  )
  const programIds = unique(instructions.map((instruction) => instruction.programId))
  const outputMentions = unique(
    instructions
      .flatMap((instruction) => instruction.accounts.map((account) => account.pubkey))
      .filter((account) => account === outputAta),
  )
  const unexpected = []

  if (build.inputMint !== mainnetUsdcMint) unexpected.push(`input mint mismatch: ${build.inputMint}`)
  if (build.outputMint !== leg.outputMint) unexpected.push(`output mint mismatch: ${build.outputMint}`)
  if (build.inAmount !== leg.inputAmountBaseUnits) unexpected.push(`input amount mismatch: ${build.inAmount}`)
  if (build.taker && build.taker !== testAddress) unexpected.push(`taker mismatch: ${build.taker}`)
  if (
    treasuryAddress &&
    instructions.some((instruction) => instruction.accounts.some((account) => account.pubkey === treasuryAddress))
  ) {
    unexpected.push('configured Devnet treasury appears in a Mainnet build')
  }
  if (!outputMentions.length) unexpected.push(`expected output destination not present: ${outputAta}`)
  if (signerAccounts.some((account) => account !== testAddress))
    unexpected.push(`unexpected signer account: ${signerAccounts.join(',')}`)

  for (const instruction of instructions) {
    const data = Buffer.from(instruction.data, 'base64')
    if (
      instruction.programId === systemProgram &&
      decodeU32(data) === 2 &&
      instruction.accounts[1]?.pubkey !== testAddress
    ) {
      unexpected.push(`unexpected top-level SOL transfer destination: ${instruction.accounts[1]?.pubkey || 'missing'}`)
    }
    if (instruction.programId === tokenProgram || instruction.programId === token2022Program) {
      const tokenInstruction = decodeU8(data)
      const prohibited = [4, 5, 6]
      if (prohibited.includes(tokenInstruction))
        unexpected.push(`prohibited token authority instruction: ${tokenInstruction}`)
      if (tokenInstruction === 9 && leg.asset !== 'SOL') unexpected.push('unexpected token close-account instruction')
    }
  }

  const messageAccounts = accountSummary(transaction)
  const requiredSignerSafe =
    messageAccounts.requiredSigners.length === 1 && messageAccounts.requiredSigners[0] === testAddress
  if (!requiredSignerSafe)
    unexpected.push(`compiled required signers are not user-only: ${messageAccounts.requiredSigners.join(',')}`)
  if (messageAccounts.feePayer !== testAddress) unexpected.push(`fee payer mismatch: ${messageAccounts.feePayer}`)

  return {
    passed: unexpected.length === 0,
    expectedOutputDestination: outputAta,
    outputDestinationMentions: outputMentions,
    signerAccounts,
    programIds,
    issues: unexpected,
  }
}

function classifySimulation(simulation) {
  if (simulation.rpcError) return 'rpc_error'
  if (!simulation.err) return 'simulated_success'
  const text = JSON.stringify({ err: simulation.err, logs: simulation.logs || [] }).toLowerCase()
  if (
    /insufficient|accountnotfound|account not found|owner does not match|invalid account|custom program error: 0x1/.test(
      text,
    )
  ) {
    return 'failed_environmental_public_test_address'
  }
  return 'failed_structural_or_route'
}

async function requestJson(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    let body = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return { response, body }
  } finally {
    clearTimeout(timer)
  }
}

async function rpcCall(method, params = []) {
  const { response, body } = await requestJson(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok || body?.error) throw new Error(`${method}: ${body?.error?.message || `HTTP ${response.status}`}`)
  return body.result
}

async function fetchBuild(leg, apiKey) {
  const url = new URL(buildUrl)
  url.searchParams.set('inputMint', mainnetUsdcMint)
  url.searchParams.set('outputMint', leg.outputMint)
  url.searchParams.set('amount', leg.inputAmountBaseUnits)
  url.searchParams.set('taker', testAddress)
  url.searchParams.set('slippageBps', String(slippageBps))
  url.searchParams.set('maxAccounts', '64')
  url.searchParams.set('wrapAndUnwrapSol', 'true')
  url.searchParams.set('blockhashSlotsToExpiry', String(blockhashSlotsToExpiry))
  url.searchParams.set('computeUnitPricePercentile', 'medium')
  if (leg.asset === 'SOL') url.searchParams.set('nativeDestinationAccount', testAddress)
  const { response, body } = await requestJson(url, { headers: { 'x-api-key': apiKey } })
  if (!response.ok || body?.error)
    throw new Error(`Jupiter /build ${response.status}: ${body?.error || body?.message || 'request failed'}`)
  if (!body.blockhashWithMetadata || !body.swapInstruction)
    throw new Error('Jupiter /build returned no usable instructions')
  return { ...body, requestUrl: url.toString() }
}

async function fetchProgramLabels(apiKey, programIds) {
  const { response, body } = await requestJson(programLabelsUrl, { headers: { 'x-api-key': apiKey } })
  if (!response.ok || !body || typeof body !== 'object')
    throw new Error(`Jupiter program label endpoint ${response.status}`)
  const resolved = {}
  const unknown = []
  for (const programId of programIds) {
    const label = knownProgramLabels[programId] || body[programId] || null
    resolved[programId] = label
    if (!label) unknown.push(programId)
  }
  return { endpoint: programLabelsUrl, resolved, unknown }
}

async function simulate(connection, transaction) {
  try {
    const simulation = await connection.simulateTransaction(transaction, {
      commitment: 'processed',
      replaceRecentBlockhash: true,
      sigVerify: false,
    })
    return {
      status: classifySimulation(simulation.value),
      err: simulation.value.err,
      unitsConsumed: simulation.value.unitsConsumed ?? null,
      logs: simulation.value.logs || [],
    }
  } catch (error) {
    return { status: 'rpc_error', rpcError: error.message, err: null, unitsConsumed: null, logs: [] }
  }
}

function buildLegSummary(build, transaction, leg, structural, simulation) {
  const bytes = transaction.serialize().length
  return {
    asset: leg.asset,
    inputAmountUsdc: leg.inputAmountUsdc,
    inputAmountBaseUnits: leg.inputAmountBaseUnits,
    inputMint: build.inputMint,
    outputMint: build.outputMint,
    expectedOutputBaseUnits: build.outAmount,
    minimumOutputBaseUnits: build.otherAmountThreshold,
    slippageBps: build.slippageBps ?? slippageBps,
    priceImpactPct: build.priceImpactPct ?? null,
    routePlan: (build.routePlan || []).map((route) => ({
      label: route.swapInfo?.label || null,
      ammKey: route.swapInfo?.ammKey || null,
      inputMint: route.swapInfo?.inputMint || null,
      outputMint: route.swapInfo?.outputMint || null,
      inputAmount: route.swapInfo?.inAmount || null,
      outputAmount: route.swapInfo?.outAmount || null,
    })),
    feeFields: {
      prioritizationFeeLamports: build.prioritizationFeeLamports ?? null,
      platformFee: build.platformFee ?? null,
      tipInstructionPresent: Boolean(build.tipInstruction),
    },
    accountCreation: {
      setupInstructionCount: build.setupInstructions?.length || 0,
      associatedTokenAccountProgramUsed: (build.setupInstructions || []).some(
        (instruction) => instruction.programId === associatedTokenProgram,
      ),
      outputAta: structural.expectedOutputDestination,
    },
    blockhash: {
      lastValidBlockHeight: build.blockhashWithMetadata.lastValidBlockHeight,
      slotsToExpiryRequested: blockhashSlotsToExpiry,
    },
    instructionCounts: buildInstructionCounts(build),
    instructionSummary: instructionSummary(build, leg),
    serializedBytes: bytes,
    under1232Bytes: bytes <= maxTransactionBytes,
    transactionAccounts: accountSummary(transaction),
    structural,
    simulation,
    simulationLogsPersisted: true,
  }
}

async function main() {
  const apiKey = await loadValueByName('JUPITER_API_KEY')
  const treasuryAddress = await loadValueByName('EXPO_PUBLIC_DEVNET_TREASURY_PUBLIC_KEY')
  const observedAt = new Date().toISOString()
  const connection = new Connection(rpcUrl, 'processed')
  const result = {
    observedAt,
    cluster: 'mainnet-beta',
    api: {
      buildEndpoint: buildUrl,
      programLabelsEndpoint: programLabelsUrl,
      apiKeyProvided: Boolean(apiKey),
      apiKeyValuePersisted: false,
    },
    publicTestAddress: testAddress,
    inputMint: mainnetUsdcMint,
    outputMints: { cbBTC: cbBtcMint, portalEth: portalEthMint, nativeSol: wrappedSolMint },
    slippageBps,
    maxTransactionBytes,
    maxComputeUnits,
    purchases: [],
    combined: { status: 'not_attempted' },
    programValidation: { status: 'not_attempted', unknown: [] },
    rpcSimulation: { signatureVerification: false, transactionsSubmitted: false },
    mobileWalletAdapterSequence: [
      'Review fresh quote and exact input/output/minimums.',
      'Request signAndSendTransactions for cbBTC leg only.',
      'Wait for finality and record receipt before continuing.',
      'Repeat review, approval, confirmation, and receipt for Portal ETH.',
      'Repeat review, approval, confirmation, and receipt for native SOL.',
    ],
    partialFailureModel: {
      automaticRetry: false,
      automaticReverse: false,
      preserveRemainingUsdc: true,
      showCompletedAndPendingLegsSeparately: true,
      resumeRequiresExplicitApproval: true,
      idempotencyKey: 'userPublicKey + purchaseId + basketVersion + legAsset + quoteRequestId',
    },
    decision: 'BLOCKED',
    blockers: [],
    unsignedPayloadPersisted: false,
  }

  console.log('C3 Core Mainnet build and simulation harness (read-only)')
  console.log(`Observed at: ${observedAt}`)
  console.log(`RPC: ${rpcUrl}`)
  console.log(`Jupiter Swap API v2 build: ${buildUrl}`)
  console.log(`Jupiter API key: ${apiKey ? 'provided (value hidden)' : 'missing'}`)
  console.log('Wallet authorization/signing/submission: not performed')

  if (!apiKey) {
    result.blockers.push(
      'Jupiter Swap API v2 and the official program-label endpoint require JUPITER_API_KEY; no key was available.',
    )
    console.log('Decision: BLOCKED — missing JUPITER_API_KEY; no build or simulation was attempted.')
    await fs.mkdir(generatedResultsDir, { recursive: true })
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`)
    process.exitCode = 1
    return
  }

  try {
    const [health, version, testBalance, usdcAccounts] = await Promise.all([
      rpcCall('getHealth'),
      rpcCall('getVersion'),
      rpcCall('getBalance', [testAddress, { commitment: 'processed' }]),
      rpcCall('getTokenAccountsByOwner', [
        testAddress,
        { mint: mainnetUsdcMint },
        { encoding: 'jsonParsed', commitment: 'processed' },
      ]),
    ])
    result.rpc = {
      health,
      version,
      publicTestAddressLamports: testBalance?.value ?? null,
      publicTestAddressUsdcTokenAccounts: usdcAccounts?.value?.length ?? 0,
    }
  } catch (error) {
    result.blockers.push(`Mainnet RPC preflight failed: ${error.message}`)
  }

  const builtLegs = []
  if (!result.blockers.length) {
    for (const purchase of purchases) {
      const purchaseResult = { totalUsdc: purchase.totalUsdc, sequential: [], combined: null }
      const legs = [
        { asset: 'cbBTC', outputMint: cbBtcMint, inputAmountUsdc: purchase.cbBtcUsdc },
        { asset: 'Portal ETH', outputMint: portalEthMint, inputAmountUsdc: purchase.portalEthUsdc },
        { asset: 'SOL', outputMint: wrappedSolMint, inputAmountUsdc: purchase.solUsdc },
      ].map((leg) => ({ ...leg, inputAmountBaseUnits: toBaseUnits(leg.inputAmountUsdc) }))
      for (const leg of legs) {
        try {
          const build = await fetchBuild(leg, apiKey)
          await sleep(2200)
          const { transaction, lookupTables } = compileUnsignedTransaction([build], connection)
          const structural = structuralChecks(build, transaction, leg, treasuryAddress)
          const simulation = await simulate(connection, transaction)
          const summary = buildLegSummary(build, transaction, leg, structural, simulation)
          purchaseResult.sequential.push(summary)
          builtLegs.push({ purchase: purchase.totalUsdc, build, leg, transaction, lookupTables })
          console.log(
            `${purchase.totalUsdc} USDC ${leg.asset}: ${summary.serializedBytes} bytes; simulation=${simulation.status}`,
          )
          if (!structural.passed)
            result.blockers.push(`${purchase.totalUsdc} USDC ${leg.asset}: ${structural.issues.join('; ')}`)
          if (summary.serializedBytes > maxTransactionBytes)
            result.blockers.push(`${purchase.totalUsdc} USDC ${leg.asset}: serialized transaction exceeds 1232 bytes`)
          if (simulation.status === 'failed_structural_or_route' || simulation.status === 'rpc_error')
            result.blockers.push(`${purchase.totalUsdc} USDC ${leg.asset}: ${simulation.status}`)
        } catch (error) {
          purchaseResult.sequential.push({ asset: leg.asset, status: 'build_failed', error: error.message })
          result.blockers.push(`${purchase.totalUsdc} USDC ${leg.asset}: ${error.message}`)
        }
      }
      result.purchases.push(purchaseResult)
    }
  }

  if (builtLegs.length) {
    const programIds = unique(
      builtLegs.flatMap(({ build }) => flattenBuildInstructions(build).map((instruction) => instruction.programId)),
    )
    try {
      const labels = await fetchProgramLabels(apiKey, programIds)
      result.programValidation = labels.unknown.length
        ? { status: 'blocked_unknown_programs', ...labels }
        : { status: 'verified', ...labels }
      if (labels.unknown.length) result.blockers.push(`Unknown program IDs: ${labels.unknown.join(', ')}`)
    } catch (error) {
      result.programValidation = { status: 'unavailable', error: error.message, unknown: programIds }
      result.blockers.push(`Jupiter program-label resolution failed: ${error.message}`)
    }
  }

  if (builtLegs.length === purchases.length * 3) {
    try {
      const combined = compileUnsignedTransaction(
        builtLegs.map(({ build }) => build),
        connection,
      )
      const combinedStructural = {
        requiredSigners: accountSummary(combined.transaction).requiredSigners,
        feePayer: accountSummary(combined.transaction).feePayer,
        under1232Bytes: combined.transaction.serialize().length <= maxTransactionBytes,
      }
      const combinedSimulation = await simulate(connection, combined.transaction)
      result.combined = {
        status: combinedStructural.under1232Bytes ? 'measured' : 'rejected_size',
        serializedBytes: combined.transaction.serialize().length,
        under1232Bytes: combinedStructural.under1232Bytes,
        transactionAccounts: accountSummary(combined.transaction),
        requiredSigners: combinedStructural.requiredSigners,
        feePayer: combinedStructural.feePayer,
        simulation: combinedSimulation,
        transactionCountCombined: 3,
      }
      if (!combinedStructural.under1232Bytes)
        result.blockers.push('Combined three-leg transaction exceeds the 1232-byte limit')
    } catch (error) {
      result.combined = { status: 'build_failed', error: error.message }
      result.blockers.push(`Combined transaction measurement failed: ${error.message}`)
    }
  }

  if (result.blockers.length) {
    result.decision = result.purchases.some((purchase) =>
      purchase.sequential.some((leg) => leg.serializedBytes && leg.structural?.passed),
    )
      ? 'REQUIRES_CHANGES'
      : 'BLOCKED'
  } else {
    result.decision = 'READY_FOR_DISABLED_IMPLEMENTATION'
  }

  await fs.mkdir(generatedResultsDir, { recursive: true })
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  console.log(`Machine-readable result: ${path.relative(repoDir(), resultPath)}`)
  console.log(`Decision: ${result.decision}`)
  if (result.blockers.length) {
    console.log(`Blockers: ${result.blockers.length}`)
    process.exitCode = 1
  }
}

function repoDir() {
  return path.resolve(mobileDir, '../..')
}

main().catch(async (error) => {
  console.error(`Fatal harness error: ${error.message}`)
  process.exitCode = 1
})
