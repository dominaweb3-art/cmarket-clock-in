import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Language } from "./locales";
import { evalText } from "./evaluation-locales";
import { evaluationTargets } from "./evaluation-visual-copy";
import { indicesText, marketKeys } from "./evaluation-indices-copy";
import { indicesView, type IndicesAction } from "./evaluation-indices-state";
import { EvaluationAccordion } from "./EvaluationAccordion";
import { CryptoIcon, NavigationGlyph } from "./EvaluationVisuals";
import { activityGroups, activityScope } from "./evaluation-activity-state";

type Props = {
  language: Language;
  wallet: string | null;
  verified: boolean;
  busy: boolean;
  position: Record<string, unknown> | null;
  status: string;
  onAction: (action: IndicesAction) => void;
  onRecover: () => void;
  displayUnits: (value: unknown) => string;
  onCatalogLayout?: (y: number) => void;
};
export function EvaluationIndices({
  language,
  wallet,
  verified,
  busy,
  position,
  status,
  onAction,
  onRecover,
  displayUnits,
  onCatalogLayout,
}: Props) {
  const t = (key: Parameters<typeof indicesText>[1]) =>
    indicesText(language, key);
  const state = indicesView(wallet, verified, busy, position);
  const ownsPosition =
    verified &&
    !!wallet &&
    position?.wallet === wallet &&
    position?.cluster === "solana:devnet" &&
    position?.simulatedAssets === true &&
    position?.monetaryValue === false;
  const history = activityGroups(wallet, verified, position);
  const hasScopedHistory = ownsPosition && activityScope(wallet, position);
  const canBuy = state.action === "deposit" && !busy;
  const canSell = state.action === "request_redemption" && !busy;
  return (
    <View testID="evaluation-indices">
      <Text accessibilityRole="header" style={s.title}>
        {t("title")}
      </Text>
      <Text style={s.subtitle}>{t("subtitle")}</Text>
      <View style={s.hero}>
        <View style={s.heading}>
          <Text style={s.c3}>C3</Text>
          <Text style={s.index}>{t("index")}</Text>
        </View>
        <Text style={s.badge}>{t("available")}</Text>
        <Text accessibilityRole="header" style={s.state}>
          {t("purchaseHeading")}
        </Text>
        <View style={s.operation}>
          <Text accessibilityRole="header" style={s.state}>
            {t(state.title)}
          </Text>
          {state.action === "deposit" ? (
            <Text style={s.body}>{t("depositNote")}</Text>
          ) : null}
          {hasScopedHistory ? (
            <View style={s.history}>
              <Text style={s.state}>{t("purchaseResult")}</Text>
              <Text style={s.caption}>{t("currentPosition")}</Text>
              <Text style={s.metric}>{displayUnits(position?.shares)} C3</Text>
              {history.map((group) =>
                group.kind === "other" ? null : (
                  <View key={group.kind} style={s.historyRow}>
                    <Text style={s.state}>
                      {t(
                        group.kind === "buy"
                          ? "purchaseHistory"
                          : "saleHistory",
                      )}
                    </Text>
                    <Text style={s.caption}>
                      {t(
                        group.state === "completed"
                          ? "historyConfirmed"
                          : "historyPending",
                      )}
                    </Text>
                    {group.amount !== null ? (
                      <Text style={s.body}>
                        {displayUnits(group.amount)} USDC · Devnet
                      </Text>
                    ) : null}
                    {group.shares !== null ? (
                      <Text style={s.body}>
                        {t("issuedHistory")}: {displayUnits(group.shares)} C3
                      </Text>
                    ) : null}
                  </View>
                ),
              )}
              {state.title === "completed" ? (
                <Text style={s.body}>{t("burnedHistory")}</Text>
              ) : null}
            </View>
          ) : null}
          <View style={s.tradeActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canBuy }}
              disabled={!canBuy}
              onPress={() => onAction("deposit")}
              style={[s.primary, s.tradeButton, !canBuy && s.disabled]}
            >
              <Text style={s.primaryText}>{t("buy")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSell }}
              disabled={!canSell}
              onPress={() => onAction("request_redemption")}
              style={[s.primary, s.tradeButton, !canSell && s.disabled]}
            >
              <Text style={s.primaryText}>{t("sell")}</Text>
            </Pressable>
          </View>
          {!canBuy || !canSell ? (
            <Text style={s.caption}>
              {t(
                state.title === "completed" ? "lifetime" : "tradeAvailability",
              )}
            </Text>
          ) : null}
          {state.action !== "deposit" &&
          state.action !== "request_redemption" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(state.label)}
              accessibilityState={{
                disabled: busy && state.action !== "activity",
              }}
              disabled={busy && state.action !== "activity"}
              onPress={() => onAction(state.action)}
              style={s.primary}
            >
              <Text style={s.primaryText}>{t(state.label)}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={s.assets}>
          {evaluationTargets.map((asset) => (
            <View
              key={asset.symbol}
              style={[s.asset, { backgroundColor: asset.background }]}
            >
              <CryptoIcon index={asset.icon} />
              <Text style={s.weight}>
                {asset.symbol} {asset.percent}%
              </Text>
            </View>
          ))}
        </View>
        <View
          accessible
          accessibilityLabel="BTC 40% · ETH 30% · SOL 30%"
          style={s.bar}
        >
          <View style={[s.segment, { flex: 40, backgroundColor: "#ee9b42" }]} />
          <View style={[s.segment, { flex: 30, backgroundColor: "#8a85c8" }]} />
          <View style={[s.segment, { flex: 30, backgroundColor: "#26aa8d" }]} />
        </View>
        <Text style={s.body}>{t("description")}</Text>
        <Text style={s.caption}>{t("testNote")}</Text>
        <View style={s.operation}>
          <Text accessibilityRole="header" style={s.state}>
            {t(state.title)}
          </Text>
          {ownsPosition &&
          (state.title === "active" || position?.lifecycle === 3) ? (
            <>
              <Text style={s.state}>{t("purchaseResult")}</Text>
              <Text style={s.caption}>{t("confirmedShares")}</Text>
              <Text style={s.metric}>{displayUnits(position?.shares)} C3</Text>
              <Text style={s.caption}>{t("marketEquivalent")}</Text>
              <Text style={s.body}>{t("noMarketValue")}</Text>
            </>
          ) : null}
          {state.title === "completed" ? (
            <>
              <Text style={s.caption}>{t("returned")}</Text>
              <Text style={s.metric}>
                {displayUnits(position?.returned)} USDC · Devnet
              </Text>
              <Text style={s.body}>{t("realizedOnly")}</Text>
              <Text style={s.body}>{t("lifetime")}</Text>
            </>
          ) : null}
          {state.action === "claim" ? (
            <>
              <Text style={s.caption}>{evalText(language, "claimable")}</Text>
              <Text style={s.metric}>
                {displayUnits(position?.claimable)} USDC · Devnet
              </Text>
              <Text style={s.body}>{t("realizedOnly")}</Text>
            </>
          ) : null}
          {/* Pending signatures and recovery are deliberately never collapsed. */}
          {state.recover ? (
            <>
              <Text style={s.warning}>{t("recoveryNote")}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={onRecover}
                style={s.secondary}
              >
                <Text style={s.link}>{t("recover")}</Text>
              </Pressable>
            </>
          ) : null}
          {state.renew ? (
            <>
              <Text style={s.body}>{t("renewal")}</Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                accessibilityState={{ disabled: busy }}
                onPress={() => onAction("renew_plan")}
                style={s.secondary}
              >
                <Text style={s.link}>{evalText(language, "renew_plan")}</Text>
              </Pressable>
            </>
          ) : null}
          {state.initialPlan && !state.recover ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              accessibilityState={{ disabled: busy }}
              onPress={() => onAction("recover_deposit_plan")}
              style={s.secondary}
            >
              <Text style={s.link}>
                {evalText(language, "recover_deposit_plan")}
              </Text>
            </Pressable>
          ) : null}
          {state.action !== "activity" && verified ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onAction("activity")}
              style={s.secondary}
            >
              <Text style={s.link}>{t("activity")}</Text>
            </Pressable>
          ) : null}
          <Text accessibilityLiveRegion="polite" style={s.status}>
            {busy ? evalText(language, "busy") : status}
          </Text>
        </View>
      </View>
      {(["composition", "how", "shares", "conditions"] as const).map((key) => (
        <EvaluationAccordion key={key} title={t(key)}>
          {key === "shares" ? (
            <Image
              accessible={false}
              source={require("../assets/evaluation-ui/c3-basket-explainer-v1.png")}
              style={s.illustration}
            />
          ) : null}
          <Text style={s.body}>{t(`${key}Body`)}</Text>
        </EvaluationAccordion>
      ))}
      <View
        style={s.catalog}
        onLayout={(event) => onCatalogLayout?.(event.nativeEvent.layout.y)}
      >
        <EvaluationAccordion title={t("more")}>
          {[5, 10, 20, 50].map((count) => (
            <View key={count} style={s.row}>
              <NavigationGlyph name="indices" />
              <View style={s.rowText}>
                <Text style={s.state}>C{count}</Text>
                <Text style={s.caption}>
                  {t("planned").replace("{count}", String(count))}
                </Text>
              </View>
            </View>
          ))}
        </EvaluationAccordion>
        <EvaluationAccordion title={t("markets")}>
          <Text style={s.body}>{t("marketsBody")}</Text>
          {marketKeys.map((key) => (
            <View key={key} style={s.market}>
              <Text style={s.body}>{t(key)}</Text>
            </View>
          ))}
        </EvaluationAccordion>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  title: { color: "#0b1221", fontSize: 28, fontWeight: "800", marginTop: 4 },
  subtitle: {
    color: "#66736e",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 4,
    marginBottom: 20,
  },
  hero: {
    borderWidth: 1,
    borderColor: "#dfede6",
    backgroundColor: "#fbfefd",
    borderRadius: 24,
    padding: 18,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  },
  c3: { fontSize: 36, color: "#0b1221", fontWeight: "800" },
  index: { fontSize: 21, fontWeight: "600", color: "#0b1221", flexShrink: 1 },
  badge: {
    alignSelf: "flex-start",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    color: "#075c47",
    backgroundColor: "#e9f6f0",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    marginVertical: 12,
  },
  assets: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  asset: {
    flex: 1,
    minWidth: 78,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 16,
    gap: 8,
  },
  weight: {
    color: "#15232c",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  bar: {
    height: 8,
    flexDirection: "row",
    borderRadius: 4,
    overflow: "hidden",
    marginVertical: 16,
  },
  segment: { height: 8 },
  body: { color: "#485d54", fontSize: 15, lineHeight: 23, marginVertical: 6 },
  caption: { color: "#61766d", fontSize: 13, lineHeight: 20 },
  operation: {
    borderTopWidth: 1,
    borderColor: "#dce9e2",
    paddingTop: 18,
    marginTop: 18,
  },
  state: {
    color: "#14382d",
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 24,
    marginBottom: 6,
  },
  primary: {
    backgroundColor: "#075c47",
    minHeight: 52,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  primaryText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  tradeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  tradeButton: { flex: 1, minWidth: 120 },
  disabled: { backgroundColor: "#7d8b86" },
  history: { marginVertical: 8 },
  historyRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: "#dce9e2",
  },
  secondary: { minHeight: 48, justifyContent: "center", paddingVertical: 12 },
  link: { color: "#075c47", fontSize: 15, fontWeight: "600", lineHeight: 22 },
  warning: {
    color: "#765311",
    backgroundColor: "#fff4d4",
    padding: 12,
    borderRadius: 12,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 12,
  },
  metric: {
    color: "#123d30",
    fontSize: 24,
    fontWeight: "700",
    marginVertical: 8,
  },
  status: { color: "#52675c", fontSize: 14, lineHeight: 22, marginTop: 8 },
  illustration: {
    width: 100,
    height: 94,
    resizeMode: "contain",
    alignSelf: "center",
    marginBottom: 8,
  },
  catalog: { marginTop: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: "#edf1ee",
  },
  rowText: { flex: 1 },
  market: { borderBottomWidth: 1, borderColor: "#edf1ee", paddingVertical: 4 },
});
