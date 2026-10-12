import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Image,
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
import { BottomNavigation, NavigationGlyph } from "./EvaluationVisuals";
import { visualText, type EvaluationTab } from "./evaluation-visual-copy";
import { EvaluationIndices } from "./EvaluationIndices";
import { EvaluationWalletSheet } from "./EvaluationWalletSheet";
import type { IndicesAction } from "./evaluation-indices-state";
import { indicesStatus } from "./evaluation-indices-copy";
import { EvaluationHome } from "./EvaluationHome";
import { homeText } from "./evaluation-home-copy";
import { EvaluationActivity } from "./EvaluationActivity";
import { EvaluationBalances } from "./EvaluationBalances";
import { purchaseUnits, purchaseCopy } from "./evaluation-purchase";

const STORAGE = "c3-evaluation-language/v1";
export default function DevnetEvaluationApp() {
  const [language, setLanguage] = useState<Language>("en");
  const [tab, setTab] = useState<EvaluationTab>("home");
  const [walletOpen, setWalletOpen] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const catalogY = useRef(0);
  const catalogRequested = useRef(false);
  const [wallet, setWallet] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("1");
  const [position, setPosition] = useState<Record<string, unknown> | null>(
    null,
  );
  const lock = useRef(false);
  const session = useRef<string | undefined>(undefined);
  const t = (key: EvaluationKey) => evalText(language, key);
  const u = (key: Parameters<typeof visualText>[1]) =>
    visualText(language, key);
  const changeTab = (value: EvaluationTab) => {
    if (value !== "indices") catalogRequested.current = false;
    setTab(value);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const scrollToCatalog = (y: number) => {
    catalogY.current = y;
    if (!catalogRequested.current || y <= 0) return;
    catalogRequested.current = false;
    scroll.current?.scrollTo({ y, animated: true });
  };
  const openUpcoming = () => {
    catalogRequested.current = true;
    changeTab("indices");
    // User-requested navigation only, never a reaction to arriving position data.
    requestAnimationFrame(() => scrollToCatalog(catalogY.current));
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
      if (code === "EVAL_AUTH_SESSION" || code === "EVAL_SESSION_REQUIRED") {
        // A stale HTTPS session must never masquerade as verified ownership.
        // Preserve the position and every signature; request a fresh message.
        session.current = undefined;
        setVerified(false);
        setWalletOpen(true);
      }
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
              try {
                await updatePosition();
              } catch {
                /* Fresh wallets provision explicitly. */
              }
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
  useEffect(() => {
    if (!wallet || !verified || !position) return;
    let active = true;
    const timer = setInterval(() => {
      if (
        !session.current ||
        lock.current ||
        AppState.currentState !== "active"
      )
        return;
      const owner = wallet;
      void evaluationRequest({ operation: "position" }, session.current)
        .then((value) => {
          if (
            active &&
            !lock.current &&
            value.wallet === owner &&
            value.cluster === "solana:devnet" &&
            value.simulatedAssets === true &&
            value.monetaryValue === false
          )
            setPosition((previous) =>
              previous === position ? value : previous,
            );
        })
        .catch(() => undefined);
    }, 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [wallet, verified, position]);
  const prepareWalletAction = (action: EvaluationMoneyAction) => {
    if (!wallet || !verified || busy) return;
    let amount: bigint, round: bigint;
    try {
      amount =
        action === "deposit"
          ? purchaseUnits(purchaseAmount)
          : BigInt(String(position?.deposited ?? "1000000"));
      round = BigInt(String(position?.round ?? "1"));
    } catch {
      Alert.alert(t("status"), purchaseCopy[language].invalid);
      return;
    }
    Alert.alert(
      t("transactionTitle"),
      `${t(action)}${action === "deposit" ? " · " + displayUnits(amount.toString()) + " USDC · Devnet" : ""}\n\n${t(action === "renew_plan" ? "renewalNotice" : "transactionNotice")}`,
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("continue"),
          onPress: () => {
            void run(async () => {
              const prepared = await evaluationRequest(
                {
                  operation: "prepare",
                  action,
                  ...(action === "deposit"
                    ? { amount: amount.toString() }
                    : {}),
                },
                session.current,
              );
              const signed = await signEvaluationTransaction(
                prepared,
                wallet,
                action,
                { amount, round },
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
  const provision = (newPurchase = false) =>
    run(async () => {
      if (!session.current) throw Error("EVAL_SESSION_REQUIRED");
      // Bounded bootstrap. Each call consults its original durable signature and
      // never resends an uncertain packet. Only evaluation identities are used.
      for (let step = 0; step < 80; step++) {
        const value = await evaluationRequest(
          {
            operation: newPurchase && step === 0 ? "new_purchase" : "provision",
          },
          session.current,
        );
        setStatus(String(value.stage ?? ""));
        if (value.ready === true) {
          await updatePosition();
          if (newPurchase) {
            session.current = undefined;
            setVerified(false);
            setStatus(purchaseCopy[language].reverify);
            setWalletOpen(true);
          }
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
  };
  const indexAction = (action: IndicesAction) => {
    if (action === "activity") return changeTab("activity");
    if (action === "wallet") return setWalletOpen(true);
    if (busy || !verified || lock.current) return;
    if (action === "refresh") return void refresh();
    if (action === "provision") return void provision();
    if (action === "new_purchase") return void provision(true);
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
      <View style={[styles.header, tab === "home" && styles.homeHeader]}>
        <View style={styles.brand}>
          <Image
            accessible={false}
            source={require("../../mobile/assets/images/splash-icon.png")}
            style={[styles.wordmark, tab === "home" && styles.homeWordmark]}
          />
          <Text style={[styles.title, tab === "home" && styles.homeTitle]}>
            C Market
          </Text>
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
      <View style={tab === "home" ? styles.homeBanner : styles.banner}>
        {tab === "home" ? (
          <Text style={styles.homeDemo}>{homeText(language, "demoStrip")}</Text>
        ) : (
          <>
            <Text style={styles.demo}>{u("demo")}</Text>
            <Text style={styles.bannerText}>{t("notice")}</Text>
          </>
        )}
      </View>
      <ScrollView
        ref={scroll}
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
      >
        {tab === "indices" ? (
          <EvaluationBalances
            wallet={wallet}
            language={language}
            revision={position}
          />
        ) : null}
        <View style={tab === "home" ? undefined : styles.hidden}>
          <EvaluationHome
            language={language}
            wallet={wallet}
            verified={verified}
            busy={busy}
            position={position}
            status={status}
            onExplore={() => changeTab("indices")}
            onUpcoming={openUpcoming}
          />
        </View>
        <View style={tab !== "activity" && styles.hidden}>
          <EvaluationActivity
            language={language}
            wallet={wallet}
            verified={verified}
            busy={busy}
            position={position}
            status={status}
            displayUnits={displayUnits}
            onWallet={() => setWalletOpen(true)}
            onIndices={() => changeTab("indices")}
            onRefresh={() => {
              void refresh();
            }}
            onRecover={() => {
              void recover();
            }}
          />
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
            purchaseAmount={purchaseAmount}
            onPurchaseAmount={setPurchaseAmount}
            onAction={indexAction}
            onRecover={() => {
              void recover();
            }}
            onCatalogLayout={scrollToCatalog}
          />
        </View>
        {tab !== "home" ? (
          <Text style={styles.footer}>{t("mainnet")}</Text>
        ) : null}
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
        balanceRevision={position}
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
  homeHeader: { paddingVertical: 6 },
  homeWordmark: { width: 32, height: 32 },
  homeTitle: { fontSize: 26 },
  homeBanner: {
    backgroundColor: "#eaf7f1",
    marginHorizontal: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    marginBottom: 8,
  },
  homeDemo: {
    color: "#124b3d",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },
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
