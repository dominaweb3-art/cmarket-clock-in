/** Devnet-only transport pacing. Shared across connections within one server
 * process; durable journals, not this queue, protect economic operations.
 * No retry, re-signing or resubmission (including sendTransaction on HTTP 429). */
import { Connection, type FetchFn } from "@solana/web3.js";
const endpoint = "https://api.devnet.solana.com";
let tail: Promise<void> = Promise.resolve();
let next = 0;
const pacedFetch: FetchFn = async (input, init) => {
  if (String(input) !== endpoint) throw Error("EVAL_RPC_ENDPOINT");
  const turn = tail.then(async () => {
    const delay = Math.max(0, next - performance.now());
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    next = performance.now() + 550;
  });
  tail = turn.catch(() => undefined);
  await turn;
  const result = await fetch(input, init);
  if (result.status === 429) throw Error("EVAL_RPC_RATE_LIMIT");
  return result;
};
export function evaluationRpc() {
  return new Connection(endpoint, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: pacedFetch,
  });
}
