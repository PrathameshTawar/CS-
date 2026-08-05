/**
 * Minimal static server for the built demo (dist-demo/). Serves on port 8099.
 * Used by the browser-based visual verification loop. Safe to delete.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = join(process.cwd(), 'dist-demo');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (path === '' || path === 'index.html') path = 'index.html';
    if (path === 'favicon.ico') {
      // Browsers auto-request a favicon; 204 keeps the console clean.
      res.writeHead(204);
      return res.end();
    }
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) throw new Error('forbidden');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(8099, () => console.log('demo server on http://localhost:8099'));
