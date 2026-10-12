import type { Language } from "./locales";

const en = {
  title: "Crypto assets, in one basket.",
  introduction:
    "C Market brings assets together in indices and lets you follow your share through a simple mobile experience.",
  available: "Available for evaluation",
  explore: "Explore C3",
  target: "Target composition",
  note: "Functional Devnet test with test tokens",
  continue: "Continue operation",
  how: "How it works",
  connect: "Connect your wallet",
  connectBody: "Use the existing MWA flow and verify ownership.",
  buy: "Buy C3",
  buyBody: "Choose 1–1,000,000 USDC Devnet within your available test balance.",
  follow: "View your share",
  followBody: "Follow shares recorded and reconciled on-chain.",
  sell: "Sell and claim",
  sellBody: "Complete redemption and check the TEST USDC actually received.",
  learn: "Get to know C Market",
  what: "What is a crypto index?",
  whatBody:
    "A basket that brings several crypto assets together following a defined methodology.",
  methodology: "C3 methodology",
  methodologyBody:
    "BTC 40% · ETH 30% · SOL 30% is the target allocation. In this evaluation, a deposit is processed into test assets held in a vault; you approve on-chain shares, then sell and claim realized TEST USDC. These are simulated assets, not real exposure or Jupiter Devnet liquidity. No live NAV, automatic rebalancing or Mainnet trading is claimed.",
  faq: "Frequently asked questions",
  real: "Is real money used?",
  realBody:
    "No. This release uses test tokens without monetary value on Devnet.",
  activity: "Where can I see my operations?",
  activityBody: "In Activity, with their states and receipts.",
  restart: "What if I close the app?",
  restartBody:
    "Reconnect and verify ownership. The existing flow can load and recover recorded operations without automatically resending uncertain ones.",
  repeat: "Can I repeat the test?",
  repeatBody:
    "One position per vault. After finalized redemption, start a separate trial; up to ten rounds per wallet, with history preserved. Only one active position at a time.",
  future: "What's next · Coming soon",
  futureBody: "More crypto indices and future global markets.",
  upcoming: "View upcoming indices",
} as const;
type Copy = Record<keyof typeof en, string>;
const es: Copy = {
  title: "Criptoactivos, en una cesta.",
  introduction:
    "C Market reúne activos en índices y te permite seguir tu participación desde una experiencia móvil sencilla.",
  available: "Disponible para evaluación",
  explore: "Explorar C3",
  target: "Composición objetivo",
  note: "Prueba funcional en Devnet con tokens de prueba",
  continue: "Continuar operación",
  how: "Cómo funciona",
  connect: "Conecta tu wallet",
  connectBody: "Usa el flujo MWA existente y verifica la propiedad.",
  buy: "Compra C3",
  buyBody: "Elige de 1 a 1.000.000 USDC Devnet dentro de tu saldo de prueba.",
  follow: "Consulta tu participación",
  followBody: "Sigue las participaciones registradas y conciliadas on-chain.",
  sell: "Vende y reclama",
  sellBody:
    "Completa la redención y consulta el TEST USDC efectivamente recibido.",
  learn: "Conoce C Market",
  what: "Qué es un índice cripto",
  whatBody:
    "Una cesta que reúne varios criptoactivos siguiendo una metodología definida.",
  methodology: "Metodología de C3",
  methodologyBody:
    "BTC 40% · ETH 30% · SOL 30% es la asignación objetivo. En esta evaluación, el depósito se procesa en activos de prueba que permanecen en la bóveda; autorizas participaciones on-chain, después vendes y reclamas TEST USDC liquidado. Son activos simulados, no exposición real ni liquidez Jupiter Devnet. No se acredita NAV vivo, rebalanceo automático ni operaciones Mainnet.",
  faq: "Preguntas frecuentes",
  real: "¿Se utiliza dinero real?",
  realBody:
    "No; esta entrega funciona con tokens de prueba sin valor monetario en Devnet.",
  activity: "¿Dónde veo mis operaciones?",
  activityBody: "En Actividad, con sus estados y comprobantes.",
  restart: "¿Qué ocurre si cierro la app?",
  restartBody:
    "Reconecta y verifica la propiedad. El flujo existente permite consultar y recuperar operaciones registradas, sin reenviar automáticamente las inciertas.",
  repeat: "¿Puedo repetir la prueba?",
  repeatBody:
    "Una posición por bóveda. Tras el rescate confirmado, inicia una prueba separada; hasta diez bóvedas por wallet, conservando el historial. Solo una posición activa a la vez.",
  future: "Lo que viene · Próximamente",
  futureBody: "Más índices cripto y futuros mercados globales.",
  upcoming: "Ver próximos índices",
};
const zh: Copy = {
  title: "加密资产，汇于一个篮子。",
  introduction:
    "C Market 将资产汇集成指数，让你通过简洁的移动体验追踪自己的份额。",
  available: "可供评估",
  explore: "探索 C3",
  target: "目标配置",
  note: "使用测试代币的 Devnet 功能测试",
  continue: "继续操作",
  how: "如何使用",
  connect: "连接钱包",
  connectBody: "使用现有 MWA 流程并验证所有权。",
  buy: "购买 C3",
  buyBody: "选择测试余额范围内的 1–1,000,000 USDC Devnet。",
  follow: "查看你的份额",
  followBody: "追踪已在链上记录并核对的份额。",
  sell: "卖出并领取",
  sellBody: "完成赎回并查询实际收到的 TEST USDC。",
  learn: "认识 C Market",
  what: "什么是加密指数？",
  whatBody: "按照明确的方法将多种加密资产组合在一起的篮子。",
  methodology: "C3 方法",
  methodologyBody:
    "BTC 40% · ETH 30% · SOL 30% 是目标配置。在此评估中，存款被处理为金库持有的测试资产；你批准链上份额，然后卖出并领取已结算的 TEST USDC。这是模拟资产，不是真实敞口或 Jupiter Devnet 流动性。不宣称实时 NAV、自动再平衡或 Mainnet 交易。",
  faq: "常见问题",
  real: "使用真实资金吗？",
  realBody: "不。本版本使用 Devnet 上没有货币价值的测试代币。",
  activity: "在哪里查看我的操作？",
  activityBody: "在活动页查看状态和凭证。",
  restart: "关闭应用后怎么办？",
  restartBody:
    "重新连接并验证所有权。现有流程可查询并恢复已记录的操作，不会自动重新发送结果不确定的操作。",
  repeat: "可以重复测试吗？",
  repeatBody:
    "每金库一个仓位。赎回确认后开始独立测试，每钱包最多十轮，保留历史，同时只能有一个活跃仓位。",
  future: "未来计划 · 即将推出",
  futureBody: "更多加密指数和未来的全球市场。",
  upcoming: "查看计划中的指数",
};
const pt: Copy = {
  title: "Criptoativos, em uma cesta.",
  introduction:
    "A C Market reúne ativos em índices e permite acompanhar sua participação em uma experiência móvel simples.",
  available: "Disponível para avaliação",
  explore: "Explorar C3",
  target: "Composição alvo",
  note: "Teste funcional na Devnet com tokens de teste",
  continue: "Continuar operação",
  how: "Como funciona",
  connect: "Conecte sua carteira",
  connectBody: "Use o fluxo MWA existente e verifique a propriedade.",
  buy: "Compre C3",
  buyBody: "Escolha de 1 a 1.000.000 USDC Devnet dentro do saldo de teste.",
  follow: "Consulte sua participação",
  followBody: "Acompanhe cotas registradas e reconciliadas on-chain.",
  sell: "Venda e resgate",
  sellBody: "Conclua a redenção e consulte o TEST USDC efetivamente recebido.",
  learn: "Conheça a C Market",
  what: "O que é um índice cripto?",
  whatBody:
    "Uma cesta que reúne vários criptoativos seguindo uma metodologia definida.",
  methodology: "Metodologia do C3",
  methodologyBody:
    "BTC 40% · ETH 30% · SOL 30% é a alocação alvo. Nesta avaliação, o depósito é processado em ativos de teste mantidos no cofre; você aprova cotas on-chain, depois vende e resgata TEST USDC liquidado. São ativos simulados, não exposição real nem liquidez Jupiter Devnet. Não se afirma NAV em tempo real, rebalanceamento automático ou operações Mainnet.",
  faq: "Perguntas frequentes",
  real: "É usado dinheiro real?",
  realBody:
    "Não. Esta versão usa tokens de teste sem valor monetário na Devnet.",
  activity: "Onde vejo minhas operações?",
  activityBody: "Em Atividade, com seus estados e comprovantes.",
  restart: "O que acontece se eu fechar o app?",
  restartBody:
    "Reconecte e verifique a propriedade. O fluxo existente permite consultar e recuperar operações registradas, sem reenviar automaticamente as incertas.",
  repeat: "Posso repetir o teste?",
  repeatBody:
    "Uma posição por cofre. Após o resgate confirmado, inicie um teste separado; até dez cofres por carteira, com histórico preservado. Apenas uma posição ativa por vez.",
  future: "O que vem aí · Em breve",
  futureBody: "Mais índices cripto e futuros mercados globais.",
  upcoming: "Ver próximos índices",
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
