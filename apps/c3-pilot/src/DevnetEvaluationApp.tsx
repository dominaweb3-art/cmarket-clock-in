import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { languages, type Language } from "./locales";
import { evalText, type EvaluationKey } from "./evaluation-locales";
import { evaluationErrorCode } from "./evaluation-errors";
import { waitForEvaluationNetwork } from "./evaluation-transport";
import {
  EVALUATION_ENDPOINT,
  evaluationRequest,
  submitEvaluationProof,
  type EvaluationChallenge,
} from "./evaluation-protocol";
import {
  connectEvaluationWallet,
  signEvaluationProof,
  signEvaluationTransaction,
} from "./evaluation-wallet";
import type { EvaluationMoneyAction } from "./evaluation-owner-review";
import { base64FromUint8Array } from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";
import {
  BottomNavigation,
  C3Summary,
  EmptyActivity,
  NavigationGlyph,
  UpcomingIndices,
} from "./EvaluationVisuals";
import { visualText, type EvaluationTab } from "./evaluation-visual-copy";
import { EvaluationIndices } from "./EvaluationIndices";
import { EvaluationWalletSheet } from "./EvaluationWalletSheet";
import type { IndicesAction } from "./evaluation-indices-state";
import { indicesStatus } from "./evaluation-indices-copy";

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
  const [tab, setTab] = useState<EvaluationTab>("home");
  const [accountOpen, setAccountOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const accountY = useRef(0);
  const scrollToAccount = useRef(false);
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
  const u = (key: Parameters<typeof visualText>[1]) =>
    visualText(language, key);
  const changeTab = (value: EvaluationTab) => {
    setTab(value);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const openAccount = () => {
    if (!wallet || !verified) {
      setWalletOpen(true);
      return;
    }
    scrollToAccount.current = !accountOpen || tab !== "home";
    setAccountOpen(true);
    setTab("home");
    scroll.current?.scrollTo({ y: accountY.current, animated: true });
  };
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
      const code = evaluationErrorCode(error);
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
            let stage = "CHALLENGE_REQUEST";
            try {
              const challenge = (await evaluationRequest({
                operation: "challenge",
                wallet,
              })) as EvaluationChallenge;
              stage = "WALLET_PROOF";
              const signature = await signEvaluationProof(challenge, wallet);
              stage = "SIGNATURE_ENCODING";
              const encodedSignature = base64FromUint8Array(signature);
              stage = "PROOF_SUBMISSION";
              const result = await submitEvaluationProof(
                challenge,
                encodedSignature,
              );
              if (
                result.wallet !== wallet ||
                typeof result.sessionToken !== "string" ||
                !/^[a-f0-9]{64}$/.test(result.sessionToken)
              )
                throw Error("EVAL_AUTH_RESPONSE_INVALID");
              session.current = result.sessionToken;
              setVerified(true);
              setStatus(t("authenticated"));
            } catch (error) {
              throw Error(
                `EVAL_AUTH_${stage}_${evaluationErrorCode(error).replace(/^EVAL_/, "")}`,
              );
            }
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
        // Read-only negative proof: verifies the actual POST transport without
        // requesting another wallet signature or creating a session.
        try {
          await evaluationRequest({
            operation: "authenticate",
            challengeId: "11111111-1111-4111-8111-111111111111",
            message: "invalid diagnostic proof",
            signature:
              "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
          });
          throw Error("EVAL_INVALID_PROOF_ACCEPTED");
        } catch (error) {
          if (evaluationErrorCode(error) !== "EVAL_AUTH_CHALLENGE") throw error;
        }
        setStatus(t("healthy"));
      } finally {
        clearTimeout(timer);
      }
    });
  const updatePosition = async () => {
    if (!session.current) throw Error("EVAL_SESSION_REQUIRED");
    const value = await evaluationRequest(
      { operation: "position" },
      session.current,
    );
    if (
      value.wallet !== wallet ||
      value.cluster !== "solana:devnet" ||
      value.simulatedAssets !== true ||
      value.monetaryValue !== false
    )
      throw Error("EVAL_POSITION_SCOPE");
    setPosition(value);
    return value;
  };
  const prepareWalletAction = (action: EvaluationMoneyAction) => {
    if (!wallet || !verified || busy) return;
    Alert.alert(
      t("transactionTitle"),
      `${t(action)}\n\n${t(action === "renew_plan" ? "renewalNotice" : "transactionNotice")}`,
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("continue"),
          onPress: () => {
            void run(async () => {
              const prepared = await evaluationRequest(
                { operation: "prepare", action },
                session.current,
              );
              const signed = await signEvaluationTransaction(
                prepared,
                wallet,
                action,
              );
              await waitForEvaluationNetwork(
                Date.parse(String(prepared.expiresAt)),
              );
              // No automatic retry. The request already exists durably BEFORE MWA.
              await evaluationRequest(
                {
                  operation: "submit",
                  requestId: prepared.requestId,
                  packet: base64FromUint8Array(signed),
                },
                session.current,
              );
              const result = await evaluationRequest(
                { operation: "reconcile", requestId: prepared.requestId },
                session.current,
              );
              setStatus(
                result.status === "effects_verified" ||
                  result.status === "already_reconciled"
                  ? t("verifiedEffects")
                  : t("uncertain"),
              );
              await updatePosition();
            });
          },
        },
      ],
    );
  };
  const provision = () =>
    run(async () => {
      if (!session.current) throw Error("EVAL_SESSION_REQUIRED");
      // Bounded bootstrap. Each call consults its original durable signature and
      // never resends an uncertain packet. Only evaluation identities are used.
      for (let step = 0; step < 80; step++) {
        const value = await evaluationRequest(
          { operation: "provision" },
          session.current,
        );
        setStatus(String(value.stage ?? ""));
        if (value.ready === true) {
          await updatePosition();
          return;
        }
        if (value.stage === "SETTLEMENT_RELEASE_VERIFICATION_REQUIRED") return;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      setStatus(t("uncertain"));
    });
  const advance = () =>
    run(async () => {
      if (!session.current) throw Error("EVAL_SESSION_REQUIRED");
      for (let step = 0; step < 48; step++) {
        const value = await evaluationRequest(
          { operation: "advance" },
          session.current,
        );
        setStatus(String(value.stage ?? ""));
        await updatePosition();
        if (value.needsOwnerAction) return;
        if (value.stage === "uncertain") {
          setStatus(t("uncertain"));
          return;
        }
        if (value.stage === "failed")
          throw Error("EVAL_FINALIZED_OPERATION_FAILED");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      setStatus(t("uncertain"));
    });
  const recover = () =>
    run(async () => {
      const value = await updatePosition();
      const pending = Array.isArray(value.pendingRequests)
        ? (value.pendingRequests[0] as Record<string, unknown> | undefined)
        : undefined;
      if (!pending && value.pendingInitialPlan) {
        const result = await evaluationRequest(
          { operation: "recover_initial_plan" },
          session.current,
        );
        setStatus(String(result.status ?? ""));
        await updatePosition();
        return;
      }
      if (!pending) return;
      const result = await evaluationRequest(
        {
          operation: pending.signature ? "reconcile" : "close_expired",
          requestId: pending.request_id,
        },
        session.current,
      );
      setStatus(String(result.status ?? ""));
      await updatePosition();
    });
  const displayUnits = (value: unknown) => {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value))
      return "—";
    const n = BigInt(value);
    return `${n / 1_000_000n}.${String(n % 1_000_000n).padStart(6, "0")}`;
  };
  const actions: EvaluationMoneyAction[] = [
    "deposit",
    "issue_shares",
    "request_redemption",
    "claim",
    "renew_plan",
    "recover_deposit_plan",
  ];
  const pending =
    Array.isArray(position?.pendingRequests) &&
    position.pendingRequests.length > 0;
  const unresolved = pending || !!position?.pendingInitialPlan;
  const selectLanguage = (value: Language) => {
    setLanguage(value);
    void AsyncStorage.setItem(STORAGE, value).catch(() => undefined);
  };
  const disconnectApp = () => {
    if (busy || lock.current || unresolved) return;
    // Local UI/session reset only. No MWA revocation, backend deletion or
    // signature cancellation. Original durable history remains recoverable.
    session.current = undefined;
    setVerified(false);
    setPosition(null);
    setWallet(null);
    setStatus("");
    setAccountOpen(false);
  };
  const indexAction = (action: IndicesAction) => {
    if (action === "activity") return changeTab("activity");
    if (action === "wallet") return setWalletOpen(true);
    if (busy || !verified || lock.current) return;
    if (action === "refresh") return void refresh();
    if (action === "provision") return void provision();
    if (unresolved || position?.settlementReleased !== true) return;
    if (action === "advance") return void advance();
    if (
      !Array.isArray(position?.allowedActions) ||
      !position.allowedActions.includes(action)
    )
      return;
    prepareWalletAction(action);
  };
  return (
    <SafeAreaView style={styles.page}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <View style={styles.header}>
        <View style={styles.brand}>
          <Image
            accessible={false}
            source={require("../../mobile/assets/images/splash-icon.png")}
            style={styles.wordmark}
          />
          <Text style={styles.title}>C Market</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={u("account")}
          accessibilityState={{ expanded: walletOpen }}
          onPress={() => setWalletOpen(true)}
          style={styles.walletButton}
        >
          <NavigationGlyph name="wallet" color="#0b1221" />
          {wallet ? <View style={styles.connectionDot} /> : null}
        </Pressable>
      </View>
      <View style={styles.banner}>
        <Text style={styles.demo}>{u("demo")}</Text>
        <Text style={styles.bannerText}>{t("notice")}</Text>
      </View>
      <ScrollView
        ref={scroll}
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
      >
        {tab === "home" && (
          <C3Summary
            language={language}
            onExplore={openAccount}
            disabled={busy}
            onDetails={() => changeTab("indices")}
          />
        )}
        <View
          style={[
            styles.card,
            ((tab === "home" && !accountOpen) || tab === "indices") &&
              styles.hidden,
          ]}
          onLayout={(event) => {
            if (tab === "home" && accountOpen) {
              accountY.current = event.nativeEvent.layout.y;
              if (scrollToAccount.current) {
                scrollToAccount.current = false;
                scroll.current?.scrollTo({
                  y: accountY.current,
                  animated: true,
                });
              }
            }
          }}
        >
          {tab === "home" && accountOpen && (
            <>
              <View style={styles.panelHeader}>
                <Text style={styles.heading}>{u("account")}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={u("back")}
                  onPress={() => {
                    setAccountOpen(false);
                    scroll.current?.scrollTo({ y: 0, animated: true });
                  }}
                  style={styles.close}
                >
                  <Text style={styles.closeText}>×</Text>
                </Pressable>
              </View>
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
              <Text style={styles.note}>{t("restriction")}</Text>
              {verified && (
                <EvaluationButton
                  label={t("provision")}
                  disabled={busy}
                  onPress={() => {
                    void provision();
                  }}
                />
              )}
              {position && (
                <>
                  <View style={styles.position}>
                    <Text style={styles.heading}>{u("position")}</Text>
                    <Text style={styles.metricLabel}>{t("shares")}</Text>
                    <Text style={styles.metric}>
                      {displayUnits(position.shares)}
                    </Text>
                    <Text style={styles.metricLabel}>{t("claimable")}</Text>
                    <Text style={styles.metric}>
                      {displayUnits(position.claimable)}
                    </Text>
                    <Text style={styles.metricLabel}>{t("returned")}</Text>
                    <Text style={styles.metric}>
                      {displayUnits(position.returned)}
                    </Text>
                  </View>
                  <Text style={styles.heading}>{u("controls")}</Text>
                  <Text style={styles.note}>{u("stepHint")}</Text>
                  {actions.map((action) => (
                    <EvaluationButton
                      key={action}
                      label={t(action)}
                      disabled={
                        busy ||
                        !verified ||
                        pending ||
                        position.settlementReleased !== true ||
                        !Array.isArray(position.allowedActions) ||
                        !position.allowedActions.includes(action)
                      }
                      onPress={() => prepareWalletAction(action)}
                    />
                  ))}
                  <EvaluationButton
                    label={t("process")}
                    disabled={
                      busy ||
                      !verified ||
                      pending ||
                      position.settlementReleased !== true
                    }
                    onPress={() => {
                      void advance();
                    }}
                  />
                  <EvaluationButton
                    label={t("recover")}
                    disabled={
                      busy ||
                      !verified ||
                      (!pending && !position.pendingInitialPlan)
                    }
                    onPress={() => {
                      void recover();
                    }}
                  />
                </>
              )}
              {position && position.settlementReleased !== true && (
                <Text style={styles.warning}>{t("notReady")}</Text>
              )}
              <Text style={styles.note}>{t("restart")}</Text>
            </>
          )}
          {tab === "activity" && (
            <>
              <Text style={styles.heading}>{t("activity")}</Text>
              <Text style={styles.note}>{u("verifiedOnly")}</Text>
              {Array.isArray(position?.activity) &&
              position.activity.length > 0 ? (
                position.activity.map((item: Record<string, unknown>) => (
                  <View key={String(item.signature)} style={styles.receipt}>
                    <View style={styles.receiptHeader}>
                      <NavigationGlyph
                        name="activity"
                        color={
                          item.effects_verified === true ? "#075c47" : "#76808d"
                        }
                      />
                      <Text style={styles.receiptTitle}>
                        {typeof item.action === "string" &&
                        actions.includes(item.action as EvaluationMoneyAction)
                          ? t(item.action as EvaluationMoneyAction)
                          : t("process")}
                      </Text>
                    </View>
                    <Text style={styles.receiptStatus}>
                      {item.effects_verified === true
                        ? t("verifiedEffects")
                        : t("uncertain")}
                    </Text>
                    {typeof item.signature === "string" &&
                      /^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(item.signature) && (
                        <Pressable
                          accessibilityRole="link"
                          accessibilityLabel={`Solana Explorer Devnet: ${item.signature}`}
                          style={styles.explorerLink}
                          onPress={() => {
                            void Linking.openURL(
                              `https://explorer.solana.com/tx/${item.signature}?cluster=devnet`,
                            );
                          }}
                        >
                          <Text style={styles.activeText}>
                            {item.signature.slice(0, 10)}…
                            {item.signature.slice(-8)}
                          </Text>
                        </Pressable>
                      )}
                  </View>
                ))
              ) : (
                <EmptyActivity language={language} />
              )}
              {!verified && (
                <EvaluationButton
                  label={u("account")}
                  onPress={() => setWalletOpen(true)}
                  disabled={busy}
                />
              )}
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
        <View style={tab !== "indices" && styles.hidden}>
          <EvaluationIndices
            language={language}
            wallet={wallet}
            verified={verified}
            busy={busy}
            position={position}
            status={indicesStatus(language, status)}
            displayUnits={displayUnits}
            onAction={indexAction}
            onRecover={() => {
              void recover();
            }}
          />
        </View>
        {tab === "home" && <UpcomingIndices language={language} />}
        <Text style={styles.footer}>{t("mainnet")}</Text>
      </ScrollView>
      <BottomNavigation language={language} tab={tab} onChange={changeTab} />
      <EvaluationWalletSheet
        visible={walletOpen}
        language={language}
        wallet={wallet}
        verified={verified}
        busy={busy}
        pending={unresolved}
        status={busy ? t("busy") : indicesStatus(language, status)}
        onClose={() => setWalletOpen(false)}
        onLanguage={selectLanguage}
        onConnect={() => {
          setWalletOpen(false);
          void connect();
        }}
        onVerify={() => {
          setWalletOpen(false);
          authenticate();
        }}
        onDisconnect={disconnectApp}
        onCheck={() => {
          void health();
        }}
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#fff",
    paddingTop: StatusBar.currentHeight ?? 0,
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 10,
  },
  brand: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  wordmark: { width: 40, height: 40, resizeMode: "contain" },
  walletButton: {
    backgroundColor: "#f3f5f7",
    borderRadius: 16,
    padding: 12,
    minHeight: 48,
    minWidth: 48,
  },
  connectionDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#008564",
    position: "absolute",
    right: 8,
    top: 8,
  },
  banner: {
    backgroundColor: "#eaf7f1",
    borderRadius: 16,
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 8,
  },
  demo: { fontSize: 16, fontWeight: "700", color: "#124b3d", marginBottom: 3 },
  bannerText: { color: "#526c61", fontSize: 12, lineHeight: 17 },
  scrollView: { flex: 1 },
  scroll: { padding: 20, paddingTop: 12, paddingBottom: 24 },
  title: { flex: 1, color: "#0b1221", fontSize: 30, fontWeight: "800" },
  hidden: { display: "none" },
  card: {
    backgroundColor: "#fbfefd",
    borderWidth: 1,
    borderColor: "#e2ede8",
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
  chip: {
    padding: 12,
    backgroundColor: "#e6eeea",
    borderRadius: 12,
    minHeight: 44,
  },
  selected: { borderColor: "#006d50", borderWidth: 2 },
  activeText: { color: "#006d50", fontWeight: "800" },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  close: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  closeText: { color: "#657080", fontSize: 30 },
  walletAddress: {
    fontSize: 15,
    color: "#075c47",
    fontWeight: "600",
    marginBottom: 8,
  },
  position: {
    backgroundColor: "#eaf7f1",
    borderRadius: 16,
    padding: 16,
    marginVertical: 16,
  },
  metricLabel: { color: "#526c61", fontSize: 13, marginTop: 12 },
  metric: { color: "#12372d", fontSize: 22, fontWeight: "700", marginTop: 4 },
  receipt: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderColor: "#e2ede8",
    gap: 8,
  },
  receiptHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  receiptTitle: { flex: 1, fontSize: 16, fontWeight: "600", color: "#0b1221" },
  receiptStatus: { color: "#526c61", fontSize: 13, lineHeight: 19 },
  explorerLink: { minHeight: 44, justifyContent: "center" },
  languageText: { color: "#263f35" },
  footer: {
    fontSize: 12,
    color: "#66746f",
    marginTop: 20,
    textAlign: "center",
    lineHeight: 18,
  },
});
