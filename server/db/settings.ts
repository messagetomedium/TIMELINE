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
  DB_SSL_CA_FILE: z.string().min(1).optional(),
});
export type DatabaseSettings = z.infer<typeof databaseSettingsSchema>;
export function databaseTls(settings: DatabaseSettings) {
  if (settings.DB_SSL_MODE === "disable") return false;
  return { rejectUnauthorized: true, ...(settings.DB_SSL_CA_FILE ? { ca: readFileSync(settings.DB_SSL_CA_FILE, "utf8") } : {}) };
}
