import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The editable sources stay split by responsibility; delivery is one offline HTML.
const directory = new URL('./', import.meta.url);
const targetFilename = process.argv[2] || 'proto-08-mobile-gemini.html';
const destination = new URL(`../${targetFilename}`, import.meta.url);
let html = await readFile(new URL('index.html', directory), 'utf8');
const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)];
for (const [tag, filename] of styles) {
  if (!filename) throw new Error('Missing prototype stylesheet name');
  const content = await readFile(new URL(filename, directory), 'utf8');
  html = html.replace(tag, `<style>\n/* ${filename} */\n${content}\n</style>`);
}
const scripts = [...html.matchAll(/<script src="([^"]+)" defer><\/script>/g)];
const inlineScripts = [];
for (const [tag, filename] of scripts) {
  if (!filename) throw new Error('Missing prototype script name');
  const content = await readFile(new URL(filename, directory), 'utf8');
  inlineScripts.push(`<script>\n/* ${filename} */\n${content}\n</script>`);
  html = html.replace(tag, '');
}
html = html.replace('</body>', `${inlineScripts.join('\n')}\n</body>`);
const lines = html.split('\n').length;
if (lines > 1000) throw new Error(`Prototype exceeds the 1000-line limit: ${lines}`);
await writeFile(destination, html);
console.log(`Created ${fileURLToPath(destination)} (${lines} lines)`);
