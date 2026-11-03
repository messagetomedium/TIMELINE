import { it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFrontend } from "../frontend";
import { readConfig } from "../config";
import { assertDatabaseTransport, databaseTls } from "../db/settings";

const env = { DATABASE_URL: "postgresql://app@localhost/test", APP_ORIGIN: "https://timeline.example.test", BETTER_AUTH_SECRET: "a-valid-synthetic-test-secret-with-more-than-32-chars", NODE_ENV: "production", MAILER_MODE: "smtp", SMTP_HOST: "localhost", DB_SSL_MODE: "verify-full" };
it("production runtime validates verified TLS, trusted proxy scope and placeholder secrets", () => {
  expect(readConfig(env).TRUST_PROXY).toEqual([]);
  expect(databaseTls(readConfig(env))).toEqual({ rejectUnauthorized: true });
  for (const override of [{ DB_SSL_MODE: "disable" }, { TRUST_PROXY: "true" }, { TRUST_PROXY: "0.0.0.0/0" }, { TRUST_PROXY: "::/0" }, { APP_ORIGIN: "http://localhost" }, { BETTER_AUTH_SECRET: "REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES" }, { DATABASE_URL: "postgresql://app@localhost/test?sslmode=no-verify" }]) expect(() => readConfig({ ...env, ...override })).toThrow("Invalid server settings");
});
it("proxy forwarding is used only from explicitly trusted network addresses", async () => {
  const config = readConfig({ ...env, TRUST_PROXY: "127.0.0.1/32" });
  const app = Fastify({ trustProxy: config.TRUST_PROXY });
  app.get("/", (r) => ({ ip: r.ip }));
  try {
    const forwarded = { "x-forwarded-for": "198.51.100.5" };
    expect((await app.inject({ url: "/", remoteAddress: "192.0.2.1", headers: forwarded })).json<unknown>()).toEqual({ ip: "192.0.2.1" });
    expect((await app.inject({ url: "/", remoteAddress: "127.0.0.1", headers: forwarded })).json<unknown>()).toEqual({ ip: "198.51.100.5" });
  } finally { await app.close(); }
});
it("static frontend uses an explicit allowlist, same-origin policy and blocks files outside dist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "timeline-static-")), root = join(directory, "dist"), app = Fastify();
  try {
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "index.html"), '<!doctype html><meta name="timeline-storage" content="local" /><title>TIMELINE</title>');
    await writeFile(join(root, "assets/app-abcdefgh.js"), "export const value = 1;");
    await writeFile(join(directory, "private.js"), "secret marker");
    await symlink(join(directory, "private.js"), join(root, "assets/leak.js"));
    await registerFrontend(app, root);
    const index = await app.inject("/"); expect(index.statusCode).toBe(200); expect(index.body).toContain('name="timeline-storage" content="server"'); expect(index.headers["content-security-policy"]).toContain("connect-src 'self'");
    const asset = await app.inject("/assets/app-abcdefgh.js"); expect(asset.statusCode).toBe(200); expect(asset.headers["cache-control"]).toContain("immutable");
    for (const path of ["/assets/leak.js", "/assets/%2e%2e/private.js", "/assets/%2e%2e%2fprivate.js", "/assets/file.map", "/api/missing", "/.env"]) expect((await app.inject(path)).statusCode).toBe(404);
    expect((await app.inject({ method: "HEAD", url: "/" })).body).toBe("");
  } finally { await app.close(); await rm(directory, { recursive: true }); }
});

it("production plaintext is allowed only for the explicitly scoped internal Compose service, including operator URLs", () => {
  const internal = { ...env, DB_SSL_MODE: "disable", DB_CONNECTION_SCOPE: "docker-internal", DATABASE_URL: "postgresql://app@postgres:5432/timeline" };
  expect(databaseTls(readConfig(internal))).toBe(false);
  expect(() => { assertDatabaseTransport(internal.DATABASE_URL, readConfig(internal), "production"); }).not.toThrow();
  for (const url of ["postgresql://app@db.example.test/timeline", "postgresql://app@127.0.0.1/timeline", "postgresql://app@10.0.0.1/timeline", "postgresql://app@postgres.evil.test/timeline", "postgresql://app@postgres:5433/timeline", "postgresql://app@postgres:5432/timeline?host=remote.example.test", "postgresql://app@postgres/timeline?port=6432"]) {
    expect(() => readConfig({ ...internal, DATABASE_URL: url })).toThrow("Invalid server settings");
    expect(() => { assertDatabaseTransport(url, readConfig(internal), "production"); }).toThrow("Production database requires");
  }
  expect(() => readConfig({ ...internal, DB_CONNECTION_SCOPE: "remote" })).toThrow();
  expect(() => readConfig({ ...internal, DB_CONNECTION_SCOPE: undefined })).toThrow();
  expect(() => readConfig({ ...env, DB_CONNECTION_SCOPE: "docker-internal", DATABASE_URL: "postgresql://app@db.example.test/timeline" })).not.toThrow();
});
