export type AccessLink = { kind: "invite" | "guest"; token: string | null };
/** Consume before imports/requests. Secrets never enter query, storage or referrers. */
export function consumeAccessLink(location: Pick<Location, "pathname" | "search" | "hash">, history: Pick<History, "replaceState">): AccessLink | undefined {
  const kind = location.pathname === "/invite" ? "invite" : location.pathname === "/guest" ? "guest" : null;
  if (!kind) return undefined;
  const raw = location.hash.slice(1);
  history.replaceState(null, "", location.pathname + location.search);
  return { kind, token: /^[\w-]{43}$/.test(raw) ? raw : null };
}
