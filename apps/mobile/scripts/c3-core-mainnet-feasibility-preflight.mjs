#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const mobileDir = path.resolve(new URL('.', import.meta.url).pathname, '..')
const repoDir = path.resolve(mobileDir, '../..')
const generatedResultsDir = path.join(mobileDir, 'dist', 'generated-results')
const resultPath = path.join(generatedResultsDir, 'c3-core-mainnet-feasibility.json')
const rpcUrl = 'https://api.mainnet.solana.com'
const jupiterQuoteBase = 'https://api.jup.ag/swap/v1/quote'
const jupiterLiteQuoteBase = 'https://lite-api.jup.ag/swap/v1/quote'
const jupiterTokenSearchBase = 'https://api.jup.ag/tokens/v2/search'
const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const mainnetUsdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const nativeSolMint = 'So11111111111111111111111111111111111111112'
const candidates = {
  cbBTC: {
    mint: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
    role: 'Bitcoin exposure',
    issuer: 'Coinbase',
    custody: 'Coinbase custody backs cbBTC 1:1 with BTC; redemption depends on Coinbase access and network support.',
    source: 'https://www.coinbase.com/cbbtc',
  },
  portalEth: {
    mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    role: 'Ethereum exposure',
    issuer: 'Wormhole Portal / wrapped ETH',
    custody:
      'Wormhole wrapped-token flow uses source-chain custody/locking and destination-chain minting; bridge and redemption depend on Guardian-verified messages and the source asset.',
    source: 'https://wormhole.com/docs/products/token-transfers/wrapped-token-transfers/overview/',
  },
  solletEth: {
    mint: '2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk',
    role: 'Ethereum exposure candidate',
    issuer: 'Sollet / legacy wrapped representation (issuer not confirmed from a current primary source)',
    custody:
      'Bridge, custodian, and redemption controls were not established from current primary documentation; treat as high operational and depeg risk.',
    source: 'https://solana.com/docs/tokens/how-to-verify-a-token',
  },
}
const purchases = [
  { total: 50, BTC: 20, ETH: 15, SOL: 15 },
  { total: 100, BTC: 40, ETH: 30, SOL: 30 },
  { total: 500, BTC: 200, ETH: 150, SOL: 150 },
]

function parseEnvLine(line) {
  const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
  if (!match) return null
  let value = match[2]
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return [match[1], value]
}

async function loadLocalSecretsByName() {
  const values = {}
  for (const filename of ['.env', '.env.local']) {
    try {
      const contents = await fs.readFile(path.join(mobileDir, filename), 'utf8')
      for (const line of contents.split(/\r?\n/)) {
        const parsed = parseEnvLine(line)
        if (parsed && parsed[0] === 'JUPITER_API_KEY') values[parsed[0]] = parsed[1]
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return { ...values, ...process.env }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function printResult(label, value, detail = '') {
  console.log(`${label}: ${value}${detail ? ` — ${detail}` : ''}`)
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return { response, body }
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

async function inspectMint(mint) {
  const [account, supply] = await Promise.all([
    rpcCall('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'finalized' }]),
    rpcCall('getTokenSupply', [mint, { commitment: 'finalized' }]),
  ])
  const value = account?.value
  const parsed = value?.data?.parsed
  const supplyValue = supply?.value
  const verified =
    Boolean(value) &&
    parsed?.type === 'mint' &&
    value.owner === tokenProgram &&
    parsed.info.isInitialized === true &&
    supplyValue?.amount === parsed.info.supply &&
    supplyValue?.decimals === parsed.info.decimals
  return {
    status: verified ? 'verified' : value ? 'uncertain' : 'unavailable',
    owner: value?.owner ?? null,
    decimals: parsed?.info?.decimals ?? null,
    supplyBaseUnits: parsed?.info?.supply ?? null,
    supplyUi: supplyValue?.uiAmountString ?? null,
  }
}

async function tokenDirectory(mint, apiKey) {
  const url = new URL(jupiterTokenSearchBase)
  url.searchParams.set('query', mint)
  const headers = apiKey ? { 'x-api-key': apiKey } : {}
  const { response, body } = await requestJson(url, { headers })
  if (!response.ok || !Array.isArray(body)) {
    return { status: response.status === 429 ? 'uncertain' : 'unavailable', httpStatus: response.status }
  }
  const token = body.find((item) => item.id === mint)
  if (!token) return { status: 'unavailable', httpStatus: response.status }
  return {
    status: token.isVerified === true ? 'verified' : 'uncertain',
    httpStatus: response.status,
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    circSupply: token.circSupply ?? null,
    totalSupply: token.totalSupply ?? null,
    liquidityUsd: token.liquidity ?? null,
    holderCount: token.holderCount ?? null,
    organicScore: token.organicScore ?? null,
    stats24h: token.stats24h
      ? {
          buyVolumeUsd: token.stats24h.buyVolume ?? null,
          sellVolumeUsd: token.stats24h.sellVolume ?? null,
          buyOrganicVolumeUsd: token.stats24h.buyOrganicVolume ?? null,
          sellOrganicVolumeUsd: token.stats24h.sellOrganicVolume ?? null,
          numBuys: token.stats24h.numBuys ?? null,
          numSells: token.stats24h.numSells ?? null,
          numTraders: token.stats24h.numTraders ?? null,
        }
      : null,
  }
}

function summarizeRoute(routePlan = []) {
  return routePlan.map((route) => ({
    dex: route.swapInfo?.label ?? 'unknown',
    ammKey: route.swapInfo?.ammKey ?? null,
    inputMint: route.swapInfo?.inputMint ?? null,
    outputMint: route.swapInfo?.outputMint ?? null,
    inputAmount: route.swapInfo?.inAmount ?? null,
    outputAmount: route.swapInfo?.outAmount ?? null,
    feeAmount: route.swapInfo?.feeAmount ?? null,
    feeMint: route.swapInfo?.feeMint ?? null,
  }))
}

async function getQuote({ apiKey, outputMint, outputDecimals, asset, totalUsdc, allocationUsdc, ataRentLamports }) {
  const endpoints = [jupiterQuoteBase, jupiterLiteQuoteBase]
  const requestedAt = new Date().toISOString()
  const result = {
    purchaseUsdc: totalUsdc,
    allocationUsdc,
    asset,
    outputMint,
    outputDecimals,
    requestedAt,
    endpoint: null,
    httpStatus: null,
    status: 'unavailable',
    quoteExpiry:
      'Not returned by /swap/v1/quote; exact blockhash/lastValidBlockHeight starts at transaction build, which was intentionally not performed.',
    accountCreation:
      asset === 'SOL'
        ? '0 lamports for final native SOL; any internal WSOL setup is route/build dependent.'
        : `Base ATA rent estimate: ${ataRentLamports} lamports; exact setup instructions were not built.`,
  }
  let response
  let body
  for (const endpoint of endpoints) {
    const url = new URL(endpoint)
    url.searchParams.set('inputMint', mainnetUsdcMint)
    url.searchParams.set('outputMint', outputMint)
    url.searchParams.set('amount', String(Math.round(allocationUsdc * 1_000_000)))
    url.searchParams.set('slippageBps', '100')
    const headers = apiKey ? { 'x-api-key': apiKey } : {}
    const request = await requestJson(url, { headers })
    response = request.response
    body = request.body
    result.endpoint = endpoint
    result.httpStatus = response.status
    if (response.status !== 429) break
    if (endpoint === jupiterQuoteBase) await sleep(4000)
  }
  if (!response.ok || body?.error || !body?.outAmount) {
    result.reason = body?.errorCode || body?.error || `HTTP ${response.status}`
    return result
  }
  result.status = 'verified'
  result.expectedOutputBaseUnits = body.outAmount
  result.minimumOutputBaseUnits = body.otherAmountThreshold ?? null
  result.priceImpactPct = body.priceImpactPct ?? null
  result.route = summarizeRoute(body.routePlan)
  result.fees = result.route.some((route) => route.feeAmount !== null)
    ? result.route
        .map((route) => ({ amount: route.feeAmount, mint: route.feeMint }))
        .filter((fee) => fee.amount !== null)
    : 'not returned by the quote response; reflected only in the net output amount'
  result.contextSlot = body.contextSlot ?? null
  result.quoteEngineTimeMs = body.timeTaken ? Math.round(body.timeTaken * 1000) : null
  result.swapMode = body.swapMode ?? null
  return result
}

async function main() {
  const env = await loadLocalSecretsByName()
  const apiKey = env.JUPITER_API_KEY
  const observedAt = new Date().toISOString()
  const result = {
    observedAt,
    cluster: 'mainnet-beta',
    rpcUrl,
    inputAsset: { mint: mainnetUsdcMint, decimals: null, status: 'unavailable' },
    candidates: {},
    ataRentLamports: null,
    quotes: [],
    transactionPackaging: {
      status: 'not_proven',
      reason:
        'No transaction was built or serialized. Three independent Jupiter builds plus setup/cleanup instructions must be measured before claiming one v0 transaction fits.',
    },
    nonCustodialFlow:
      'Future design only: user wallet signs each approved swap; outputs go directly to the same user wallet; no C Market private keys.',
    decision: 'NO-GO',
  }

  console.log('C3 Core Mainnet feasibility preflight (read-only)')
  console.log(`Observed at: ${observedAt}`)
  console.log(`RPC: ${rpcUrl}`)
  console.log('Mobile app network: unchanged; no wallet authorization requested')
  console.log('Transaction construction/serialization/submission: not performed')
  console.log(`Jupiter API key: ${apiKey ? 'provided (value hidden)' : 'not provided; keyless rate limit applies'}`)

  try {
    const [health, version, ataRent, inputAsset] = await Promise.all([
      rpcCall('getHealth'),
      rpcCall('getVersion'),
      rpcCall('getMinimumBalanceForRentExemption', [165, { commitment: 'finalized' }]),
      inspectMint(mainnetUsdcMint),
    ])
    result.rpc = { status: health === 'ok' ? 'verified' : 'uncertain', health, version }
    result.ataRentLamports = ataRent
    result.inputAsset = {
      mint: mainnetUsdcMint,
      decimals: inputAsset.decimals,
      status: inputAsset.status,
      owner: inputAsset.owner,
      supplyBaseUnits: inputAsset.supplyBaseUnits,
      supplyUi: inputAsset.supplyUi,
    }
    printResult('Mainnet RPC', result.rpc.status, `health=${health}`)
    printResult('Mainnet USDC mint', result.inputAsset.status, `decimals=${inputAsset.decimals ?? 'n/a'}`)
    printResult('Base ATA rent estimate', 'verified', `${ataRent} lamports per 165-byte token account`)
  } catch (error) {
    result.rpc = { status: 'unavailable', error: error.message }
    printResult('Mainnet RPC', 'unavailable', error.message)
  }

  for (const [name, candidate] of Object.entries(candidates)) {
    try {
      const [chain, directory] = await Promise.all([
        inspectMint(candidate.mint),
        tokenDirectory(candidate.mint, apiKey),
      ])
      result.candidates[name] = { ...candidate, chain, jupiter: directory }
      printResult(`${name} chain`, chain.status, `decimals=${chain.decimals ?? 'n/a'}`)
      printResult(`${name} Jupiter`, directory.status, `liquidityUsd=${directory.liquidityUsd ?? 'n/a'}`)
    } catch (error) {
      result.candidates[name] = {
        ...candidate,
        chain: { status: 'unavailable' },
        jupiter: { status: 'unavailable', error: error.message },
      }
      printResult(`${name}`, 'unavailable', error.message)
    }
  }

  const selectedEth = candidates.portalEth
  const canQuote =
    result.rpc.status === 'verified' &&
    result.inputAsset.status === 'verified' &&
    result.candidates.cbBTC?.chain.status === 'verified' &&
    result.candidates.portalEth?.chain.status === 'verified' &&
    result.candidates.cbBTC?.jupiter.status === 'verified' &&
    result.candidates.portalEth?.jupiter.status === 'verified'

  if (canQuote) {
    for (const purchase of purchases) {
      for (const leg of [
        { asset: 'cbBTC', outputMint: candidates.cbBTC.mint, allocationUsdc: purchase.BTC, outputDecimals: 8 },
        { asset: 'ETH', outputMint: selectedEth.mint, allocationUsdc: purchase.ETH, outputDecimals: 8 },
        { asset: 'SOL', outputMint: nativeSolMint, allocationUsdc: purchase.SOL, outputDecimals: 9 },
      ]) {
        const quote = await getQuote({
          apiKey,
          outputMint: leg.outputMint,
          outputDecimals: leg.outputDecimals,
          asset: leg.asset,
          totalUsdc: purchase.total,
          allocationUsdc: leg.allocationUsdc,
          ataRentLamports: result.ataRentLamports,
        })
        result.quotes.push(quote)
        printResult(
          `Jupiter ${purchase.total} USDC ${leg.asset}`,
          quote.status,
          quote.reason || `impact=${quote.priceImpactPct}`,
        )
        await sleep(apiKey ? 250 : 2200)
      }
    }
  } else {
    result.quotes = purchases.flatMap((purchase) =>
      ['cbBTC', 'ETH', 'SOL'].map((asset) => ({
        purchaseUsdc: purchase.total,
        asset,
        status: 'uncertain',
        reason: 'RPC or token verification prerequisite failed',
      })),
    )
  }

  const requiredQuotesVerified =
    result.quotes.length === 9 && result.quotes.every((quote) => quote.status === 'verified')
  result.decision = requiredQuotesVerified ? 'CONDITIONAL_GO' : 'NO_GO'
  result.notes = requiredQuotesVerified
    ? 'Mainnet quotes exist for all requested sizes. Implementation remains conditional on transaction-build simulation, non-custodial MWA review, failure recovery, and security/legal review.'
    : 'Do not implement or claim the Mainnet basket. Preserve the separate verified Devnet payment flow.'
  result.sources = {
    jupiterQuote: 'https://dev.jup.ag/docs/swap/v1/get-quote',
    jupiterTokenDirectory: 'https://dev.jup.ag/docs/tokens/v2/search',
    jupiterRateLimits: 'https://dev.jup.ag/docs/portal/rate-limits',
    solanaTokenVerification: 'https://solana.com/docs/tokens/how-to-verify-a-token',
    coinbaseCbBTC: 'https://www.coinbase.com/cbbtc',
    coinbaseReserves: 'https://www.coinbase.com/en-it/cbbtc/proof-of-reserves',
    wormholeWrappedTokenTransfers:
      'https://wormhole.com/docs/products/token-transfers/wrapped-token-transfers/overview/',
    wormholeConnectAssets: 'https://wormhole.com/docs/products/connect/configuration/configuration-v0/',
  }

  await fs.mkdir(generatedResultsDir, { recursive: true })
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`Machine-readable result: ${path.relative(repoDir, resultPath)}`)
  console.log(`Decision: ${result.decision}`)
  if (!requiredQuotesVerified) process.exitCode = 1
}

main().catch((error) => {
  console.error(`Preflight failed: ${error.message}`)
  process.exitCode = 1
})
