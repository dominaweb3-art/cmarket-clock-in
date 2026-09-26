// Deliberately credential-free child process. It never opens PostgreSQL.
import process from 'node:process';
import { buildUnsigned } from './builder.mjs';

try {
  let input = '';
  let size = 0;
  for await (const chunk of process.stdin) {
    size += Buffer.byteLength(chunk);
    if (size > 4_096) throw new Error('oversized');
    input += chunk;
  }
  const context = JSON.parse(input);
  if (!context || typeof context !== 'object' || Array.isArray(context) ||
    Object.keys(context).sort().join(',') !==
      'amountBaseUnits,cluster,expiresAt,operation,positionVerified,rpcUrl,shareMint,usdcMint,vault,wallet')
    throw new Error('invalid context');
  const result = await buildUnsigned(context);
  const output = JSON.stringify(result);
  if (Buffer.byteLength(output) > 48_000) throw new Error('oversized output');
  process.stdout.write(output + '\n');
} catch {
  process.exitCode = 2;
}
