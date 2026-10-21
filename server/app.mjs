import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { tokenHash, transaction } from "./database.mjs";

const derive = promisify(scrypt);
const lifetime = 30 * 86400000;
const cookieName = "sts2stats_session";
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export async function passwordHash(password, salt = randomBytes(24).toString("hex")) {
  const value = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${value.toString("hex")}`;
}
async function passwordMatches(password, stored) {
  const hash = await passwordHash(password, stored.split(":")[0]);
  return timingSafeEqual(Buffer.from(hash), Buffer.from(stored));
}
function checkPassword(value) {
  if (typeof value !== "string" || value.length < 12 || Buffer.byteLength(value) > 1024) throw new ApiError(400, "密码须为 12–256 个字符，且不超过 1024 字节");
  if (value.length > 256) throw new ApiError(400, "密码过长");
  return value;
}
async function body(request, limit) {
  if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")) throw new ApiError(415, "仅接受 JSON");
  if (Number(request.headers["content-length"]) > limit) throw new ApiError(413, "同步数据超过服务器单次容量限制");
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new ApiError(413, "同步数据超过服务器单次容量限制");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    return value;
  } catch { throw new ApiError(400, "JSON 格式无效"); }
}
function send(response, status, value, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(value));
}
export function createServer({ db, webRoot, origin, secureCookies = true, trustProxy = false, maxPayloadBytes = 256 * 1024 * 1024 }) {
  const dummy = passwordHash("dummy-password-for-timing");
  let authInFlight = 0;
  function rateLimit(key, max, milliseconds) {
    const now = Date.now();
    db.prepare("DELETE FROM attempts WHERE expires < ?").run(now);
    const current = db.prepare("SELECT count FROM attempts WHERE key=?").get(key);
    if ((current?.count ?? 0) >= max) throw new ApiError(429, "尝试过于频繁，请稍后再试");
    if (!current && db.prepare("SELECT count(*) AS n FROM attempts").get().n >= 20000) throw new ApiError(429, "服务器繁忙，请稍后再试");
    db.prepare("INSERT INTO attempts(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1").run(key, now + milliseconds);
  }
  function session(request) {
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "")?.[1];
    const cookie = (request.headers.cookie ?? "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const token = bearer ?? cookie;
    if (!token) return null;
    return db.prepare("SELECT users.id,username,sessions.hash FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND expires>?").get(tokenHash(token), Date.now()) ?? null;
  }
  function requireUser(request) {
    const user = session(request);
    if (!user) throw new ApiError(401, "请登录账户");
    return user;
  }
  function startSession(request, response, user) {
    const token = randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    // A bounded number of active devices; the oldest session expires first.
    db.prepare("DELETE FROM sessions WHERE user_id=? AND hash IN (SELECT hash FROM sessions WHERE user_id=? ORDER BY expires DESC LIMIT -1 OFFSET 19)").run(user.id, user.id);
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(tokenHash(token), user.id, Date.now() + lifetime);
    const native = request.headers["x-sts-client"] === "desktop" && !request.headers.origin;
    send(response, 200, { user: { id: user.id, username: user.username }, ...(native ? { token } : {}) }, native ? {} : {
      "Set-Cookie": `${cookieName}=${token}; Path=/api/v1/; HttpOnly; SameSite=Strict; Max-Age=${lifetime / 1000}${secureCookies ? "; Secure" : ""}`,
    });
  }
  return http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    try {
      const url = new URL(request.url, origin);
      const api = url.pathname.startsWith("/api/");
      if (!api) {
        if (!["GET", "HEAD"].includes(request.method)) throw new ApiError(405, "不支持的请求");
        let relative;
        try { relative = decodeURIComponent(url.pathname); } catch { throw new ApiError(400, "无效路径"); }
        if (relative.split("/").some((part) => part.startsWith("."))) throw new ApiError(404, "未找到");
        const file = path.resolve(webRoot, `.${relative.endsWith("/") ? relative + "index.html" : relative}`);
        if (!file.startsWith(path.resolve(webRoot) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ApiError(404, "未找到");
        response.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": /\/assets\//.test(relative) ? "public, max-age=31536000, immutable" : "no-cache" });
        if (request.method === "HEAD") response.end(); else fs.createReadStream(file).on("error", () => response.destroy()).pipe(response);
        return;
      }
      if (request.headers.origin && request.headers.origin !== origin) throw new ApiError(403, "请求来源不允许");
      if (request.headers["sec-fetch-site"] === "cross-site") throw new ApiError(403, "跨站请求不允许");
      const route = url.pathname.slice("/api/v1".length);
      const method = request.method;
      if (method === "GET" && route === "/health") { send(response, 200, { ok: true, protocol: 1 }); return; }
      const ip = trustProxy ? request.headers["x-real-ip"] ?? request.socket.remoteAddress : request.socket.remoteAddress;
      if (method === "POST" && ["/auth/register", "/auth/login"].includes(route)) {
        rateLimit(`auth:${tokenHash(String(ip))}`, 30, 15 * 60000);
        const value = await body(request, 16384);
        const username = typeof value.username === "string" ? value.username.trim().toLowerCase() : "";
        if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) throw new ApiError(400, "用户名须为 3–32 位英文字母、数字、下划线或短横线");
        const password = checkPassword(value.password);
        rateLimit(`user:${tokenHash(username)}`, 20, 15 * 60000);
        if (authInFlight >= 4) throw new ApiError(429, "服务器繁忙，请稍后再试");
        authInFlight++;
        try {
          if (route === "/auth/register") {
            const invite = tokenHash(typeof value.invite === "string" ? value.invite.trim() : "");
            const valid = db.prepare("SELECT hash FROM invites WHERE hash=? AND used=0 AND expires>?").get(invite, Date.now());
            if (!valid) throw new ApiError(403, "邀请码无效、已使用或已过期");
            const hash = await passwordHash(password);
            const user = { id: randomUUID(), username };
            transaction(db, () => {
              if (!db.prepare("UPDATE invites SET used=1 WHERE hash=? AND used=0 AND expires>?").run(invite, Date.now()).changes) throw new ApiError(403, "邀请码已使用或已过期");
              if (db.prepare("SELECT id FROM users WHERE username=?").get(username)) throw new ApiError(409, "用户名已被使用");
              db.prepare("INSERT INTO users VALUES (?,?,?,?)").run(user.id, username, hash, Date.now());
            });
            startSession(request, response, user);
          } else {
            const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
            if (!await passwordMatches(password, user?.password ?? await dummy) || !user) throw new ApiError(401, "用户名或密码不正确");
            if (db.prepare("SELECT password FROM users WHERE id=?").get(user.id)?.password !== user.password) throw new ApiError(401, "账户密码已更改，请重新登录");
            startSession(request, response, user);
          }
        } finally { authInFlight--; }
        return;
      }
      const user = requireUser(request);
      if (request.headers["x-sts-account"] && request.headers["x-sts-account"] !== user.id) throw new ApiError(409, "当前登录账户已在其他窗口更改，请刷新后重新登录");
      if (method === "GET" && route === "/auth/session") { send(response, 200, { user: { id: user.id, username: user.username } }); return; }
      if (method === "POST" && route === "/auth/logout") {
        db.prepare("DELETE FROM sessions WHERE hash=?").run(user.hash);
        send(response, 200, { ok: true }, { "Set-Cookie": `${cookieName}=; Path=/api/v1/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookies ? "; Secure" : ""}` }); return;
      }
      if (method === "POST" && ["/auth/password", "/auth/delete"].includes(route)) {
        rateLimit(`sensitive:${user.id}`, 5, 15 * 60000);
        const value = await body(request, 16384);
        const current = db.prepare("SELECT password FROM users WHERE id=?").get(user.id);
        if (!current || !await passwordMatches(checkPassword(value.password), current.password)) throw new ApiError(401, "当前密码不正确");
        if (route === "/auth/delete") {
          if (!db.prepare("DELETE FROM users WHERE id=? AND password=?").run(user.id, current.password).changes) throw new ApiError(409, "账户已更新，请重新操作");
          send(response, 200, { ok: true }, { "Set-Cookie": `${cookieName}=; Path=/api/v1/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookies ? "; Secure" : ""}` });
        } else {
          const hash = await passwordHash(checkPassword(value.newPassword));
          transaction(db, () => {
            if (!db.prepare("UPDATE users SET password=? WHERE id=? AND password=?").run(hash, user.id, current.password).changes) throw new ApiError(409, "账户已更新，请重新操作");
            db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
          });
          startSession(request, response, user);
        }
        return;
      }
      if (method === "GET" && route === "/vaults") {
        send(response, 200, { vaults: db.prepare("SELECT game,revision,updated,fingerprint FROM vaults WHERE user_id=?").all(user.id) }); return;
      }
      const game = /^\/vaults\/(sts1|sts2)$/.exec(route)?.[1];
      if (game && method === "GET") {
        const vault = db.prepare("SELECT revision,updated,fingerprint,payload FROM vaults WHERE user_id=? AND game=?").get(user.id, game);
        if (!vault) throw new ApiError(404, "云端尚无此游戏数据");
        send(response, 200, vault); return;
      }
      if (game && method === "PUT") {
        rateLimit(`write:${user.id}`, 120, 60000);
        const value = await body(request, maxPayloadBytes);
        if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !/^[a-f0-9]{64}$/.test(value.fingerprint) || typeof value.payload !== "string") throw new ApiError(400, "同步格式无效");
        let payload;
        try { payload = JSON.parse(value.payload); } catch { throw new ApiError(400, "同步数据格式无效"); }
        if (payload?.schema !== 1 || payload.game !== game || !Array.isArray(payload.dataset?.runs) || !Array.isArray(payload.favorites)) throw new ApiError(400, "同步数据格式无效");
        const updated = Date.now();
        transaction(db, () => {
          const previous = db.prepare("SELECT revision FROM vaults WHERE user_id=? AND game=?").get(user.id, game);
          if ((previous?.revision ?? 0) !== value.revision) throw new ApiError(409, "云端已由其他设备更新，请重新同步");
          db.prepare("INSERT INTO vaults VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,game) DO UPDATE SET revision=excluded.revision,updated=excluded.updated,fingerprint=excluded.fingerprint,payload=excluded.payload").run(user.id, game, value.revision + 1, updated, value.fingerprint, value.payload);
        });
        send(response, 200, { revision: value.revision + 1, updated, fingerprint: value.fingerprint }); return;
      }
      throw new ApiError(404, "未找到");
    } catch (error) {
      if (!response.headersSent) send(response, error instanceof ApiError ? error.status : 500, { error: error instanceof ApiError ? error.message : "服务器暂时无法处理请求" });
      else response.destroy();
    }
  });
}
