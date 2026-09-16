import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

import { C3_CORE_MAINNET_CONFIG } from '../../constants/c3-core-mainnet.ts'
import type {
  C3MainnetInstructionEvidence,
  C3MainnetTransactionEvidence,
} from '../../services/c3-core-mainnet-reconciliation.ts'
import type { C3CoreMainnetLegId } from '../../services/c3-core-mainnet-core.ts'

export const REALISTIC_FIXTURE_WALLET = 'DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej'
export const REALISTIC_FIXTURE_SOURCE = 'GzHwuZ17v1L3avncqgpbmkFMwHThDRKntWQqVRSdwkHc'
export const REALISTIC_FIXTURE_ROUTE_PROGRAM = '8TxrtAxqA5PA2Y1d2pxzCz9SoDhjrBcYqNAQKVv6p443'
export const REALISTIC_FIXTURE_LOOKUP = new PublicKey(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
).toBase58()
export const REALISTIC_FIXTURE_ROUTE_ACCOUNT = new PublicKey(Uint8Array.from({ length: 32 }, () => 9)).toBase58()
export const REALISTIC_FIXTURE_CBBTC_DESTINATION = new PublicKey(Uint8Array.from({ length: 32 }, () => 10)).toBase58()
export const REALISTIC_FIXTURE_ETH_DESTINATION = new PublicKey(Uint8Array.from({ length: 32 }, () => 11)).toBase58()
export const REALISTIC_FIXTURE_WSOL_DESTINATION = new PublicKey(Uint8Array.from({ length: 32 }, () => 12)).toBase58()
export const REALISTIC_FIXTURE_SIGNATURE =
  '99eUso3aSbE9tqGSTXzo3TLfKb9RkMTURrHKQ1K7Zh3BbeqPevr5E1iCbpTjqHuTFLtfxTTD5ekfVuZFzQyEQf8'

const routeDiscriminator = [187, 100, 250, 204, 49, 196, 175, 20]
const tokenProgram = C3_CORE_MAINNET_CONFIG.programs.token
const jupiterProgram = C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6
const computeBudgetProgram = C3_CORE_MAINNET_CONFIG.programs.computeBudget
const altProgram = C3_CORE_MAINNET_CONFIG.programs.addressLookupTable

function dataBase64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64')
}

function accountKeys(outputDestination: string, temporaryWsolAccount?: string) {
  const keys = [
    REALISTIC_FIXTURE_WALLET,
    REALISTIC_FIXTURE_SOURCE,
    outputDestination,
    C3_CORE_MAINNET_CONFIG.assets.input,
    C3_CORE_MAINNET_CONFIG.assets.cbBTC,
    C3_CORE_MAINNET_CONFIG.assets.portalETH,
    C3_CORE_MAINNET_CONFIG.assets.wSOL,
    tokenProgram,
    computeBudgetProgram,
    jupiterProgram,
    C3_CORE_MAINNET_CONFIG.programs.associatedToken,
    C3_CORE_MAINNET_CONFIG.programs.system,
    C3_CORE_MAINNET_CONFIG.programs.token2022,
    C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6,
    C3_CORE_MAINNET_CONFIG.programs.addressLookupTable,
    C3_CORE_MAINNET_PROGRAMS_EVENT_AUTHORITY,
    REALISTIC_FIXTURE_ROUTE_ACCOUNT,
    REALISTIC_FIXTURE_ROUTE_PROGRAM,
  ]
  if (temporaryWsolAccount) keys.push(temporaryWsolAccount)
  return keys
}

const C3_CORE_MAINNET_PROGRAMS_EVENT_AUTHORITY = 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf'

function instructionSet(
  outputDestination: string,
  leg: C3CoreMainnetLegId,
  temporaryWsolAccount?: string,
): {
  outer: C3MainnetInstructionEvidence[]
  inner: C3MainnetInstructionEvidence[]
} {
  const outer: C3MainnetInstructionEvidence[] = [
    {
      index: 0,
      programId: computeBudgetProgram,
      accountAddresses: [],
      dataBase64: dataBase64([2, 0, 0, 0, 0]),
    },
    {
      index: 1,
      programId: jupiterProgram,
      accountAddresses: [
        REALISTIC_FIXTURE_WALLET,
        REALISTIC_FIXTURE_SOURCE,
        outputDestination,
        C3_CORE_MAINNET_CONFIG.assets.input,
        leg === 'cbBTC'
          ? C3_CORE_MAINNET_CONFIG.assets.cbBTC
          : leg === 'portalETH'
            ? C3_CORE_MAINNET_CONFIG.assets.portalETH
            : C3_CORE_MAINNET_ASSETS_WSOL,
        tokenProgram,
        jupiterProgram,
        C3_CORE_MAINNET_PROGRAMS_EVENT_AUTHORITY,
        REALISTIC_FIXTURE_ROUTE_ACCOUNT,
        REALISTIC_FIXTURE_ROUTE_PROGRAM,
      ],
      dataBase64: dataBase64(routeDiscriminator),
    },
  ]
  if (leg === 'SOL' && temporaryWsolAccount) {
    outer.push({
      index: 2,
      programId: tokenProgram,
      accountAddresses: [temporaryWsolAccount, REALISTIC_FIXTURE_WALLET, REALISTIC_FIXTURE_WALLET],
      dataBase64: dataBase64([9]),
    })
  }
  const inner: C3MainnetInstructionEvidence[] = [
    {
      index: 0,
      parentIndex: 1,
      programId: REALISTIC_FIXTURE_ROUTE_PROGRAM,
      accountAddresses: [REALISTIC_FIXTURE_ROUTE_ACCOUNT, REALISTIC_FIXTURE_SOURCE, outputDestination],
      dataBase64: dataBase64([1, 2, 3, 4]),
    },
    {
      index: 1,
      parentIndex: 1,
      programId: tokenProgram,
      accountAddresses: [REALISTIC_FIXTURE_SOURCE, REALISTIC_FIXTURE_ROUTE_ACCOUNT],
      dataBase64: dataBase64([3, 0, 0, 0, 0]),
    },
    {
      index: 2,
      parentIndex: 1,
      programId: tokenProgram,
      accountAddresses: [REALISTIC_FIXTURE_ROUTE_ACCOUNT, outputDestination],
      dataBase64: dataBase64([3, 0, 0, 0, 0]),
    },
  ]
  return { outer, inner }
}

export function realisticC3Evidence(
  leg: C3CoreMainnetLegId,
  inputAmountBaseUnits = leg === 'cbBTC' ? '20000000' : '15000000',
  outputAmountBaseUnits = leg === 'SOL' ? '15000000' : '26000',
): C3MainnetTransactionEvidence {
  const outputDestination =
    leg === 'cbBTC'
      ? REALISTIC_FIXTURE_CBBTC_DESTINATION
      : leg === 'portalETH'
        ? REALISTIC_FIXTURE_ETH_DESTINATION
        : REALISTIC_FIXTURE_WSOL_DESTINATION
  const temporaryWsolAccount = leg === 'SOL' ? REALISTIC_FIXTURE_WSOL_DESTINATION : undefined
  const keys = accountKeys(outputDestination, temporaryWsolAccount)
  const instructions = instructionSet(outputDestination, leg, temporaryWsolAccount)
  const outputMint =
    leg === 'cbBTC'
      ? C3_CORE_MAINNET_CONFIG.assets.cbBTC
      : leg === 'portalETH'
        ? C3_CORE_MAINNET_CONFIG.assets.portalETH
        : C3_CORE_MAINNET_ASSETS_WSOL
  const outputIndex = keys.indexOf(outputDestination)
  const sourceIndex = keys.indexOf(REALISTIC_FIXTURE_SOURCE)
  const walletIndex = keys.indexOf(REALISTIC_FIXTURE_WALLET)
  const preLamports = keys.map(() => '0')
  const postLamports = keys.map(() => '0')
  preLamports[walletIndex] = '1000000000'
  postLamports[walletIndex] = leg === 'SOL' ? '1014995000' : '999995000'
  const sourceAfter = (BigInt('100000000') - BigInt(inputAmountBaseUnits)).toString()
  const raw = {
    accountKeys: keys.map((address, index) => ({
      address,
      isSigner: index === walletIndex,
      isWritable: index === walletIndex || index === sourceIndex || index === outputIndex,
      source: address === REALISTIC_FIXTURE_ROUTE_ACCOUNT ? ('lookupTable' as const) : ('transaction' as const),
    })),
    outerInstructions: instructions.outer,
    innerInstructions: instructions.inner,
    preTokenBalances: [
      {
        accountIndex: sourceIndex,
        mint: C3_CORE_MAINNET_CONFIG.assets.input,
        owner: REALISTIC_FIXTURE_WALLET,
        amountBaseUnits: '100000000',
      },
      { accountIndex: outputIndex, mint: outputMint, owner: REALISTIC_FIXTURE_WALLET, amountBaseUnits: '0' },
    ],
    postTokenBalances: [
      {
        accountIndex: sourceIndex,
        mint: C3_CORE_MAINNET_CONFIG.assets.input,
        owner: REALISTIC_FIXTURE_WALLET,
        amountBaseUnits: sourceAfter,
      },
      {
        accountIndex: outputIndex,
        mint: outputMint,
        owner: REALISTIC_FIXTURE_WALLET,
        amountBaseUnits: outputAmountBaseUnits,
      },
    ],
    preLamportBalances: preLamports,
    postLamportBalances: postLamports,
    feeLamports: '5000',
    logMessages: ['Program log: sanitized C3 fixture'],
    addressLookupTables: [
      {
        address: REALISTIC_FIXTURE_LOOKUP,
        owner: altProgram,
        active: true,
        lastExtendedSlot: 90,
        addresses: [REALISTIC_FIXTURE_ROUTE_ACCOUNT],
        writableIndexes: [0],
        readonlyIndexes: [],
        loadedWritableAddresses: [REALISTIC_FIXTURE_ROUTE_ACCOUNT],
        loadedReadonlyAddresses: [],
      },
    ],
  }
  return {
    signature: REALISTIC_FIXTURE_SIGNATURE,
    cluster: 'mainnet-beta',
    slot: 100,
    blockTimeMs: 1_700_000_000_000,
    finalized: true,
    metaErr: null,
    feePayer: REALISTIC_FIXTURE_WALLET,
    signerAddresses: [REALISTIC_FIXTURE_WALLET],
    jupiterProgramIds: [jupiterProgram],
    executableProgramIds: [computeBudgetProgram, jupiterProgram, REALISTIC_FIXTURE_ROUTE_PROGRAM, tokenProgram],
    unknownProgramIds: [],
    input: {
      owner: REALISTIC_FIXTURE_WALLET,
      mint: C3_CORE_MAINNET_CONFIG.assets.input,
      amountBaseUnits: inputAmountBaseUnits,
      destination: REALISTIC_FIXTURE_SOURCE,
    },
    output:
      leg === 'SOL'
        ? undefined
        : {
            owner: REALISTIC_FIXTURE_WALLET,
            mint: outputMint,
            amountBaseUnits: outputAmountBaseUnits,
            destination: outputDestination,
          },
    treasuryAddresses: [],
    lookupTablesValidated: true,
    effectsComplete: true,
    raw,
    sol: {
      outputLamports: leg === 'SOL' ? outputAmountBaseUnits : '0',
      feeLamports: '5000',
      userLamportsReturned: '0',
    },
  }
}

export const C3_CORE_MAINNET_ASSETS_WSOL = C3_CORE_MAINNET_CONFIG.assets.wSOL

export function createOversizedPortalEthTransaction(): VersionedTransaction {
  const oversizedKeys = Array.from(
    { length: 40 },
    (_, index) => new PublicKey(Uint8Array.from({ length: 32 }, (_, byte) => (index + byte + 21) % 256)),
  )
  const instruction = new TransactionInstruction({
    programId: SystemProgram.programId,
    keys: oversizedKeys.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    data: Buffer.alloc(300, 7),
  })
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: new PublicKey(REALISTIC_FIXTURE_WALLET),
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [instruction],
    }).compileToV0Message(),
  )
}
