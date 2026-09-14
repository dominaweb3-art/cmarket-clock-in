import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'

import { ellipsify } from '../solana/format'

export function WalletBar() {
  const { account, connect, disconnect } = useMobileWallet()
  const address = account?.address?.toString()

  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        <View style={styles.statusDot} />
        <Text style={styles.network}>SOLANA DEVNET</Text>
      </View>

      {address ? (
        <View style={styles.connectedRow}>
          <View style={styles.addressBlock}>
            <Text style={styles.label}>Connected wallet</Text>
            <Text style={styles.address}>{ellipsify(address)}</Text>
          </View>
          <Pressable onPress={() => void disconnect()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Disconnect</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => void connect()} style={styles.connectButton}>
          <Text style={styles.connectButtonText}>Connect wallet</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCE7F3',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#14B87A',
  },
  network: {
    color: '#4B6580',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  connectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addressBlock: {
    flex: 1,
    gap: 5,
  },
  label: {
    color: '#6D8298',
    fontSize: 12,
  },
  address: {
    color: '#102A43',
    fontSize: 16,
    fontWeight: '800',
  },
  connectButton: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#102A43',
  },
  connectButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: '#EEF4FA',
  },
  secondaryButtonText: {
    color: '#315A7D',
    fontSize: 12,
    fontWeight: '800',
  },
})
