import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const expected = {
  '@symmetry-hq/sdk': '1.0.22',
  '@solana/web3.js': '1.98.4',
  pg: '8.23.0',
};
for (const [name, version] of Object.entries(expected)) {
  const entry = lock.packages[`node_modules/${name}`];
  assert.equal(entry?.version, version, `${name} lock version mismatch`);
  assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//);
  assert.equal(require(`${name}/package.json`).version, version, `${name} installed version mismatch`);
}
assert.equal(lock.packages['node_modules/@symmetry-hq/sdk'].integrity,
  'sha512-yopoVu6VnFiktGsjgeJ2dbFX8pdciePK7BUFNbUYb5wAto6DQqVq6a51qE33dRT6BRkL/ANBpKZEJgqpJX+KMA==');
console.log('SDK_VERSION_PINNED: true');
console.log('SDK_INTEGRITY_VERIFIED: true (npm lock digest and installed package version; npm ci enforces archive digest)');
