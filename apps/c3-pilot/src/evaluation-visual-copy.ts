import type { Language } from "./locales";

const en = {
  demo: "Devnet demo",
  index: "Crypto index",
  buy: "Buy C3 · Devnet test",
  what: "What is C3?",
  description:
    "One share to follow a basket of crypto assets. This evaluation uses test tokens, not real asset exposure.",
  allocation: "Target allocation · test assets",
  more: "More indices and markets",
  soon: "Coming soon",
  markets: "Global markets",
  account: "My wallet & evaluation",
  position: "My reconciled position",
  controls: "Evaluation steps",
  details: "Wallet, language & recovery",
  back: "Close wallet panel",
  activityHint:
    "Your confirmed Devnet operations will appear here. Verify wallet ownership to load your history.",
  verifiedOnly:
    "Status comes from reconciled on-chain effects, not from a stored signature alone.",
  test: "TEST",
  stepHint:
    "Receive test tokens, deposit, process swaps and approve each required wallet step. Only actions allowed by your vault are available.",
  view: "View C3 details",
  goals:
    "40% Bitcoin · 30% Ethereum · 30% Solana is the strategic target, not a claim about current holdings.",
} as const;
type Copy = Record<keyof typeof en, string>;
const es: Copy = {
  demo: "Demo Devnet",
  index: "Índice cripto",
  buy: "Comprar C3 · prueba Devnet",
  what: "¿Qué es C3?",
  description:
    "Una participación para seguir una cesta de criptoactivos. Esta evaluación usa tokens de prueba, no exposición a activos reales.",
  allocation: "Asignación objetivo · activos de prueba",
  more: "Más índices y mercados",
  soon: "Próximamente",
  markets: "Mercados globales",
  account: "Mi wallet y evaluación",
  position: "Mi posición conciliada",
  controls: "Pasos de evaluación",
  details: "Wallet, idioma y recuperación",
  back: "Cerrar panel de wallet",
  activityHint:
    "Aquí aparecerán tus operaciones Devnet confirmadas. Verifica la propiedad de tu wallet para consultar el historial.",
  verifiedOnly:
    "El estado procede de efectos on-chain conciliados, no únicamente de una firma guardada.",
  test: "PRUEBA",
  stepHint:
    "Recibe tokens de prueba, deposita, procesa los swaps y aprueba cada paso requerido. Solo están disponibles las acciones permitidas por tu bóveda.",
  view: "Ver detalles de C3",
  goals:
    "40% Bitcoin · 30% Ethereum · 30% Solana es el objetivo estratégico, no una afirmación sobre las tenencias actuales.",
};
const zh: Copy = {
  demo: "Devnet 演示",
  index: "加密指数",
  buy: "购买 C3 · Devnet 测试",
  what: "什么是 C3？",
  description:
    "以一份份额追踪加密资产篮子。此评估使用测试代币，不代表真实资产敞口。",
  allocation: "目标配置 · 测试资产",
  more: "更多指数和市场",
  soon: "即将推出",
  markets: "全球市场",
  account: "我的钱包和评估",
  position: "已核对的仓位",
  controls: "评估步骤",
  details: "钱包、语言和恢复",
  back: "关闭钱包面板",
  activityHint: "已确认的 Devnet 操作将在此显示。验证钱包所有权后可查看历史。",
  verifiedOnly: "状态基于已核对的链上效果，而不只是保存的签名。",
  test: "测试",
  stepHint:
    "领取测试代币、存款、处理兑换并批准所需的钱包操作。仅可执行金库允许的操作。",
  view: "查看 C3 详情",
  goals: "40% Bitcoin · 30% Ethereum · 30% Solana 是战略目标，不代表当前持仓。",
};
const pt: Copy = {
  demo: "Demo Devnet",
  index: "Índice cripto",
  buy: "Comprar C3 · teste Devnet",
  what: "O que é C3?",
  description:
    "Uma cota para acompanhar uma cesta de criptoativos. Esta avaliação usa tokens de teste, sem exposição a ativos reais.",
  allocation: "Alocação alvo · ativos de teste",
  more: "Mais índices e mercados",
  soon: "Em breve",
  markets: "Mercados globais",
  account: "Minha carteira e avaliação",
  position: "Minha posição reconciliada",
  controls: "Etapas da avaliação",
  details: "Carteira, idioma e recuperação",
  back: "Fechar painel da carteira",
  activityHint:
    "Suas operações Devnet confirmadas aparecerão aqui. Verifique a propriedade da carteira para consultar o histórico.",
  verifiedOnly:
    "O estado vem de efeitos on-chain reconciliados, não apenas de uma assinatura armazenada.",
  test: "TESTE",
  stepHint:
    "Receba tokens de teste, deposite, processe swaps e aprove cada etapa necessária. Apenas as ações permitidas pelo cofre estão disponíveis.",
  view: "Ver detalhes do C3",
  goals:
    "40% Bitcoin · 30% Ethereum · 30% Solana é o alvo estratégico, não uma afirmação sobre posições atuais.",
};
export type VisualKey = keyof typeof en;
const copy: Record<Language, Copy> = { en, es, "zh-CN": zh, "pt-BR": pt };
export const visualText = (language: Language, key: VisualKey): string =>
  copy[language]?.[key] ?? en[key];

// Source-controlled presentation only; these never construct or authorize swaps.
export const evaluationTargets = [
  { symbol: "BTC", percent: 40, icon: 0, background: "#fff4e7" },
  { symbol: "ETH", percent: 30, icon: 1, background: "#f0efff" },
  { symbol: "SOL", percent: 30, icon: 2, background: "#e9f8f3" },
] as const;
export const evaluationTabs = ["home", "indices", "activity"] as const;
export type EvaluationTab = (typeof evaluationTabs)[number];
