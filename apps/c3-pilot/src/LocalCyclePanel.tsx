import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import {
  readLocalCycle,
  startLocalCycle,
  type LocalCycle,
} from "./local-cycle";
import { translate, type Language } from "./locales";
export function LocalCyclePanel({
  endpoint,
  language,
}: {
  endpoint: string;
  language: Language;
}) {
  const [run, setRun] = useState<LocalCycle | null>(null),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      const request = new AbortController();
      const abort = () => request.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      const deadline = setTimeout(abort, 8000);
      try {
        const value = await readLocalCycle(endpoint, request.signal);
        if (active) setRun(value);
      } catch {
        if (active) setRun(null);
      } finally {
        clearTimeout(deadline);
        controller.signal.removeEventListener("abort", abort);
        if (active)
          timer = setTimeout(() => {
            void poll();
          }, 2000);
      }
    };
    void poll();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [endpoint]);
  const start = async () => {
    if (!run || lock.current || run.state !== "ready") return;
    lock.current = true;
    setBusy(true);
    const request = new AbortController(),
      deadline = setTimeout(() => request.abort(), 8000);
    try {
      await startLocalCycle(endpoint, run, request.signal);
      setRun({ ...run, state: "running" });
    } catch {
      setRun(null);
    } finally {
      clearTimeout(deadline);
      setBusy(false);
      lock.current = false;
    }
  };
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("cloneTitle")}</Text>
      <Text style={styles.text}>{t("cloneNotice")}</Text>
      {!run ? (
        <Text style={styles.text}>{t("cloneUnavailable")}</Text>
      ) : (
        <>
          <Text style={styles.text}>
            {t("localState")}: {run.state} · {run.stage}
          </Text>
          <Text style={styles.text}>
            {t("cloneLegs")}: {run.confirmedLegs}/6
          </Text>
          <Text style={styles.text}>
            {t("cloneShares")}: {run.sharesIssued} / {run.sharesBurned}
          </Text>
          <Text style={styles.text}>
            {t("cloneReturned")}: {run.usdcReturned} (base units)
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || run.state !== "ready" }}
            disabled={busy || run.state !== "ready"}
            onPress={() => {
              void start();
            }}
            style={styles.button}
          >
            <Text style={styles.title}>
              {busy ? t("loading") : t("cloneStart")}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    padding: 17,
    gap: 10,
    backgroundColor: "#283326",
    borderColor: "#d5b471",
    borderWidth: 1,
    borderRadius: 18,
  },
  title: { color: "#ffdf9c", fontWeight: "700", fontSize: 17 },
  text: { color: "#e0d6ba", lineHeight: 22 },
  button: {
    padding: 12,
    borderColor: "#d5b471",
    borderWidth: 1,
    borderRadius: 10,
  },
});
