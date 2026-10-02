export const candidateLanguages = ["en", "es", "zh-CN", "pt-BR"] as const;
export type CandidateLanguage = (typeof candidateLanguages)[number];
const en = {
  title: "C Market · C3 Candidate",
  home: "Home",
  indices: "Indices",
  activity: "Activity",
  network: "Mainnet candidate · monetary execution disabled",
  gate: "No deployment or pilot has been authorized. Connecting a wallet does not enable Buy or Sell.",
  language: "Language",
  wallet: "Wallet",
  connect: "Connect wallet (authorization only)",
  loading: "Loading…",
  walletError:
    "Connection cancelled or unavailable. No monetary signature was requested.",
  notConnected: "Not connected",
  target: "Strategic target: Bitcoin 40% · Ethereum 30% · Solana 30%",
  assets:
    "cbBTC · Wormhole Portal ETH · SOL exposure held as WSOL inside the vault",
  position: "No independently reconciled on-chain C3 position is configured.",
  nav: "NAV is unavailable; targets and test results are not holdings or prices.",
  empty:
    "No verified Mainnet C3 activity. No local test launcher is included in this APK.",
  buy: "Buy 1 USDC · blocked",
  sell: "Full redemption · blocked",
  risk: "SOL account rent, deployment and operation costs are separate from 1 USDC. Fees and SKR discounts remain disabled. No returns are guaranteed.",
  configuration:
    "Public release configuration and owner approvals are missing.",
} as const;
type Dictionary = Record<keyof typeof en, string>;
export const candidateTranslations: Record<CandidateLanguage, Dictionary> = {
  en,
  es: {
    title: "C Market · C3 Candidato",
    home: "Inicio",
    indices: "Índices",
    activity: "Actividad",
    network: "Candidato Mainnet · operaciones monetarias deshabilitadas",
    gate: "No se ha autorizado el despliegue ni el piloto. Conectar una wallet no habilita Comprar ni Vender.",
    language: "Idioma",
    wallet: "Wallet",
    connect: "Conectar wallet (solo autorización)",
    loading: "Cargando…",
    walletError:
      "Conexión cancelada o no disponible. No se solicitó firma monetaria.",
    notConnected: "Sin conexión",
    target: "Objetivo estratégico: Bitcoin 40% · Ethereum 30% · Solana 30%",
    assets:
      "cbBTC · Wormhole Portal ETH · exposición SOL como WSOL dentro del vault",
    position:
      "No hay una posición C3 on-chain configurada y conciliada independientemente.",
    nav: "NAV no disponible; objetivos y pruebas no son tenencias ni precios.",
    empty:
      "Sin actividad C3 Mainnet verificada. Este APK no incluye el lanzador de pruebas locales.",
    buy: "Comprar 1 USDC · bloqueado",
    sell: "Rescate total · bloqueado",
    risk: "La renta de cuentas, despliegue y operación en SOL es adicional a 1 USDC. Comisiones y descuentos SKR deshabilitados. Sin rendimientos garantizados.",
    configuration:
      "Faltan configuración pública y aprobaciones del propietario.",
  },
  "zh-CN": {
    title: "C Market · C3 候选版",
    home: "首页",
    indices: "指数",
    activity: "活动",
    network: "Mainnet 候选版 · 资金操作已禁用",
    gate: "部署及试点尚未获批。连接钱包不会启用买卖。",
    language: "语言",
    wallet: "钱包",
    connect: "连接钱包（仅授权）",
    loading: "加载中…",
    walletError: "连接已取消或不可用。未请求资金签名。",
    notConnected: "未连接",
    target: "战略目标：Bitcoin 40% · Ethereum 30% · Solana 30%",
    assets: "cbBTC · Wormhole Portal ETH · 金库内以 WSOL 持有 SOL 敞口",
    position: "尚未配置经独立核对的链上 C3 持仓。",
    nav: "NAV 不可用；目标和测试结果不是持仓或价格。",
    empty: "暂无经核实的 Mainnet C3 活动。此 APK 不含本地测试启动器。",
    buy: "购买 1 USDC · 已阻止",
    sell: "全额赎回 · 已阻止",
    risk: "SOL 账户租金、部署及操作成本不包含在 1 USDC 中。手续费和 SKR 折扣尚未启用。不保证收益。",
    configuration: "缺少公开发布配置及所有者批准。",
  },
  "pt-BR": {
    title: "C Market · C3 Candidato",
    home: "Início",
    indices: "Índices",
    activity: "Atividade",
    network: "Candidato Mainnet · operações monetárias desativadas",
    gate: "A implantação e o piloto não foram autorizados. Conectar a carteira não habilita Compra ou Venda.",
    language: "Idioma",
    wallet: "Carteira",
    connect: "Conectar carteira (somente autorização)",
    loading: "Carregando…",
    walletError:
      "Conexão cancelada ou indisponível. Nenhuma assinatura monetária foi solicitada.",
    notConnected: "Não conectada",
    target: "Meta estratégica: Bitcoin 40% · Ethereum 30% · Solana 30%",
    assets: "cbBTC · Wormhole Portal ETH · exposição SOL como WSOL no vault",
    position:
      "Nenhuma posição C3 on-chain configurada e reconciliada independentemente.",
    nav: "NAV indisponível; metas e testes não são posições nem preços.",
    empty:
      "Sem atividade C3 Mainnet verificada. Este APK não inclui o iniciador de testes locais.",
    buy: "Comprar 1 USDC · bloqueado",
    sell: "Resgate total · bloqueado",
    risk: "Aluguel de contas, implantação e operação em SOL são adicionais a 1 USDC. Taxas e descontos SKR desativados. Sem garantia de retorno.",
    configuration: "Faltam configuração pública e aprovações do proprietário.",
  },
};
