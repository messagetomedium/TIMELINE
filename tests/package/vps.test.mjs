import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, cp, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import https from "node:https";
import { setTimeout as delay } from "node:timers/promises";

const image = process.env.TIMELINE_TEST_IMAGE;
test("VPS package: private DB, least privilege, 4 users within memory limits, encrypted backup/download/restore and controlled update", { timeout: 600_000 }, async () => {
  assert(image, "Set TIMELINE_TEST_IMAGE to the built release image");
  const folder = await mkdtemp(join(tmpdir(), "timeline-vps-test-")), project = `timeline-vps-test-${randomBytes(5).toString("hex")}`;
  const env = { ...process.env, TIMELINE_PROJECT: project, TIMELINE_COMPOSE_OVERRIDE: join(folder, "test-override.yaml") };
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete env[key];
  let phase = "prepare", passed = false;
  const step = (name) => { phase = name; process.stdout.write(`vps: ${name}\n`); };
  function exec(command, args, input, expected = 0) {
    const r = spawnSync(command, args, { env, cwd: folder, input, encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    // Fixture output can contain secrets; do not reflect it in errors/logs.
    if (r.status !== expected) {
      const diagnostic = (r.stderr ?? "").match(/(?:permission denied|Permission denied|connection refused|no such file|not found|network .* overlaps|Unknown|invalid|unhealthy|OOM|readonly|read-only|Operation not permitted)/)?.[0] ?? "inspect this phase";
      const safeLines = (r.stderr ?? "").split("\n").filter((line) => /Permission denied|permission denied|TIMELINE .*failed/.test(line)).map((line) => line.replace(/[a-f0-9]{32,}/gi, "<fixture>")).slice(-3).join(" ");
      assert.fail(`${command} failed during ${phase}: status ${r.status}, ${diagnostic} ${safeLines}`);
    }
    return r.stdout.trim();
  }
  const docker = (args, input, expected) => exec("docker", ["--host=unix:///var/run/docker.sock", ...args], input, expected);
  const compose = (args, input, expected) => docker(["compose", "--project-directory", folder, "--env-file", join(folder, "state/config.env"), "-f", join(folder, "compose.yaml"), "-f", env.TIMELINE_COMPOSE_OVERRIDE, ...args], input, expected);
  const script = (args, input, expected) => exec("bash", [join(folder, "timeline.sh"), ...args], input, expected);
  const sql = (value, expected) => compose(["exec", "-T", "--user", "0", "postgres", "sh", "-ec", 'export PGPASSWORD="$(cat /run/secrets/postgres_password)"; exec psql -X -qAt -h 127.0.0.1 -U postgres -d timeline -v ON_ERROR_STOP=1'], value, expected);
  async function setSecret(name, value) { const file = join(folder, "state/secrets", name); await chmod(file, 0o600); await writeFile(file, value); await chmod(file, 0o400); }
  try {
    await cp(resolve("deploy/vps"), folder, { recursive: true, filter: (path) => !path.includes("/state") });
    const id = docker(["image", "inspect", "--format", "{{.Id}}", image]);
    // All secrets are generated disposable fixtures, never real SMTP/S3 credentials.
    const password = randomBytes(24).toString("hex");
    script(["init"], [id, "timeline.localhost", "tls@example.test", "localhost", "587", "mail@example.test", "mail@example.test", password].join("\n") + "\n");
    const originalSecret = await readFile(join(folder, "state/secrets/BETTER_AUTH_SECRET"), "utf8");
    script(["init"], "", 1);
    assert.equal(await readFile(join(folder, "state/secrets/BETTER_AUTH_SECRET"), "utf8"), originalSecret);
    const caddy = (await readFile(join(folder, "Caddyfile"), "utf8")).replace('{$DOMAIN} {', '{$DOMAIN} {\n  tls internal');
    await writeFile(join(folder, "Caddyfile"), caddy);
    await chmod(join(folder, "Caddyfile"), 0o644);
    await writeFile(env.TIMELINE_COMPOSE_OVERRIDE, 'services:\n  proxy:\n    ports: !override ["127.0.0.1::443"]\n');
    const config = JSON.parse(compose(["--profile", "tools", "config", "--format", "json"]));
    assert.equal(config.networks.database.internal, true);
    assert.equal(config.services.postgres.ports, undefined); assert.equal(config.services.app.ports, undefined);
    assert.deepEqual(config.services.app.secrets.map((s) => s.source).sort(), ["BETTER_AUTH_SECRET", "DATABASE_URL", "SMTP_PASSWORD"]);
    assert(!JSON.stringify(config).includes(originalSecret), "Secret in Compose environment");
    assert(config.services.app.read_only); assert(config.services.operator.read_only);
    const mib = 1024 ** 2;
    const steady = ["app", "postgres", "proxy"].reduce((n, key) => n + Number(config.services[key].mem_limit), 0);
    assert.equal(steady, 1152 * mib);
    assert(steady + Number(config.services.operator.mem_limit) <= 1536 * mib, "Leave >=512 MiB for host/Docker on 2 GiB VPS");
    assert(config.services.restic.mem_limit <= 256 * mib);
    step("install and restricted roles"); script(["install"]);
    assert.equal(sql("select count(*) from pg_roles where rolname in ('timeline_app','timeline_migrator') and not (rolsuper or rolcreatedb or rolcreaterole or rolbypassrls)"), "2");
    compose(["exec", "-T", "--user", "0", "postgres", "sh", "-ec", 'export PGPASSWORD="$(cat /run/secrets/app_password)"; exec psql -X -h 127.0.0.1 -U timeline_app -d timeline -v ON_ERROR_STOP=1 -c "create table forbidden_fixture(id int)"'], undefined, 1);
    script(["migrate"]); // Explicit, idempotent operator action; never a startup entrypoint.
    // The real deployment uses HTTPS S3. The fixture exercises encryption/transfer/restore
    // with Restic's isolated local backend; it never contacts an external storage account.
    await setSecret("RESTIC_REPOSITORY", "/restore/offsite-fixture");
    await setSecret("restic_password", randomBytes(32).toString("hex"));
    script(["backup-init"]);
    script(["start"], undefined, 1); // No app exposure before a verified external copy.
    step("encrypted copy and isolated restore"); script(["backup"]);
    assert.equal(sql("select count(*) from pg_database where datname like '%\\_restore_test'"), "0");
    step("HTTPS and server mode"); script(["start"]);
    const app = compose(["ps", "-q", "app"]), pg = compose(["ps", "-q", "postgres"]), proxy = compose(["ps", "-q", "proxy"]);
    for (const container of [app, pg]) {
      const ports = JSON.parse(docker(["inspect", "--format", "{{json .NetworkSettings.Ports}}", container]));
      assert(Object.values(ports).every((value) => value === null), "Private service published a port");
    }
    assert.equal(docker(["exec", app, "id", "-u"]), "1000");
    assert.equal(docker(["exec", app, "sh", "-c", "test ! -e /run/secrets/MIGRATION_DATABASE_URL && test ! -e /run/secrets/postgres_password && printf OK"]), "OK");
    docker(["cp", `${proxy}:/data/caddy/pki/authorities/local/root.crt`, join(folder, "ca.crt")]);
    const ca = await readFile(join(folder, "ca.crt"));
    const port = JSON.parse(docker(["inspect", "--format", "{{json .NetworkSettings.Ports}}", proxy]))["443/tcp"][0].HostPort;
    function request(path, body, cookie = "") {
      return new Promise((done, reject) => {
        const req = https.request({ hostname: "127.0.0.1", port, servername: "timeline.localhost", ca, path, method: body ? "POST" : "GET", headers: { host: "timeline.localhost", origin: "https://timeline.localhost", "content-type": "application/json", cookie } }, (response) => {
          let raw = ""; response.setEncoding("utf8"); response.on("data", (s) => { raw += s; });
          response.on("end", () => { done({ status: response.statusCode, headers: response.headers, raw }); });
        });
        req.setTimeout(15_000, () => { req.destroy(Error("Fixture request timeout")); }); req.on("error", reject);
        req.end(body ? JSON.stringify(body) : undefined);
      });
    }
    const index = await request("/"); assert.equal(index.status, 200, index.status === 403 ? index.raw.slice(0, 200) : "HTTPS frontend status"); assert.match(index.raw, /name="timeline-storage" content="server"/);
    assert.match(docker(["exec", app, "cat", "/app/dist/index.html"]), /name="timeline-storage" content="local"/, "Pages artifact must stay local");
    assert.equal((await request("/health/ready")).status, 404);
    assert.equal((await request("/api/v1/projects")).status, 401);
    const hash = docker(["exec", "-i", app, "node", "--input-type=module"], `import {hashPassword} from 'better-auth/crypto'; process.stdout.write(await hashPassword(${JSON.stringify(password)}));`);
    assert(/^[a-f0-9:]+$/i.test(hash));
    const users = Array.from({ length: 4 }, (_, i) => ({ id: randomUUID(), email: `fixture${i}@example.test` }));
    for (const user of users) sql(`INSERT INTO auth_users(id,name,email,email_verified) VALUES('${user.id}','Fixture','${user.email}',true); INSERT INTO auth_accounts(id,user_id,account_id,provider_id,password) VALUES('${randomUUID()}','${user.id}','${user.id}','credential','${hash}');`);
    script(["bootstrap", users[0].email]);
    for (const user of users.slice(1)) sql(`INSERT INTO workspace_memberships(workspace_id,user_id,role) SELECT id,'${user.id}','admin' FROM workspaces;`);
    step("4 concurrent authenticated users and independent commands");
    const sessions = await Promise.all(users.map(async (user) => {
      let r = await request("/api/auth/sign-in/email", { email: user.email, password });
      // All fixture users share one NAT IP. Respect the existing sign-in rate limit.
      if (r.status === 429) { await delay(11_000); r = await request("/api/auth/sign-in/email", { email: user.email, password }); }
      assert.equal(r.status, 200);
      assert(r.headers["set-cookie"].some((s) => /Secure/.test(s) && /HttpOnly/.test(s)));
      return r.headers["set-cookie"].map((s) => s.split(";")[0]).join("; ");
    }));
    const ids = [];
    for (const cookie of sessions) {
      const { workspace } = JSON.parse((await request("/api/v1/workspaces/current", undefined, cookie)).raw);
      const created = await request("/api/v1/projects", { commandId: randomUUID(), version: 1, workspaceId: workspace.id, expectedRevision: workspace.revision, name: "Fixture", description: "", startDate: "2026-11-04" }, cookie);
      assert.equal(created.status, 200); ids.push(JSON.parse(created.raw).projectId);
    }
    await Promise.all(sessions.map(async (cookie, i) => {
      for (let n = 0; n < 3; n++) {
        const doc = JSON.parse((await request(`/api/v1/projects/${ids[i]}`, undefined, cookie)).raw);
        const r = await request(`/api/v1/projects/${ids[i]}/commands`, { commandId: randomUUID(), version: 1, workspaceId: doc.project.workspaceId, projectId: ids[i], expectedRevision: doc.project.revision, command: { type: "Describe", kind: "project", id: ids[i], value: `Fixture ${n}` } }, cookie);
        assert.equal(r.status, 200);
      }
    }));
    assert.equal(sql("select count(*) from projects"), "4");
    const loadPeaks = {};
    for (const service of ["app", "postgres", "proxy"]) {
      const container = compose(["ps", "-q", service]);
      loadPeaks[service] = Number(docker(["exec", container, "sh", "-c", "cat /sys/fs/cgroup/memory.peak 2>/dev/null || cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes"]));
      assert.equal(docker(["inspect", "--format", "{{.State.OOMKilled}}", container]), "false");
    }
    step("controlled update with backup/download/restore/rehearsal"); script(["update", id, "--migrate"]);
    assert.equal(sql("select count(*) from projects"), "4");
    assert.equal(sql("select count(*) from pg_database where datname like '%\\_restore_test'"), "0");
    script(["verify"]);
    step("memory and outage safety");
    for (const service of ["app", "postgres", "proxy"]) {
      const container = compose(["ps", "-q", service]);
      assert.equal(docker(["inspect", "--format", "{{.State.OOMKilled}}", container]), "false");
      const peak = Math.max(loadPeaks[service], Number(docker(["exec", container, "sh", "-c", "cat /sys/fs/cgroup/memory.peak 2>/dev/null || cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes"])));
      assert(peak < config.services[service].mem_limit);
      process.stdout.write(`vps: ${service} peak ${Math.ceil(peak / mib)} MiB / ${config.services[service].mem_limit / mib} MiB\n`);
    }
    const savedKey = await readFile(join(folder, "state/secrets/restic_password"), "utf8");
    await setSecret("restic_password", randomBytes(32).toString("hex"));
    script(["update", id, "--migrate"], undefined, 12); // Restic: wrong repository password.
    assert.equal(compose(["ps", "--status", "running", "-q", "app"]).length > 0, true, "Failed backup must not stop the app");
    assert.equal(sql("select count(*) from projects"), "4");
    await setSecret("restic_password", savedKey);
    passed = true;
  } finally {
    if (!passed) {
      const logs = spawnSync("docker", ["--host=unix:///var/run/docker.sock", "compose", "--project-directory", folder, "--env-file", join(folder, "state/config.env"), "-f", join(folder, "compose.yaml"), "-f", env.TIMELINE_COMPOSE_OVERRIDE, "logs", "--no-color", "--tail", "15", "app", "proxy"], { env, encoding: "utf8", timeout: 10_000 });
      const safe = (logs.stdout ?? "").replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "<database>").replace(/[a-f0-9]{32,}/gi, "<fixture>");
      process.stdout.write(safe.slice(-5000));
    }
    // Only this disposable project's containers/networks/volumes and temp directory.
    spawnSync("docker", ["--host=unix:///var/run/docker.sock", "compose", "--project-directory", folder, "--env-file", join(folder, "state/config.env"), "-f", join(folder, "compose.yaml"), "-f", env.TIMELINE_COMPOSE_OVERRIDE, "--profile", "tools", "down", "--volumes", "--remove-orphans"], { env, stdio: "ignore", timeout: 60_000 });
    await rm(folder, { recursive: true, force: true });
  }
});

test("VPS init preserves exact secret bytes and refuses to replace existing state", async () => {
  const folder = await mkdtemp(join(tmpdir(), "timeline-vps-init-"));
  const smtpPassword = "  disposable fixture $ quote' and spaces  ";
  try {
    await cp(resolve("deploy/vps"), folder, { recursive: true, filter: (path) => !path.includes("/state") });
    const input = [`sha256:${"a".repeat(64)}`, "timeline.example.test", "tls@example.test", "smtp.example.test", "587", "mail@example.test", "mail@example.test", smtpPassword].join("\n") + "\n";
    const result = spawnSync("bash", [join(folder, "timeline.sh"), "init"], { input, encoding: "utf8" });
    assert.equal(result.status, 0, "Fixture init failed (run as root or UID 1000)");
    assert.equal(await readFile(join(folder, "state/secrets/SMTP_PASSWORD"), "utf8"), smtpPassword);
    assert.equal(spawnSync("bash", [join(folder, "timeline.sh"), "init"], { encoding: "utf8" }).status, 1);
    assert.equal(await readFile(join(folder, "state/secrets/SMTP_PASSWORD"), "utf8"), smtpPassword);
    await writeFile(join(folder, "state/installed"), "fixture");
    const again = spawnSync("bash", [join(folder, "timeline.sh"), "install"], { encoding: "utf8" });
    assert.equal(again.status, 1); assert.match(again.stderr, /уже выполнена/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
