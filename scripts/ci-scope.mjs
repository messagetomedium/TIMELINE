import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export function changedPaths(base, head, directory) {
  // A rename must include its deleted source path, even when moved into docs.
  return execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", base, head], { cwd: directory, encoding: "utf8" }).split("\0").filter(Boolean);
}
export function classifyPaths(paths, mainPush = false) {
  const scope = { frontend: false, server: false, package: false };
  for (const path of paths) {
    if (/^(\.github\/|scripts\/|tests\/package\/|Dockerfile$|\.dockerignore$|\.env\.example$|\.nvmrc$|\.npmrc$|package(?:-lock)?\.json$|tsconfig|[^/]*config\.)/.test(path)) return { frontend: true, server: true, package: true };
    if (/^(docs\/|[^/]+\.md$|LICENSE(?:\.|$))/.test(path)) continue;
    if (/^src\/(domain|application)\//.test(path)) { scope.frontend = true; scope.server = true; }
    else if (/^server\//.test(path)) { scope.server = true; if (!path.startsWith("server/tests/")) scope.package = true; }
    else if (/^(src\/|tests\/e2e\/|public\/|index\.html$)/.test(path)) scope.frontend = true;
    else return { frontend: true, server: true, package: true };
  }
  // Without a confirmed PR gate, the parent main may itself contain failed code.
  // A later narrow change must not publish that unvalidated parent by omission.
  if (mainPush && (scope.frontend || scope.server || scope.package)) return { frontend: true, server: true, package: true };
  return scope;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let scope = { frontend: true, server: true, package: true };
  const sha = process.env.CI_HEAD_SHA;
  try {
    const base = process.env.CI_BASE_SHA;
    if (!/^[a-f0-9]{40}$/.test(sha ?? "") || !/^[a-f0-9]{40}$/.test(base ?? "") || /^0+$/.test(base)) throw Error("No complete diff");
    scope = classifyPaths(changedPaths(base, sha), process.env.CI_MAIN_PUSH === "true");
  } catch { process.stderr.write("Scope could not be determined; all checks are required.\n"); }
  for (const [key, value] of Object.entries(scope)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  writeFileSync("ci-scope.json", JSON.stringify({ sha, ...scope }));
}
