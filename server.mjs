/* Zero-dependency static server for the Luqmat Al Malek site.
   The site is hand-written HTML/CSS/JS with no build step, so there is nothing
   to bundle — this only needs to serve files with correct types and support
   HTTP range requests, which the hero <video> depends on.

   node server.mjs --port 3003 */

import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));

const argIndex = process.argv.indexOf('--port');
const PORT = Number(argIndex >= 0 ? process.argv[argIndex + 1] : process.env.PORT || 3003);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function resolveTarget(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let target = join(ROOT, clean);
  if (!target.startsWith(ROOT)) return null;            // no traversal out of ROOT
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
  return existsSync(target) ? target : null;
}

createServer((req, res) => {
  const target = resolveTarget(req.url || '/');
  if (!target) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const type = TYPES[extname(target).toLowerCase()] || 'application/octet-stream';
  const size = statSync(target).size;

  // Range support — Safari and mobile Chrome will not play the hero video without it.
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : size - 1;
      if (start < size && end < size && start <= end) {
        res.writeHead(206, {
          'content-type': type,
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes',
          'content-length': end - start + 1,
        });
        createReadStream(target, { start, end }).pipe(res);
        return;
      }
    }
  }

  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(target).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Luqmat Al Malek — serving ${ROOT} on http://127.0.0.1:${PORT}`);
});
