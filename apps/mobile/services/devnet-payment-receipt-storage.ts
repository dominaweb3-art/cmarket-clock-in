import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  loadDevnetPaymentReceipts as loadReceipts,
  recordDevnetPaymentReceipt as recordReceipt,
  type DevnetPaymentReceipt,
} from './devnet-payment-receipts'

const storage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
}

export function loadDevnetPaymentReceipts() {
  return loadReceipts(storage)
}

export function recordDevnetPaymentReceipt(receipt: DevnetPaymentReceipt) {
  return recordReceipt(storage, receipt)
}
