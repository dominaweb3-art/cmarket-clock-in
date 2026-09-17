declare module 'bs58' {
  const bs58: {
    decode: (value: string) => Uint8Array
  }
  export default bs58
}
