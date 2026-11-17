import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const copies = Object.keys(lock.packages).filter(directory => directory.endsWith('node_modules/picomatch'));

test('the maintained mitigation covers every installed picomatch copy', () => {
  assert.ok(copies.length > 0);
  for (const directory of copies) {
    assert.match(readFileSync(path.join(directory, 'lib/parse.js'), 'utf8'), /CDEK mitigation: GHSA-fc5q-39xc-vjpf/);
  }
});

for (const directory of copies) {
  test(directory + ' rejects known single-branch ReDoS patterns within a bounded time', () => {
    const program = 'const p=require(' + JSON.stringify(path.resolve(directory)) + ');' +
      'for(const pattern of ["+(*)b","+(*a)b","*(*)b","*(*a)b"])' +
      'for(const options of [{},{maxExtglobRecursion:false}])' +
      'if(p(pattern,options)("a".repeat(45)+"!"))throw Error("Unexpected match");';
    execFileSync(process.execPath, ['-e', program], { timeout: 2500, windowsHide: true, stdio: 'pipe' });
  });

  test(directory + ' preserves ordinary application globs and literal repeated groups', () => {
    const picomatch = require(path.resolve(directory));
    assert.ok(picomatch('**/*.{js,ts,tsx}')('app/api/chat/route.ts'));
    assert.ok(!picomatch('**/*.ts')('app/site.css'));
    assert.ok(picomatch('+(abc)')('abcabc'));
    assert.ok(picomatch('file-@(one|two).js')('file-two.js'));
    assert.ok(picomatch('!(*.test).ts')('route.ts'));
    assert.ok(!picomatch('!(*.test).ts')('route.test.ts'));
  });
}
