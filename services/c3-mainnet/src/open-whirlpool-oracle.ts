/** Official Orca Oracle account layout: state/oracle.rs, LEN254, discriminator
 * 8bc283b38cb3e5f4. This is an adaptive-fee account, NOT a C3 USD price oracle.
 * https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/state/oracle.rs */
import { PublicKey } from "@solana/web3.js";
const WHIRL = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
export function verifyWhirlpoolOracle(
  address: PublicKey,
  pool: PublicKey,
  owner: PublicKey,
  data: Buffer,
  executable: boolean,
) {
  const expected = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), pool.toBuffer()],
    WHIRL,
  )[0];
  if (!expected.equals(address) || executable)
    throw Error("C3_WHIRLPOOL_ORACLE_UNVERIFIED_PDA");
  // Official OracleAccessor explicitly supports the uninitialized exact PDA:
  // System owner and empty data. Never accept an arbitrary readonly account.
  if (owner.equals(PublicKey.default) && data.length === 0) return;
  if (!owner.equals(WHIRL)) throw Error("C3_WHIRLPOOL_ORACLE_UNVERIFIED_OWNER");
  if (
    data.length !== 254 ||
    !data.subarray(0, 8).equals(Buffer.from("8bc283b38cb3e5f4", "hex")) ||
    !data.subarray(8, 40).equals(pool.toBuffer())
  )
    throw Error("C3_WHIRLPOOL_ORACLE_UNVERIFIED_LAYOUT");
}
