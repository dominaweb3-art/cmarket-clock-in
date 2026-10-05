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
  informationalValuation:
    "Any valuation estimate is informational only, not a redemption price or guaranteed return.",
  singlePosition:
    "Restricted candidate: one wallet, one lifetime 1 USDC deposit, full redemption only. Public execution disabled.",
  realizedClaim: "Finalized liquidation: claimable USDC",
  realizedReturned: "Finalized USDC actually returned",
  usdcBaseUnits: "USDC base units (6 decimals)",
  empty:
    "No verified Mainnet C3 activity. No local test launcher is included in this APK.",
  buy: "Buy 1 USDC · blocked",
  sell: "Full redemption · blocked",
  risk: "SOL account rent, deployment and operation costs are separate from 1 USDC. Fees and SKR discounts remain disabled. No returns are guaranteed.",
  configuration:
    "Public release configuration and owner approvals are missing.",
  ownerWorkflow:
    "Owner flow: deposit → settlement → shares → redemption → USDC claim. Real operations remain blocked.",
  readPosition: "Read reconciled position",
  shares: "C3 shares",
  baseUnits: "base units (6 decimals)",
  noOperation: "No owner operation recorded.",
  issue: "Issue reconciled shares · blocked",
  claim: "Claim reconciled USDC · blocked",
  approve: "Review and authorize with MWA",
  recover: "Read-only recovery (no retry)",
  operationError:
    "Operation blocked or evidence unavailable. An uncertain signature must be reconciled; do not retry.",
  reviewNotice:
    "Review the exact program, accounts and amount before approval. A wallet signature is not a settled C3 position.",
  review: "Awaiting explicit review",
  authorizing: "Wallet authorization pending",
  signed: "Signature recorded; effects not yet verified",
  uncertain: "Uncertain result: reconciliation required",
  finalized: "Economic effects reconciled",
  closed_unexecuted: "Expired request independently closed without execution",
  cancelRequest: "Request safe expiry / cancellation",
  ownerSignIn: "Authenticate owner for recovery",
  renewRequest: "Prepare a new generation after reconciliation",
  renewPlan: "Review expired plan renewal (no swap)",
  reviewMinimum:
    "Request a fresh quote to review an unattainable minimum (no swap)",
  minimumResolutionNotice:
    "Economic change: lower only the next pending swap minimum. Review explicitly; previously acquired assets stay in the vault. This does not execute a swap or guarantee recovery of the original USDC.",
  minimumResolutionUnits: "Previous → proposed minimum (token base units)",
  minimumResolutionExpiry: "Quote review expires (UTC)",
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
    informationalValuation:
      "Toda valoración estimada es solo informativa, no un precio de rescate ni devolución garantizada.",
    singlePosition:
      "Candidato restringido: una wallet, un único depósito de 1 USDC y rescate total. Ejecución pública deshabilitada.",
    realizedClaim: "Liquidación finalizada: USDC reclamable",
    realizedReturned: "USDC efectivamente devuelto y finalizado",
    usdcBaseUnits: "unidades base USDC (6 decimales)",
    empty:
      "Sin actividad C3 Mainnet verificada. Este APK no incluye el lanzador de pruebas locales.",
    buy: "Comprar 1 USDC · bloqueado",
    sell: "Rescate total · bloqueado",
    risk: "La renta de cuentas, despliegue y operación en SOL es adicional a 1 USDC. Comisiones y descuentos SKR deshabilitados. Sin rendimientos garantizados.",
    configuration:
      "Faltan configuración pública y aprobaciones del propietario.",
    ownerWorkflow:
      "Recorrido del propietario: depósito → liquidación → participaciones → rescate → reclamo USDC. Operaciones reales bloqueadas.",
    readPosition: "Consultar posición conciliada",
    shares: "Participaciones C3",
    baseUnits: "unidades base (6 decimales)",
    noOperation: "Sin operación del propietario registrada.",
    issue: "Emitir participaciones conciliadas · bloqueado",
    claim: "Reclamar USDC conciliado · bloqueado",
    approve: "Revisar y autorizar con MWA",
    recover: "Recuperación de solo lectura (sin reenvío)",
    operationError:
      "Operación bloqueada o evidencia no disponible. Una firma incierta debe conciliarse; no reintentes.",
    reviewNotice:
      "Revisa programa, cuentas e importe exactos antes de autorizar. Una firma no es una posición C3 liquidada.",
    review: "Esperando revisión explícita",
    authorizing: "Autorización de wallet pendiente",
    signed: "Firma registrada; efectos aún no verificados",
    uncertain: "Resultado incierto: requiere conciliación",
    finalized: "Efectos económicos conciliados",
    closed_unexecuted:
      "Solicitud vencida cerrada sin ejecución tras conciliación",
    cancelRequest: "Solicitar vencimiento / cancelación segura",
    ownerSignIn: "Autenticar propietario para recuperar",
    renewRequest: "Preparar nueva generación tras conciliación",
    renewPlan: "Revisar renovación del plan vencido (sin swap)",
    reviewMinimum:
      "Solicitar cotización fresca para revisar un mínimo inalcanzable (sin swap)",
    minimumResolutionNotice:
      "Cambio económico: reducir solo el mínimo del siguiente swap pendiente. Requiere revisión explícita; los activos adquiridos siguen en la bóveda. No ejecuta un swap ni garantiza recuperar el USDC original.",
    minimumResolutionUnits:
      "Mínimo anterior → propuesto (unidades base del token)",
    minimumResolutionExpiry: "Vencimiento de revisión (UTC)",
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
    informationalValuation: "估值仅供参考，不是赎回价格，也不保证回报。",
    singlePosition:
      "受限候选：一个钱包、终身仅一次 1 USDC 存款、仅支持全部赎回。公开执行已禁用。",
    realizedClaim: "已最终确认的清算：可领取 USDC",
    realizedReturned: "已最终确认的实际返还 USDC",
    usdcBaseUnits: "USDC 基础单位（6 位小数）",
    empty: "暂无经核实的 Mainnet C3 活动。此 APK 不含本地测试启动器。",
    buy: "购买 1 USDC · 已阻止",
    sell: "全额赎回 · 已阻止",
    risk: "SOL 账户租金、部署及操作成本不包含在 1 USDC 中。手续费和 SKR 折扣尚未启用。不保证收益。",
    configuration: "缺少公开发布配置及所有者批准。",
    ownerWorkflow:
      "所有者流程：存入 → 结算 → 份额 → 赎回 → 领取 USDC。真实资金操作仍被阻止。",
    readPosition: "读取已核对持仓",
    shares: "C3 份额",
    baseUnits: "基本单位（6 位小数）",
    noOperation: "尚无所有者操作记录。",
    issue: "发行已核对份额 · 已阻止",
    claim: "领取已核对 USDC · 已阻止",
    approve: "审核并通过 MWA 授权",
    recover: "只读恢复（不重试）",
    operationError:
      "操作被阻止或证据不可用。结果不明的签名须先核对，不要重试。",
    reviewNotice:
      "授权前审核准确的程序、账户和金额。钱包签名不等于已结算的 C3 持仓。",
    review: "等待明确审核",
    authorizing: "等待钱包授权",
    signed: "已记录签名；经济效果尚未验证",
    uncertain: "结果不明：须核对",
    finalized: "经济效果已核对",
    closed_unexecuted: "过期请求已核对关闭，未执行",
    cancelRequest: "请求安全过期或取消",
    ownerSignIn: "验证所有者以恢复操作",
    renewRequest: "核对后准备新一代请求",
    renewPlan: "检查过期计划续期（不进行兑换）",
    reviewMinimum: "请求新报价以审核无法达到的最低值（不进行兑换）",
    minimumResolutionNotice:
      "经济变更：仅降低下一笔待执行兑换的最低输出。须明确审核；已购资产仍在金库中。这不执行兑换，也不保证收回原始 USDC。",
    minimumResolutionUnits: "原最低值 → 建议最低值（代币基础单位）",
    minimumResolutionExpiry: "报价审核到期时间（UTC）",
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
    informationalValuation:
      "Qualquer avaliação estimada é apenas informativa, não é preço de resgate nem retorno garantido.",
    singlePosition:
      "Candidato restrito: uma carteira, um único depósito de 1 USDC e resgate total. Execução pública desativada.",
    realizedClaim: "Liquidação finalizada: USDC disponível para resgate",
    realizedReturned: "USDC efetivamente devolvido e finalizado",
    usdcBaseUnits: "unidades base USDC (6 decimais)",
    empty:
      "Sem atividade C3 Mainnet verificada. Este APK não inclui o iniciador de testes locais.",
    buy: "Comprar 1 USDC · bloqueado",
    sell: "Resgate total · bloqueado",
    risk: "Aluguel de contas, implantação e operação em SOL são adicionais a 1 USDC. Taxas e descontos SKR desativados. Sem garantia de retorno.",
    configuration: "Faltam configuração pública e aprovações do proprietário.",
    ownerWorkflow:
      "Fluxo do proprietário: depósito → liquidação → cotas → resgate → retirada USDC. Operações reais bloqueadas.",
    readPosition: "Consultar posição reconciliada",
    shares: "Cotas C3",
    baseUnits: "unidades base (6 casas decimais)",
    noOperation: "Nenhuma operação do proprietário registrada.",
    issue: "Emitir cotas reconciliadas · bloqueado",
    claim: "Retirar USDC reconciliado · bloqueado",
    approve: "Revisar e autorizar com MWA",
    recover: "Recuperação somente leitura (sem reenvio)",
    operationError:
      "Operação bloqueada ou evidência indisponível. Uma assinatura incerta deve ser reconciliada; não tente novamente.",
    reviewNotice:
      "Revise programa, contas e valor exatos antes de aprovar. Uma assinatura não é uma posição C3 liquidada.",
    review: "Aguardando revisão explícita",
    authorizing: "Autorização da carteira pendente",
    signed: "Assinatura registrada; efeitos ainda não verificados",
    uncertain: "Resultado incerto: requer reconciliação",
    finalized: "Efeitos econômicos reconciliados",
    closed_unexecuted:
      "Solicitação expirada encerrada sem execução após reconciliação",
    cancelRequest: "Solicitar expiração / cancelamento seguro",
    ownerSignIn: "Autenticar proprietário para recuperação",
    renewRequest: "Preparar nova geração após reconciliação",
    renewPlan: "Revisar renovação do plano expirado (sem swap)",
    reviewMinimum:
      "Solicitar cotação nova para revisar mínimo inalcançável (sem swap)",
    minimumResolutionNotice:
      "Alteração econômica: reduzir apenas o mínimo do próximo swap pendente. Exige revisão explícita; ativos comprados ficam no vault. Não executa swap nem garante recuperar o USDC original.",
    minimumResolutionUnits:
      "Mínimo anterior → proposto (unidades base do token)",
    minimumResolutionExpiry: "Revisão da cotação expira (UTC)",
  },
};
