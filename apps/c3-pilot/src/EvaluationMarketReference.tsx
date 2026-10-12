import { AppState, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import type { Language } from "./locales";
import { referenceView } from "./evaluation-reference-view";
import { localizedUnits } from "./evaluation-indices-presentation";
import { EvaluationAccordion } from "./EvaluationAccordion";
import {
  checkedLivePrices,
  liveReferencePosition,
  priceChange24h,
  type LivePrices,
} from "./evaluation-live-prices";
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
      "Market prices are checked every 5 seconds while Indices is open. Basket change is relative to the deposit; it is not a realized profit or loss.",
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
      "Los precios se consultan cada 5 segundos con Índices abierto. La variación de la cesta se compara con el depósito; no es ganancia o pérdida realizada.",
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
      "指数页面打开时每5秒查询市场价格。篮子百分比相对于存款计算，并非已实现的收益或损失。",
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
      "Consulta preços a cada 5 segundos com Índices aberto. A variação da cesta é relativa ao depósito; não é lucro ou prejuízo realizado.",
  },
} satisfies Record<Language, Record<string, string>>;
export function EvaluationMarketReference({
  language,
  position,
  expanded,
  onToggle,
  screenActive = true,
}: {
  language: Language;
  position: Record<string, unknown> | null;
  expanded?: boolean;
  onToggle?: () => void;
  screenActive?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [prices, setPrices] = useState<LivePrices | null>(null);
  useEffect(() => {
    if (!screenActive) return;
    let active = true,
      busy = false,
      nextAttempt = 0;
    let controller: AbortController | undefined;
    const query = async () => {
      if (
        !active ||
        busy ||
        AppState.currentState !== "active" ||
        Date.now() < nextAttempt
      )
        return;
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 7000);
      try {
        const response = await fetch(
          "https://cmarket-nine.vercel.app/api/prices",
          { signal: controller.signal },
        );
        if (!response.ok) throw Error("MARKET_UNAVAILABLE");
        const value = checkedLivePrices(await response.json());
        if (active) {
          setPrices(value);
          setNow(Date.now());
        }
      } catch {
        nextAttempt = Date.now() + 15000;
        if (active) {
          setPrices(null);
          setNow(Date.now());
        }
      } finally {
        clearTimeout(timeout);
        busy = false;
      }
    };
    void query();
    const timer = setInterval(() => {
      void query();
    }, 5000);
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void query();
    });
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      foreground.remove();
    };
  }, [screenActive]);
  const t = copy[language],
    r = referenceView(liveReferencePosition(position, prices), now);
  const marketCopy = {
    en: [
      "Market prices · USD",
      "24h",
      "Checked every 5 seconds · Coinbase Exchange",
      "Purchase pending: basket performance appears after shares are confirmed.",
    ],
    es: [
      "Precios de mercado · USD",
      "24 h",
      "Consulta cada 5 segundos · Coinbase Exchange",
      "Compra pendiente: la evolución de tu cesta aparece al confirmar las participaciones.",
    ],
    "zh-CN": [
      "市场价格 · USD",
      "24小时",
      "每5秒查询 · Coinbase Exchange",
      "购买待处理：份额确认后显示篮子表现。",
    ],
    "pt-BR": [
      "Preços de mercado · USD",
      "24h",
      "Consulta a cada 5 segundos · Coinbase Exchange",
      "Compra pendente: o desempenho da cesta aparece após confirmar as participações.",
    ],
  }[language];
  return (
    <View style={s.box}>
      <Text accessibilityRole="header" style={s.title}>
        {marketCopy[0]}
      </Text>
      {prices ? (
        prices.assets.map((asset) => {
          const change = priceChange24h(asset.priceUnits, asset.open24hUnits);
          const price = BigInt(asset.priceUnits);
          return (
            <View key={asset.product} style={s.marketRow}>
              <Text style={s.caption}>{asset.product.slice(0, 3)}</Text>
              <Text style={s.price}>
                ${(price / 100000000n).toString()}.
                {((price % 100000000n) / 1000000n).toString().padStart(2, "0")}
              </Text>
              <Text
                style={[
                  s.change,
                  change.direction === "down" && s.loss,
                  change.direction === "flat" && s.flat,
                ]}
              >
                {change.percent} · {marketCopy[1]}
              </Text>
            </View>
          );
        })
      ) : (
        <Text style={s.caption}>{t.unavailable}</Text>
      )}
      <Text style={s.caption}>
        {marketCopy[2]}
        {prices
          ? ` · ${new Date(prices.observedAt).toLocaleTimeString(language)}`
          : ""}
      </Text>
      {!r && Number(position?.lifecycle) === 1 ? (
        <Text style={s.caption}>{marketCopy[3]}</Text>
      ) : null}
      {r ? (
        <>
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
              <Text style={s.value}>
                USD {localizedUnits(r.value, language)}
              </Text>
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
                  {t[r.performance.direction]} ·{" "}
                  {BigInt(r.change) > 0n ? "+" : ""}
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
        </>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  marketRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 6,
  },
  price: { fontSize: 16, color: "#0c1424", fontWeight: "600" },
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
