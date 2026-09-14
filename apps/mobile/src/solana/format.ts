export function ellipsify(value: string, chars = 5): string {
  if (value.length <= chars * 2) return value
  return value.slice(0, chars) + '…' + value.slice(-chars)
}

export function formatUsdc(value: number): string {
  return value.toFixed(2)
}

export function getExplorerTransactionUrl(signature: string): string {
  return 'https://explorer.solana.com/tx/' + signature + '?cluster=devnet'
}
