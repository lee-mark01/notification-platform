// Minimal static server for the demo. Push needs a secure context, which
// browsers grant to http://localhost. Run: npm run demo:serve
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const root = import.meta.dirname;
const port = Number(process.env.DEMO_PORT ?? 8080);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  // Serve only files inside this directory, and never the server scripts.
  if (!file.startsWith(root + sep) || !(extname(file) in types)) {
    res.writeHead(404).end();
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': types[extname(file)],
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`Web push demo at http://localhost:${port}`);
});
