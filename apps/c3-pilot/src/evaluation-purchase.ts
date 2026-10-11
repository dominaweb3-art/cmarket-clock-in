/** Devnet-only decimal policy. No floats, prices, RPC or wallet callbacks. */
export function purchaseUnits(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,2})([.,][0-9]{1,6})?$/.test(value))
    throw Error("EVAL_PURCHASE_AMOUNT");
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const units = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (units < 1_000_000n || units > 200_000_000n)
    throw Error("EVAL_PURCHASE_AMOUNT");
  return units;
}
export type EvaluationPurchaseReview = Readonly<{
  amount: bigint;
  round: bigint;
}>;
export function validatePurchaseReview(context: EvaluationPurchaseReview) {
  if (
    context.amount < 1_000_000n ||
    context.amount > 200_000_000n ||
    context.round < 1n ||
    context.round > 10n
  )
    throw Error("EVAL_OWNER_PURCHASE_CONTEXT");
  return context;
}
export const purchaseCopy = {
  en: {
    amount: "Purchase amount · USDC Devnet",
    range:
      "1–200 USDC Devnet. Select any amount within your available test balance. One C3 unit represents one deposited test USDC in this separate trial, not a real-dollar asset.",
    next: "New purchase · separate vault",
    history: "Previous trials",
    reverify:
      "New vault ready. Verify wallet ownership again before authorizing this purchase.",
    invalid: "Enter an amount from 1 to 200 with at most six decimals.",
  },
  es: {
    amount: "Importe de compra · USDC Devnet",
    range:
      "1–200 USDC Devnet. Elige el importe dentro de tu saldo de prueba disponible. Una unidad C3 representa un USDC de prueba depositado en esta bóveda separada, no un activo en dólares reales.",
    next: "Nueva compra · bóveda separada",
    history: "Pruebas anteriores",
    reverify:
      "Nueva bóveda lista. Verifica de nuevo la propiedad de la wallet antes de autorizar esta compra.",
    invalid: "Introduce entre 1 y 200, con un máximo de seis decimales.",
  },
  "zh-CN": {
    amount: "购买金额 · USDC Devnet",
    range:
      "1–200 USDC Devnet。选择测试余额范围内的金额。此独立测试中一个 C3 单位代表一单位存入的测试 USDC，并非真实美元资产。",
    next: "新购买 · 独立金库",
    history: "历史测试",
    reverify: "新金库已准备好。授权本次购买前，请再次验证钱包所有权。",
    invalid: "请输入 1 至 200 之间的金额，最多六位小数。",
  },
  "pt-BR": {
    amount: "Valor da compra · USDC Devnet",
    range:
      "1–200 USDC Devnet. Escolha um valor dentro do saldo de teste disponível. Uma unidade C3 representa um USDC de teste depositado neste cofre separado, não um ativo em dólares reais.",
    next: "Nova compra · cofre separado",
    history: "Testes anteriores",
    reverify:
      "Novo cofre pronto. Verifique novamente a propriedade da carteira antes de autorizar esta compra.",
    invalid: "Informe entre 1 e 200, com até seis casas decimais.",
  },
} as const;
