import { StyleSheet, Text, View } from "react-native";
import type { Language } from "./locales";
import { indicesView } from "./evaluation-indices-state";
import { positionCopy } from "./evaluation-position-view";
import {
  positionSummary,
  localizedUnits,
} from "./evaluation-indices-presentation";
import {
  presentationText,
  presentationCopy,
  type PresentationKey,
} from "./evaluation-indices-presentation-copy";
/** Read-only summary: missing evidence never becomes a zero balance. */
export function EvaluationPosition({
  language,
  wallet,
  verified,
  position,
}: {
  language: Language;
  wallet: string | null;
  verified: boolean;
  position: Record<string, unknown> | null;
}) {
  const t = (key: PresentationKey) => presentationText(language, key);
  const summary = positionSummary(wallet, verified, position);
  if (!summary || summary.empty)
    return (
      <Text style={s.caption}>
        {!wallet
          ? positionCopy[language].connect
          : !verified
            ? positionCopy[language].verify
            : t(summary?.empty ? "empty" : "unavailable")}
      </Text>
    );
  if (summary.received !== null)
    return (
      <View testID="evaluation-basket-position-closed" style={s.box}>
        <Text accessibilityRole="header" style={s.title}>
          {positionCopy[language].completed}
        </Text>
        <Text style={s.caption}>{t("participation")}: 0 C3</Text>
        <Text style={s.result}>
          {positionCopy[language].received}:{" "}
          {localizedUnits(summary.received, language)}
        </Text>
      </View>
    );
  const state = indicesView(wallet, verified, false, position);
  const stateKey =
    state.title in presentationCopy.en
      ? (state.title as PresentationKey)
      : "unknown";
  return (
    <View testID="evaluation-basket-position" style={s.box}>
      <View style={s.heading}>
        <Text accessibilityRole="header" style={s.title}>
          {t("basket")}
        </Text>
        <Text accessibilityLiveRegion="polite" style={s.badge}>
          {t(
            summary.shares === null && state.title === "active"
              ? "unknown"
              : stateKey,
          )}
        </Text>
      </View>
      <View style={s.metrics}>
        <View style={s.metric}>
          <Text style={s.caption}>{t("deposited")}</Text>
          <Text style={s.value}>
            {localizedUnits(summary.deposited, language)}
          </Text>
          <Text style={s.caption}>{t("testUsdc")}</Text>
        </View>
        <View style={s.metric}>
          <Text style={s.caption}>{t("participation")}</Text>
          <Text style={s.value}>
            {summary.shares === null
              ? t("pendingShares")
              : localizedUnits(summary.shares, language)}
          </Text>
          {summary.shares !== null ? <Text style={s.caption}>C3</Text> : null}
        </View>
      </View>
      {summary.received !== null && BigInt(summary.received) > 0n ? (
        <Text style={s.result}>
          {t("received")}: {localizedUnits(summary.received, language)}
        </Text>
      ) : null}
      {summary.claimable !== null && BigInt(summary.claimable) > 0n ? (
        <Text style={s.result}>
          {t("payable")}: {localizedUnits(summary.claimable, language)}{" "}
          {t("testUsdc")}
        </Text>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  box: { borderTopWidth: 1, borderColor: "#dce9e2", paddingTop: 14, gap: 12 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  title: { color: "#102b25", fontSize: 20, fontWeight: "700" },
  badge: {
    color: "#075c47",
    backgroundColor: "#eaf7f1",
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metric: { flex: 1, minWidth: 100, gap: 4 },
  caption: { color: "#60766a", fontSize: 14, lineHeight: 21 },
  value: { color: "#0b1221", fontSize: 24, lineHeight: 31, fontWeight: "700" },
  result: { color: "#075c47", fontSize: 15, lineHeight: 23 },
});
