import { StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import type { Language } from "./locales";
import { referenceDollars, referenceView } from "./evaluation-reference-view";
const copy = {
  en: {
    title: "Illustrative market value",
    change: "Change since deposit",
    frozen: "Reference at sale request",
    unavailable: "Market reference unavailable",
    note: "Simulation using real BTC/ETH/SOL USD prices (40/30/30). Not real assets, redeemable dollars or guaranteed test USDC. Sales pay only reconciled test USDC and burn shares.",
    source: "Coinbase Exchange · 60-second historical entry reference",
    updated: "Updated",
    entry: "Deposit basis",
  },
  es: {
    title: "Valor representativo de mercado",
    change: "Variación desde el depósito",
    frozen: "Referencia al solicitar la venta",
    unavailable: "Referencia de mercado no disponible",
    note: "Simulación con precios reales BTC/ETH/SOL en USD (40/30/30). No son activos reales, dólares rescatables ni USDC de prueba garantizado. La venta paga solo USDC de prueba conciliado y quema participaciones.",
    source:
      "Coinbase Exchange · referencia histórica de entrada de 60 segundos",
    updated: "Actualizado",
    entry: "Base del depósito",
  },
  "zh-CN": {
    title: "模拟市场价值",
    change: "相对存款的变化",
    frozen: "卖出申请时的参考值",
    unavailable: "市场参考暂不可用",
    note: "使用 BTC/ETH/SOL 真实美元价格的模拟（40/30/30）。并非真实资产、可赎回美元或保证的测试 USDC。卖出仅支付已核实的测试 USDC，并销毁份额。",
    source: "Coinbase Exchange · 60 秒历史入场参考",
    updated: "更新时间",
    entry: "存款基准",
  },
  "pt-BR": {
    title: "Valor representativo de mercado",
    change: "Variação desde o depósito",
    frozen: "Referência ao solicitar a venda",
    unavailable: "Referência de mercado indisponível",
    note: "Simulação com preços reais BTC/ETH/SOL em USD (40/30/30). Não são ativos reais, dólares resgatáveis ou USDC de teste garantido. A venda paga apenas USDC de teste conciliado e queima participações.",
    source:
      "Coinbase Exchange · referência histórica de entrada de 60 segundos",
    updated: "Atualizado",
    entry: "Base do depósito",
  },
} satisfies Record<Language, Record<string, string>>;
export function EvaluationMarketReference({
  language,
  position,
}: {
  language: Language;
  position: Record<string, unknown> | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const t = copy[language],
    r = referenceView(position, now);
  return (
    <View style={s.box}>
      <Text accessibilityRole="header" style={s.title}>
        {r?.frozen ? t.frozen : t.title}
      </Text>
      {r ? (
        <>
          <Text style={s.value}>USD {referenceDollars(r.value)}</Text>
          <Text style={[s.change, BigInt(r.change) < 0n && s.loss]}>
            {t.change}: {BigInt(r.change) >= 0n ? "+" : ""}
            {referenceDollars(r.change)} USD
          </Text>
          <Text style={s.caption}>
            {t.entry}: {new Date(r.basisTime).toLocaleString(language)}
          </Text>
          <Text style={s.caption}>
            {t.updated}: {new Date(r.observedAt).toLocaleString(language)}
          </Text>
          <Text style={s.caption}>{t.source}</Text>
        </>
      ) : (
        <Text style={s.caption}>{t.unavailable}</Text>
      )}
      <Text style={s.caption}>{t.note}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  box: { paddingVertical: 16, gap: 8 },
  title: { fontSize: 18, fontWeight: "700", color: "#17443b" },
  value: { fontSize: 28, fontWeight: "700", color: "#0c1424" },
  change: { color: "#075f4c", fontSize: 16 },
  loss: { color: "#ad3448" },
  caption: { color: "#5f726c", fontSize: 13, lineHeight: 19 },
});
