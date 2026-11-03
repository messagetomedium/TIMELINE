import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const image = process.env.TIMELINE_TEST_IMAGE;
test("release image: verified TLS, non-root API/static, operator commands, backup/restore and shutdown", { timeout: 360_000 }, async () => {
  assert(image, "Build the image and set TIMELINE_TEST_IMAGE before running this test");
  const dockerEnv = { ...process.env };
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete dockerEnv[key];
  let phase = "initialization";
  const advance = (value) => { phase = value; process.stdout.write(`package: ${value}\n`); };
  function docker(args, input, expected = 0) {
    const result = spawnSync("docker", ["--host=unix:///var/run/docker.sock", ...args], { env: dockerEnv, encoding: "utf8", input, maxBuffer: 4 * 1024 * 1024, timeout: 60_000 });
    // Never reflect CLI arguments, stdout or stderr: they can contain fixture credentials.
    assert.equal(result.status, expected, `Docker ${args[0]} failed during ${phase}: ${result.stderr?.match(/\b(?:ERR_[A-Z_]+|[A-Z_]*SELF_SIGNED_CERT[A-Z_]*|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ENOENT|DRIVER_ERROR|TLS_DISABLED|CONNECTION_TIMEOUT|AUTH_REJECTED)\b/)?.[0] ?? "see phase"}`);
    return result.stdout.trim();
  }
  const suffix = randomBytes(6).toString("hex"), network = `timeline-test-${suffix}`, db = `${network}-db`, app = `${network}-app`, volume = `${network}-backup`;
  const folder = await mkdtemp(join(tmpdir(), "timeline-package-"));
  await chmod(folder, 0o755);
  const adminPassword = randomBytes(24).toString("hex"), appPassword = randomBytes(24).toString("hex"), secret = randomBytes(48).toString("base64url"), password = randomBytes(20).toString("hex");
  const source = `postgresql://postgres:${adminPassword}@timeline-db:5432/timeline_package_test`;
  const runtime = `postgresql://timeline_app:${appPassword}@timeline-db:5432/timeline_package_test`;
  const restore = `postgresql://postgres:${adminPassword}@timeline-db:5432/timeline_package_restore_test`;
  const cert = join(folder, "db.crt"), key = join(folder, "db.key");
  const openssl = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=timeline-db", "-addext", "subjectAltName=DNS:timeline-db", "-keyout", key, "-out", cert], { stdio: "ignore" });
  assert.equal(openssl.status, 0, "TLS fixture certificate generation failed");
  await chmod(cert, 0o644);
  const envFile = async (name, values) => {
    const file = join(folder, name);
    await writeFile(file, Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n"), { mode: 0o600 });
    return file;
  };
  const pgFile = await envFile("postgres.env", { POSTGRES_PASSWORD: adminPassword, POSTGRES_DB: "timeline_package_test" });
  const operator = await envFile("operator.env", { NODE_ENV: "production", DB_SSL_MODE: "verify-full", DB_SSL_CA_FILE: "/run/db-ca.pem", MIGRATION_DATABASE_URL: source, RESTORE_DATABASE_URL: restore, BACKUP_FILE: "/backups/timeline.dump", BOOTSTRAP_OWNER_EMAIL: "owner@example.test" });
  const runtimeFile = await envFile("runtime.env", { NODE_ENV: "production", DB_SSL_MODE: "verify-full", DB_SSL_CA_FILE: "/run/db-ca.pem", DATABASE_URL: runtime, APP_ORIGIN: "https://timeline.test", BETTER_AUTH_SECRET: secret, MAILER_MODE: "smtp", SMTP_HOST: "127.0.0.1", MAIL_FROM: "fixture@example.test", TEST_PASSWORD: password });
  const caMount = ["--mount", `type=bind,src=${cert},dst=/run/db-ca.pem,readonly`];
  const mount = [...caMount, "--mount", `type=volume,src=${volume},dst=/backups`];
  const run = ["run", "--rm", "--name", `${network}-oneshot`, "--network", network, "--read-only", "--tmpfs", "/tmp", ...mount];
  const sql = (text) => docker(["exec", "-i", db, "psql", "-X", "-U", "postgres", "-d", "timeline_package_test", "-v", "ON_ERROR_STOP=1", "-At"], text);
  const cli = (command, expected = 0, extra = []) => docker([...run, "--env-file", operator, ...extra, image, "node", "build/server/cli.js", command], undefined, expected);
  try {
    advance("test PostgreSQL");
    docker(["network", "create", network]); docker(["volume", "create", volume]);
    docker(["run", "-d", "--name", db, "--network", network, "--network-alias", "timeline-db", "--env-file", pgFile, "postgres:17"]);
    let ready = false;
    for (let i = 0; i < 80; i++) {
      const result = spawnSync("docker", ["--host=unix:///var/run/docker.sock", "exec", db, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { env: dockerEnv, stdio: "ignore" });
      if (result.status === 0) { ready = true; break; } await delay(250);
    }
    assert(ready, "PostgreSQL fixture did not start");
    docker(["cp", cert, `${db}:/var/lib/postgresql/data/server.crt`]); docker(["cp", key, `${db}:/var/lib/postgresql/data/server.key`]);
    docker(["exec", "-u", "0", db, "chown", "postgres:postgres", "/var/lib/postgresql/data/server.key", "/var/lib/postgresql/data/server.crt"]);
    docker(["exec", "-u", "0", db, "chmod", "600", "/var/lib/postgresql/data/server.key"]);
    advance("enabling fixture TLS");
    sql("ALTER SYSTEM SET ssl = 'on';\nSELECT pg_reload_conf();\n");
    await delay(500);
    assert.equal(sql("show ssl"), "on", "PostgreSQL fixture TLS was not enabled");
    sql(`CREATE ROLE timeline_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;\nCREATE DATABASE timeline_package_restore_test;\n`);
    docker([...run, "--user", "0", image, "node", "-e", "require('fs').chownSync('/backups',1000,1000)"]);
    advance("direct verified PostgreSQL connection");
    docker([...run, "--env-file", operator, image, "node", "--input-type=module", "-e", "import {Pool} from 'pg'; import fs from 'node:fs'; const p=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL,connectionTimeoutMillis:5000,ssl:{ca:fs.readFileSync(process.env.DB_SSL_CA_FILE,'utf8'),rejectUnauthorized:true}}); try{await p.query('select 1')}catch(e){console.error(e.code??(/does not support SSL/.test(e.message)?'TLS_DISABLED':/timeout|terminated/.test(e.message)?'CONNECTION_TIMEOUT':/password|authentication/.test(e.message)?'AUTH_REJECTED':'DRIVER_ERROR'));process.exitCode=1}finally{await p.end()}"]);
    advance("pending schema and verified TLS");
    cli("status", 1);
    docker([...run, "--env-file", runtimeFile, image], undefined, 1);
    advance("migration and least privilege");
    cli("migrate"); cli("migrate"); cli("status");
    cli("status", 1, ["-e", "DB_SSL_CA_FILE=/etc/ssl/certs/ca-certificates.crt"]);
    cli("status", 1, ["-e", "MIGRATION_DATABASE_URL=" + source.replace("timeline-db", db)]); // Hostname mismatch.
    sql("REVOKE CREATE ON SCHEMA public FROM PUBLIC;\nGRANT USAGE ON SCHEMA public,drizzle TO timeline_app;\nGRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO timeline_app;\nGRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO timeline_app;\n");
    const userId = randomUUID(), accountId = randomUUID();
    const hashed = docker([...run, "--env-file", runtimeFile, image, "node", "--input-type=module", "-e", "import { hashPassword } from 'better-auth/crypto'; process.stdout.write(await hashPassword(process.env.TEST_PASSWORD))"]);
    assert(/^[a-f0-9:]+$/i.test(hashed), "Unexpected Better Auth hash format");
    sql(`INSERT INTO auth_users(id,name,email,email_verified) VALUES('${userId}','Fixture owner','owner@example.test',true);\nINSERT INTO auth_accounts(id,user_id,account_id,provider_id,password) VALUES('${accountId}','${userId}','${userId}','credential','${hashed}');\n`);
    cli("bootstrap"); cli("bootstrap");
    advance("production runtime");
    docker([...run, "--env-file", runtimeFile, "-e", `DATABASE_URL=${source}`, image], undefined, 1);
    docker(["run", "-d", "--name", app, "--network", network, "--read-only", "--tmpfs", "/tmp", ...caMount, "--env-file", runtimeFile, "-p", "127.0.0.1::8080", image]);
    const port = JSON.parse(docker(["inspect", "--format", "{{json .NetworkSettings.Ports}}", app]))["8080/tcp"][0].HostPort;
    const base = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${base}/health/ready`)).status === 200) { healthy = true; break; } } catch { /* Startup. */ }
      await delay(250);
    }
    assert(healthy, "Packaged runtime did not become ready");
    assert.equal(docker(["exec", app, "id", "-u"]), "1000");
    const index = await fetch(base); assert.equal(index.status, 200); assert.match(index.headers.get("content-security-policy"), /connect-src 'self'/);
    const html = await index.text(), asset = /src="\.\/([^\"]+\.js)"/.exec(html)?.[1]; assert(asset, "Compiled frontend is missing");
    const js = await fetch(`${base}/${asset}`); assert.equal(js.status, 200); const bundle = await js.text();
    for (const value of [secret, adminPassword, appPassword, password]) assert(!bundle.includes(value), "Secret found in frontend bundle");
    for (const path of ["/api/not-a-route", "/assets/%2e%2e%2fpackage.json", "/assets/does-not-exist.js", "/.env", "/server/db/migrations/meta/_journal.json"]) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(`${base}/api/v1/projects`)).status, 401);
    const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { Origin: "https://timeline.test", "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@example.test", password }) });
    assert.equal(login.status, 200, "Packaged verified login failed");
    const cookieHeaders = login.headers.getSetCookie(); assert(cookieHeaders.some((s) => /Secure/i.test(s) && /HttpOnly/i.test(s) && /SameSite=Lax/i.test(s)));
    const cookie = cookieHeaders.map((s) => s.split(";")[0]).join("; ");
    const headers = { Origin: "https://timeline.test", "Content-Type": "application/json", Cookie: cookie };
    const workspace = await (await fetch(`${base}/api/v1/workspaces/current`, { headers })).json();
    const created = await fetch(`${base}/api/v1/projects`, { method: "POST", headers, body: JSON.stringify({ version: 1, commandId: randomUUID(), workspaceId: workspace.workspace.id, expectedRevision: workspace.workspace.revision, name: "Backup fixture", description: "", startDate: "2026-11-03" }) });
    assert.equal(created.status, 200, "Packaged command API failed"); const project = await created.json();
    assert.equal((await fetch(`${base}/api/v1/projects/${project.projectId}`, { headers })).status, 200);
    advance("backup and isolated restore");
    docker([...run, "--env-file", operator, image, "node", "build/server/backup.js", "dump-verify"]);
    docker([...run, "--env-file", operator, image, "node", "-e", "const fs=require('fs');for(const f of [process.env.BACKUP_FILE,process.env.BACKUP_FILE+'.json'])require('assert').equal(fs.statSync(f).mode&511,384)"]);
    assert.equal(sql("select count(*) from projects"), "1");
    assert.equal(docker(["exec", db, "psql", "-X", "-U", "postgres", "-d", "timeline_package_restore_test", "-Atc", "select count(*) from projects where name='Backup fixture'"]), "1");
    docker([...run, "--env-file", operator, image, "node", "build/server/backup.js", "verify"], undefined, 1); // Occupied target.
    docker([...run, "--env-file", operator, "-e", `RESTORE_DATABASE_URL=${source}`, image, "node", "build/server/backup.js", "verify"], undefined, 1);
    sql("CREATE DATABASE timeline_functions_restore_test;");
    docker(["exec", db, "psql", "-X", "-U", "postgres", "-d", "timeline_functions_restore_test", "-c", "create function public.existing_fixture() returns int language sql as 'select 1'"]);
    docker([...run, "--env-file", operator, "-e", `RESTORE_DATABASE_URL=${restore.replace('timeline_package_restore_test','timeline_functions_restore_test')}`, image, "node", "build/server/backup.js", "verify"], undefined, 1);
    docker([...run, "--env-file", operator, image, "node", "build/server/backup.js", "dump"], undefined, 1); // Never overwrite.
    advance("image secret exclusion");
    docker(["exec", app, "node", "--input-type=module", "-e", `import fs from 'node:fs'; import assert from 'node:assert/strict';
      assert(!process.env.MIGRATION_DATABASE_URL); assert(!fs.existsSync('/backups')); assert(!fs.existsSync('/app/.env')); assert(!fs.existsSync('/run/secrets/proxy_ca')); assert(!fs.existsSync('/app/node_modules/tsx'));
      const needles=[process.env.BETTER_AUTH_SECRET,new URL(process.env.DATABASE_URL).password,process.env.TEST_PASSWORD];
      function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())scan(p);else {const s=fs.readFileSync(p).toString();for(const n of needles)assert(!s.includes(n),'Secret in runtime files');}}} scan('/app/build');scan('/app/dist');scan('/app/server');`]);
    const history = docker(["history", "--no-trunc", "--format", "{{.CreatedBy}}", image]);
    assert(!history.includes(secret) && !history.includes(adminPassword), "Secret in image history");
    advance("database outage readiness and graceful shutdown");
    docker(["stop", "--time", "10", db]);
    assert.equal((await fetch(`${base}/health/ready`)).status, 503);
    assert.equal((await fetch(`${base}/health/live`)).status, 200);
    docker(["stop", "--time", "12", app]);
    assert.equal(docker(["inspect", "--format", "{{.State.ExitCode}}", app]), "0");
  } finally {
    for (const name of [app, db, `${network}-oneshot`]) spawnSync("docker", ["--host=unix:///var/run/docker.sock", "rm", "-f", "-v", name], { env: dockerEnv, stdio: "ignore" });
    spawnSync("docker", ["--host=unix:///var/run/docker.sock", "volume", "rm", volume], { env: dockerEnv, stdio: "ignore" });
    spawnSync("docker", ["--host=unix:///var/run/docker.sock", "network", "rm", network], { env: dockerEnv, stdio: "ignore" });
    await rm(folder, { recursive: true, force: true });
  }
});
