/** Pure canonical public context encoding. No Mainnet configuration imports. */
export function evaluationCanonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(evaluationCanonical).join(",") + "]";
  if (
    typeof value !== "object" ||
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw Error("EVAL_CONTEXT_ENCODING");
  const record = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(record)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + evaluationCanonical(record[k]))
      .join(",") +
    "}"
  );
}
