import { readFileSync } from "node:fs";
import { z } from "zod";

export const databaseUrlSchema = z.url().refine((value) => {
  try {
    const url = new URL(value);
    // node-postgres URL ssl parameters can replace the verified TLS options.
    return ["postgres:", "postgresql:"].includes(url.protocol) &&
      ![...url.searchParams.keys()].some((key) => key.toLowerCase().startsWith("ssl"));
  } catch { return false; }
});
export const databaseSettingsSchema = z.object({
  DB_SSL_MODE: z.enum(["disable", "verify-full"]).default("disable"),
  DB_CONNECTION_SCOPE: z.enum(["remote", "docker-internal"]).optional(),
  DB_SSL_CA_FILE: z.string().min(1).optional(),
});
export type DatabaseSettings = z.infer<typeof databaseSettingsSchema>;
export function databaseTls(settings: DatabaseSettings) {
  if (settings.DB_SSL_MODE === "disable") return false;
  return { rejectUnauthorized: true, ...(settings.DB_SSL_CA_FILE ? { ca: readFileSync(settings.DB_SSL_CA_FILE, "utf8") } : {}) };
}

/** Production plaintext is restricted to the Compose service on its private network.
 * The explicit scope is an operator assertion, not a generic TLS bypass for private IPs.
 */
export function assertDatabaseTransport(url: string, settings: DatabaseSettings, environment = process.env.NODE_ENV) {
  if (environment !== "production" || settings.DB_SSL_MODE === "verify-full") return;
  const parsed = new URL(databaseUrlSchema.parse(url));
  if (settings.DB_CONNECTION_SCOPE !== "docker-internal" || parsed.hostname !== "postgres" || (parsed.port && parsed.port !== "5432") || parsed.search) {
    throw Error("Production database requires verify-full; plaintext is only allowed for the internal Compose postgres service");
  }
}
