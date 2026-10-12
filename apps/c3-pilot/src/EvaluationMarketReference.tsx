import { StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import type { Language } from "./locales";
import { referenceView } from "./evaluation-reference-view";
import { localizedUnits } from "./evaluation-indices-presentation";
import { EvaluationAccordion } from "./EvaluationAccordion";
const copy = {
  en: {
    title: "Indicative value",
    detail: "About this value",
    warning:
      "Reference only. Sale proceeds are confirmed when processing finishes.",
    change: "Estimated change since deposit",
    up: "Up",
    down: "Down",
    flat: "No change",
    frozen: "Indicative value at sale request",
    unavailable: "Indicative value unavailable",
    note: "Simulation using real BTC/ETH/SOL USD prices (40/30/30). Not real assets, redeemable dollars or guaranteed test USDC. Sales pay only reconciled test USDC and burn shares.",
    source: "Coinbase Exchange · 60-second historical entry reference",
    updated: "Updated",
    entry: "Deposit date",
    refresh:
      "Refreshes every minute while the app is open. Percentage is relative to the deposit; it is not a realized profit or loss.",
  },
  es: {
    title: "Valor orientativo",
    detail: "Sobre este valor",
    warning: "Es una referencia. El importe de venta se confirma al finalizar.",
    change: "Variación estimada desde el depósito",
    up: "Subió",
    down: "Bajó",
    flat: "Sin variación",
    frozen: "Valor orientativo al solicitar la venta",
    unavailable: "Valor orientativo no disponible",
    note: "Simulación con precios reales BTC/ETH/SOL en USD (40/30/30). No son activos reales, dólares rescatables ni USDC de prueba garantizado. La venta paga solo USDC de prueba conciliado y quema participaciones.",
    source:
      "Coinbase Exchange · referencia histórica de entrada de 60 segundos",
    updated: "Actualizado",
    entry: "Fecha del depósito",
    refresh:
      "Se actualiza cada minuto mientras la app está abierta. El porcentaje se compara con el depósito; no es ganancia o pérdida realizada.",
  },
  "zh-CN": {
    title: "参考估值",
    detail: "关于此估值",
    warning: "仅供参考。卖出金额在处理完成后确认。",
    change: "相对存款的估计变化",
    up: "上涨",
    down: "下跌",
    flat: "无变化",
    frozen: "卖出申请时的参考值",
    unavailable: "参考估值暂不可用",
    note: "使用 BTC/ETH/SOL 真实美元价格的模拟（40/30/30）。并非真实资产、可赎回美元或保证的测试 USDC。卖出仅支付已核实的测试 USDC，并销毁份额。",
    source: "Coinbase Exchange · 60 秒历史入场参考",
    updated: "更新时间",
    entry: "存款日期",
    refresh:
      "应用打开时每分钟刷新。百分比相对于存款计算，并非已实现的收益或损失。",
  },
  "pt-BR": {
    title: "Valor indicativo",
    detail: "Sobre este valor",
    warning: "É uma referência. O valor da venda é confirmado ao finalizar.",
    change: "Variação estimada desde o depósito",
    up: "Subiu",
    down: "Caiu",
    flat: "Sem variação",
    frozen: "Valor indicativo ao solicitar a venda",
    unavailable: "Valor indicativo indisponível",
    note: "Simulação com preços reais BTC/ETH/SOL em USD (40/30/30). Não são ativos reais, dólares resgatáveis ou USDC de teste garantido. A venda paga apenas USDC de teste conciliado e queima participações.",
    source:
      "Coinbase Exchange · referência histórica de entrada de 60 segundos",
    updated: "Atualizado",
    entry: "Data do depósito",
    refresh:
      "Atualiza a cada minuto enquanto o app está aberto. A porcentagem é relativa ao depósito; não é lucro ou prejuízo realizado.",
  },
} satisfies Record<Language, Record<string, string>>;
export function EvaluationMarketReference({
  language,
  position,
  expanded,
  onToggle,
}: {
  language: Language;
  position: Record<string, unknown> | null;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const t = copy[language],
    r = referenceView(position, now);
  if (!r) return <Text style={s.caption}>{t.unavailable}</Text>;
  return (
    <View style={s.box}>
      {r ? (
        <Text style={s.caption}>
          {t.entry}: {new Date(r.basisTime).toLocaleString(language)}
        </Text>
      ) : null}
      <Text accessibilityRole="header" style={s.title}>
        {r?.frozen ? t.frozen : t.title}
      </Text>
      {r ? (
        <>
          <Text style={s.value}>USD {localizedUnits(r.value, language)}</Text>
          <View
            testID="evaluation-basket-performance"
            style={[
              s.performance,
              r.performance.direction === "down" && s.lossBox,
              r.performance.direction === "flat" && s.flatBox,
            ]}
          >
            <Text style={s.caption}>{t.change}</Text>
            <Text
              style={[
                s.change,
                r.performance.direction === "down" && s.loss,
                r.performance.direction === "flat" && s.flat,
              ]}
            >
              {t[r.performance.direction]} · {BigInt(r.change) > 0n ? "+" : ""}
              {localizedUnits(r.change, language)} USD ·{" "}
              {r.performance.percent.replace(
                ".",
                language === "es" || language === "pt-BR" ? "," : ".",
              )}
            </Text>
          </View>
          <Text style={s.caption}>
            {t.updated}: {new Date(r.observedAt).toLocaleString(language)}
          </Text>
        </>
      ) : (
        <Text style={s.caption}>{t.unavailable}</Text>
      )}
      <Text style={s.caption}>{t.warning}</Text>
      <EvaluationAccordion
        title={t.detail}
        {...(expanded === undefined ? {} : { expanded })}
        {...(onToggle ? { onToggle } : {})}
        inline
      >
        <Text style={s.caption}>{t.source}</Text>
        <Text style={s.caption}>{t.refresh}</Text>
        <Text style={s.caption}>{t.note}</Text>
      </EvaluationAccordion>
    </View>
  );
}
const s = StyleSheet.create({
  box: {
    paddingTop: 14,
    marginTop: 8,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#dce9e2",
  },
  title: { fontSize: 18, fontWeight: "700", color: "#17443b" },
  value: { fontSize: 24, fontWeight: "700", color: "#0c1424" },
  performance: {
    backgroundColor: "#edf8f2",
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  lossBox: { backgroundColor: "#fff0f2" },
  flatBox: { backgroundColor: "#f2f5f4" },
  change: { color: "#075f4c", fontSize: 17, fontWeight: "700", lineHeight: 25 },
  loss: { color: "#ad3448" },
  flat: { color: "#52635d" },
  caption: { color: "#5f726c", fontSize: 13, lineHeight: 19 },
});
