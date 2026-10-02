/** Pure v0 review shared by isolated MWA tests. No wallet, network, storage or
 * capability override. Owner lifecycle packets require no ALTs or other signer.
 * Expected bytes/metas must come from reviewed policy, NEVER the packet server.
 */
export type OwnerInstructionReview = Readonly<{
  program: Uint8Array;
  accounts: readonly Readonly<{
    key: Uint8Array;
    writable: boolean;
    signer: boolean;
  }>[];
  data: Uint8Array;
}>;
const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const check = (v: unknown) => {
  if (!v) throw Error("C3_OWNER_TRANSACTION_REVIEW_FAILED");
};
export function inspectOwnerTransaction(
  packet: Uint8Array,
  wallet: Uint8Array,
  instructions: readonly OwnerInstructionReview[],
  signed = false,
) {
  packet = new Uint8Array(packet); // Buffer.slice must never preserve an alias.
  check(
    packet.length <= 1232 &&
      packet.length > 100 &&
      wallet.length === 32 &&
      instructions.length >= 1 &&
      instructions.length <= 3,
  );
  let p = 0;
  const byte = () => {
    check(p < packet.length);
    return packet[p++]!;
  };
  const count = () => {
    const first = byte();
    if (first < 128) return first;
    const second = byte();
    check(second > 0 && second < 128);
    return (first & 127) + (second << 7);
  };
  const bytes = (n: number) => {
    check(n >= 0 && p + n <= packet.length);
    const r = packet.slice(p, p + n);
    p += n;
    return r;
  };
  check(count() === 1);
  const signature = bytes(64);
  check(
    signed ? signature.some((v) => v !== 0) : signature.every((v) => v === 0),
  );
  const messageOffset = p;
  check(byte() === 128 && byte() === 1 && byte() === 0);
  const readonly = byte(),
    n = count();
  check(n >= 2 && n <= 64 && readonly < n);
  const keys = Array.from({ length: n }, () => bytes(32));
  check(equal(keys[0]!, wallet));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++) check(!equal(keys[i]!, keys[j]!));
  const blockhash = bytes(32);
  check(blockhash.some((v) => v !== 0));
  check(count() === instructions.length);
  const used = new Set<number>([0]);
  for (const expected of instructions) {
    const program = byte();
    check(
      program < n &&
        equal(keys[program]!, expected.program) &&
        program >= n - readonly,
    );
    used.add(program);
    const indexes = Array.from({ length: count() }, () => byte());
    check(indexes.length === expected.accounts.length);
    for (let i = 0; i < indexes.length; i++) {
      const index = indexes[i]!,
        meta = expected.accounts[i]!;
      check(
        index < n &&
          equal(keys[index]!, meta.key) &&
          meta.signer === (index === 0) &&
          meta.writable === index < n - readonly,
      );
      used.add(index);
    }
    check(equal(bytes(count()), expected.data));
  }
  check(count() === 0 && p === packet.length && used.size === n);
  return Object.freeze({
    message: packet.slice(messageOffset),
    signature,
    blockhash,
    bytes: packet.length,
  });
}
export function freezeOwnerReview(
  packet: Uint8Array,
  owner: Uint8Array,
  instructions: readonly OwnerInstructionReview[],
) {
  const bytes = new Uint8Array(packet),
    wallet = new Uint8Array(owner);
  const templates = instructions.map((i) => ({
    program: new Uint8Array(i.program),
    data: new Uint8Array(i.data),
    accounts: i.accounts.map((a) => ({ ...a, key: new Uint8Array(a.key) })),
  }));
  const review = inspectOwnerTransaction(bytes, wallet, templates);
  return { bytes, wallet, templates, review };
}
