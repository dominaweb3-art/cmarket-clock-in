import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { connectCandidateWallet } from "./candidate-wallet";
import {
  candidateLanguages,
  candidateTranslations,
  type CandidateLanguage,
} from "./candidate-locales";
// This separate entrypoint NEVER imports App/LocalCyclePanel/backend/local-cycle.
const STORAGE = "c3-mainnet-candidate-language/v1";
const labels = {
  en: "English",
  es: "Español",
  "zh-CN": "简体中文",
  "pt-BR": "Português (Brasil)",
};
export default function MainnetCandidateApp() {
  const [language, setLanguage] = useState<CandidateLanguage>("en");
  const [tab, setTab] = useState<"home" | "indices" | "activity">("home");
  const [wallet, setWallet] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORAGE)
      .then((v) => {
        if (active && candidateLanguages.some((l) => l === v))
          setLanguage(v as CandidateLanguage);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const t = candidateTranslations[language];
  const connect = async () => {
    if (lock.current) return;
    lock.current = true;
    setConnecting(true);
    try {
      setWallet(await connectCandidateWallet());
    } catch {
      Alert.alert(t.wallet, t.walletError);
    } finally {
      lock.current = false;
      setConnecting(false);
    }
  };
  return (
    <SafeAreaView style={s.page}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.title}>{t.title}</Text>
        <Text style={s.notice}>{t.network}</Text>
        <Text style={s.text}>{t.gate}</Text>
        <View style={s.row}>
          {(["home", "indices", "activity"] as const).map((v) => (
            <Pressable
              key={v}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === v }}
              style={s.button}
              onPress={() => setTab(v)}
            >
              <Text style={s.text}>{t[v]}</Text>
            </Pressable>
          ))}
        </View>
        {tab === "home" && (
          <View style={s.card}>
            <Text style={s.text}>{t.language}</Text>
            <View style={s.row}>
              {candidateLanguages.map((l) => (
                <Pressable
                  key={l}
                  accessibilityRole="button"
                  accessibilityState={{ selected: l === language }}
                  style={s.button}
                  onPress={() => {
                    setLanguage(l);
                    void AsyncStorage.setItem(STORAGE, l).catch(
                      () => undefined,
                    );
                  }}
                >
                  <Text style={s.text}>{labels[l]}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.text}>
              {t.wallet}:{" "}
              {wallet
                ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
                : t.notConnected}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: connecting }}
              disabled={connecting}
              style={s.button}
              onPress={() => {
                void connect();
              }}
            >
              <Text style={s.text}>{connecting ? t.loading : t.connect}</Text>
            </Pressable>
          </View>
        )}
        {tab !== "activity" ? (
          <View style={s.card}>
            <Text style={s.text}>{t.target}</Text>
            <Text style={s.text}>{t.assets}</Text>
            <Text style={s.notice}>{t.position}</Text>
            <Text style={s.text}>{t.nav}</Text>
            {[t.buy, t.sell].map((text) => (
              <Pressable
                key={text}
                accessibilityRole="button"
                accessibilityState={{ disabled: true }}
                disabled
                style={s.disabled}
              >
                <Text style={s.text}>{text}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.text}>{t.empty}</Text>
          </View>
        )}
        <Text style={s.notice}>{t.configuration}</Text>
        <Text style={s.text}>{t.risk}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#071c18" },
  scroll: { padding: 24, gap: 18 },
  title: { fontSize: 26, fontWeight: "700", color: "#e2ffee" },
  text: { fontSize: 16, color: "#e2ffee", lineHeight: 24 },
  notice: { fontSize: 16, color: "#ffc96b", lineHeight: 24 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { padding: 18, gap: 16, backgroundColor: "#12342b", borderRadius: 16 },
  button: { padding: 12, borderRadius: 10, backgroundColor: "#225745" },
  disabled: {
    padding: 16,
    borderRadius: 10,
    backgroundColor: "#40514d",
    opacity: 0.6,
  },
});
