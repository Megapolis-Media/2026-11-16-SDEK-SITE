import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const checksums = {
  '2.3.2': '3a91656f440069aa8f8e15c9d695b9f6b2209df1eab2be8127c72cbcca45ff5f',
  '4.0.7': '4e1e05447668aa1e94366c5516a2bcd8f5fff800cc92b1d0cd7d77703b8618c4',
};
const anchor = 'const analyzeRepeatedExtglob = (body, options) => {\n';
const mitigation = [
  '  // CDEK mitigation: GHSA-fc5q-39xc-vjpf; remove when upstream ships a fix.',
  '  // Reuse the parser\'s existing literal fallback for ambiguous repetition.',
  '  const singleBranch = splitTopLevel(body);',
  '  if (singleBranch.length === 1) {',
  '    for (let at = 0; at < singleBranch[0].length; at++) {',
  "      if (singleBranch[0][at] === '\\\\') { at++; continue; }",
  "      if (singleBranch[0][at] === '*' || singleBranch[0][at] === '?') return { risky: true };",
  '    }',
  '  }',
  '',
].join('\n');

// No dependency versions or advisory metadata are altered. npm audit continues
// to report the upstream advisory; regression tests verify our local mitigation.
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
let count = 0;
for (const [directory, entry] of Object.entries(lock.packages)) {
  if (!directory.endsWith('node_modules/picomatch')) continue;
  if (!existsSync(path.join(root, directory, 'package.json'))) continue;
  const filename = path.join(root, directory, 'lib/parse.js');
  const source = readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
  const original = source.replace(mitigation, '');
  const checksum = createHash('sha256').update(original).digest('hex');
  if (checksum !== checksums[entry.version] || original.split(anchor).length !== 2) {
    throw new Error('Review the picomatch security mitigation for version ' + entry.version);
  }
  if (source === original) {
    if (process.argv.includes('--check')) throw new Error('Missing picomatch security mitigation: ' + directory);
    writeFileSync(filename, original.replace(anchor, anchor + mitigation));
  }
  count++;
}
console.log('Verified picomatch security mitigation in ' + count + ' installed copies.');
