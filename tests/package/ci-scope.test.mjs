import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPaths, changedPaths } from "../../scripts/ci-scope.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("documentation skips expensive checks; unknown and critical paths require every gate", () => {
  assert.deepEqual(classifyPaths(["AGENTS.md", "docs/STAGING.md", "README.md"]), { frontend: false, server: false, package: false });
  for (const path of [".github/workflows/ci.yml", "Dockerfile", "package-lock.json", "tsconfig.server.json", "unknown.file", "scripts/ci-scope.mjs"]) assert.deepEqual(classifyPaths([path]), { frontend: true, server: true, package: true });
});
test("frontend, backend and shared commands select the relevant jobs", () => {
  assert.deepEqual(classifyPaths(["src/features/timeline/TimelineBar.tsx"]), { frontend: true, server: false, package: false });
  assert.deepEqual(classifyPaths(["server/app.ts"]), { frontend: false, server: true, package: true });
  assert.deepEqual(classifyPaths(["server/tests/postgres.test.ts"]), { frontend: false, server: true, package: false });
  assert.deepEqual(classifyPaths(["src/domain/v2/model.ts", "src/application/v2/CommandService.ts"]), { frontend: true, server: true, package: false });
});
test("moving source code into docs still validates the deleted source scope", () => {
  const dir = mkdtempSync(join(tmpdir(), "timeline-ci-scope-"));
  const git = (...args) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args], { cwd: dir, encoding: "utf8" }).trim();
  try {
    git("init", "-q"); mkdirSync(join(dir, "server")); mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "server/app.ts"), "fixture source\n"); git("add", "."); git("commit", "-qm", "initial"); const before = git("rev-parse", "HEAD");
    renameSync(join(dir, "server/app.ts"), join(dir, "docs/app.md")); git("add", "-A"); git("commit", "-qm", "rename");
    assert.deepEqual(classifyPaths(changedPaths(before, git("rev-parse", "HEAD"), dir)), { frontend: false, server: true, package: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
