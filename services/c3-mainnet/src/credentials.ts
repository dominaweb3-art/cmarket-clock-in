import { SERVER_CREDENTIAL_NAMES } from "./constants.ts";

export type CredentialPresence = Readonly<{
  jupiter: boolean;
  pyth: boolean;
  rpcPrimary: boolean;
  rpcSecondary: boolean;
  rpcOperatorsIndependent: boolean;
}>;

function validHttps(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function inspectCredentialPresence(
  environment: Readonly<Record<string, string | undefined>>,
): CredentialPresence {
  const primaryUrl = environment[SERVER_CREDENTIAL_NAMES.rpcPrimaryUrl];
  const secondaryUrl = environment[SERVER_CREDENTIAL_NAMES.rpcSecondaryUrl];
  const primaryOperator =
    environment[SERVER_CREDENTIAL_NAMES.rpcPrimaryOperator];
  const secondaryOperator =
    environment[SERVER_CREDENTIAL_NAMES.rpcSecondaryOperator];
  return Object.freeze({
    jupiter: Boolean(environment[SERVER_CREDENTIAL_NAMES.jupiter]),
    pyth: Boolean(environment[SERVER_CREDENTIAL_NAMES.pyth]),
    rpcPrimary: validHttps(primaryUrl),
    rpcSecondary: validHttps(secondaryUrl) && secondaryUrl !== primaryUrl,
    rpcOperatorsIndependent: Boolean(
      primaryOperator &&
      secondaryOperator &&
      primaryOperator !== secondaryOperator,
    ),
  });
}

export function redactOperationalError(
  error: unknown,
): Readonly<{ code: string; message: string }> {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown isolated service failure.";
  const redacted = message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/x-api-key["'\s:=]+[A-Za-z0-9._~+/=-]+/gi, "x-api-key=[REDACTED]")
    .replace(/https:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://[REDACTED]@");
  return Object.freeze({ code: "isolated_service_error", message: redacted });
}
