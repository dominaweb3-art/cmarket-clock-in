import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { languageLabels, languages, type Language } from "./locales";
import { evalText, type EvaluationKey } from "./evaluation-locales";
import {
  EVALUATION_ENDPOINT,
  evaluationRequest,
  type EvaluationChallenge,
} from "./evaluation-protocol";
import {
  connectEvaluationWallet,
  signEvaluationProof,
} from "./evaluation-wallet";
import { base64FromUint8Array } from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";

const STORAGE = "c3-evaluation-language/v1";
function EvaluationButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
export default function DevnetEvaluationApp() {
  const [language, setLanguage] = useState<Language>("en");
  const [tab, setTab] = useState<"home" | "indices" | "activity">("home");
  const [wallet, setWallet] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [position, setPosition] = useState<Record<string, unknown> | null>(
    null,
  );
  const lock = useRef(false);
  const session = useRef<string | undefined>(undefined);
  const t = (key: EvaluationKey) => evalText(language, key);
  useEffect(() => {
    AsyncStorage.getItem(STORAGE)
      .then((v) => {
        if (languages.includes(v as Language)) setLanguage(v as Language);
      })
      .catch(() => undefined);
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z][A-Z0-9_]{2,90}$/.test(error.message)
          ? error.message
          : "EVAL_OPERATION_CANCELLED";
      setStatus(code);
      Alert.alert(t("status"), `${t("error")}\n${code}`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const connect = () =>
    run(async () => {
      const owner = await connectEvaluationWallet();
      session.current = undefined;
      setVerified(false);
      setPosition(null);
      setWallet(owner);
      setStatus(t("connected"));
    });
  const authenticate = () => {
    if (!wallet || busy) return;
    Alert.alert(t("proofTitle"), t("proof"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("continue"),
        onPress: () => {
          void run(async () => {
            const challenge = (await evaluationRequest({
              operation: "challenge",
              wallet,
            })) as EvaluationChallenge;
            const signature = await signEvaluationProof(challenge, wallet);
            const result = await evaluationRequest({
              operation: "authenticate",
              challengeId: challenge.challengeId,
              message: challenge.message,
              signature: base64FromUint8Array(signature),
            });
            if (
              result.wallet !== wallet ||
              typeof result.sessionToken !== "string" ||
              !/^[a-f0-9]{64}$/.test(result.sessionToken)
            )
              throw Error("EVAL_AUTH_RESPONSE_INVALID");
            session.current = result.sessionToken;
            setVerified(true);
            setStatus(t("authenticated"));
          });
        },
      },
    ]);
  };
  const refresh = () =>
    run(async () => {
      if (!session.current) throw Error("EVAL_SESSION_REQUIRED");
      const result = await evaluationRequest(
        { operation: "position" },
        session.current,
      );
      if (
        result.wallet !== wallet ||
        result.cluster !== "solana:devnet" ||
        result.simulatedAssets !== true ||
        result.monetaryValue !== false
      )
        throw Error("EVAL_POSITION_SCOPE");
      setPosition(result);
    });
  const health = () =>
    run(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(`${EVALUATION_ENDPOINT}/api/health`, {
          signal: controller.signal,
        });
        const result = await response.json();
        if (
          !response.ok ||
          result.mainnetEnabled !== false ||
          result.database !== "SCHEMA_PRESENT" ||
          result.devnet !== "VERIFIED_DEVNET"
        )
          throw Error("EVAL_BACKEND_NOT_READY");
        setStatus(t("healthy"));
      } finally {
        clearTimeout(timer);
      }
    });
  return (
    <SafeAreaView style={styles.page}>
      <StatusBar barStyle="light-content" backgroundColor="#071c18" />
      <View style={styles.banner}>
        <Text style={styles.bannerText}>{t("notice")}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Image
          source={require("../../mobile/assets/images/icon.png")}
          style={styles.logo}
          accessibilityLabel="C Market"
        />
        <Text style={styles.title}>{t("title")}</Text>
        <Text style={styles.note}>{t("mainnet")}</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>{t("language")}</Text>
          <View style={styles.languages}>
            {languages.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: language === value }}
                onPress={() => {
                  setLanguage(value);
                  void AsyncStorage.setItem(STORAGE, value).catch(
                    () => undefined,
                  );
                }}
                style={[styles.chip, value === language && styles.selected]}
              >
                <Text>{languageLabels[value]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.tabs}>
          {(["home", "indices", "activity"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: value === tab }}
              onPress={() => setTab(value)}
              style={styles.chip}
            >
              <Text style={value === tab && styles.activeText}>{t(value)}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.card}>
          {tab === "home" && (
            <>
              <Text style={styles.heading}>{t("home")}</Text>
              {wallet && (
                <Text>
                  {wallet.slice(0, 6)}…{wallet.slice(-6)}
                </Text>
              )}
              <EvaluationButton
                label={t("connect")}
                disabled={busy}
                onPress={() => {
                  void connect();
                }}
              />
              <EvaluationButton
                label={t("authenticate")}
                disabled={busy || !wallet}
                onPress={authenticate}
              />
              <EvaluationButton
                label={t("check")}
                disabled={busy}
                onPress={() => {
                  void health();
                }}
              />
              {verified && (
                <EvaluationButton
                  label={t("refresh")}
                  disabled={busy}
                  onPress={() => {
                    void refresh();
                  }}
                />
              )}
              <Text style={styles.note}>
                {verified ? t("authenticated") : t("noPosition")}
              </Text>
              <Text style={styles.warning}>{t("notReady")}</Text>
              <Text style={styles.note}>{t("restart")}</Text>
            </>
          )}
          {tab === "indices" && (
            <>
              <Text style={styles.heading}>{t("target")}</Text>
              <Text style={styles.note}>{t("assets")}</Text>
              <Text style={styles.heading}>{t("upcoming")}</Text>
            </>
          )}
          {tab === "activity" && (
            <>
              <Text style={styles.heading}>{t("activity")}</Text>
              <Text>{position ? t("noPosition") : t("noActivity")}</Text>
              <EvaluationButton
                label={t("refresh")}
                disabled={busy || !verified}
                onPress={() => {
                  void refresh();
                }}
              />
            </>
          )}
          <Text accessibilityLiveRegion="polite" style={styles.note}>
            {busy ? t("busy") : status}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#eef4f0",
    paddingTop: StatusBar.currentHeight ?? 0,
  },
  banner: { backgroundColor: "#071c18", padding: 12 },
  bannerText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  scroll: { padding: 20, paddingBottom: 40 },
  title: { color: "#071c18", fontSize: 30, fontWeight: "800", marginBottom: 8 },
  logo: { width: 64, height: 64, borderRadius: 14, marginBottom: 12 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    marginTop: 16,
  },
  heading: {
    fontSize: 20,
    fontWeight: "700",
    color: "#071c18",
    marginBottom: 12,
  },
  note: { color: "#40554d", fontSize: 15, lineHeight: 23, marginVertical: 10 },
  warning: {
    color: "#734300",
    fontSize: 15,
    lineHeight: 23,
    backgroundColor: "#fff4d4",
    padding: 12,
    borderRadius: 12,
  },
  button: {
    backgroundColor: "#006d50",
    borderRadius: 14,
    minHeight: 48,
    justifyContent: "center",
    padding: 14,
    marginVertical: 7,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.45 },
  languages: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tabs: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
  },
  chip: {
    padding: 12,
    backgroundColor: "#e6eeea",
    borderRadius: 12,
    minHeight: 44,
  },
  selected: { borderColor: "#006d50", borderWidth: 2 },
  activeText: { color: "#006d50", fontWeight: "800" },
});
