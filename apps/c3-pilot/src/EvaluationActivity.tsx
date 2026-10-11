import { useState } from "react";
import {
  ActivityIndicator,
  Clipboard,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Language } from "./locales";
import { evalText, type EvaluationKey } from "./evaluation-locales";
import { indicesText } from "./evaluation-indices-copy";
import { indicesView } from "./evaluation-indices-state";
import { homeOperation } from "./evaluation-home-state";
import {
  activityExplorer,
  activityGroups,
  activityScope,
  type ActivityGroup,
  type Receipt,
} from "./evaluation-activity-state";
import { activityText, type ActivityKey } from "./evaluation-activity-copy";
import { EvaluationAccordion } from "./EvaluationAccordion";
import { NavigationGlyph } from "./EvaluationVisuals";
import { purchaseCopy } from "./evaluation-purchase";

const ownerStages = new Set([
  "deposit",
  "issue_shares",
  "request_redemption",
  "claim",
  "renew_plan",
  "recover_deposit_plan",
]);
const serviceStages = new Set<ActivityKey>([
  "plan",
  "authorize",
  "execute",
  "record",
]);
function stage(language: Language, action: string): string {
  if (ownerStages.has(action))
    return evalText(language, action as EvaluationKey);
  if (serviceStages.has(action as ActivityKey))
    return activityText(language, action as ActivityKey);
  return activityText(language, "unknown");
}
function dateLabel(language: Language, value: string): string {
  // No device-time-generated operation dates. Only dated service records.
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function ReceiptRow({
  language,
  receipt,
  displayUnits,
}: {
  language: Language;
  receipt: Receipt;
  displayUnits: (v: unknown) => string;
}) {
  const [copied, setCopied] = useState<"copied" | "copyError" | null>(null);
  const t = (k: ActivityKey) => activityText(language, k);
  const url = activityExplorer(receipt.signature);
  return (
    <View style={s.receipt}>
      <Text style={s.stage}>{stage(language, receipt.action)}</Text>
      <Text style={s.body}>
        {t(receipt.verified ? "confirmed" : "reconciling")}
      </Text>
      {receipt.date ? (
        <Text style={s.caption}>{dateLabel(language, receipt.date)}</Text>
      ) : null}
      {receipt.output !== null && receipt.verified ? (
        <Text style={s.body}>
          {t("amounts")}: {displayUnits(receipt.output)} · TEST
        </Text>
      ) : null}
      <Text style={s.signature}>
        {receipt.signature.slice(0, 8)}…{receipt.signature.slice(-8)}
      </Text>
      <View style={s.links}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t("copy")} · ${stage(language, receipt.action)}`}
          style={s.linkButton}
          onPress={() => {
            try {
              Clipboard.setString(receipt.signature);
              setCopied("copied");
            } catch {
              setCopied("copyError");
            }
          }}
        >
          <Text style={s.link}>{t("copy")}</Text>
        </Pressable>
        {url ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${t("explorer")} · ${stage(language, receipt.action)}`}
            style={s.linkButton}
            onPress={() => {
              void Linking.openURL(url).catch(() => setCopied("copyError"));
            }}
          >
            <Text style={s.link}>{t("explorer")}</Text>
          </Pressable>
        ) : null}
      </View>
      {copied ? (
        <Text accessibilityLiveRegion="polite" style={s.caption}>
          {t(copied)}
        </Text>
      ) : null}
    </View>
  );
}
function OperationCard({
  language,
  group,
  displayUnits,
}: {
  language: Language;
  group: ActivityGroup;
  displayUnits: (v: unknown) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const t = (k: ActivityKey) => activityText(language, k);
  return (
    <View style={s.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t(group.kind)} · ${t(group.state)}`}
        accessibilityState={{ expanded }}
        style={s.summary}
        onPress={() => setExpanded((v) => !v)}
      >
        <View accessible={false} style={s.icon}>
          <Text style={s.arrow}>
            {group.kind === "buy" ? "↓" : group.kind === "sell" ? "↑" : "≡"}
          </Text>
        </View>
        <View style={s.summaryText}>
          <Text style={s.groupTitle}>{t(group.kind)}</Text>
          {group.date ? (
            <Text style={s.caption}>{dateLabel(language, group.date)}</Text>
          ) : null}
          {group.amount !== null ? (
            <Text style={s.amount}>{displayUnits(group.amount)} TEST USDC</Text>
          ) : null}
          <Text style={[s.state, group.state === "reconciling" && s.attention]}>
            {t(group.state)}
          </Text>
        </View>
        <Text accessible={false} style={s.toggle}>
          {expanded ? "−" : "+"}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={s.content}>
          <Text style={s.caption}>
            {t(group.kind === "other" ? "otherNote" : "partial")}
          </Text>
          {group.shares !== null ? (
            <Text style={s.body}>
              {t("shares")}: {displayUnits(group.shares)}
            </Text>
          ) : null}
          <Text style={s.receiptsTitle}>{t("receipts")}</Text>
          {group.receipts.map((receipt) => (
            <ReceiptRow
              key={receipt.signature}
              language={language}
              receipt={receipt}
              displayUnits={displayUnits}
            />
          ))}
          <EvaluationAccordion title={t("details")}>
            {group.receipts.map((receipt) => (
              <View key={receipt.signature} style={s.technicalRow}>
                <Text style={s.caption}>{stage(language, receipt.action)}</Text>
                <Text selectable style={s.technical}>
                  {receipt.signature}
                </Text>
              </View>
            ))}
          </EvaluationAccordion>
        </View>
      ) : null}
    </View>
  );
}
type Props = {
  language: Language;
  wallet: string | null;
  verified: boolean;
  busy: boolean;
  position: Record<string, unknown> | null;
  status: string;
  displayUnits: (v: unknown) => string;
  onWallet: () => void;
  onIndices: () => void;
  onRefresh: () => void;
  onRecover: () => void;
};
/** Mounted across tabs. No effect, automatic refresh, authorization or submission. */
export function EvaluationActivity({
  language,
  wallet,
  verified,
  busy,
  position,
  status,
  displayUnits,
  onWallet,
  onIndices,
  onRefresh,
  onRecover,
}: Props) {
  const t = (k: ActivityKey) => activityText(language, k);
  const scoped = activityScope(wallet, position);
  const groups = activityGroups(wallet, verified, position);
  const operation = scoped
    ? homeOperation(wallet, verified, busy, position)
    : null;
  const view = indicesView(wallet, verified, busy, scoped ? position : null);
  const error = status.startsWith("EVAL_");
  const emptyKey = !wallet
    ? "wallet"
    : !verified
      ? "verify"
      : !position
        ? "notLoaded"
        : "empty";
  const emptyAction =
    !wallet || !verified
      ? onWallet
      : !position || !scoped
        ? onRefresh
        : onIndices;
  const emptyLabel =
    !wallet || !verified
      ? "openWallet"
      : !position || !scoped
        ? "query"
        : "explore";
  const intent =
    position?.intent && typeof position.intent === "object"
      ? (position.intent as Record<string, unknown>)
      : null;
  const technical = scoped
    ? [
        ["intent_id", intent?.intent_id],
        ["db_revision", intent?.db_revision],
        ["chain_revision", intent?.chain_revision],
        ["finalizedSlot", position?.finalizedSlot],
      ].filter(
        ([, v]) =>
          (typeof v === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(v)) ||
          (typeof v === "number" && Number.isSafeInteger(v) && v >= 0),
      )
    : [];
  return (
    <View testID="evaluation-activity">
      <Text accessibilityRole="header" style={s.title}>
        {t("title")}
      </Text>
      <Text style={s.subtitle}>{t("subtitle")}</Text>
      {busy ? (
        <View accessibilityLiveRegion="polite" style={s.loading}>
          <ActivityIndicator size="small" color="#075c47" />
          <Text style={s.caption}>{t("loading")}</Text>
        </View>
      ) : null}
      {error || (verified && position && !scoped) ? (
        <View style={s.warning}>
          <Text accessibilityLiveRegion="polite" style={s.body}>
            {t(error ? "error" : "scope")}
          </Text>
          {verified ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              accessibilityState={{ disabled: busy }}
              onPress={onRefresh}
              style={s.linkButton}
            >
              <Text style={s.link}>{t("refresh")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {operation && operation !== "busy" ? (
        <View style={s.pending}>
          <View style={s.pendingHeading}>
            <NavigationGlyph name="activity" color="#075c47" />
            <Text style={s.groupTitle}>
              C3 ·{" "}
              {t(
                position?.lifecycle === 3
                  ? "sell"
                  : position?.lifecycle === 1
                    ? "buy"
                    : "pending",
              )}
            </Text>
          </View>
          <Text accessibilityLiveRegion="polite" style={s.body}>
            {operation === "recoveryNote"
              ? t("reconciling")
              : indicesText(language, operation)}
          </Text>
          <Text style={s.caption}>{t("recoverNote")}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            accessibilityState={{ disabled: busy }}
            onPress={view.recover ? onRecover : onIndices}
            style={s.linkButton}
          >
            <Text style={s.link}>
              {t(view.recover ? "review" : "continue")}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {!groups.length ? (
        <View style={s.empty}>
          <Image
            accessible={false}
            source={require("../assets/evaluation-ui/activity-empty-v1.png")}
            style={s.emptyImage}
          />
          <Text style={s.groupTitle}>{t(emptyKey)}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            accessibilityState={{ disabled: busy }}
            onPress={emptyAction}
            style={s.linkButton}
          >
            <Text style={s.link}>{t(emptyLabel)}</Text>
          </Pressable>
        </View>
      ) : (
        groups.map((group) => (
          <OperationCard
            key={group.kind}
            language={language}
            group={group}
            displayUnits={displayUnits}
          />
        ))
      )}
      {verified && position ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          accessibilityState={{ disabled: busy }}
          onPress={onRefresh}
          style={s.refresh}
        >
          <Text style={s.link}>{t("refresh")}</Text>
        </Pressable>
      ) : null}
      {verified &&
      scoped &&
      Array.isArray(position?.previousTrials) &&
      position.previousTrials.length ? (
        <EvaluationAccordion title={purchaseCopy[language].history}>
          {position.previousTrials.map((trial: Record<string, unknown>) => {
            if (
              typeof trial.vault !== "string" ||
              !Array.isArray(trial.activity)
            )
              return null;
            const receipts = trial.activity.filter(
              (r: Record<string, unknown>) =>
                r.effects_verified === true && activityExplorer(r.signature),
            );
            const deposited = receipts.some(
              (r: Record<string, unknown>) => r.action === "deposit",
            );
            return (
              <View key={trial.vault} style={s.receipt}>
                <Text style={s.groupTitle}>
                  C3 · {deposited ? displayUnits(trial.amount) : "—"} USDC ·
                  Devnet
                </Text>
                {receipts.map((r: Record<string, unknown>) => (
                  <Pressable
                    key={String(r.signature)}
                    accessibilityRole="link"
                    style={s.linkButton}
                    onPress={() => {
                      void Linking.openURL(
                        activityExplorer(r.signature)!,
                      ).catch(() => undefined);
                    }}
                  >
                    <Text style={s.link}>
                      {stage(language, String(r.action))} · {t("confirmed")}
                    </Text>
                  </Pressable>
                ))}
              </View>
            );
          })}
        </EvaluationAccordion>
      ) : null}
      <EvaluationAccordion title={t("help")}>
        <Text style={s.body}>{t("helpBody")}</Text>
      </EvaluationAccordion>
      {technical.length || error ? (
        <EvaluationAccordion title={t("details")}>
          {technical.map(([label, value]) => (
            <Text key={String(label)} selectable style={s.technical}>
              {String(label)}: {String(value)}
            </Text>
          ))}
          {error ? (
            <Text selectable style={s.technical}>
              {status}
            </Text>
          ) : null}
        </EvaluationAccordion>
      ) : null}
      <Text style={s.footnote}>{t("test")}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  title: { color: "#0b1221", fontSize: 27, lineHeight: 34, fontWeight: "800" },
  subtitle: {
    color: "#52665c",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 16,
  },
  card: {
    borderWidth: 1,
    borderColor: "#e1ebe6",
    borderRadius: 20,
    backgroundColor: "#fff",
    marginTop: 12,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    minHeight: 88,
  },
  summaryText: { flex: 1 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#eaf7f1",
    alignItems: "center",
    justifyContent: "center",
  },
  arrow: { fontSize: 23, fontWeight: "600", color: "#075c47" },
  toggle: { fontSize: 24, color: "#075c47" },
  groupTitle: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700",
    color: "#173b30",
    flexShrink: 1,
  },
  amount: { fontSize: 16, color: "#173b30", fontWeight: "600", marginTop: 4 },
  state: { fontSize: 13, lineHeight: 20, color: "#075c47", marginTop: 4 },
  attention: { color: "#765311" },
  content: { paddingHorizontal: 16, paddingBottom: 16 },
  body: { fontSize: 15, lineHeight: 23, color: "#52675b" },
  caption: { color: "#63776c", fontSize: 13, lineHeight: 20, marginTop: 4 },
  receiptsTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#153c2e",
    marginTop: 16,
  },
  receipt: {
    borderTopWidth: 1,
    borderColor: "#e5ece8",
    paddingTop: 12,
    marginTop: 12,
  },
  stage: { fontSize: 15, fontWeight: "600", lineHeight: 22, color: "#173b30" },
  signature: { color: "#60766a", fontSize: 13, marginTop: 6 },
  links: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  linkButton: { minHeight: 48, justifyContent: "center", paddingVertical: 10 },
  link: { color: "#075c47", fontSize: 15, lineHeight: 22, fontWeight: "600" },
  technical: { color: "#627269", fontSize: 12, lineHeight: 19, marginTop: 6 },
  technicalRow: { marginTop: 8 },
  pending: {
    backgroundColor: "#edf8f2",
    borderWidth: 1,
    borderColor: "#cfe6d9",
    borderRadius: 20,
    padding: 16,
    marginBottom: 8,
  },
  pendingHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  warning: {
    backgroundColor: "#fff4d4",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  empty: {
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e3ebe7",
    alignItems: "center",
    gap: 10,
  },
  emptyImage: { width: 100, height: 75, resizeMode: "contain" },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  refresh: { minHeight: 48, justifyContent: "center", marginTop: 12 },
  footnote: { fontSize: 12, lineHeight: 18, color: "#63776c", marginTop: 16 },
});
