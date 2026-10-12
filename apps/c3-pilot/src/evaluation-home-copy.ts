import type { Language } from "./locales";

const en = {
  title: "Three crypto assets.\nOne basket.",
  introduction:
    "Discover C3, explore its composition and follow your shares from your wallet.",
  demoStrip: "Demo Devnet · No real money",
  about: "About this demo",
  aboutBody:
    "Operations are recorded on Solana Devnet using test tokens and liquidity. Market-reference values are informational estimates. They do not represent real BTC, ETH or SOL exposure. Real-money operations remain disabled.",
  available: "Available for evaluation",
  explore: "Explore C3",
  target: "Target allocation",
  note: "Functional Devnet test with test tokens",
  continue: "Continue operation",
  how: "Getting started",
  connect: "Connect your wallet",
  connectBody: "Connect Phantom and verify that the account belongs to you.",
  buy: "Try C3",
  buyBody:
    "In Indices, review and authorize a deposit starting at 1 test USDC.",
  follow: "View your position",
  followBody: "Check your shares in Indices and receipts in Activity.",
  sell: "Sell and claim",
  sellBody: "Complete the sale and check the test USDC received.",
  learn: "Get to know C Market",
  what: "What is a crypto index?",
  whatBody:
    "A basket that groups crypto assets according to selection and allocation rules. C3 targets three assets.",
  methodology: "How C3 is designed",
  methodologyBody:
    "The target allocation is BTC 40% · ETH 30% · SOL 30%. Assets stay in the vault and on-chain shares record your position. This demo uses test assets, not real crypto holdings.",
  faq: "Frequently asked questions",
  real: "Do I use real money?",
  realBody:
    "No. This demo uses tokens without monetary value on Solana Devnet.",
  activity: "Where can I see my operations?",
  activityBody: "In Activity, with their states and receipts.",
  restart: "What if I close the app?",
  restartBody:
    "Return with the same wallet and check your operation in Activity. Verify ownership if the app asks.",
  repeat: "Can I repeat the test?",
  repeatBody:
    "One position per vault. After finalized redemption, start a separate trial; up to ten rounds per wallet, with history preserved. Only one active position at a time.",
  future: "More markets · Coming soon",
  futureBody:
    "We are preparing more crypto indices and a future global-markets offering.",
  upcoming: "Explore upcoming indices",
} as const;
type Copy = Record<keyof typeof en, string>;
const es: Copy = {
  title: "Tres criptoactivos.\nUna sola cesta.",
  introduction:
    "Conoce C3, explora su composición y sigue tus participaciones desde tu wallet.",
  demoStrip: "Demo Devnet · Sin dinero real",
  about: "Sobre esta demo",
  aboutBody:
    "Las operaciones se registran en Solana Devnet con tokens y liquidez de prueba. Los valores de referencia de mercado son estimaciones informativas. No representan exposición real a BTC, ETH o SOL. Las operaciones con fondos reales permanecen deshabilitadas.",
  available: "Disponible para evaluación",
  explore: "Explorar C3",
  target: "Asignación objetivo",
  note: "Prueba funcional en Devnet con tokens de prueba",
  continue: "Continuar operación",
  how: "Cómo empezar",
  connect: "Conecta tu wallet",
  connectBody: "Conecta Phantom y verifica que la cuenta te pertenece.",
  buy: "Prueba C3",
  buyBody: "En Índices, revisa y autoriza un depósito desde 1 USDC de prueba.",
  follow: "Consulta tu posición",
  followBody:
    "Revisa tus participaciones en Índices y los comprobantes en Actividad.",
  sell: "Vende y reclama",
  sellBody: "Completa la venta y consulta el USDC de prueba recibido.",
  learn: "Conoce C Market",
  what: "Qué es un índice cripto",
  whatBody:
    "Una cesta que agrupa criptoactivos siguiendo reglas de selección y distribución. C3 utiliza una asignación objetivo a tres activos.",
  methodology: "Cómo está diseñado C3",
  methodologyBody:
    "La asignación objetivo es BTC 40% · ETH 30% · SOL 30%. Los activos permanecen en la bóveda y las participaciones registran tu posición on-chain. En esta demo se utilizan activos de prueba, no criptoactivos reales.",
  faq: "Preguntas frecuentes",
  real: "¿Utilizo dinero real?",
  realBody:
    "No. Esta demo utiliza tokens sin valor monetario en Solana Devnet.",
  activity: "¿Dónde consulto mis operaciones?",
  activityBody: "En Actividad, con sus estados y comprobantes.",
  restart: "¿Qué pasa si cierro la app?",
  restartBody:
    "Al regresar, utiliza la misma wallet y consulta tu operación en Actividad. Verifica tu propiedad si la app lo solicita.",
  repeat: "¿Puedo repetir la prueba?",
  repeatBody:
    "Una posición por bóveda. Tras el rescate confirmado, inicia una prueba separada; hasta diez bóvedas por wallet, conservando el historial. Solo una posición activa a la vez.",
  future: "Más mercados · Próximamente",
  futureBody:
    "Estamos preparando más índices cripto y una futura oferta de mercados globales.",
  upcoming: "Explorar próximos índices",
};
const zh: Copy = {
  title: "三种加密资产。\n一个篮子。",
  introduction: "了解 C3，探索其配置，并通过钱包追踪你的份额。",
  demoStrip: "Demo Devnet · 无真实资金",
  about: "关于此演示",
  aboutBody:
    "操作使用测试代币和流动性记录在 Solana Devnet 上。市场参考值仅供参考，并不代表真实 BTC、ETH 或 SOL 敞口。真实资金操作仍处于禁用状态。",
  available: "可供评估",
  explore: "探索 C3",
  target: "目标配置",
  note: "使用测试代币的 Devnet 功能测试",
  continue: "继续操作",
  how: "如何开始",
  connect: "连接钱包",
  connectBody: "连接 Phantom 并验证该账户属于你。",
  buy: "体验 C3",
  buyBody: "在指数页查看并批准至少 1 测试 USDC 的存款。",
  follow: "查看你的仓位",
  followBody: "在指数页查看份额，在活动页查看凭证。",
  sell: "卖出并领取",
  sellBody: "完成卖出并查看收到的测试 USDC。",
  learn: "认识 C Market",
  what: "什么是加密指数？",
  whatBody:
    "按照选择和配置规则将加密资产组合起来的篮子。C3 目标配置为三种资产。",
  methodology: "C3 的设计",
  methodologyBody:
    "目标配置为 BTC 40% · ETH 30% · SOL 30%。资产保留在金库中，链上份额记录你的仓位。此演示使用测试资产，而非真实加密资产。",
  faq: "常见问题",
  real: "使用真实资金吗？",
  realBody: "不。此演示使用 Solana Devnet 上没有货币价值的代币。",
  activity: "在哪里查看我的操作？",
  activityBody: "在活动页查看状态和凭证。",
  restart: "关闭应用后怎么办？",
  restartBody:
    "返回后使用同一钱包，在活动页查看操作。如应用提示，请验证所有权。",
  repeat: "可以重复测试吗？",
  repeatBody:
    "每金库一个仓位。赎回确认后开始独立测试，每钱包最多十轮，保留历史，同时只能有一个活跃仓位。",
  future: "更多市场 · 即将推出",
  futureBody: "我们正在筹备更多加密指数和未来的全球市场产品。",
  upcoming: "探索即将推出的指数",
};
const pt: Copy = {
  title: "Três criptoativos.\nUma única cesta.",
  introduction:
    "Conheça o C3, explore sua composição e acompanhe suas cotas pela wallet.",
  demoStrip: "Demo Devnet · Sem dinheiro real",
  about: "Sobre esta demo",
  aboutBody:
    "As operações são registradas na Solana Devnet com tokens e liquidez de teste. Os valores de referência de mercado são estimativas informativas. Não representam exposição real a BTC, ETH ou SOL. Operações com dinheiro real permanecem desativadas.",
  available: "Disponível para avaliação",
  explore: "Explorar C3",
  target: "Alocação alvo",
  note: "Teste funcional na Devnet com tokens de teste",
  continue: "Continuar operação",
  how: "Como começar",
  connect: "Conecte sua carteira",
  connectBody: "Conecte Phantom e verifique que a conta pertence a você.",
  buy: "Experimente C3",
  buyBody:
    "Em Índices, revise e autorize um depósito a partir de 1 USDC de teste.",
  follow: "Consulte sua posição",
  followBody: "Veja suas cotas em Índices e os comprovantes em Atividade.",
  sell: "Venda e resgate",
  sellBody: "Conclua a venda e consulte o USDC de teste recebido.",
  learn: "Conheça a C Market",
  what: "O que é um índice cripto?",
  whatBody:
    "Uma cesta que agrupa criptoativos seguindo regras de seleção e distribuição. C3 tem uma alocação alvo de três ativos.",
  methodology: "Como C3 foi projetado",
  methodologyBody:
    "A alocação alvo é BTC 40% · ETH 30% · SOL 30%. Os ativos permanecem no cofre e as cotas on-chain registram sua posição. Nesta demo são usados ativos de teste, não criptoativos reais.",
  faq: "Perguntas frequentes",
  real: "É usado dinheiro real?",
  realBody: "Não. Esta demo usa tokens sem valor monetário na Solana Devnet.",
  activity: "Onde vejo minhas operações?",
  activityBody: "Em Atividade, com seus estados e comprovantes.",
  restart: "O que acontece se eu fechar o app?",
  restartBody:
    "Ao voltar, use a mesma wallet e consulte sua operação em Atividade. Verifique a propriedade se o app solicitar.",
  repeat: "Posso repetir o teste?",
  repeatBody:
    "Uma posição por cofre. Após o resgate confirmado, inicie um teste separado; até dez cofres por carteira, com histórico preservado. Apenas uma posição ativa por vez.",
  future: "Mais mercados · Em breve",
  futureBody:
    "Estamos preparando mais índices cripto e uma futura oferta de mercados globais.",
  upcoming: "Explorar próximos índices",
};
export type HomeKey = keyof typeof en;
export const homeCopy: Record<Language, Copy> = {
  en,
  es,
  "zh-CN": zh,
  "pt-BR": pt,
};
export const homeText = (language: Language, key: HomeKey): string =>
  homeCopy[language]?.[key] ?? en[key];
