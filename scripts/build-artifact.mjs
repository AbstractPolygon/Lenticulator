// Packages dist/ as a claude.ai artifact page: body-only HTML (the host adds the
// document skeleton) plus the asset files it references.
// Usage: npm run build && node scripts/build-artifact.mjs [outDir]   (default: artifact/)
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'artifact';
rmSync(join(out, 'assets'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('dist/assets', join(out, 'assets'), { recursive: true });
cpSync('dist/icon.svg', join(out, 'icon.svg'));

const html = readFileSync('dist/index.html', 'utf8');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
  .replace(/<meta[\s\S]*?>\s*/g, '') // charset/viewport come from the host; drop our CSP (the host sets its own)
  .replace(/<title>[\s\S]*?<\/title>\s*/, '')
  .replace(/<link rel="icon"[^>]*>\s*/, '')
  .trim();
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim();
writeFileSync(join(out, 'lenticulator.html'), `<title>Lenticulator</title>\n${head}\n${body}\n`);

const files = Object.fromEntries(
  ['icon.svg', ...readdirSync(join(out, 'assets')).map((f) => `assets/${f}`)].map((f) => [f, f]),
);
console.log(JSON.stringify({ page: join(out, 'lenticulator.html'), root: out, files }, null, 2));
