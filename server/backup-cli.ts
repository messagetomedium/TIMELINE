import { z } from "zod";
import { assertDatabaseTransport, databaseSettingsSchema, databaseUrlSchema } from "./db/settings";
import { backupDatabase, verifyBackup } from "./backup";
try {
  const settings = databaseSettingsSchema.parse(process.env);
  const source = databaseUrlSchema.parse(process.env.MIGRATION_DATABASE_URL), file = z.string().min(1).parse(process.env.BACKUP_FILE);
  assertDatabaseTransport(source, settings);
  if (process.env.RESTORE_DATABASE_URL) assertDatabaseTransport(databaseUrlSchema.parse(process.env.RESTORE_DATABASE_URL), settings);
  const command = z.enum(["dump", "verify", "dump-verify"]).parse(process.argv[2]);
  if (command !== "verify") await backupDatabase(source, file, settings);
  if (command !== "dump") await verifyBackup(source, databaseUrlSchema.parse(process.env.RESTORE_DATABASE_URL), file, settings);
  process.stdout.write(`TIMELINE backup ${command}: OK\n`);
} catch {
  process.stderr.write("TIMELINE backup failed; check isolated target, empty database, TLS, archive/manifest and PostgreSQL client version\n");
  process.exitCode = 1;
}
