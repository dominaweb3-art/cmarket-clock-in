import { useState } from "react";
import {
  Clipboard,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { languageLabels, languages, type Language } from "./locales";
import { indicesText } from "./evaluation-indices-copy";
import { EvaluationAccordion } from "./EvaluationAccordion";

type Props = {
  visible: boolean;
  language: Language;
  wallet: string | null;
  verified: boolean;
  busy: boolean;
  pending: boolean;
  status: string;
  onClose: () => void;
  onLanguage: (language: Language) => void;
  onConnect: () => void;
  onVerify: () => void;
  onDisconnect: () => void;
  onCheck: () => void;
};
/** No mount effects, provider assumptions, balances, or monetary actions. */
export function EvaluationWalletSheet({
  visible,
  language,
  wallet,
  verified,
  busy,
  pending,
  status,
  onClose,
  onLanguage,
  onConnect,
  onVerify,
  onDisconnect,
  onCheck,
}: Props) {
  const [copyStatus, setCopyStatus] = useState<{
    wallet: string;
    result: "copied" | "copyError";
  } | null>(null);
  const t = (key: Parameters<typeof indicesText>[1]) =>
    indicesText(language, key);
  const copy = () => {
    if (!wallet) return;
    try {
      // Existing pinned React Native native module; no dependency/native change.
      // Only a public wallet address is copied, never a token or transaction.
      Clipboard.setString(wallet);
      setCopyStatus({ wallet, result: "copied" });
    } catch {
      setCopyStatus({ wallet, result: "copyError" });
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("close")}
          onPress={onClose}
          style={s.backdrop}
        />
        <SafeAreaView accessibilityViewIsModal style={s.sheet}>
          <View style={s.heading}>
            <Text accessibilityRole="header" style={s.title}>
              {t("wallet")}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("close")}
              onPress={onClose}
              style={s.close}
            >
              <Text accessible={false} style={s.cross}>
                ×
              </Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.content}>
            <Text style={s.network}>Solana Devnet · TEST</Text>
            {wallet ? (
              <>
                <Text style={s.address}>
                  {wallet.slice(0, 6)}…{wallet.slice(-6)}
                </Text>
                <Text style={s.body}>
                  {t("connected")} · {t(verified ? "verified" : "unverified")}
                </Text>
                {!verified ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    onPress={onVerify}
                    style={s.primary}
                  >
                    <Text style={s.primaryText}>{t("verify")}</Text>
                  </Pressable>
                ) : null}
                <EvaluationAccordion title={t("walletDetails")}>
                  <Text selectable style={s.fullAddress}>
                    {wallet}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={copy}
                    style={s.secondary}
                  >
                    <Text style={s.link}>{t("copy")}</Text>
                  </Pressable>
                  {copyStatus?.wallet === wallet ? (
                    <Text accessibilityLiveRegion="polite" style={s.body}>
                      {t(copyStatus.result)}
                    </Text>
                  ) : null}
                  <Text style={s.body}>{t("disconnectNote")}</Text>
                </EvaluationAccordion>
              </>
            ) : (
              <>
                <Text style={s.body}>{t("walletHint")}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={onConnect}
                  style={s.primary}
                >
                  <Text style={s.primaryText}>{t("connect")}</Text>
                </Pressable>
              </>
            )}
            {pending ? (
              <Text style={s.warning}>{t("recoveryNote")}</Text>
            ) : null}
            <Text accessibilityLiveRegion="polite" style={s.body}>
              {status}
            </Text>
            <EvaluationAccordion
              title={`${t("language")} · ${languageLabels[language]}`}
            >
              {languages.map((value) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityLabel={languageLabels[value]}
                  accessibilityState={{ checked: language === value }}
                  key={value}
                  onPress={() => onLanguage(value)}
                  style={[s.option, value === language && s.selected]}
                >
                  <Text style={s.link}>{languageLabels[value]}</Text>
                  <Text accessible={false}>
                    {value === language ? "●" : "○"}
                  </Text>
                </Pressable>
              ))}
            </EvaluationAccordion>
            {__DEV__ ? (
              <EvaluationAccordion title={t("diagnostics")}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={onCheck}
                  style={s.secondary}
                >
                  <Text style={s.link}>{t("check")}</Text>
                </Pressable>
              </EvaluationAccordion>
            ) : null}
            {wallet ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || pending }}
                disabled={busy || pending}
                onPress={onDisconnect}
                style={s.secondary}
              >
                <Text style={[s.link, (busy || pending) && s.disabled]}>
                  {t("disconnect")}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(7,23,19,0.35)",
  },
  backdrop: { flex: 1 },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "86%",
    paddingBottom: 24,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  title: { flex: 1, fontSize: 23, fontWeight: "700", color: "#0b1221" },
  close: {
    minHeight: 48,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  cross: { color: "#65766b", fontSize: 30 },
  content: { paddingHorizontal: 20, paddingBottom: 16 },
  network: { fontSize: 13, color: "#075c47", marginBottom: 12 },
  address: {
    fontSize: 20,
    fontWeight: "600",
    color: "#163d30",
    marginBottom: 8,
  },
  body: { color: "#52675b", fontSize: 15, lineHeight: 23, marginVertical: 8 },
  fullAddress: { fontSize: 14, lineHeight: 22, color: "#163d30" },
  primary: {
    backgroundColor: "#075c47",
    minHeight: 52,
    padding: 14,
    justifyContent: "center",
    borderRadius: 14,
    marginTop: 8,
  },
  primaryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  secondary: { minHeight: 48, paddingVertical: 12, justifyContent: "center" },
  link: { color: "#075c47", fontSize: 15, lineHeight: 22, fontWeight: "600" },
  option: {
    minHeight: 48,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: 10,
  },
  selected: { backgroundColor: "#eaf7f0" },
  warning: {
    backgroundColor: "#fff4d4",
    borderRadius: 12,
    padding: 12,
    color: "#765311",
    fontSize: 14,
    lineHeight: 22,
    marginTop: 12,
  },
  disabled: { opacity: 0.45 },
});
