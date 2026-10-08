import type { Language } from "./locales";
const en = {
  title: "C Market · C3",
  notice: "Solana Devnet evaluation · test tokens with no monetary value",
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
    "Operation cancelled, unavailable or blocked. No transaction was requested.",
  mainnet: "Mainnet and real-fund execution are disabled.",
  busy: "Please wait…",
  check: "Check hosted backend",
  healthy: "Hosted database and Solana Devnet reachable",
  status: "Status",
} as const;
type Dictionary = Record<keyof typeof en, string>;
const es: Dictionary = {
  title: "C Market · C3",
  notice: "Evaluación Solana Devnet · tokens de prueba sin valor monetario",
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
    "Operación cancelada, no disponible o bloqueada. No se solicitó una transacción.",
  mainnet: "Mainnet y las operaciones con fondos reales están deshabilitados.",
  busy: "Espera…",
  check: "Comprobar backend alojado",
  healthy: "Base de datos alojada y Solana Devnet accesibles",
  status: "Estado",
};
const zh: Dictionary = {
  title: "C Market · C3",
  notice: "Solana Devnet 评估 · 测试代币无货币价值",
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
  error: "操作已取消、不可用或被阻止。未请求任何交易。",
  mainnet: "Mainnet 和真实资金操作已禁用。",
  busy: "请稍候…",
  check: "检查托管后端",
  healthy: "托管数据库和 Solana Devnet 可访问",
  status: "状态",
};
const pt: Dictionary = {
  title: "C Market · C3",
  notice: "Avaliação Solana Devnet · tokens de teste sem valor monetário",
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
    "Operação cancelada, indisponível ou bloqueada. Nenhuma transação foi solicitada.",
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
