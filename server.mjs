import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json' };
const files = new Set(['index.html', 'style.css', 'app.js', 'search.js', 'geo.js', 'data/gebieden.json']);
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(path) || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
  try {
    const content = await readFile(new URL(`./web/${path}`, import.meta.url));
    res.writeHead(200, { 'Content-Type': `${types[path.split('.').pop()]}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(500).end('Kan bestand niet lezen.'); }
}).listen(Number(process.env.PORT) || 4174, '127.0.0.1', function () { console.log(`Demo: http://127.0.0.1:${this.address().port}`); });
