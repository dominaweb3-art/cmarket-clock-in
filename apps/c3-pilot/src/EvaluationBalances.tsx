import { useEffect, useState } from "react";
import {
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Language } from "./locales";
import { nativeEvaluationPost } from "./evaluation-transport";
import {
  DEVNET_BALANCE_RPC,
  EVALUATION_USDC_MINT,
  balanceUnits,
  tokenBalance,
} from "./evaluation-balances";
import { CryptoIcon } from "./EvaluationVisuals";

const copy = {
  en: [
    "Connect wallet to view balances",
    "Loading…",
    "Unavailable",
    "Refresh balances",
    "USDC",
    "Balances · Devnet only",
    "Devnet",
  ],
  es: [
    "Conecta tu wallet para ver saldos",
    "Consultando…",
    "No disponible",
    "Actualizar saldos",
    "USDC",
    "Saldos · solo Devnet",
    "Devnet",
  ],
  "zh-CN": [
    "连接钱包查看余额",
    "查询中…",
    "不可用",
    "刷新余额",
    "USDC",
    "余额 · 仅 Devnet",
    "Devnet",
  ],
  "pt-BR": [
    "Conecte a wallet para ver saldos",
    "Consultando…",
    "Indisponível",
    "Atualizar saldos",
    "USDC",
    "Saldos · apenas Devnet",
    "Devnet",
  ],
} as const;
type Entry = { wallet: string; values: (string | null)[] };
async function rpc(method: string, params: unknown[]) {
  const response = await nativeEvaluationPost(
    DEVNET_BALANCE_RPC,
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  );
  const body = JSON.parse(response.text);
  if (response.status !== 200 || body.error || body.id !== 1 || !body.result)
    throw Error("BALANCE_RPC");
  return body.result;
}
export function EvaluationBalances({
  wallet,
  language,
  revision,
  compact = false,
}: {
  wallet: string | null;
  language: Language;
  revision: unknown;
  compact?: boolean;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const c = copy[language];
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setRefresh((v) => v + 1);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!wallet) return;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setEntry(null);
      setLoading(true);
    });
    const sol = rpc("getBalance", [wallet, { commitment: "finalized" }]).then(
      (r) => {
        if (!Number.isSafeInteger(r.value) || r.value < 0)
          throw Error("BALANCE_INVALID");
        return balanceUnits(BigInt(r.value), 9);
      },
    );
    const testUsdc = rpc("getTokenAccountsByOwner", [
      wallet,
      { mint: EVALUATION_USDC_MINT },
      { encoding: "jsonParsed", commitment: "finalized" },
    ]).then((r) => tokenBalance(r, wallet, EVALUATION_USDC_MINT));
    void Promise.allSettled([sol, testUsdc]).then((results) => {
      if (cancelled) return;
      setEntry({
        wallet,
        values: results.map((r) => (r.status === "fulfilled" ? r.value : null)),
      });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [wallet, refresh, revision]);
  const values = entry?.wallet === wallet ? entry.values : null;
  return (
    <View
      style={[s.container, compact && s.compact]}
      testID="evaluation-wallet-balances"
    >
      {!wallet ? (
        <Text style={s.note}>{c[0]}</Text>
      ) : (
        <>
          <View style={[s.row, compact && s.compactRow]}>
            <View style={s.cell}>
              <View style={s.solIcon}>
                <View style={s.solInner}>
                  <CryptoIcon index={2} />
                </View>
              </View>
              <View style={s.content}>
                <Text style={[s.label, compact && s.compactLabel]}>
                  SOL Devnet
                </Text>
                <Text style={[s.amount, compact && s.compactAmount]}>
                  {loading ? c[1] : (values?.[0] ?? c[2])}
                </Text>
              </View>
            </View>
            <View style={s.cell}>
              <Image
                source={require("../assets/evaluation-ui/usdc-official.png")}
                style={s.icon}
                accessible={false}
              />
              <View style={s.content}>
                <View style={s.tokenHeading}>
                  <Text style={[s.label, compact && s.compactLabel]}>
                    {c[4]}
                  </Text>
                  <Text style={s.network}>{c[6]}</Text>
                </View>
                <View>
                  <Text style={[s.amount, compact && s.compactAmount]}>
                    {loading ? c[1] : (values?.[1] ?? c[2])}
                  </Text>
                </View>
              </View>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={c[3]}
            disabled={loading}
            onPress={() => setRefresh((v) => v + 1)}
            style={[s.refresh, compact && s.compactRefresh]}
          >
            <Text style={[s.note, compact && s.compactNote]}>{c[5]} · ↻</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  compact: { marginHorizontal: 0, marginBottom: 12 },
  compactRow: { flexWrap: "wrap" },
  compactLabel: { fontSize: 13 },
  compactAmount: { fontSize: 17 },
  compactNote: { fontSize: 12 },
  compactRefresh: { minHeight: 48 },
  container: { marginHorizontal: 20, marginTop: 10, marginBottom: 2 },
  row: { flexDirection: "row", gap: 10 },
  cell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 10,
    gap: 7,
    backgroundColor: "#f7faf9",
    borderRadius: 14,
  },
  content: { flex: 1, gap: 5 },
  icon: { width: 32, height: 32 },
  tokenHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  network: {
    fontSize: 9,
    color: "#006d50",
    backgroundColor: "#e5f3ed",
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: "hidden",
    borderRadius: 5,
  },
  solIcon: { width: 32, height: 32, overflow: "hidden" },
  solInner: {
    width: 56,
    height: 56,
    position: "absolute",
    left: -12,
    top: -12,
    transform: [{ scale: 0.57 }],
  },
  label: { fontSize: 11, color: "#526c61", fontWeight: "600" },
  amount: { fontSize: 15, fontWeight: "700", color: "#124b3d", flexShrink: 1 },
  note: { fontSize: 10, color: "#526c61", textAlign: "center" },
  refresh: { minHeight: 44, justifyContent: "center" },
});
