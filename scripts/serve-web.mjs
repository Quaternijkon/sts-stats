import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist-web/", import.meta.url));
const base = "/sts2stats/";
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon" };
const server = http.createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405); response.end(); return; }
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/") { response.writeHead(302, { Location: base }); response.end(); return; }
  let relative;
  try { relative = decodeURIComponent(url.pathname.slice(base.length)); } catch { response.writeHead(400); response.end(); return; }
  const file = path.resolve(root, relative || "index.html");
  if (!url.pathname.startsWith(base) || !file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
  if (request.method === "HEAD") response.end();
  else fs.createReadStream(file).pipe(response);
});
server.listen(1421, "127.0.0.1", () => console.log("Web production preview: http://127.0.0.1:1421/sts2stats/"));
