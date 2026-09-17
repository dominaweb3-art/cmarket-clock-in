#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const mobileDir = path.resolve(new URL('.', import.meta.url).pathname, '..')
const repoDir = path.resolve(mobileDir, '../..')
const generatedResultsDir = path.join(mobileDir, 'dist', 'generated-results')
const resultPath = path.join(generatedResultsDir, 'c3-devnet-feasibility.json')
const rpcUrlDefault = 'https://api.devnet.solana.com'
const wsolMint = 'So11111111111111111111111111111111111111112'
const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const jitoDevnet = {
  program: 'DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib',
  stakePool: 'JitoY5pcAxWX6iyP2QdFwTznGb8A99PRCUCVVxB46WZ',
  mint: 'J1tos8mqbhdGcF3pgj4PCKyVjzWSURcpLZU7pPGHxSYi',
}
const purchaseSizes = [5, 10, 50]

function parseEnvLine(line) {
  const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
  if (!match) return null
  let value = match[2]
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return [match[1], value]
}

async function loadLocalEnv() {
  const values = {}
  for (const filename of ['.env', '.env.local']) {
    try {
      const contents = await fs.readFile(path.join(mobileDir, filename), 'utf8')
      for (const line of contents.split(/\r?\n/)) {
        const parsed = parseEnvLine(line)
        if (parsed && (parsed[0].startsWith('EXPO_PUBLIC_') || parsed[0] === 'JUPITER_API_KEY')) {
          values[parsed[0]] = parsed[1]
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return { ...values, ...process.env }
}

function status(label, value, detail = '') {
  const suffix = detail ? ` — ${detail}` : ''
  console.log(`${label}: ${value}${suffix}`)
}

async function rpcCall(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok || body?.error) {
    const message = body?.error?.message || `HTTP ${response.status}`
    throw new Error(`${method}: ${message}`)
  }
  return body.result
}

function mintSummary(result) {
  const value = result?.value
  const parsed = value?.data?.parsed
  if (!value || parsed?.type !== 'mint') {
    return { status: 'unavailable', owner: value?.owner ?? null, decimals: null, supplyBaseUnits: null }
  }
  return {
    status: value.owner === tokenProgram && parsed.info.isInitialized ? 'verified' : 'uncertain',
    owner: value.owner,
    decimals: parsed.info.decimals,
    supplyBaseUnits: parsed.info.supply,
  }
}

async function inspectMint(rpcUrl, mint) {
  const [account, supply] = await Promise.all([
    rpcCall(rpcUrl, 'getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'finalized' }]),
    rpcCall(rpcUrl, 'getTokenSupply', [mint, { commitment: 'finalized' }]),
  ])
  const summary = mintSummary(account)
  const supplyValue = supply?.value
  if (
    summary.status === 'verified' &&
    supplyValue?.amount === summary.supplyBaseUnits &&
    supplyValue.decimals === summary.decimals
  ) {
    return { ...summary, supplyUi: supplyValue.uiAmountString }
  }
  return {
    ...summary,
    status: summary.status === 'unavailable' ? 'unavailable' : 'uncertain',
    supplyUi: supplyValue?.uiAmountString ?? null,
  }
}

async function jupiterQuote({ apiKey, inputMint, outputMint, amount }) {
  const url = new URL('https://api.jup.ag/swap/v1/quote')
  url.searchParams.set('inputMint', inputMint)
  url.searchParams.set('outputMint', outputMint)
  url.searchParams.set('amount', String(amount))
  url.searchParams.set('slippageBps', '100')
  const headers = apiKey ? { 'x-api-key': apiKey } : {}
  const response = await fetch(url, { headers })
  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    return {
      status: response.status === 401 || response.status === 403 ? 'unsupported' : 'unavailable',
      httpStatus: response.status,
      reason: body?.errorCode || body?.error || `HTTP ${response.status}`,
    }
  }
  if (body?.error || !body?.outAmount) {
    return { status: 'unavailable', httpStatus: response.status, reason: body?.errorCode || body?.error || 'no route' }
  }
  return {
    status: 'verified',
    httpStatus: response.status,
    outAmount: body.outAmount,
    priceImpactPct: body.priceImpactPct ?? null,
    routeCount: Array.isArray(body.routePlan) ? body.routePlan.length : null,
    contextSlot: body.contextSlot ?? null,
    timeTakenMs: body.timeTaken ? Math.round(body.timeTaken * 1000) : null,
  }
}

async function main() {
  const env = await loadLocalEnv()
  const rpcUrl = env.EXPO_PUBLIC_SOLANA_RPC_URL || rpcUrlDefault
  const usdcMint = env.EXPO_PUBLIC_DEVNET_USDC_MINT
  const configuredCluster = env.EXPO_PUBLIC_SOLANA_CLUSTER || null
  const usdcDecimals = Number(env.EXPO_PUBLIC_USDC_DECIMALS)
  const missing = ['EXPO_PUBLIC_DEVNET_USDC_MINT', 'EXPO_PUBLIC_USDC_DECIMALS'].filter((name) => !env[name])
  if (missing.length) {
    console.error(`Missing mandatory public configuration: ${missing.join(', ')}`)
    process.exitCode = 2
    return
  }

  const observedAt = new Date().toISOString()
  const result = {
    observedAt,
    cluster: configuredCluster,
    rpcUrl,
    rpc: {},
    mints: {},
    deployment: {},
    jupiter: { endpoint: 'https://api.jup.ag/swap/v1/quote', apiKeyProvided: Boolean(env.JUPITER_API_KEY), routes: [] },
    directJitoAlternative: {},
    decision: 'NO-GO',
  }

  console.log('C3 Devnet feasibility preflight (read-only)')
  console.log(`Observed at: ${observedAt}`)
  console.log(`RPC: ${rpcUrl}`)
  console.log('Wallet authorization: not requested')
  console.log('Transaction construction/serialization/submission: not performed')

  try {
    result.rpc.health = await rpcCall(rpcUrl, 'getHealth')
    result.rpc.version = await rpcCall(rpcUrl, 'getVersion')
    result.rpc.epoch = await rpcCall(rpcUrl, 'getEpochInfo')
    status('RPC status', result.rpc.health === 'ok' ? 'verified' : 'uncertain', `health=${result.rpc.health}`)
  } catch (error) {
    result.rpc = { status: 'unavailable', error: error.message }
    status('RPC status', 'unavailable', error.message)
  }

  try {
    result.mints.usdc = await inspectMint(rpcUrl, usdcMint)
    status('Configured USDC mint', result.mints.usdc.status, `decimals=${result.mints.usdc.decimals ?? 'n/a'}`)
  } catch (error) {
    result.mints.usdc = { status: 'unavailable', error: error.message }
    status('Configured USDC mint', 'unavailable', error.message)
  }

  try {
    result.mints.jitosol = await inspectMint(rpcUrl, jitoDevnet.mint)
    status('JitoSOL Devnet mint', result.mints.jitosol.status, `decimals=${result.mints.jitosol.decimals ?? 'n/a'}`)
  } catch (error) {
    result.mints.jitosol = { status: 'unavailable', error: error.message }
    status('JitoSOL Devnet mint', 'unavailable', error.message)
  }

  for (const [name, address] of Object.entries({ program: jitoDevnet.program, stakePool: jitoDevnet.stakePool })) {
    try {
      const account = await rpcCall(rpcUrl, 'getAccountInfo', [
        address,
        { encoding: 'base64', commitment: 'finalized' },
      ])
      result.deployment[name] = {
        status: account?.value ? 'verified' : 'unavailable',
        executable: account?.value?.executable ?? null,
        owner: account?.value?.owner ?? null,
      }
    } catch (error) {
      result.deployment[name] = { status: 'unavailable', error: error.message }
    }
  }
  const deploymentReady =
    result.deployment.program?.status === 'verified' && result.deployment.stakePool?.status === 'verified'
  result.directJitoAlternative = {
    status: deploymentReady ? 'conditional' : 'unavailable',
    reason: deploymentReady
      ? 'Jito Devnet program, stake pool, and mint accounts exist; direct mint requires SOL or stake accounts, not the current USDC payment alone.'
      : 'Official Jito Devnet deployment accounts were not both readable.',
  }
  status('Jito direct alternative', result.directJitoAlternative.status, result.directJitoAlternative.reason)

  const canQuote =
    result.rpc.health === 'ok' && result.mints.usdc.status === 'verified' && result.mints.jitosol.status === 'verified'
  if (canQuote) {
    for (const purchaseSize of purchaseSizes) {
      for (const leg of [
        { asset: 'SOL/WSOL', outputMint: wsolMint, weightPercent: 50 },
        { asset: 'JitoSOL', outputMint: jitoDevnet.mint, weightPercent: 20 },
      ]) {
        const inputAmount = Math.round((purchaseSize * leg.weightPercent * 10 ** usdcDecimals) / 100)
        let quote
        try {
          quote = await jupiterQuote({
            apiKey: env.JUPITER_API_KEY,
            inputMint: usdcMint,
            outputMint: leg.outputMint,
            amount: inputAmount,
          })
        } catch (error) {
          quote = { status: 'unavailable', reason: error.message }
        }
        result.jupiter.routes.push({
          purchaseSizeUsdc: purchaseSize,
          leg: leg.asset,
          inputAmountUsdcBaseUnits: inputAmount,
          ...quote,
        })
        status(
          `Jupiter ${purchaseSize} USDC ${leg.asset}`,
          quote.status,
          quote.reason || `priceImpact=${quote.priceImpactPct ?? 'n/a'}`,
        )
      }
    }
  } else {
    result.jupiter.routes = purchaseSizes.flatMap((purchaseSize) => [
      { purchaseSizeUsdc: purchaseSize, leg: 'SOL/WSOL', status: 'uncertain', reason: 'Mint/RPC prerequisite failed' },
      { purchaseSizeUsdc: purchaseSize, leg: 'JitoSOL', status: 'uncertain', reason: 'Mint/RPC prerequisite failed' },
    ])
  }
  const solRoutes = result.jupiter.routes.filter((route) => route.leg === 'SOL/WSOL')
  const jitoRoutes = result.jupiter.routes.filter((route) => route.leg === 'JitoSOL')
  result.jupiter.solRoute = solRoutes.every((route) => route.status === 'verified') ? 'verified' : 'unavailable'
  result.jupiter.jitosolRoute = jitoRoutes.every((route) => route.status === 'verified') ? 'verified' : 'unavailable'
  result.decision =
    result.jupiter.solRoute === 'verified' && result.jupiter.jitosolRoute === 'verified' ? 'GO' : 'NO-GO'
  result.notes =
    result.decision === 'NO-GO'
      ? 'Do not implement or claim real C3 Devnet settlement. Preserve the verified USDC payment and show a truthful planned/pending settlement state.'
      : 'All requested Devnet routes returned verifiable quotes; implementation still requires simulation, audit, and controlled settlement tests.'

  await fs.mkdir(generatedResultsDir, { recursive: true })
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`Machine-readable result: ${path.relative(repoDir, resultPath)}`)
  console.log(`Decision: ${result.decision}`)
  if (result.decision === 'NO-GO') process.exitCode = 1
}

main().catch((error) => {
  console.error(`Preflight failed: ${error.message}`)
  process.exitCode = 1
})
