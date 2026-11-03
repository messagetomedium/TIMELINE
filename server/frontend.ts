import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".png": "image/png", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8",
};
/** Hash navigation needs only these static roots. Unknown API paths remain JSON 404. */
export async function registerFrontend(app: FastifyInstance, directory: string, mode: "local" | "server" = "server") {
  const root = await realpath(directory);
  if (!(await stat(resolve(root, "index.html"))).isFile()) throw Error("Frontend build is missing");
  async function send(request: FastifyRequest, reply: FastifyReply) {
    let pathname: string;
    try { pathname = decodeURIComponent((request.raw.url ?? "/").split("?")[0] ?? "/"); }
    catch { return reply.code(404).send({ error: "NOT_FOUND" }); }
    if (pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").some((s) => s.startsWith("."))) return reply.code(404).send({ error: "NOT_FOUND" });
    const name = pathname === "/" ? "index.html" : pathname.slice(1);
    const type = types[extname(name)];
    if (!type || (extname(name) === ".html" && name !== "index.html")) return reply.code(404).send({ error: "NOT_FOUND" });
    let file: string;
    try {
      file = await realpath(resolve(root, name));
      if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) return await reply.code(404).send({ error: "NOT_FOUND" });
    } catch { return reply.code(404).send({ error: "NOT_FOUND" }); }
    reply.type(type).header("Cross-Origin-Resource-Policy", "same-origin");
    if (name === "index.html") reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    else if (/-[a-zA-Z0-9_-]{8,}\.(js|css|woff2)$/.test(name)) reply.header("Cache-Control", "public, max-age=31536000, immutable");
    if (name === "index.html") {
      const html = await readFile(file, "utf8");
      if (!html.includes('<meta name="timeline-storage" content="local" />')) throw Error("Frontend mode marker is missing");
      return reply.send(html.replace('<meta name="timeline-storage" content="local" />', `<meta name="timeline-storage" content="${mode}" />`));
    }
    return reply.send(createReadStream(file));
  }
  app.get("/", send);
  app.get("/assets/*", send);
  app.get("/fonts/*", send);
  app.get("/favicon.svg", send);
}
