// Packages site/ as an editable claude.ai artifact: the page body (the host adds the document skeleton),
// the in-page text editor (scripts/site-editor.js) and the files the page references.
// Usage: node scripts/build-site-artifact.mjs [outDir]   (default: artifact-site/)
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'artifact-site';
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'app/samples'), { recursive: true });
cpSync('site/images', join(out, 'images'), { recursive: true });
cpSync('public/icon.svg', join(out, 'app/icon.svg'));
cpSync('public/samples/aloe', join(out, 'app/samples/aloe'), { recursive: true });

const html = readFileSync('site/index.html', 'utf8');
const pick = (re) => (html.match(re) ?? [''])[0];
const editorStyle = `<style id="editor-style">
.editbar { position: fixed; right: max(16px, env(safe-area-inset-right, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  z-index: 50; display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 12px; background: var(--surface);
  border: 1px solid var(--line); box-shadow: var(--shadow); font: 600 14px/1 var(--font); }
.editbar button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface-2); color: var(--text); cursor: pointer; }
.editbar button[data-a="save"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.editbar button:disabled { opacity: .6; cursor: default; }
.editbar-msg { color: var(--muted); font-weight: 500; padding-right: 4px; }
.editbar-msg:empty { display: none; }
body.editing [contenteditable] { outline: 1px dashed color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 3px; border-radius: 3px; cursor: text; }
body.editing [contenteditable]:focus { outline: 2px solid var(--accent); }
</style>`;
const body = html.slice(html.indexOf('<div id="page">'), html.lastIndexOf('</body>')).trim();
// the editor runs before #site-script so it can snapshot the page as authored
const [pageHtml, siteScript] = [body.slice(0, body.indexOf('<script id="site-script">')).trim(), pick(/<script id="site-script">[\s\S]*?<\/script>/)];
const page = [
  pick(/<title>[\s\S]*?<\/title>/),
  '<meta name="claude:viewport-fit-sides" content="cover">',
  pick(/<style id="site-style">[\s\S]*?<\/style>/),
  editorStyle,
  pageHtml,
  `<script id="editor-script">\n${readFileSync('scripts/site-editor.js', 'utf8')}</script>`,
  siteScript,
].join('\n');
writeFileSync(join(out, 'lenticulator-site.html'), page + '\n');

const list = (dir) => readdirSync(join(out, dir), { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? list(join(dir, d.name)) : [join(dir, d.name)]);
console.log(JSON.stringify({ page: join(out, 'lenticulator-site.html'), files: Object.fromEntries(list('').filter((f) => !f.endsWith('.html')).map((f) => [f, f])) }, null, 1));
