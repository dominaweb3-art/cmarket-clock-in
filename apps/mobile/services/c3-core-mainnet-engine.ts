import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { toUint8Array } from 'js-base64'

import { C3_CORE_MAINNET_CONFIG } from '@/constants/c3-core-mainnet'
import {
  C3_CORE_MAINNET_ASSETS,
  allocateC3Core,
  assertC3MainnetExecution,
  assertC3MainnetStateTransition,
  parseC3UsdcAmount,
  C3CoreMainnetLegId,
  C3CoreMainnetPurchaseState,
  C3_CORE_MAINNET_POLICY,
} from '@/services/c3-core-mainnet-core'
import { C3CoreMainnetPurchaseIntent, C3CoreMainnetStore, deriveStateFromLegs } from '@/services/c3-core-mainnet-state'
import {
  flattenC3BuildInstructions,
  decodeC3Blockhash,
  getC3JupiterSourceTokenAccount,
  JupiterBuildResponse,
  toC3TransactionInstruction,
  validateC3AddressLookupTableRecord,
  validateC3CoreMainnetTransaction,
} from '@/services/c3-core-mainnet-validation'

type MainnetWalletSender = (transaction: VersionedTransaction, minContextSlot: number) => Promise<string>

export type C3CoreMainnetReview = Readonly<{
  purchaseId: string
  leg: C3CoreMainnetLegId
  inputAmountBaseUnits: string
  expectedOutputBaseUnits: string
  minimumOutputBaseUnits: string
  priceImpactPct: string | null
  slippageBps: number
  fee: string
  estimatedTokenAccountCreation: boolean
  expiresAtBlockHeight: number
  route: ReadonlyArray<{ label: string | null; ammKey: string | null }>
}>

type PendingBuild = Readonly<{
  review: C3CoreMainnetReview
  transaction: VersionedTransaction
  build: JupiterBuildResponse
  lastValidBlockHeight: number
  minContextSlot: number
}>

type MainnetEngineOptions = Readonly<{
  walletAddress: string
  configuredCluster: string
  connection?: Connection
  store?: C3CoreMainnetStore
  sendTransaction: MainnetWalletSender
  treasuryAddress?: string
}>

export class C3CoreMainnetEngine {
  private readonly connection: Connection
  private readonly store: C3CoreMainnetStore
  private readonly pendingBuilds = new Map<string, PendingBuild>()
  private readonly submissionLocks = new Set<string>()
  private lastJupiterRequestAt = 0

  constructor(private readonly options: MainnetEngineOptions) {
    assertC3MainnetExecution(options.configuredCluster)
    this.connection = options.connection ?? new Connection(C3_CORE_MAINNET_CONFIG.policy.rpcEndpoint, 'confirmed')
    this.store = options.store ?? new C3CoreMainnetStore()
    new PublicKey(options.walletAddress)
  }

  async createPurchase(totalUsdc: string): Promise<C3CoreMainnetPurchaseIntent> {
    this.assertRuntimeGuard()
    const totalUsdcBaseUnits = parseC3UsdcAmount(totalUsdc)
    const allocation = allocateC3Core(totalUsdcBaseUnits)
    return this.store.create({
      walletAddress: this.options.walletAddress,
      totalUsdcBaseUnits,
      legs: allocation.legs,
    })
  }

  async quoteNextLeg(purchaseId: string): Promise<C3CoreMainnetReview> {
    this.assertRuntimeGuard()
    const intent = await this.requireIntent(purchaseId)
    const leg = nextLegForQuote(intent)
    if (!leg) throw new Error('No pending C3 Mainnet leg remains.')

    const quotingIntent = await this.updatePurchaseState(intent, 'quoting')
    try {
      const inputAmountBaseUnits = BigInt(intent.legs[leg].allocationUsdcBaseUnits)
      const build = await this.fetchBuild(leg, inputAmountBaseUnits)
      const transactionData = await this.compileBuild(build)
      const currentBlockHeight = await this.connection.getBlockHeight('confirmed')
      if (currentBlockHeight > build.blockhashWithMetadata.lastValidBlockHeight) {
        throw new Error('Jupiter returned an expired blockhash. Request a fresh quote.')
      }

      await this.assertSourceAndDestinationAccounts(build, leg)

      const validation = validateC3CoreMainnetTransaction({
        walletAddress: this.options.walletAddress,
        leg,
        inputAmountBaseUnits,
        build,
        transaction: transactionData.transaction,
        treasuryAddress: this.options.treasuryAddress,
      })
      if (!validation.passed) throw new Error(`Transaction validation failed: ${validation.issues.join('; ')}`)

      const serializedBytes = transactionData.transaction.serialize().length
      if (serializedBytes > C3_CORE_MAINNET_POLICY.maxTransactionBytes) {
        throw new Error(`Transaction exceeds the ${C3_CORE_MAINNET_POLICY.maxTransactionBytes}-byte limit.`)
      }

      const review: C3CoreMainnetReview = {
        purchaseId,
        leg,
        inputAmountBaseUnits: inputAmountBaseUnits.toString(),
        expectedOutputBaseUnits: build.outAmount,
        minimumOutputBaseUnits: build.otherAmountThreshold,
        priceImpactPct: build.priceImpactPct ?? null,
        slippageBps: build.slippageBps ?? C3_CORE_MAINNET_POLICY.maximumSlippageBps,
        fee: String(build.prioritizationFeeLamports ?? 'wallet/network calculated'),
        estimatedTokenAccountCreation: (build.setupInstructions ?? []).length > 0,
        expiresAtBlockHeight: build.blockhashWithMetadata.lastValidBlockHeight,
        route: (build.routePlan ?? []).map((route) => ({
          label: route.swapInfo?.label ?? null,
          ammKey: route.swapInfo?.ammKey ?? null,
        })),
      }
      const pendingKey = pendingBuildKey(purchaseId, leg)
      this.pendingBuilds.set(pendingKey, {
        review,
        transaction: transactionData.transaction,
        build,
        lastValidBlockHeight: build.blockhashWithMetadata.lastValidBlockHeight,
        minContextSlot: transactionData.minContextSlot,
      })
      const awaitingReview = await this.updateLeg(quotingIntent, leg, 'awaiting_approval')
      await this.updatePurchaseState(awaitingReview, 'ready_for_review')
      return review
    } catch (error) {
      await this.markFailure(
        await this.requireIntent(purchaseId),
        leg,
        error instanceof Error ? error.message : 'quote_failed',
      )
      throw error
    }
  }

  async approveAndConfirmNextLeg(purchaseId: string): Promise<C3CoreMainnetPurchaseIntent> {
    this.assertRuntimeGuard()
    const intent = await this.requireIntent(purchaseId)
    const leg = nextLegAwaitingApproval(intent)
    if (!leg) throw new Error('No pending C3 Mainnet leg remains.')
    const pendingKey = pendingBuildKey(purchaseId, leg)
    const pending = this.pendingBuilds.get(pendingKey)
    if (!pending) throw new Error('The quote expired from memory. Review a fresh quote before approving.')
    if (this.submissionLocks.has(pendingKey)) throw new Error('This C3 Mainnet leg is already being submitted.')
    if (intent.legs[leg].state === 'confirmed') throw new Error('A confirmed C3 Mainnet leg cannot be submitted again.')

    this.submissionLocks.add(pendingKey)
    try {
      const currentBlockHeight = await this.connection.getBlockHeight('confirmed')
      if (currentBlockHeight > pending.lastValidBlockHeight) {
        throw new Error('The quote or blockhash expired. Review a fresh quote before approving.')
      }

      await this.updatePurchaseState(intent, 'awaiting_wallet')
      const signature = await this.options.sendTransaction(pending.transaction, pending.minContextSlot)
      await this.updateLeg(await this.requireIntent(purchaseId), leg, 'submitted', { signature }, 'submitted')
      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          blockhash: decodeC3Blockhash(pending.build.blockhashWithMetadata.blockhash),
          lastValidBlockHeight: pending.lastValidBlockHeight,
        },
        'finalized',
      )
      if (confirmation.value.err) throw new Error('The wallet transaction was rejected on-chain.')

      const latestIntent = await this.requireIntent(purchaseId)
      const confirmedOutputBaseUnits = await this.findConfirmedTokenOutput(signature, pending.review.leg)
      const confirmedIntent = await this.updateLeg(
        latestIntent,
        leg,
        'confirmed',
        {
          signature,
          confirmedOutputBaseUnits: confirmedOutputBaseUnits ?? undefined,
        },
        'confirmed',
      )
      const finalIntentState = deriveStateFromLegs(confirmedIntent)
      this.pendingBuilds.delete(pendingKey)
      return finalIntentState === confirmedIntent.state
        ? confirmedIntent
        : this.updatePurchaseState(confirmedIntent, finalIntentState)
    } catch (error) {
      await this.markFailure(
        await this.requireIntent(purchaseId),
        leg,
        error instanceof Error ? error.message : 'submission_failed',
      )
      this.pendingBuilds.delete(pendingKey)
      throw error
    } finally {
      this.submissionLocks.delete(pendingKey)
    }
  }

  async hydratePurchase(purchaseId: string): Promise<C3CoreMainnetPurchaseIntent> {
    this.assertRuntimeGuard()
    const intent = await this.requireIntent(purchaseId)
    let nextIntent = intent
    for (const leg of Object.values(intent.legs)) {
      if (!leg.signature || (leg.state !== 'submitted' && leg.state !== 'confirmed')) continue
      const status = await this.connection.getSignatureStatuses([leg.signature], { searchTransactionHistory: true })
      const signatureStatus = status.value[0]
      if (signatureStatus?.err) {
        nextIntent = await this.updateLeg(nextIntent, leg.id, 'failed', { errorCode: 'on_chain_error' })
      } else if (signatureStatus?.confirmationStatus === 'finalized' && leg.state !== 'confirmed') {
        nextIntent = await this.updateLeg(nextIntent, leg.id, 'confirmed', { signature: leg.signature })
      }
    }
    return nextIntent
  }

  async getPurchase(purchaseId: string): Promise<C3CoreMainnetPurchaseIntent | undefined> {
    this.assertRuntimeGuard()
    return this.store.get(purchaseId)
  }

  private assertRuntimeGuard() {
    assertC3MainnetExecution(this.options.configuredCluster)
  }

  private async requireIntent(purchaseId: string): Promise<C3CoreMainnetPurchaseIntent> {
    const intent = await this.store.get(purchaseId)
    if (!intent || intent.walletAddress !== this.options.walletAddress)
      throw new Error('C3 Mainnet purchase intent not found.')
    return intent
  }

  private async fetchBuild(leg: C3CoreMainnetLegId, inputAmountBaseUnits: bigint): Promise<JupiterBuildResponse> {
    const outputMint =
      leg === 'cbBTC'
        ? C3_CORE_MAINNET_ASSETS.cbBTC
        : leg === 'portalETH'
          ? C3_CORE_MAINNET_ASSETS.portalETH
          : C3_CORE_MAINNET_ASSETS.wSOL
    const url = new URL(C3_CORE_MAINNET_POLICY.quoteEndpoint)
    url.searchParams.set('inputMint', C3_CORE_MAINNET_ASSETS.input)
    url.searchParams.set('outputMint', outputMint)
    url.searchParams.set('amount', inputAmountBaseUnits.toString())
    url.searchParams.set('taker', this.options.walletAddress)
    url.searchParams.set('swapMode', 'ExactIn')
    url.searchParams.set('slippageBps', String(C3_CORE_MAINNET_POLICY.maximumSlippageBps))
    url.searchParams.set('maxAccounts', '64')
    url.searchParams.set('wrapAndUnwrapSol', 'true')
    url.searchParams.set('blockhashSlotsToExpiry', String(C3_CORE_MAINNET_POLICY.blockhashSlotsToExpiry))
    url.searchParams.set('computeUnitPricePercentile', 'medium')
    if (leg === 'SOL') url.searchParams.set('nativeDestinationAccount', this.options.walletAddress)

    const body = await this.jupiterRequest(url)
    if (!body || typeof body !== 'object' || 'error' in body) {
      throw new Error('Jupiter did not return a usable Mainnet build.')
    }
    const build = body as Partial<JupiterBuildResponse>
    if (!build.blockhashWithMetadata || !build.swapInstruction)
      throw new Error('Jupiter returned incomplete build instructions.')
    return build as JupiterBuildResponse
  }

  private async jupiterRequest(url: URL): Promise<unknown> {
    for (let attempt = 0; attempt <= C3_CORE_MAINNET_POLICY.maxRateLimitRetries; attempt += 1) {
      const waitMs = Math.max(
        0,
        C3_CORE_MAINNET_POLICY.keylessRequestIntervalMs - (Date.now() - this.lastJupiterRequestAt),
      )
      if (waitMs) await sleep(waitMs)
      this.lastJupiterRequestAt = Date.now()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      try {
        const response = await fetch(url.toString(), { signal: controller.signal })
        const body = await response.json().catch(() => null)
        if (response.status === 429 && attempt < C3_CORE_MAINNET_POLICY.maxRateLimitRetries) {
          await sleep(
            Math.max(
              C3_CORE_MAINNET_POLICY.keylessRequestIntervalMs,
              parseRetryAfter(response.headers.get('retry-after')),
            ),
          )
          continue
        }
        if (!response.ok) throw new Error(`Jupiter HTTP ${response.status}: ${sanitizeErrorBody(body)}`)
        return body
      } catch (error) {
        if (isAbortError(error)) throw new Error('Jupiter request timed out.')
        throw error
      } finally {
        clearTimeout(timeout)
      }
    }
    throw new Error('Jupiter rate limit retry window exhausted.')
  }

  private async compileBuild(build: JupiterBuildResponse) {
    const blockhash = decodeC3Blockhash(build.blockhashWithMetadata.blockhash)
    const lookupTables = await this.loadValidatedLookupTables(build.addressesByLookupTableAddress ?? {})
    const instructions = flattenC3BuildInstructions(build).map(toC3TransactionInstruction)
    const message = new TransactionMessage({
      payerKey: new PublicKey(this.options.walletAddress),
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(lookupTables)
    return {
      transaction: new VersionedTransaction(message),
      minContextSlot: await this.connection.getSlot('confirmed'),
    }
  }

  private async loadValidatedLookupTables(
    addressesByLookupTableAddress: Record<string, string[]>,
  ): Promise<AddressLookupTableAccount[]> {
    const currentSlot = await this.connection.getSlot('confirmed')
    const lookupTables: AddressLookupTableAccount[] = []
    for (const [address, expectedAddresses] of Object.entries(addressesByLookupTableAddress)) {
      const key = new PublicKey(address)
      const accountInfo = await this.connection.getAccountInfo(key, 'confirmed')
      if (
        !accountInfo ||
        !accountInfo.owner.equals(new PublicKey(C3_CORE_MAINNET_CONFIG.programs.addressLookupTable))
      ) {
        throw new Error(`Jupiter lookup table failed ownership validation: ${address}`)
      }
      const response = await this.connection.getAddressLookupTable(key, { commitment: 'confirmed' })
      const table = response.value
      if (!table) throw new Error(`Jupiter lookup table is missing: ${address}`)
      const tableIssues = validateC3AddressLookupTableRecord(table, address, currentSlot)
      if (tableIssues.length) throw new Error(`Jupiter lookup table failed validation: ${tableIssues.join(', ')}`)
      if (
        table.state.addresses.length !== expectedAddresses.length ||
        table.state.addresses.some((value, index) => value.toBase58() !== expectedAddresses[index])
      ) {
        throw new Error(`Jupiter lookup table contents do not match the build: ${address}`)
      }
      lookupTables.push(table)
    }
    return lookupTables
  }

  private async assertSourceAndDestinationAccounts(build: JupiterBuildResponse, leg: C3CoreMainnetLegId) {
    const sourceAddress = new PublicKey(getC3JupiterSourceTokenAccount(build))
    const source = await this.connection.getParsedAccountInfo(sourceAddress, 'confirmed')
    const sourceParsed = readParsedTokenAccount(source.value)
    if (
      !sourceParsed ||
      source.value?.owner.toBase58() !== C3_CORE_MAINNET_CONFIG.programs.token ||
      sourceParsed.mint !== C3_CORE_MAINNET_CONFIG.assets.input ||
      sourceParsed.owner !== this.options.walletAddress
    ) {
      throw new Error('Jupiter source account is not a user-owned Mainnet USDC token account.')
    }

    if (leg !== 'SOL') {
      const destination = getAssociatedTokenAddressSync(
        leg === 'cbBTC' ? C3_CORE_MAINNET_CONFIG.cbBTCMint : C3_CORE_MAINNET_CONFIG.portalETHMint,
        new PublicKey(this.options.walletAddress),
      )
      const destinationInfo = await this.connection.getParsedAccountInfo(destination, 'confirmed')
      if (destinationInfo.value) {
        const parsed = readParsedTokenAccount(destinationInfo.value)
        if (
          !parsed ||
          destinationInfo.value.owner.toBase58() !== C3_CORE_MAINNET_CONFIG.programs.token ||
          parsed.mint !==
            (leg === 'cbBTC' ? C3_CORE_MAINNET_CONFIG.assets.cbBTC : C3_CORE_MAINNET_CONFIG.assets.portalETH) ||
          parsed.owner !== this.options.walletAddress
        ) {
          throw new Error('Jupiter output token account is not owned by the connected wallet.')
        }
      }
    }
  }

  private async updatePurchaseState(
    intent: C3CoreMainnetPurchaseIntent,
    nextState: C3CoreMainnetPurchaseState,
  ): Promise<C3CoreMainnetPurchaseIntent> {
    if (intent.state !== nextState) assertC3MainnetStateTransition(intent.state, nextState)
    const updated = { ...intent, state: nextState, updatedAt: Date.now() }
    await this.store.save(updated)
    return updated
  }

  private async updateLeg(
    intent: C3CoreMainnetPurchaseIntent,
    leg: C3CoreMainnetLegId,
    state: C3CoreMainnetLegRecord['state'],
    patch: Partial<C3CoreMainnetLegRecord> = {},
    purchaseState?: C3CoreMainnetPurchaseState,
  ): Promise<C3CoreMainnetPurchaseIntent> {
    const updatedAt = Date.now()
    const nextLeg = { ...intent.legs[leg], ...patch, state, updatedAt }
    const nextIntent = { ...intent, legs: { ...intent.legs, [leg]: nextLeg }, updatedAt }
    const derivedState =
      purchaseState ??
      (['confirmed', 'failed', 'cancelled'].includes(state) ? deriveStateFromLegs(nextIntent) : intent.state)
    const currentState = nextIntent.state
    if (currentState !== derivedState) assertC3MainnetStateTransition(currentState, derivedState)
    const saved = { ...nextIntent, state: derivedState }
    await this.store.save(saved)
    return saved
  }

  private async markFailure(intent: C3CoreMainnetPurchaseIntent, leg: C3CoreMainnetLegId, message: string) {
    const failed = await this.updateLeg(intent, leg, 'failed', { errorCode: sanitizeErrorBody(message) }, 'failed')
    const finalIntentState = deriveStateFromLegs(failed)
    return finalIntentState === failed.state ? failed : this.updatePurchaseState(failed, finalIntentState)
  }

  private async findConfirmedTokenOutput(signature: string, leg: C3CoreMainnetLegId): Promise<string | null> {
    if (leg === 'SOL') return null
    const transaction = await this.connection.getParsedTransaction(signature, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })
    const destination = getAssociatedTokenAddressSync(
      leg === 'cbBTC' ? C3_CORE_MAINNET_CONFIG.cbBTCMint : C3_CORE_MAINNET_CONFIG.portalETHMint,
      new PublicKey(this.options.walletAddress),
    ).toBase58()
    const balance = transaction?.meta?.postTokenBalances?.find(
      (item) =>
        item.owner === this.options.walletAddress &&
        item.mint ===
          (leg === 'cbBTC' ? C3_CORE_MAINNET_CONFIG.assets.cbBTC : C3_CORE_MAINNET_CONFIG.assets.portalETH) &&
        transaction.transaction.message.accountKeys[item.accountIndex]?.pubkey.toBase58() === destination,
    )
    return balance?.uiTokenAmount.amount ?? null
  }
}

function nextLegForQuote(intent: C3CoreMainnetPurchaseIntent): C3CoreMainnetLegId | undefined {
  return (['cbBTC', 'portalETH', 'SOL'] as const).find(
    (leg) => intent.legs[leg].state === 'pending' || intent.legs[leg].state === 'failed',
  )
}

function nextLegAwaitingApproval(intent: C3CoreMainnetPurchaseIntent): C3CoreMainnetLegId | undefined {
  return (['cbBTC', 'portalETH', 'SOL'] as const).find((leg) => intent.legs[leg].state === 'awaiting_approval')
}

function pendingBuildKey(purchaseId: string, leg: C3CoreMainnetLegId) {
  return `${purchaseId}:${leg}`
}

function parseRetryAfter(value: string | null): number {
  if (!value) return C3_CORE_MAINNET_POLICY.keylessRequestIntervalMs
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds * 1000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : C3_CORE_MAINNET_POLICY.keylessRequestIntervalMs
}

function sanitizeErrorBody(body: unknown): string {
  const value =
    typeof body === 'string'
      ? body
      : body && typeof body === 'object' && 'message' in body
        ? String(body.message)
        : String(body ?? 'request failed')
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
}

type C3CoreMainnetLegRecord = C3CoreMainnetPurchaseIntent['legs'][C3CoreMainnetLegId]

function readParsedTokenAccount(value: unknown): { mint: string; owner: string } | null {
  if (!value || typeof value !== 'object' || !('data' in value)) return null
  const account = value as { data?: unknown }
  if (!account.data || typeof account.data !== 'object' || !('parsed' in account.data)) return null
  const parsed = account.data as { parsed?: unknown }
  if (!parsed.parsed || typeof parsed.parsed !== 'object' || !('info' in parsed.parsed)) return null
  const info = (parsed.parsed as { info?: unknown }).info
  if (!info || typeof info !== 'object') return null
  const tokenInfo = info as { mint?: unknown; owner?: unknown }
  return typeof tokenInfo.mint === 'string' && typeof tokenInfo.owner === 'string'
    ? { mint: tokenInfo.mint, owner: tokenInfo.owner }
    : null
}
