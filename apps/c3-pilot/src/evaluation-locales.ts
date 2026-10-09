import type { Language } from "./locales";
const en = {
  title: "C Market · C3",
  notice:
    "Devnet evaluation · test tokens and liquidity with no monetary value",
  provision: "Receive test tokens / prepare my vault",
  deposit: "Deposit exactly 1 test USDC",
  issue_shares: "Issue on-chain evaluation shares",
  request_redemption: "Sell my evaluation shares",
  claim: "Burn shares and claim realized test USDC",
  renew_plan: "Approve renewal of expired settlement plan",
  renewalNotice:
    "This Devnet signature extends the expired plan by at most 110 seconds and increments its revision. It does not move tokens, lower minimum outputs or reset completed swaps. Previous signatures and inventory remain recorded.",
  process: "Process / reconcile authorized test swaps",
  recover: "Recover original request (never resend)",
  transactionTitle: "Review a Devnet transaction",
  transactionNotice:
    "Test tokens only. One position per wallet vault for its lifetime. A deposit transfers exactly 1 test USDC to your vault. Share issuance and redemption require separate approvals. The claim burns your shares and returns only the test USDC actually settled. Free Devnet SOL pays network fees. This is not a real C3 investment.",
  shares: "On-chain evaluation shares",
  claimable: "Realized test USDC available to claim",
  returned: "Test USDC already returned",
  verifiedEffects: "Finalized effects verified",
  uncertain: "Not yet confirmed · reconcile the original signature",
  restriction:
    "One wallet-specific vault · one 1 test USDC deposit per lifetime",
  connect: "Connect Phantom / wallet",
  authenticate: "Verify wallet ownership",
  proofTitle: "Sign an authentication message",
  proof:
    "Solana Devnet. Phantom will show a C Market wallet-ownership message. It does not authorize spending, transfer tokens or create a transaction. Cancel if the wallet shows a payment.",
  continue: "Continue",
  cancel: "Cancel",
  connected: "Connected; ownership not yet verified",
  authenticated: "Ownership verified by the hosted service",
  home: "Home",
  indices: "Indices",
  activity: "Activity",
  refresh: "Refresh from Devnet",
  language: "Language",
  target: "Simulated C3 target: 40% / 30% / 30%",
  assets:
    "Three evaluation tokens. NOT real Bitcoin, Ethereum or SOL holdings. NOT Jupiter Devnet liquidity.",
  upcoming: "C5 / C10 / C20 / C50 · Coming soon",
  notReady:
    "Vault provisioning and hosted settlement are not ready. No deposit or C3 position is claimed.",
  noActivity: "No verified on-chain activity available.",
  noPosition: "No reconciled share position available.",
  restart:
    "After restart, reconnect and verify ownership. The server preserves signatures and history; uncertain operations are never automatically resent.",
  error:
    "Operation cancelled, unavailable or blocked. No success is claimed. If signing started, recover the original request before continuing.",
  mainnet: "Mainnet and real-fund execution are disabled.",
  busy: "Please wait…",
  check: "Check hosted backend",
  healthy: "Hosted database and Solana Devnet reachable",
  status: "Status",
} as const;
type Dictionary = Record<keyof typeof en, string>;
const es: Dictionary = {
  title: "C Market · C3",
  notice: "Evaluación Devnet · tokens y liquidez de prueba sin valor monetario",
  provision: "Recibir tokens de prueba / preparar mi bóveda",
  deposit: "Depositar exactamente 1 USDC de prueba",
  issue_shares: "Emitir participaciones de evaluación on-chain",
  request_redemption: "Vender mis participaciones de evaluación",
  claim: "Quemar participaciones y reclamar USDC de prueba liquidado",
  renew_plan: "Autorizar renovación del plan de liquidación vencido",
  renewalNotice:
    "Esta firma Devnet extiende el plan vencido hasta 110 segundos y aumenta su revisión. No mueve tokens, reduce mínimos ni reinicia swaps completados. Se conservan inventario y firmas anteriores.",
  process: "Procesar / conciliar swaps de prueba autorizados",
  recover: "Recuperar solicitud original (sin reenviarla)",
  transactionTitle: "Revisar una transacción Devnet",
  transactionNotice:
    "Solo tokens de prueba. Una posición por vida de tu bóveda. El depósito transfiere exactamente 1 USDC de prueba a tu bóveda. La emisión y la venta requieren aprobaciones separadas. El reclamo quema tus participaciones y devuelve únicamente el USDC de prueba efectivamente liquidado. SOL Devnet gratuito paga las comisiones de red. No es una inversión C3 real.",
  shares: "Participaciones de evaluación on-chain",
  claimable: "USDC de prueba liquidado disponible para reclamar",
  returned: "USDC de prueba ya devuelto",
  verifiedEffects: "Efectos finalizados verificados",
  uncertain: "Todavía no confirmado · conciliar la firma original",
  restriction:
    "Bóveda propia por wallet · un depósito de 1 USDC de prueba por vida",
  connect: "Conectar Phantom / wallet",
  authenticate: "Verificar propiedad de wallet",
  proofTitle: "Firmar un mensaje de autenticación",
  proof:
    "Solana Devnet. Phantom mostrará un mensaje de propiedad de wallet de C Market. No autoriza gastos, transfiere tokens ni crea una transacción. Cancela si la wallet muestra un pago.",
  continue: "Continuar",
  cancel: "Cancelar",
  connected: "Conectada; propiedad todavía no verificada",
  authenticated: "Propiedad verificada por el servicio alojado",
  home: "Inicio",
  indices: "Índices",
  activity: "Actividad",
  refresh: "Actualizar desde Devnet",
  language: "Idioma",
  target: "Objetivo C3 simulado: 40% / 30% / 30%",
  assets:
    "Tres tokens de evaluación. NO representan Bitcoin, Ethereum ni SOL reales. NO es liquidez Jupiter Devnet.",
  upcoming: "C5 / C10 / C20 / C50 · Próximamente",
  notReady:
    "La creación de bóvedas y la liquidación alojada no están listas. No se acredita depósito ni posición C3.",
  noActivity: "No hay actividad on-chain verificada disponible.",
  noPosition: "No hay participaciones conciliadas disponibles.",
  restart:
    "Tras reiniciar, reconecta y verifica propiedad. El servidor conserva firmas e historial; nunca reenvía automáticamente operaciones inciertas.",
  error:
    "Operación cancelada, no disponible o bloqueada. No se acredita éxito. Si comenzó la firma, recupera la solicitud original antes de continuar.",
  mainnet: "Mainnet y las operaciones con fondos reales están deshabilitados.",
  busy: "Espera…",
  check: "Comprobar backend alojado",
  healthy: "Base de datos alojada y Solana Devnet accesibles",
  status: "Estado",
};
const zh: Dictionary = {
  title: "C Market · C3",
  notice: "Devnet 评估 · 测试代币和流动性无货币价值",
  provision: "领取测试代币 / 准备我的金库",
  deposit: "存入恰好 1 测试 USDC",
  issue_shares: "发行链上评估份额",
  request_redemption: "出售我的评估份额",
  claim: "销毁份额并领取实际结算的测试 USDC",
  renew_plan: "批准续期已过期的结算计划",
  renewalNotice:
    "此 Devnet 签名将已过期计划续期最多 110 秒并增加版本。它不会转移代币、降低最低输出或重置已完成兑换。保留原有签名及资产记录。",
  process: "处理 / 核对已授权的测试兑换",
  recover: "恢复原始请求（绝不重发）",
  transactionTitle: "审核 Devnet 交易",
  transactionNotice:
    "仅使用测试代币。每个钱包金库终身仅限一个仓位。存款向您的金库转移恰好 1 测试 USDC。发行份额和赎回需要单独批准。领取会销毁份额，仅返还实际结算的测试 USDC。免费 Devnet SOL 支付网络费用。这不是真实的 C3 投资。",
  shares: "链上评估份额",
  claimable: "可领取的已结算测试 USDC",
  returned: "已返还的测试 USDC",
  verifiedEffects: "已验证最终交易效果",
  uncertain: "尚未确认 · 核对原始签名",
  restriction: "每钱包独立金库 · 终身一次 1 测试 USDC 存款",
  connect: "连接 Phantom / 钱包",
  authenticate: "验证钱包所有权",
  proofTitle: "签署身份验证消息",
  proof:
    "Solana Devnet。Phantom 将显示 C Market 钱包所有权消息。此消息不授权支出、不转移代币、不创建交易。如果钱包显示付款，请取消。",
  continue: "继续",
  cancel: "取消",
  connected: "已连接；尚未验证所有权",
  authenticated: "托管服务已验证所有权",
  home: "首页",
  indices: "指数",
  activity: "活动",
  refresh: "从 Devnet 刷新",
  language: "语言",
  target: "模拟 C3 目标：40% / 30% / 30%",
  assets:
    "三种评估代币。不是实际 Bitcoin、Ethereum 或 SOL 持仓。不是 Jupiter Devnet 流动性。",
  upcoming: "C5 / C10 / C20 / C50 · 即将推出",
  notReady: "金库创建和托管结算尚未就绪。未确认任何存款或 C3 仓位。",
  noActivity: "暂无已验证的链上活动。",
  noPosition: "暂无已核对的份额仓位。",
  restart:
    "重启后重新连接并验证所有权。服务器保留签名和历史记录；不确定的操作绝不会自动重发。",
  error:
    "操作已取消、不可用或被阻止。未确认成功。如果已开始签名，请先恢复原始请求。",
  mainnet: "Mainnet 和真实资金操作已禁用。",
  busy: "请稍候…",
  check: "检查托管后端",
  healthy: "托管数据库和 Solana Devnet 可访问",
  status: "状态",
};
const pt: Dictionary = {
  title: "C Market · C3",
  notice: "Avaliação Devnet · tokens e liquidez de teste sem valor monetário",
  provision: "Receber tokens de teste / preparar meu cofre",
  deposit: "Depositar exatamente 1 USDC de teste",
  issue_shares: "Emitir cotas de avaliação on-chain",
  request_redemption: "Vender minhas cotas de avaliação",
  claim: "Queimar cotas e resgatar USDC de teste liquidado",
  renew_plan: "Autorizar renovação do plano de liquidação expirado",
  renewalNotice:
    "Esta assinatura Devnet estende o plano expirado em até 110 segundos e incrementa sua revisão. Não move tokens, reduz mínimos nem reinicia swaps concluídos. Inventário e assinaturas anteriores são preservados.",
  process: "Processar / reconciliar swaps de teste autorizados",
  recover: "Recuperar solicitação original (sem reenviar)",
  transactionTitle: "Revisar uma transação Devnet",
  transactionNotice:
    "Somente tokens de teste. Uma posição por vida de cada cofre. O depósito transfere exatamente 1 USDC de teste ao seu cofre. A emissão e a venda exigem aprovações separadas. O resgate queima suas cotas e devolve apenas o USDC de teste realmente liquidado. SOL Devnet gratuito paga as taxas de rede. Não é um investimento C3 real.",
  shares: "Cotas de avaliação on-chain",
  claimable: "USDC de teste liquidado disponível para resgate",
  returned: "USDC de teste já devolvido",
  verifiedEffects: "Efeitos finalizados verificados",
  uncertain: "Ainda não confirmado · reconciliar a assinatura original",
  restriction: "Cofre por carteira · um depósito de 1 USDC de teste por vida",
  connect: "Conectar Phantom / carteira",
  authenticate: "Verificar propriedade da carteira",
  proofTitle: "Assinar uma mensagem de autenticação",
  proof:
    "Solana Devnet. Phantom mostrará uma mensagem de propriedade da carteira C Market. Não autoriza gastos, transfere tokens nem cria uma transação. Cancele se a carteira mostrar um pagamento.",
  continue: "Continuar",
  cancel: "Cancelar",
  connected: "Conectada; propriedade ainda não verificada",
  authenticated: "Propriedade verificada pelo serviço hospedado",
  home: "Início",
  indices: "Índices",
  activity: "Atividade",
  refresh: "Atualizar do Devnet",
  language: "Idioma",
  target: "Alocação alvo C3 simulada: 40% / 30% / 30%",
  assets:
    "Três tokens de avaliação. NÃO são posições reais de Bitcoin, Ethereum ou SOL. NÃO é liquidez Jupiter Devnet.",
  upcoming: "C5 / C10 / C20 / C50 · Em breve",
  notReady:
    "A criação de cofres e a liquidação hospedada não estão prontas. Nenhum depósito ou posição C3 é confirmado.",
  noActivity: "Nenhuma atividade on-chain verificada disponível.",
  noPosition: "Nenhuma posição de cotas reconciliada disponível.",
  restart:
    "Após reiniciar, reconecte e verifique a propriedade. O servidor preserva assinaturas e histórico; operações incertas nunca são reenviadas automaticamente.",
  error:
    "Operação cancelada, indisponível ou bloqueada. Nenhum sucesso confirmado. Se a assinatura começou, recupere a solicitação original antes de continuar.",
  mainnet: "Mainnet e operações com fundos reais estão desabilitadas.",
  busy: "Aguarde…",
  check: "Verificar backend hospedado",
  healthy: "Banco de dados hospedado e Solana Devnet acessíveis",
  status: "Estado",
};
export type EvaluationKey = keyof typeof en;
const dictionaries: Record<Language, Dictionary> = {
  en,
  es,
  "zh-CN": zh,
  "pt-BR": pt,
};
export const evalText = (language: Language, key: EvaluationKey) =>
  dictionaries[language]?.[key] ?? en[key];
