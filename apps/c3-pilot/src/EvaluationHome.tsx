import { Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import type { Language } from "./locales";
import { evalText } from "./evaluation-locales";
import { evaluationTargets } from "./evaluation-visual-copy";
import { indicesText } from "./evaluation-indices-copy";
import { homeText } from "./evaluation-home-copy";
import { homeOperation } from "./evaluation-home-state";
import { EvaluationAccordion } from "./EvaluationAccordion";
import { CryptoIcon, NavigationGlyph } from "./EvaluationVisuals";

const steps = [
  { title: "connect", body: "connectBody", icon: "wallet" },
  { title: "buy", body: "buyBody", icon: "indices" },
  { title: "follow", body: "followBody", icon: "activity" },
  { title: "sell", body: "sellBody", icon: "wallet" },
] as const;
const questions = ["real", "activity", "restart", "repeat"] as const;
type Props = {
  language: Language;
  wallet: string | null;
  verified: boolean;
  busy: boolean;
  position: Record<string, unknown> | null;
  status: string;
  onExplore: () => void;
  onUpcoming: () => void;
};
/** Home is explanatory and navigational only. No wallet/network side effects. */
export function EvaluationHome({
  language,
  wallet,
  verified,
  busy,
  position,
  status,
  onExplore,
  onUpcoming,
}: Props) {
  const t = (key: Parameters<typeof homeText>[1]) => homeText(language, key);
  const operation = homeOperation(wallet, verified, busy, position);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const accordionProps = (key: string) => ({
    inline: true,
    expanded: openSection === key,
    onToggle: () =>
      setOpenSection((previous) => (previous === key ? null : key)),
  });
  return (
    <View testID="evaluation-home">
      <Text accessibilityRole="header" style={s.title}>
        {t("title")}
      </Text>
      <Text style={s.introduction}>{t("introduction")}</Text>
      <View style={s.card}>
        <View style={s.heading}>
          <Text style={s.c3}>C3</Text>
          <Text style={s.index}>{indicesText(language, "index")}</Text>
        </View>
        <Text style={s.caption}>{t("target")}</Text>
        <View style={s.assets}>
          {evaluationTargets.map((asset) => (
            <View
              key={asset.symbol}
              style={[s.asset, { backgroundColor: asset.background }]}
            >
              <CryptoIcon index={asset.icon} size={36} />
              <Text style={s.weight}>
                {asset.symbol} {asset.percent}%
              </Text>
            </View>
          ))}
        </View>
        <Pressable
          testID="home-explore-c3"
          accessibilityRole="button"
          accessibilityLabel={t("explore")}
          onPress={onExplore}
          style={s.primary}
        >
          <Text style={s.primaryText}>{t("explore")}</Text>
        </Pressable>
        {operation ? (
          <View style={s.pending}>
            <Text accessibilityLiveRegion="polite" style={s.caption}>
              {operation === "busy"
                ? evalText(language, "busy")
                : indicesText(language, operation)}
            </Text>
            <Pressable
              testID="home-continue-operation"
              accessibilityRole="button"
              onPress={onExplore}
              style={s.secondary}
            >
              <Text style={s.link}>{t("continue")}</Text>
            </Pressable>
          </View>
        ) : null}
        {status.startsWith("EVAL_") ? (
          <Text accessibilityLiveRegion="polite" style={s.warning}>
            {evalText(language, "error")}
            {"\n"}
            {status}
          </Text>
        ) : null}
      </View>
      <Text accessibilityRole="header" style={s.sectionTitle}>
        {t("learn")}
      </Text>
      <View style={s.information} testID="home-information-group">
        <EvaluationAccordion title={t("how")} {...accordionProps("how")}>
          {steps.map((step, index) => (
            <View key={step.title} style={s.step}>
              <View accessible={false} style={s.stepIcon}>
                <NavigationGlyph name={step.icon} color="#075c47" />
              </View>
              <View style={s.stepText}>
                <Text style={s.question}>
                  {index + 1}. {t(step.title)}
                </Text>
                <Text style={s.body}>{t(step.body)}</Text>
              </View>
            </View>
          ))}
        </EvaluationAccordion>
        <EvaluationAccordion title={t("what")} {...accordionProps("what")}>
          <Text style={s.body}>{t("whatBody")}</Text>
        </EvaluationAccordion>
        <EvaluationAccordion
          title={t("methodology")}
          {...accordionProps("methodology")}
        >
          <Text style={s.body}>{t("methodologyBody")}</Text>
        </EvaluationAccordion>
        <EvaluationAccordion title={t("faq")} {...accordionProps("faq")}>
          {questions.map((key) => (
            <View key={key} style={s.answer}>
              <Text style={s.question}>{t(key)}</Text>
              <Text style={s.body}>{t(`${key}Body`)}</Text>
            </View>
          ))}
        </EvaluationAccordion>
        <EvaluationAccordion title={t("about")} {...accordionProps("about")}>
          <Text style={s.body}>{t("aboutBody")}</Text>
        </EvaluationAccordion>
      </View>
      <View style={s.future}>
        <EvaluationAccordion title={t("future")} {...accordionProps("future")}>
          <Text style={s.body}>{t("futureBody")}</Text>
          <Pressable
            testID="home-upcoming-indices"
            accessibilityRole="button"
            onPress={onUpcoming}
            style={s.secondary}
          >
            <Text style={s.link}>{t("upcoming")}</Text>
          </Pressable>
        </EvaluationAccordion>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  title: {
    color: "#0b1221",
    fontSize: 27,
    lineHeight: 34,
    fontWeight: "800",
    marginTop: 2,
  },
  introduction: {
    color: "#52665c",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 22,
  },
  card: {
    borderWidth: 1,
    borderColor: "#dfede6",
    backgroundColor: "#fbfefd",
    borderRadius: 24,
    padding: 16,
    marginBottom: 0,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  },
  c3: { fontSize: 32, fontWeight: "800", color: "#0b1221" },
  index: { color: "#183d30", fontSize: 20, fontWeight: "600", flexShrink: 1 },
  caption: { color: "#60766a", fontSize: 13, lineHeight: 20 },
  assets: { flexDirection: "row", gap: 8, marginTop: 8 },
  asset: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    alignItems: "center",
    paddingVertical: 8,
    gap: 4,
  },
  weight: {
    fontSize: 14,
    fontWeight: "700",
    color: "#17352b",
    textAlign: "center",
  },
  primary: {
    backgroundColor: "#075c47",
    borderRadius: 14,
    minHeight: 52,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  primaryText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  pending: { paddingTop: 10 },
  secondary: { minHeight: 48, justifyContent: "center", paddingVertical: 10 },
  link: { color: "#075c47", fontSize: 15, lineHeight: 22, fontWeight: "600" },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 26,
    color: "#153c2e",
    fontWeight: "700",
    marginTop: 22,
    marginBottom: 8,
  },
  information: {
    borderWidth: 1,
    borderColor: "#e3ebe7",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  step: {
    flexDirection: "row",
    gap: 12,
    marginVertical: 8,
    alignItems: "flex-start",
  },
  stepIcon: { width: 30, height: 30, transform: [{ scale: 0.75 }] },
  stepText: { flex: 1 },
  question: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
    color: "#153c2e",
  },
  body: { color: "#52675b", fontSize: 15, lineHeight: 23, marginTop: 4 },
  answer: { paddingVertical: 8 },
  future: { marginTop: 20 },
  warning: {
    color: "#765311",
    backgroundColor: "#fff4d4",
    fontSize: 14,
    lineHeight: 22,
    padding: 12,
    borderRadius: 12,
    marginTop: 10,
  },
});
