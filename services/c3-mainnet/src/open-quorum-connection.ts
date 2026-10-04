/** web3 read-only adapter over the SAME reviewed, independent RPC quorum.
 * Compiler/reconciler cannot substitute a caller endpoint or broadcast. */
import { Connection } from "@solana/web3.js";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { readIndependentOpenEvidence } from "./open-rpc-quorum.ts";
export function productionQuorumConnection(
  fetcher: typeof fetch = fetch,
): Connection {
  const p = requireOpenProductionPolicy();
  return new Connection(p.providers[0]!.endpoint, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: async (_input, init) => {
      if (typeof init?.body !== "string")
        throw Error("C3_OPEN_READ_ONLY_TRANSPORT");
      const request = JSON.parse(init.body) as {
        id: number;
        method: string;
        params: unknown[];
      };
      const evidence = (await readIndependentOpenEvidence(
        p.providers,
        request.method,
        request.params,
        fetcher,
      )) as { primary: unknown };
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: evidence.primary,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
}
