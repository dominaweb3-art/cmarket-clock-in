import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { connectReadOnlyWallet } from "./wallet";
import { loadStatus, READ_ONLY_BACKEND, type PilotStatus } from "./backend";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  C3_MAINNET_EXECUTION_ENABLED,
  C3_PILOT_EXECUTION_ENABLED,
  PILOT_CONFIG,
} from "./config";
import {
  languageLabels,
  languages,
  translate,
  type Language,
  type TranslationKey,
} from "./locales";

const STORAGE_KEY = "c3-pilot-language/v1";

export default function App() {
  const [language, setLanguage] = useState<Language>("en");
  const [tab, setTab] = useState<"home" | "indices" | "activity">("home");
  const [wallet, setWallet] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState<PilotStatus | null>(null);
  const [backendState, setBackendState] = useState<
    "backendMissing" | "loading" | "backendError" | "backendReady"
  >("backendMissing");
  const walletLock = useRef(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!wallet || !READ_ONLY_BACKEND) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    loadStatus(READ_ONLY_BACKEND, wallet, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setStatus(value);
          setBackendState("backendReady");
        }
      })
      .catch(() => {
        setBackendState("backendError");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [wallet, refresh]);
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (languages.some((item) => item === value))
          setLanguage(value as Language);
      })
      .catch(() => undefined);
  }, []);
  const t = (key: TranslationKey) => translate(language, key);
  const select = (next: Language) => {
    setLanguage(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  };
  const connect = async () => {
    if (walletLock.current) return;
    walletLock.current = true;
    setConnecting(true);
    try {
      setWallet(await connectReadOnlyWallet());
    } catch {
      Alert.alert(t("wallet"), t("walletError"));
    } finally {
      walletLock.current = false;
      setConnecting(false);
    }
  };
  // The whole pilot intentionally fails closed. A configured endpoint alone cannot enable a trade.
  const canTrade =
    C3_PILOT_EXECUTION_ENABLED &&
    C3_MAINNET_EXECUTION_ENABLED &&
    PILOT_CONFIG !== null;
  return (
    <SafeAreaView style={styles.page}>
      <StatusBar barStyle="light-content" backgroundColor="#071c18" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{t("title")}</Text>
        <Text style={styles.badge}>{t("controlled")}</Text>
        <Text style={styles.notice}>
          {t("network")} · {t("mainnet")}
        </Text>
        <View style={styles.languages}>
          {(["home", "indices", "activity"] as const).map((item) => (
            <Pressable
              key={item}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === item }}
              onPress={() => setTab(item)}
              style={[styles.language, tab === item && styles.selected]}
            >
              <Text style={styles.languageText}>{t(item)}</Text>
            </Pressable>
          ))}
        </View>
        {tab === "home" && (
          <>
            <View style={styles.card}>
              <Text style={styles.heading}>{t("language")}</Text>
              <View style={styles.languages}>
                {languages.map((item) => (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityState={{ selected: language === item }}
                    onPress={() => select(item)}
                    style={[
                      styles.language,
                      language === item && styles.selected,
                    ]}
                  >
                    <Text style={styles.languageText}>
                      {languageLabels[item]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>{t("wallet")}</Text>
              <Text style={styles.muted}>
                {wallet
                  ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
                  : t("noWallet")}
              </Text>
              <Pressable
                accessibilityRole="button"
                style={styles.secondary}
                accessibilityState={{ disabled: connecting }}
                disabled={connecting}
                onPress={() => {
                  void connect();
                }}
              >
                <Text style={styles.secondaryText}>
                  {connecting ? t("loading") : t("connect")}
                </Text>
              </Pressable>
            </View>
          </>
        )}
        {(tab === "home" || tab === "indices") && (
          <>
            <View style={styles.card}>
              <Text style={styles.heading}>{t("target")}</Text>
              <Text style={styles.alloc}>
                {t("bitcoin")} · {t("ethereum")} · {t("solana")}
              </Text>
              <Text style={styles.muted}>{t("targetNote")}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>{t("state")}</Text>
              <Text style={styles.muted}>{t("noPosition")}</Text>
              <View style={styles.dataRow}>
                <Text style={styles.muted}>{t("shares")}</Text>
                <Text style={styles.muted}>{t("unknown")}</Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.muted}>{t("nav")}</Text>
                <Text style={styles.muted}>{t("unknown")}</Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.muted}>{t("current")}</Text>
                <Text style={styles.muted}>{t("unknown")}</Text>
              </View>
            </View>
          </>
        )}
        {tab === "activity" && (
          <>
            <View style={styles.card}>
              <Text style={styles.heading}>{t("progress")}</Text>
              <Text style={styles.muted}>{t("progressEmpty")}</Text>
              <Text style={styles.heading}>{t("activity")}</Text>
              <Text style={styles.muted}>{t("activityEmpty")}</Text>
              <Text style={styles.notice}>{t(backendState)}</Text>
              <Text style={styles.notice}>{t("simulationNotice")}</Text>
              {status?.intents.map((intent) => (
                <View key={intent.id} style={styles.card}>
                  <Text style={styles.muted}>
                    {t("localIntent")} {intent.id.slice(0, 8)}
                  </Text>
                  <Text style={styles.muted}>
                    {t("localState")}: {intent.state} · {intent.confirmedLegs}/6
                  </Text>
                </View>
              ))}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setStatus(null);
                  setBackendState(
                    wallet && READ_ONLY_BACKEND ? "loading" : "backendMissing",
                  );
                  setRefresh((value) => value + 1);
                }}
                style={styles.secondary}
              >
                <Text style={styles.secondaryText}>{t("refresh")}</Text>
              </Pressable>
            </View>
          </>
        )}
        {tab !== "activity" && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canTrade }}
              disabled={!canTrade}
              style={styles.disabledButton}
            >
              <Text style={styles.buttonText}>{t("purchase")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canTrade }}
              disabled={!canTrade}
              style={styles.disabledButton}
            >
              <Text style={styles.buttonText}>{t("sell")}</Text>
            </Pressable>
            <Text style={styles.notice}>
              {PILOT_CONFIG ? t("disabled") : t("unavailable")}
            </Text>
            <View style={styles.card}>
              <Text style={styles.heading}>{t("costs")}</Text>
              <Text style={styles.muted}>{t("costsText")}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#071c18" },
  scroll: { padding: 20, paddingBottom: 40, gap: 14 },
  title: { color: "#e9fff1", fontSize: 30, fontWeight: "800", marginTop: 12 },
  badge: { color: "#ffdf9c", fontWeight: "700", fontSize: 14 },
  notice: { color: "#b4c8bd", lineHeight: 21 },
  card: {
    backgroundColor: "#102c25",
    borderColor: "#2f6650",
    borderWidth: 1,
    borderRadius: 18,
    padding: 17,
    gap: 10,
  },
  heading: { color: "#f1fff3", fontSize: 18, fontWeight: "700" },
  muted: { color: "#bbd0c4", lineHeight: 22 },
  alloc: { color: "#7df2a3", fontWeight: "700", lineHeight: 24 },
  languages: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  language: {
    borderWidth: 1,
    borderColor: "#47826a",
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
  },
  selected: { backgroundColor: "#1b7950" },
  languageText: { color: "#f1fff3" },
  secondary: {
    borderRadius: 12,
    padding: 13,
    borderWidth: 1,
    borderColor: "#7df2a3",
    alignSelf: "flex-start",
  },
  secondaryText: { color: "#7df2a3", fontWeight: "700" },
  dataRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  disabledButton: {
    backgroundColor: "#47645a",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    opacity: 0.55,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
