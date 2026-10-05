import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  base58ToUint8Array,
  base64FromUint8Array,
  base64ToUint8Array,
  base64ToBase58,
} from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";
import {
  candidateHttpsEndpoint,
  requireCandidateMoneyGate,
} from "./candidate-config";
import {
  requestCandidateMonetarySignature,
  authenticateCandidateOwner,
} from "./candidate-wallet";
import { createOwnerSession } from "./owner-session";
import { OwnerController } from "./owner-controller";
import { ownerBackend, authenticatedOwnerPreparation } from "./owner-backend";
import type { OwnerPolicy } from "./owner-policy";
import { parseOwnerPosition, type OwnerPosition } from "./owner-position";
/** Source-controlled reviewed public release configuration, never env/constructor
 * input. Currently absent: no user/PDA/address is invented for an enabled build. */
export type CandidateOwnerConfiguration = Readonly<{
  backend: string;
  wallet: string;
  intentId: string;
  policy: OwnerPolicy;
}>;
const ownerSessions = new Map<string, ReturnType<typeof createOwnerSession>>();
export function reviewedCandidateOwnerConfiguration(): CandidateOwnerConfiguration | null {
  return null;
}
function requiredOwnerConfiguration(
  wallet: string,
): CandidateOwnerConfiguration {
  const c = reviewedCandidateOwnerConfiguration();
  if (
    !c ||
    c.wallet !== wallet ||
    !candidateHttpsEndpoint(c.backend) ||
    c.policy.wallet.length !== 32 ||
    !base58ToUint8Array(wallet).every((b, i) => b === c.policy.wallet[i])
  )
    throw Error("C3_OWNER_RELEASE_CONFIGURATION_MISSING");
  return c;
}
export function candidateOwnerController(wallet: string): OwnerController {
  requireCandidateMoneyGate();
  const configuration = requiredOwnerConfiguration(wallet);
  const session = createOwnerSession(
    configuration.backend,
    wallet,
    configuration.intentId,
    (message) => authenticateCandidateOwner(wallet, message),
    base64FromUint8Array,
  );
  const backend = ownerBackend(
    configuration.backend,
    base64FromUint8Array,
    base64ToUint8Array,
    session.fetch,
    true,
  );
  ownerSessions.set(wallet, session);
  return new OwnerController({
    gate: requireCandidateMoneyGate,
    wallet,
    policy: configuration.policy,
    backend: {
      ...backend,
      reauthenticate: async (requestId) => {
        await session.authenticate();
        if (requestId) {
          const response = await session.fetch(
            configuration.backend + "/v1/c3/owner/recovery-bind",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ requestId }),
              signal: AbortSignal.timeout(8000),
            },
          );
          const text = await response.text();
          if (
            !response.ok ||
            text.length > 1000 ||
            JSON.parse(text).requestId !== requestId
          )
            throw Error("C3_OWNER_RECOVERY_BINDING");
        }
      },
      // Only explicit prepare opens sign-in; restart/recover never asks a wallet.
      prepare: authenticatedOwnerPreparation(backend, () =>
        session.authenticate(),
      ),
    },
    now: () => Math.floor(Date.now() / 1000),
    save: async (r) =>
      AsyncStorage.setItem("c3-owner/v1:" + wallet, JSON.stringify(r)),
    sign: async (bytes, templates) =>
      requestCandidateMonetarySignature(wallet, bytes, templates),
    signature: (bytes) => {
      // The MWA adapter already verified exact message/templates. Read signature
      // vector directly (one signer): no second wallet or submission callback.
      if (bytes[0] !== 1 || bytes.length > 1232)
        throw Error("C3_OWNER_SIGNATURE_INVALID");
      return base64ToBase58(base64FromUint8Array(bytes.slice(1, 65)));
    },
  });
}
export async function restoreCandidateOwner(
  controller: OwnerController,
  wallet: string,
) {
  const stored = await AsyncStorage.getItem("c3-owner/v1:" + wallet);
  if (stored) await controller.restore(stored);
}
export async function readCandidateOwnerPosition(
  wallet: string,
): Promise<OwnerPosition> {
  const c = requiredOwnerConfiguration(wallet);
  const mint = c.policy.accounts.share_mint;
  if (!mint || mint.length !== 32)
    throw Error("C3_OWNER_RELEASE_CONFIGURATION_MISSING");
  const session = ownerSessions.get(wallet);
  if (!session) throw Error("C3_OWNER_REAUTH_REQUIRED");
  const r = await session.fetch(
    c.backend +
      "/v1/c3/owner/position?intentId=" +
      encodeURIComponent(c.intentId),
    {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    },
  );
  const text = await r.text();
  if (!r.ok || text.length > 2048) throw Error("C3_OWNER_POSITION_UNVERIFIED");
  return parseOwnerPosition(
    JSON.parse(text),
    wallet,
    base64ToBase58(base64FromUint8Array(mint)),
  );
}
