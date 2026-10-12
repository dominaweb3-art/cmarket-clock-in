import { StyleSheet, Text, View } from "react-native";
import type { Language } from "./locales";
import { basketPosition, positionCopy } from "./evaluation-position-view";
import { referenceDollars } from "./evaluation-reference-view";
import { EvaluationMarketReference } from "./EvaluationMarketReference";

/** Amount-first read-only view. Share-token implementation stays in receipts. */
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
  const t = positionCopy[language],
    view = basketPosition(wallet, verified, position);
  return (
    <View testID="evaluation-basket-position" style={s.box}>
      <Text accessibilityRole="header" style={s.title}>
        {t.title}
      </Text>
      <Text accessibilityLiveRegion="polite" style={s.status}>
        {t[view.state]}
      </Text>
      {"deposited" in view ? (
        <>
          <Text style={s.caption}>{t.invested}</Text>
          <Text style={s.value}>{referenceDollars(view.deposited)}</Text>
        </>
      ) : null}
      {view.state === "active" || view.state === "selling" ? (
        <EvaluationMarketReference language={language} position={position} />
      ) : null}
      {view.state === "completed" ? (
        <>
          <Text style={s.caption}>{t.received}</Text>
          <Text style={s.value}>{referenceDollars(view.received)}</Text>
        </>
      ) : null}
      {view.state === "selling" && BigInt(view.claimable) > 0n ? (
        <>
          <Text style={s.caption}>{t.claimable}</Text>
          <Text style={s.value}>{referenceDollars(view.claimable)}</Text>
        </>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  box: { paddingVertical: 12, gap: 6 },
  title: { color: "#102b25", fontSize: 20, fontWeight: "700" },
  status: { color: "#075c47", fontSize: 14, lineHeight: 21 },
  caption: { color: "#60766a", fontSize: 13, lineHeight: 19 },
  value: { color: "#0b1221", fontSize: 26, fontWeight: "700" },
});
