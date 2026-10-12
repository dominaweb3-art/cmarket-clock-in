/** Read-only position presentation. Never authorizes a wallet operation. */
export function basketPosition(
  wallet: string | null,
  verified: boolean,
  p: Record<string, unknown> | null,
) {
  if (!wallet) return { state: "connect" } as const;
  if (!verified) return { state: "verify" } as const;
  if (!p) return { state: "unavailable" } as const;
  if (
    p.wallet !== wallet ||
    p.cluster !== "solana:devnet" ||
    p.simulatedAssets !== true ||
    p.monetaryValue !== false
  )
    return { state: "unavailable" } as const;
  const units = (v: unknown): v is string =>
    typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v);
  if (![p.deposited, p.shares, p.returned, p.claimable].every(units))
    return { state: "unavailable" } as const;
  const deposited = p.deposited as string;
  if (p.lifecycle === 0 && deposited === "0" && p.shares === "0")
    return { state: "empty" } as const;
  if (
    p.lifecycle === 4 &&
    p.shares === "0" &&
    BigInt(p.returned as string) > 0n
  )
    return {
      state: "completed",
      deposited,
      received: p.returned as string,
    } as const;
  if (BigInt(deposited) < 1_000_000n || BigInt(deposited) > 1_000_000_000_000n)
    return { state: "unavailable" } as const;
  if (p.lifecycle === 1 && p.shares === "0")
    return { state: "buying", deposited } as const;
  if (p.lifecycle === 2 && BigInt(p.shares as string) > 0n)
    return { state: "active", deposited } as const;
  if (p.lifecycle === 3 && BigInt(p.shares as string) > 0n)
    return {
      state: "selling",
      deposited,
      claimable: p.claimable as string,
    } as const;
  return { state: "unavailable" } as const;
}

export const positionCopy = {
  en: {
    title: "My C3 basket",
    invested: "Deposited · USDC Devnet",
    connect: "Connect your wallet to see your basket.",
    verify: "Verify wallet ownership to load your position.",
    unavailable:
      "Position unavailable. Refresh after checking your connection.",
    empty: "No active basket yet. Start with Buy C3.",
    completed: "Basket sold · no active position",
    received: "Actually received · USDC Devnet",
    buying: "Purchase in progress · position not issued yet",
    active: "Active basket",
    selling: "Sale in progress",
    claimable: "Reconciled amount to claim · USDC Devnet",
    details: "Receipts and technical details",
    sellReason:
      "Sell becomes available only after your purchase finishes and your position is confirmed. A sold basket cannot be sold again.",
    prepare:
      "Buy C3 guides you through connection, verification and a new vault. No deposit is signed by this button alone.",
    limited:
      "One active basket per wallet. Complete its sale and claim before starting another trial.",
  },
  es: {
    title: "Mi cesta C3",
    invested: "Depositado · USDC Devnet",
    connect: "Conecta tu wallet para consultar tu cesta.",
    verify: "Verifica la propiedad de tu wallet para cargar tu posición.",
    unavailable: "Posición no disponible. Comprueba la conexión y actualiza.",
    empty: "Todavía no tienes una cesta activa. Empieza con Comprar C3.",
    completed: "Cesta vendida · sin posición activa",
    received: "Efectivamente recibido · USDC Devnet",
    buying: "Compra en curso · participación todavía no emitida",
    active: "Cesta activa",
    selling: "Venta en curso",
    claimable: "Importe conciliado para reclamar · USDC Devnet",
    details: "Comprobantes y detalles técnicos",
    sellReason:
      "Vender se activa cuando termina la compra y tu posición está confirmada. Una cesta ya vendida no se puede vender otra vez.",
    prepare:
      "Comprar C3 te guía a conectar, verificar y preparar una bóveda nueva. Este botón por sí solo no firma un depósito.",
    limited:
      "Una cesta activa por wallet. Termina su venta y reclamo antes de iniciar otra prueba.",
  },
  "zh-CN": {
    title: "我的 C3 篮子",
    invested: "已存入 · USDC Devnet",
    connect: "连接钱包以查看篮子。",
    verify: "验证钱包所有权以加载仓位。",
    unavailable: "仓位暂不可用。检查连接后刷新。",
    empty: "暂无活跃篮子。点击购买 C3 开始。",
    completed: "篮子已卖出 · 无活跃仓位",
    received: "实际收到 · USDC Devnet",
    buying: "购买处理中 · 份额尚未发行",
    active: "活跃篮子",
    selling: "卖出处理中",
    claimable: "已核对的可领取金额 · USDC Devnet",
    details: "凭证与技术详情",
    sellReason: "购买完成且仓位确认后才能卖出。已卖出的篮子不能再次卖出。",
    prepare: "购买 C3 将引导连接、验证和准备新金库。此按钮本身不会签署存款。",
    limited: "每个钱包只能有一个活跃篮子。完成卖出和领取后才能开始下一次测试。",
  },
  "pt-BR": {
    title: "Minha cesta C3",
    invested: "Depositado · USDC Devnet",
    connect: "Conecte sua carteira para consultar a cesta.",
    verify: "Verifique a propriedade da carteira para carregar sua posição.",
    unavailable: "Posição indisponível. Verifique a conexão e atualize.",
    empty: "Nenhuma cesta ativa. Comece com Comprar C3.",
    completed: "Cesta vendida · sem posição ativa",
    received: "Efetivamente recebido · USDC Devnet",
    buying: "Compra em andamento · participação ainda não emitida",
    active: "Cesta ativa",
    selling: "Venda em andamento",
    claimable: "Valor reconciliado para resgatar · USDC Devnet",
    details: "Comprovantes e detalhes técnicos",
    sellReason:
      "Vender fica disponível após a compra terminar e a posição ser confirmada. Uma cesta vendida não pode ser vendida novamente.",
    prepare:
      "Comprar C3 orienta conexão, verificação e preparação de um novo cofre. O botão sozinho não assina um depósito.",
    limited:
      "Uma cesta ativa por carteira. Conclua a venda e o resgate antes de iniciar outro teste.",
  },
} as const;
