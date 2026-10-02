import { useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { MAINNET_MONETARY_CAPABILITY } from "./candidate-config";
import {
  candidateOwnerController,
  reviewedCandidateOwnerConfiguration,
  restoreCandidateOwner,
  readCandidateOwnerPosition,
} from "./candidate-owner";
import type { OwnerController, OwnerReceipt } from "./owner-controller";
import type { MoneyAction } from "./owner-policy";
import {
  candidateTranslations,
  type CandidateLanguage,
} from "./candidate-locales";
import type { OwnerPosition } from "./owner-position";
/** Existing design, no clone launcher. Buttons wire to the real protocol;
 * immutable release gate keeps every monetary action disabled. */
export function OwnerLifecyclePanel({
  wallet,
  language,
  activityOnly = false,
}: {
  wallet: string | null;
  language: CandidateLanguage;
  activityOnly?: boolean;
}) {
  const t = candidateTranslations[language],
    lock = useRef(false),
    controller = useRef<OwnerController | null>(null);
  const [receipt, setReceipt] = useState<OwnerReceipt | null>(null),
    [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<OwnerPosition | null>(null);
  const readPosition = async () => {
    if (lock.current || !wallet) return;
    lock.current = true;
    setBusy(true);
    try {
      setPosition(await readCandidateOwnerPosition(wallet));
    } catch {
      setPosition(null);
      Alert.alert(t.activity, t.position);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const run = async (action: MoneyAction | "approve" | "recover") => {
    if (lock.current || !wallet) return;
    lock.current = true;
    setBusy(true);
    try {
      const config = reviewedCandidateOwnerConfiguration();
      if (!config) throw Error("C3_OWNER_RELEASE_CONFIGURATION_MISSING");
      if (!controller.current) {
        controller.current = candidateOwnerController(wallet);
        await restoreCandidateOwner(controller.current, wallet);
      }
      if (action === "approve") await controller.current.approve();
      else if (action === "recover") await controller.current.recover();
      else await controller.current.prepare(config.intentId, action);
    } catch {
      Alert.alert(t.activity, t.operationError);
    } finally {
      setReceipt(controller.current?.snapshot ?? null);
      lock.current = false;
      setBusy(false);
    }
  };
  const labels = {
    deposit: t.buy,
    issue_shares: t.issue,
    request_redemption: t.sell,
    claim: t.claim,
  };
  const disabled = !MAINNET_MONETARY_CAPABILITY || !wallet || busy;
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: "#ffc96b" }}>{t.ownerWorkflow}</Text>
      {position ? (
        <Text style={{ color: "#e2ffee" }}>
          {t.shares}: {position.shareUnits} {t.baseUnits} · slot {position.slot}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={!wallet || busy}
        accessibilityState={{ disabled: !wallet || busy }}
        onPress={() => {
          void readPosition();
        }}
      >
        <Text style={{ color: "#e2ffee" }}>{t.readPosition}</Text>
      </Pressable>
      <Text style={{ color: "#e2ffee" }}>
        {receipt ? t[receipt.state] : t.noOperation}
      </Text>
      {receipt ? (
        <Text style={{ color: "#e2ffee" }}>
          {labels[receipt.action]} · {receipt.requestId}
          {receipt.signature
            ? ` · ${receipt.signature.slice(0, 8)}…${receipt.signature.slice(-8)}`
            : ""}
        </Text>
      ) : null}
      {(
        ["deposit", "issue_shares", "request_redemption", "claim"] as const
      ).map((a) => (
        <Pressable
          key={a}
          accessibilityRole="button"
          accessibilityState={{ disabled: disabled || activityOnly }}
          disabled={disabled || activityOnly}
          onPress={() => {
            void run(a);
          }}
          style={{
            display: activityOnly ? "none" : "flex",
            padding: 12,
            backgroundColor: "#40514d",
            borderRadius: 10,
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "#e2ffee" }}>{labels[a]}</Text>
        </Pressable>
      ))}
      {!activityOnly && receipt?.state === "review" ? (
        <>
          <Text style={{ color: "#e2ffee" }}>{t.reviewNotice}</Text>
          <Pressable
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            onPress={() => {
              void run("approve");
            }}
          >
            <Text style={{ color: "#e2ffee" }}>{t.approve}</Text>
          </Pressable>
        </>
      ) : null}
      <Pressable
        disabled={disabled || !receipt}
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || !receipt }}
        onPress={() => {
          void run("recover");
        }}
      >
        <Text style={{ color: "#e2ffee" }}>{t.recover}</Text>
      </Pressable>
    </View>
  );
}
