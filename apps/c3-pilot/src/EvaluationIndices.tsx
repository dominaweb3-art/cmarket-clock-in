import { useState } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { purchaseUnits } from "./evaluation-purchase";
import type { Language } from "./locales";
import { evalText } from "./evaluation-locales";
import { evaluationTargets } from "./evaluation-visual-copy";
import { indicesText, marketKeys } from "./evaluation-indices-copy";
import { indicesView, type IndicesAction } from "./evaluation-indices-state";
import { EvaluationAccordion } from "./EvaluationAccordion";
import { CryptoIcon } from "./EvaluationVisuals";
import {
  activityExplorer,
  activityGroups,
  activityScope,
} from "./evaluation-activity-state";
import { EvaluationPosition } from "./EvaluationPosition";
import { EvaluationMarketReference } from "./EvaluationMarketReference";
import {
  localizedUnits,
  presentationAction,
  presentationLimits,
  positionSummary,
} from "./evaluation-indices-presentation";
import {
  presentationText,
  type PresentationKey,
} from "./evaluation-indices-presentation-copy";
import { saleCopy } from "./evaluation-sale-copy";

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
  purchaseAmount: string;
  onPurchaseAmount: (value: string) => void;
  onCatalogLayout?: (y: number) => void;
};
/** Presentation only: callbacks dispatch to the original reviewed controllers. */
export function EvaluationIndices({
  language,
  wallet,
  verified,
  busy,
  position,
  status,
  onAction,
  onRecover,
  purchaseAmount,
  onPurchaseAmount,
  onCatalogLayout,
}: Props) {
  const t = (key: PresentationKey) => presentationText(language, key);
  const state = indicesView(wallet, verified, busy, position);
  const ownsPosition = verified && activityScope(wallet, position);
  const history = activityGroups(wallet, verified, position);
  const limits = presentationLimits(wallet, verified, position);
  const summary = positionSummary(wallet, verified, position);
  const sale = saleCopy[language];
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [proofError, setProofError] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const twoColumns = width >= 360 && fontScale <= 1.2;
  const accordionProps = (key: string) => ({
    inline: true,
    expanded: openSection === key,
    onToggle: () =>
      setOpenSection((previous) => (previous === key ? null : key)),
  });
  const interpolate = (text: string) =>
    limits
      ? text
          .replace("{minimum}", localizedUnits(limits.minimum, language))
          .replace("{maximum}", localizedUnits(limits.maximum, language))
          .replace("{amount}", localizedUnits(limits.available, language))
          .replace("{round}", limits.round)
          .replace("{rounds}", limits.rounds)
      : t("limitsPending");
  // Same reviewed purchase parser and balance/cap checks. No change to amounts.
  let validAmount = false;
  try {
    const amount = purchaseUnits(purchaseAmount);
    validAmount =
      typeof position?.availableUsdc === "string" &&
      /^[0-9]+$/.test(position.availableUsdc) &&
      typeof position?.maximumPurchase === "string" &&
      /^[0-9]+$/.test(position.maximumPurchase) &&
      amount <= BigInt(position.maximumPurchase) &&
      amount <= BigInt(position.availableUsdc);
  } catch {
    /* No signing for invalid amounts. */
  }
  const primary = presentationAction(state, busy, validAmount, limits);
  const label =
    primary.action === "request_redemption"
      ? sale.sell
      : primary.action === "new_purchase"
        ? t("newTrial")
        : primary.action === "claim"
          ? t("claim")
          : primary.action === "issue_shares"
            ? t("issue")
            : primary.action === "advance"
              ? t("continue")
              : primary.action === "provision"
                ? t("funds")
                : primary.action === "refresh"
                  ? t("refresh")
                  : primary.action === "activity"
                    ? t(state.title === "completed" ? "activity" : "view")
                    : indicesText(language, state.label);
  const infoKeys = [
    "composition",
    "how",
    "shares",
    "conditions",
    "details",
  ] as const;
  return (
    <View testID="evaluation-indices">
      <Text accessibilityRole="header" style={s.title}>
        {indicesText(language, "title")}
      </Text>
      <Text style={s.subtitle}>{t("subtitle")}</Text>
      <View style={s.product}>
        <View style={s.heading}>
          <Text style={s.c3}>C3</Text>
          <Text style={s.index}>{indicesText(language, "index")}</Text>
        </View>
        <Text style={s.body}>{t("description")}</Text>
        <Text style={s.caption}>{t("target")}</Text>
        <View style={s.assets}>
          {evaluationTargets.map((asset) => (
            <View key={asset.symbol} style={s.asset}>
              <CryptoIcon index={asset.icon} size={32} />
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
          {evaluationTargets.map((asset) => (
            <View
              key={asset.symbol}
              style={{
                flex: asset.percent,
                backgroundColor:
                  asset.symbol === "BTC"
                    ? "#ee9b42"
                    : asset.symbol === "ETH"
                      ? "#8a85c8"
                      : "#26aa8d",
              }}
            />
          ))}
        </View>
        <EvaluationPosition
          language={language}
          wallet={wallet}
          verified={verified}
          position={position}
        />
        {state.action === "deposit" ? (
          <View style={s.amountEntry}>
            <Text style={s.body}>{t("amount")}</Text>
            <TextInput
              accessibilityLabel={t("amount")}
              value={purchaseAmount}
              onChangeText={onPurchaseAmount}
              keyboardType="decimal-pad"
              maxLength={14}
              editable={!busy}
              style={s.input}
            />
            <Text style={s.caption}>{interpolate(t("range"))}</Text>
            {limits ? (
              <Text style={s.caption}>{interpolate(t("available"))}</Text>
            ) : null}
            {!validAmount ? (
              <Text style={s.warning}>{t("invalid")}</Text>
            ) : null}
            {validAmount ? (
              <Text style={s.caption}>
                {sale.expected.replace(
                  "{amount}",
                  localizedUnits(
                    purchaseUnits(purchaseAmount).toString(),
                    language,
                  ),
                )}
              </Text>
            ) : null}
          </View>
        ) : null}
        {primary.action === "request_redemption" &&
        summary &&
        !summary.empty &&
        summary.shares !== null ? (
          <View style={s.amountEntry}>
            <Text style={s.body}>{sale.quantity}</Text>
            <Text style={s.input}>
              {sale.all.replace(
                "{amount}",
                localizedUnits(summary.shares, language),
              )}
            </Text>
            <Text style={s.caption}>{sale.totalOnly}</Text>
          </View>
        ) : null}
        <Pressable
          testID="indices-primary-action"
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: primary.disabled }}
          disabled={primary.disabled}
          onPress={() => {
            if (!primary.disabled) onAction(primary.action);
          }}
          style={[s.primary, primary.disabled && s.disabled]}
        >
          <Text style={s.primaryText}>{label}</Text>
        </Pressable>
        {ownsPosition && [3, 4].includes(Number(position?.lifecycle)) ? (
          <Text accessibilityLiveRegion="polite" style={s.body}>
            {state.action === "claim"
              ? sale.claiming
              : summary && !summary.empty && summary.received !== null
                ? sale.closed
                : sale.selling}
          </Text>
        ) : null}
        {primary.action !== "activity" && verified ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onAction("activity")}
            style={s.secondary}
          >
            <Text style={s.link}>{t("activity")}</Text>
          </Pressable>
        ) : null}
        {/* Uncertain requests and recovery never disappear into an accordion. */}
        {state.recover ? (
          <View>
            <Text style={s.warning}>
              {indicesText(language, "recoveryNote")}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={onRecover}
              style={s.secondary}
            >
              <Text style={s.link}>{indicesText(language, "recover")}</Text>
            </Pressable>
          </View>
        ) : null}
        {state.renew ? (
          <View>
            <Text style={s.body}>{indicesText(language, "renewal")}</Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              accessibilityState={{ disabled: busy }}
              onPress={() => onAction("renew_plan")}
              style={s.secondary}
            >
              <Text style={s.link}>{evalText(language, "renew_plan")}</Text>
            </Pressable>
          </View>
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
        {busy || status ? (
          <Text accessibilityLiveRegion="polite" style={s.caption}>
            {busy
              ? evalText(language, "busy")
              : summary &&
                  !summary.empty &&
                  summary.received !== null &&
                  !state.recover &&
                  !status.startsWith("EVAL_")
                ? t("completed")
                : status}
          </Text>
        ) : null}
        {ownsPosition && [2, 3].includes(Number(position?.lifecycle)) ? (
          <EvaluationMarketReference
            language={language}
            position={position}
            expanded={openSection === "value"}
            onToggle={accordionProps("value").onToggle}
          />
        ) : null}
      </View>
      <Text accessibilityRole="header" style={s.sectionTitle}>
        {t("about")}
      </Text>
      <View testID="indices-about-c3" style={s.group}>
        {infoKeys.map((key) => (
          <EvaluationAccordion
            key={key}
            title={t(key)}
            {...accordionProps(key)}
          >
            {key === "how" ? (
              <>
                {(["how1", "how2", "how3", "how4"] as const).map((step, i) => (
                  <Text key={step} style={s.body}>
                    {i + 1}. {t(step)}
                  </Text>
                ))}
                <Text style={s.body}>{t("approvals")}</Text>
              </>
            ) : key === "details" ? (
              <>
                {ownsPosition ? (
                  <>
                    {(["vault", "shareMint", "round"] as const).map((field) =>
                      typeof position?.[field] === "string" ? (
                        <View key={field} style={s.detailRow}>
                          <Text style={s.caption}>
                            {t(field === "round" ? "trial" : field)}
                          </Text>
                          <Text selectable style={s.technical}>
                            {String(position[field])}
                          </Text>
                        </View>
                      ) : null,
                    )}
                    {history
                      .flatMap((group) => group.receipts)
                      .map((receipt) => {
                        const url = activityExplorer(receipt.signature);
                        return (
                          <View key={receipt.signature} style={s.detailRow}>
                            <Text style={s.caption}>
                              {receipt.action} ·{" "}
                              {t(receipt.verified ? "confirmed" : "pending")}
                            </Text>
                            <Text selectable style={s.technical}>
                              {receipt.signature}
                            </Text>
                            {url ? (
                              <Pressable
                                accessibilityRole="link"
                                accessibilityLabel={t("proof")}
                                onPress={() => {
                                  void Linking.openURL(url).catch(() =>
                                    setProofError(true),
                                  );
                                }}
                                style={s.secondary}
                              >
                                <Text style={s.link}>{t("proof")}</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        );
                      })}
                  </>
                ) : (
                  <Text style={s.body}>{t("noReceipts")}</Text>
                )}
                {proofError ? (
                  <Text accessibilityLiveRegion="polite" style={s.warning}>
                    {t("proofError")}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onAction("activity")}
                  style={s.secondary}
                >
                  <Text style={s.link}>{t("activity")}</Text>
                </Pressable>
              </>
            ) : (
              <Text style={s.body}>{t((key + "Body") as PresentationKey)}</Text>
            )}
            {key === "conditions" ? (
              <>
                <Text style={s.body}>{interpolate(t("range"))}</Text>
                <Text style={s.body}>{interpolate(t("repeat"))}</Text>
              </>
            ) : null}
          </EvaluationAccordion>
        ))}
      </View>
      <View
        testID="indices-upcoming"
        onLayout={(event) => onCatalogLayout?.(event.nativeEvent.layout.y)}
      >
        <Text accessibilityRole="header" style={s.sectionTitle}>
          {t("upcoming")}
        </Text>
        <View style={s.group}>
          <EvaluationAccordion title={t("more")} {...accordionProps("more")}>
            {[5, 10, 20, 50].map((count) => (
              <Text key={count} style={s.body}>
                C{count} · {t("planned").replace("{count}", String(count))}
              </Text>
            ))}
          </EvaluationAccordion>
          <EvaluationAccordion
            title={t("markets")}
            {...accordionProps("markets")}
          >
            <Text style={s.body}>{t("marketsBody")}</Text>
            <View style={s.markets}>
              {marketKeys.map((key) => (
                <View
                  key={key}
                  style={[s.market, { width: twoColumns ? "48%" : "100%" }]}
                >
                  <Text style={s.body}>{indicesText(language, key)}</Text>
                </View>
              ))}
            </View>
          </EvaluationAccordion>
        </View>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  title: { color: "#0b1221", fontSize: 27, fontWeight: "800" },
  subtitle: {
    color: "#52665c",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 4,
    marginBottom: 20,
  },
  product: {
    borderWidth: 1,
    borderColor: "#dfede6",
    backgroundColor: "#fbfefd",
    borderRadius: 20,
    padding: 16,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  c3: { fontSize: 32, fontWeight: "800", color: "#0b1221" },
  index: { fontSize: 20, fontWeight: "600", color: "#17382c", flexShrink: 1 },
  assets: { flexDirection: "row", gap: 8, marginTop: 8 },
  asset: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
  },
  weight: {
    fontSize: 14,
    fontWeight: "700",
    color: "#17352b",
    textAlign: "center",
  },
  bar: {
    height: 4,
    flexDirection: "row",
    overflow: "hidden",
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 12,
  },
  body: { color: "#485d54", fontSize: 15, lineHeight: 23, marginVertical: 6 },
  caption: { color: "#61766d", fontSize: 13, lineHeight: 20 },
  amountEntry: { gap: 6, marginVertical: 12 },
  input: {
    fontSize: 16,
    color: "#17382c",
    padding: 12,
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#dce8e4",
    borderRadius: 12,
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
  disabled: { backgroundColor: "#7d8b86" },
  secondary: { minHeight: 48, justifyContent: "center", paddingVertical: 10 },
  link: { color: "#075c47", fontSize: 15, lineHeight: 22, fontWeight: "600" },
  warning: {
    color: "#765311",
    backgroundColor: "#fff4d4",
    padding: 10,
    borderRadius: 10,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "700",
    color: "#153c2e",
    marginTop: 22,
    marginBottom: 8,
  },
  group: {
    borderWidth: 1,
    borderColor: "#e3ebe7",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  detailRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#e3ebe7",
  },
  technical: { fontSize: 13, lineHeight: 20, color: "#17382c" },
  markets: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  market: { paddingVertical: 4 },
});
