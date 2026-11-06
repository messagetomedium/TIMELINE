import { expect, it, vi } from "vitest";
import { consumeAccessLink } from "./accessLink";

it.each(["invite", "guest"] as const)("consumes /%s fragment once into memory and clears it before any downstream action", (kind) => {
  const location = { pathname: `/${kind}`, search: "", hash: `#${"A".repeat(43)}` };
  const replaceState = vi.fn(() => { location.hash = ""; });
  const value = consumeAccessLink(location, { replaceState });
  expect(replaceState).toHaveBeenCalledWith(null, "", `/${kind}`);
  expect(value).toEqual({ kind, token: "A".repeat(43) }); expect(location.hash).toBe("");
  expect(consumeAccessLink(location, { replaceState })).toEqual({ kind, token: null });
});
it.each(["#short", "#" + "A".repeat(44), "#<script>"])("clears invalid fragments without accepting or reflecting them", (hash) => {
  const replaceState = vi.fn();
  expect(consumeAccessLink({ pathname: "/invite", search: "", hash }, { replaceState })).toEqual({ kind: "invite", token: null });
  expect(replaceState).toHaveBeenCalledWith(null, "", "/invite");
});
it("leaves existing project/Pages hash navigation unchanged", () => {
  const replaceState = vi.fn();
  expect(consumeAccessLink({ pathname: "/TIMELINE/", search: "", hash: "#/projects/id" }, { replaceState })).toBeUndefined();
  expect(replaceState).not.toHaveBeenCalled();
});
