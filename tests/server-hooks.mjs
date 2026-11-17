import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Exercise actual route modules and SQLite; only the hosting/request bindings
// are supplied by the test harness instead of Cloudflare or a Next server.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers' || specifier === 'next/headers') {
    return { url: new URL('./server-fixture.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier === 'next/navigation') return nextResolve('next/navigation.js', context);
  try { return await nextResolve(specifier, context); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || !context.parentURL) throw error;
    for (const extension of ['.ts', '.mts']) {
      const url = new URL(specifier + extension, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && /\.(?:ts|mts)$/.test(url)) {
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      fileName: fileURLToPath(url),
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
    }).outputText };
  }
  return nextLoad(url, context);
}
