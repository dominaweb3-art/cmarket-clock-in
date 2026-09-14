import { createContext, type PropsWithChildren, use, useMemo } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'

export interface AuthState {
  isAuthenticated: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const Context = createContext<AuthState>({} as AuthState)

export function useAuth() {
  const value = use(Context)
  if (!value) {
    throw new Error('useAuth must be wrapped in a <AuthProvider />')
  }

  return value
}

export function AuthProvider({ children }: PropsWithChildren) {
  const { accounts, connect, disconnect } = useMobileWallet()

  const value: AuthState = useMemo(
    () => ({
      // Authentication is wallet connection for this app. The previous
      // sign-in flow requested a signed message against example.com and
      // caused Phantom to reject it with MWA error -3.
      signIn: async () => {
        await connect()
      },
      signOut: async () => await disconnect(),
      isAuthenticated: (accounts?.length ?? 0) > 0,
    }),
    [accounts, connect, disconnect],
  )

  return <Context value={value}>{children}</Context>
}
