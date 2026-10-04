/** Loopback-only adapter over the SAME production CPI compiler. */
import { Connection } from "@solana/web3.js";
import { JupiterLegCompiler } from "../src/open-jupiter-compiler.ts";
import { JupiterV2ReadOnlyClient } from "../src/jupiter-v2.ts";
export class JupiterOpenBuilder extends JupiterLegCompiler {
  constructor(rpc: Connection, jupiter?: JupiterV2ReadOnlyClient) {
    if (!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(rpc.rpcEndpoint))
      throw Error("C3_OPEN_BUILD_LOCAL_RPC_REQUIRED");
    super(rpc, jupiter);
  }
}
