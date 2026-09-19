import { allocateC3Core, C3_CORE_MAINNET_POLICY, type C3CoreMainnetLegId } from '../services/c3-core-mainnet-core.ts'
import { C3_CORE_MAINNET_ASSETS, C3_CORE_MAINNET_DECIMALS } from '../services/c3-core-mainnet-core.ts'

export const C3_CANDIDATE_EXECUTION_ENABLED = false as const
export const C3_CANDIDATE_QUOTE_ENDPOINT = 'https://api.jup.ag/swap/v2/quote' as const
export const C3_CANDIDATE_KEYLESS_INTERVAL_MS = 2500 as const
export const C3_CANDIDATE_SLIPPAGE_BPS = C3_CORE_MAINNET_POLICY.maximumSlippageBps

export type CandidateLegId = C3CoreMainnetLegId

export type CandidateLeg = Readonly<{
  id: CandidateLegId
  label: string
  symbol: string
  outputMint: string
  outputDecimals: number
  allocationPercent: number
  inputAmountUsdc: number
  inputAmountBaseUnits: string
}>

export type CandidateQuote = Readonly<{
  leg: CandidateLeg
  status: 'verified' | 'unavailable' | 'invalid'
  observedAt: string
  expectedOutputBaseUnits?: string
  minimumOutputBaseUnits?: string
  priceImpactPct?: string | null
  routeLabels: string[]
  routePrograms: string[]
  contextSlot?: number | null
  reason?: string
}>

type QuoteBody = Readonly<{
  inputMint?: unknown
  outputMint?: unknown
  inAmount?: unknown
  outAmount?: unknown
  otherAmountThreshold?: unknown
  swapMode?: unknown
  slippageBps?: unknown
  priceImpactPct?: unknown
  contextSlot?: unknown
  routePlan?: unknown
}>

const LEG_DETAILS: Readonly<Record<CandidateLegId, Omit<CandidateLeg, 'inputAmountUsdc' | 'inputAmountBaseUnits'>>> = {
  cbBTC: {
    id: 'cbBTC',
    label: 'Bitcoin exposure · cbBTC',
    symbol: 'cbBTC',
    outputMint: C3_CORE_MAINNET_ASSETS.cbBTC,
    outputDecimals: C3_CORE_MAINNET_DECIMALS.cbBTC,
    allocationPercent: 40,
  },
  portalETH: {
    id: 'portalETH',
    label: 'Ethereum exposure · Portal ETH',
    symbol: 'Portal ETH',
    outputMint: C3_CORE_MAINNET_ASSETS.portalETH,
    outputDecimals: C3_CORE_MAINNET_DECIMALS.portalETH,
    allocationPercent: 30,
  },
  SOL: {
    id: 'SOL',
    label: 'Solana exposure · native SOL',
    symbol: 'SOL',
    outputMint: C3_CORE_MAINNET_ASSETS.wSOL,
    outputDecimals: C3_CORE_MAINNET_DECIMALS.SOL,
    allocationPercent: 30,
  },
}

export function assertCandidateExecutionDisabled(): never {
  throw new Error('Execution is disabled in this candidate build.')
}

export function createCandidateLegs(totalUsdc: number): CandidateLeg[] {
  if (!Number.isSafeInteger(totalUsdc)) throw new Error('Candidate purchase size must be an integer USDC amount.')

  const allocation = allocateC3Core(BigInt(totalUsdc) * 1_000_000n)
  return (Object.keys(LEG_DETAILS) as CandidateLegId[]).map((id) => {
    const inputAmountBaseUnits = allocation.legs[id].toString()
    return {
      ...LEG_DETAILS[id],
      inputAmountUsdc: Number(inputAmountBaseUnits) / 1_000_000,
      inputAmountBaseUnits,
    }
  })
}

export function createCandidateQuoteUrl(leg: CandidateLeg): string {
  const url = new URL(C3_CANDIDATE_QUOTE_ENDPOINT)
  url.searchParams.set('inputMint', C3_CORE_MAINNET_ASSETS.input)
  url.searchParams.set('outputMint', leg.outputMint)
  url.searchParams.set('amount', leg.inputAmountBaseUnits)
  url.searchParams.set('slippageBps', String(C3_CANDIDATE_SLIPPAGE_BPS))
  url.searchParams.set('restrictIntermediateTokens', 'true')
  return url.toString()
}

function routeLabels(body: QuoteBody): string[] {
  if (!Array.isArray(body.routePlan)) return []
  return body.routePlan.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const swapInfo = (item as { swapInfo?: { label?: unknown } }).swapInfo
    return typeof swapInfo?.label === 'string' ? [swapInfo.label] : []
  })
}

function routePrograms(body: QuoteBody): string[] {
  if (!Array.isArray(body.routePlan)) return []
  return body.routePlan.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const swapInfo = (item as { swapInfo?: { programId?: unknown } }).swapInfo
    return typeof swapInfo?.programId === 'string' ? [swapInfo.programId] : []
  })
}

export function validateCandidateQuote(body: QuoteBody, leg: CandidateLeg, observedAt: string): CandidateQuote {
  const base = {
    leg,
    observedAt,
    routeLabels: routeLabels(body),
    routePrograms: routePrograms(body),
  }
  const validAmounts =
    typeof body.inAmount === 'string' &&
    typeof body.outAmount === 'string' &&
    typeof body.otherAmountThreshold === 'string' &&
    /^\d+$/.test(body.inAmount) &&
    /^\d+$/.test(body.outAmount) &&
    /^\d+$/.test(body.otherAmountThreshold)
  const validMetadata =
    body.inputMint === C3_CORE_MAINNET_ASSETS.input &&
    body.outputMint === leg.outputMint &&
    body.inAmount === leg.inputAmountBaseUnits &&
    body.swapMode === 'ExactIn' &&
    body.slippageBps === C3_CANDIDATE_SLIPPAGE_BPS &&
    Array.isArray(body.routePlan) &&
    body.routePlan.length > 0
  if (!validAmounts || !validMetadata) {
    return { ...base, status: 'invalid', reason: 'Jupiter quote metadata did not match the selected C3 leg.' }
  }
  return {
    ...base,
    status: 'verified',
    expectedOutputBaseUnits: body.outAmount,
    minimumOutputBaseUnits: body.otherAmountThreshold,
    priceImpactPct: typeof body.priceImpactPct === 'string' ? body.priceImpactPct : null,
    contextSlot: typeof body.contextSlot === 'number' ? body.contextSlot : null,
  }
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function retryAfterMilliseconds(response: Response): number {
  const retryAfter = response.headers.get('retry-after')
  const seconds = retryAfter ? Number(retryAfter) : NaN
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.max(C3_CANDIDATE_KEYLESS_INTERVAL_MS, seconds * 1000)
    : C3_CANDIDATE_KEYLESS_INTERVAL_MS
}

async function fetchQuote(leg: CandidateLeg, signal?: AbortSignal): Promise<CandidateQuote> {
  const observedAt = new Date().toISOString()
  let attempts = 0
  while (attempts <= 2) {
    const response = await fetch(createCandidateQuoteUrl(leg), {
      headers: { accept: 'application/json' },
      signal,
    })
    if (response.status === 429 && attempts < 2) {
      attempts += 1
      await sleep(retryAfterMilliseconds(response))
      continue
    }
    if (!response.ok) {
      return {
        leg,
        status: 'unavailable',
        observedAt,
        routeLabels: [],
        routePrograms: [],
        reason: `Jupiter quote unavailable (HTTP ${response.status}).`,
      }
    }
    const body = (await response.json()) as QuoteBody
    return validateCandidateQuote(body, leg, observedAt)
  }
  return {
    leg,
    status: 'unavailable',
    observedAt,
    routeLabels: [],
    routePrograms: [],
    reason: 'Jupiter quote rate limit persisted after bounded retries.',
  }
}

export async function fetchCandidateQuotes(totalUsdc: number, signal?: AbortSignal): Promise<CandidateQuote[]> {
  const legs = createCandidateLegs(totalUsdc)
  const results: CandidateQuote[] = []
  let lastRequestAt = 0
  for (const leg of legs) {
    const wait = Math.max(0, C3_CANDIDATE_KEYLESS_INTERVAL_MS - (Date.now() - lastRequestAt))
    if (wait) await sleep(wait)
    lastRequestAt = Date.now()
    results.push(await fetchQuote(leg, signal))
  }
  return results
}
