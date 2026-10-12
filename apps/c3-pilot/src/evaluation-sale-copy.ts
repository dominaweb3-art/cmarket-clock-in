import type { Language } from "./locales";
const en = {
  quantity: "Quantity to sell",
  renew: "Renew and continue this sale",
  expired:
    "The settlement plan expired, not your shares. Tap Sell C3 to review its renewal and resume the existing sale.",
  finishFirst:
    "Finish or recover the current basket before opening another purchase. No deposit will be duplicated.",
  noShares:
    "There are no verified shares available to sell yet. Complete the current purchase or refresh your position.",
  all: "All my shares · {amount} C3",
  totalOnly:
    "This vault supports full sales only; partial sales are not available.",
  sell: "Sell all C3",
  selling:
    "Sale pending. Continue settlement; if the plan expired, review and authorize its renewal. Your shares remain until collection finishes.",
  claiming:
    "Sale settled. Collect the test USDC to receive it in your wallet and burn your C3 shares together.",
  closed:
    "Position closed. Shares burned and test USDC received. The receipt stays in Activity.",
  expected:
    "Shares upon issuance: {amount} C3. This trial uses one share per deposited test USDC; this is not a dollar valuation.",
  processing:
    "After confirmed authorization, C Market processes this trial until the next action requiring your signature. Uncertain operations stop for reconciliation.",
} as const;
type Copy = Record<keyof typeof en, string>;
export const saleCopy: Record<Language, Copy> = {
  en,
  es: {
    quantity: "Cantidad a vender",
    renew: "Renovar y continuar esta venta",
    expired:
      "Venció el plan de liquidación, no tus participaciones. Pulsa Vender C3 para revisar su renovación y retomar la venta existente.",
    finishFirst:
      "Termina o recupera la cesta actual antes de abrir otra compra. No se duplicará ningún depósito.",
    noShares:
      "Todavía no hay participaciones verificadas disponibles para vender. Completa la compra actual o actualiza tu posición.",
    all: "Todas mis participaciones · {amount} C3",
    totalOnly:
      "Esta bóveda solo permite venta total; la venta parcial no está disponible.",
    sell: "Vender todo C3",
    selling:
      "Venta pendiente. Continúa la liquidación; si el plan venció, revisa y autoriza su renovación. Tus participaciones permanecen hasta completar el cobro.",
    claiming:
      "Venta liquidada. Cobra el USDC de prueba para recibirlo en tu wallet y quemar tus participaciones C3 conjuntamente.",
    closed:
      "Posición cerrada. Participaciones quemadas y USDC de prueba recibido. El comprobante permanece en Actividad.",
    expected:
      "Participaciones al emitir: {amount} C3. Esta prueba usa una participación por USDC de prueba depositado; no es una valoración en dólares.",
    processing:
      "Tras confirmar la autorización, C Market procesa esta prueba hasta el siguiente paso que requiere tu firma. Las operaciones inciertas se detienen para conciliar.",
  },
  "zh-CN": {
    quantity: "卖出数量",
    renew: "续期并继续本次卖出",
    expired:
      "结算计划已过期，份额并未失效。点击卖出 C3 查看续期并继续现有卖出。",
    finishFirst: "开启新购买前请完成或恢复当前篮子。不会重复存入。",
    noShares: "尚无可卖出的已验证份额。请完成当前购买或刷新仓位。",
    all: "全部份额 · {amount} C3",
    totalOnly: "此金库仅支持全部卖出；暂不支持部分卖出。",
    sell: "卖出全部 C3",
    selling:
      "卖出待处理。继续结算；若计划过期，请查看并批准续期。领取完成前份额仍保留。",
    claiming: "卖出已结算。领取测试 USDC，将其接收至钱包并同时销毁 C3 份额。",
    closed: "仓位已关闭。份额已销毁，测试 USDC 已收到。凭证保留在活动中。",
    expected:
      "发行后的份额：{amount} C3。本测试每存入一单位测试 USDC 对应一份额；并非美元估值。",
    processing:
      "授权确认后，C Market 处理本次测试，直至下一项需要签名的操作。不确定的操作将停止并进行核对。",
  },
  "pt-BR": {
    quantity: "Quantidade a vender",
    renew: "Renovar e continuar esta venda",
    expired:
      "O plano de liquidação expirou, não suas cotas. Toque em Vender C3 para revisar a renovação e retomar a venda existente.",
    finishFirst:
      "Conclua ou recupere a cesta atual antes de iniciar outra compra. Nenhum depósito será duplicado.",
    noShares:
      "Ainda não há cotas verificadas disponíveis para vender. Conclua a compra atual ou atualize sua posição.",
    all: "Todas as minhas cotas · {amount} C3",
    totalOnly:
      "Este cofre permite apenas venda total; vendas parciais não estão disponíveis.",
    sell: "Vender todo C3",
    selling:
      "Venda pendente. Continue a liquidação; se o plano expirou, revise e autorize sua renovação. Suas cotas permanecem até concluir o recebimento.",
    claiming:
      "Venda liquidada. Receba o USDC de teste na wallet e queime suas cotas C3 na mesma operação.",
    closed:
      "Posição encerrada. Cotas queimadas e USDC de teste recebido. O comprovante permanece em Atividade.",
    expected:
      "Cotas após emissão: {amount} C3. Este teste usa uma cota por USDC de teste depositado; não é uma avaliação em dólares.",
    processing:
      "Após confirmar a autorização, C Market processa este teste até a próxima ação que exige sua assinatura. Operações incertas param para conciliação.",
  },
};
