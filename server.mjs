import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', ico: 'image/x-icon' };
const files = new Set(['index.html', 'style.css', 'app.js', 'search.js', 'geo.js', 'data/gebieden.json', '404.html', 'kaart-404.webp', 'favicon.svg', 'favicon.ico', ...[32, 180, 512].map(size => `favicon-${size}.png`)]);
// Dezelfde headers als online (web/_headers, blok "/*"), zodat CSP-fouten ook lokaal zichtbaar zijn.
const headers = Object.fromEntries((await readFile(new URL('./web/_headers', import.meta.url), 'utf-8')).split('\n').filter(line => /^\s+[\w-]+:/.test(line)).map(line => { const [key, ...rest] = line.trim().split(':'); return [key, rest.join(':').trim()]; }));
const read = name => readFile(new URL(`./web/${name}`, import.meta.url));
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  const found = files.has(path);
  try {
    // Onbekend pad: 404.html als die er is, anders een korte tekst.
    const name = found ? path : '404.html';
    const content = await read(name).catch(() => (found ? Promise.reject() : Buffer.from('Pagina niet gevonden.')));
    const type = name === '404.html' && !content.includes('<html') ? 'text/plain' : types[name.split('.').pop()];
    res.writeHead(found ? 200 : 404, { ...headers, 'Content-Type': `${type}${type.startsWith('image/') ? '' : '; charset=utf-8'}`, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(500).end('Kan bestand niet lezen.'); }
}).listen(Number(process.env.PORT) || 4174, '127.0.0.1', function () { console.log(`Demo: http://127.0.0.1:${this.address().port}`); });
