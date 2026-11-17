import { execFileSync, spawnSync } from 'node:child_process';

if (!process.env.npm_execpath) throw new Error('Run npm run audit:dependencies');
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], {
  encoding: 'utf8', timeout: 90_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0 && result.status !== 1) throw new Error('npm audit failed to run');
const audit = JSON.parse(result.stdout);
if (audit.error || !audit.metadata || !audit.vulnerabilities) throw new Error('Incomplete npm audit response');

const advisories = new Map();
for (const vulnerability of Object.values(audit.vulnerabilities)) {
  for (const entry of vulnerability.via) {
    if (typeof entry !== 'string') advisories.set(entry.url, entry);
  }
}
// This is an explicit, verified mitigation, not a severity threshold or a
// wildcard allowlist. A newly reported advisory makes this command fail.
const mitigated = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
for (const [url, entry] of advisories) {
  if (url !== mitigated || entry.name !== 'picomatch') {
    console.error('Unmitigated dependency advisory:', entry.name, url);
    process.exitCode = 1;
  }
}
if (!process.exitCode) {
  execFileSync(process.execPath, ['scripts/patch-dependencies.mjs', '--check'], { stdio: 'inherit', windowsHide: true });
  execFileSync(process.execPath, ['--test', 'tests/dependency-security.test.mjs'], { stdio: 'inherit', windowsHide: true });
  console.log('Unmitigated published advisories: 0. Upstream advisory records remain: ' + audit.metadata.vulnerabilities.total + '.');
}
