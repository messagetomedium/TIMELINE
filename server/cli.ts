import { z } from "zod";
import { connect } from "./db/connection";
import { assertMigrations, migrateDatabase } from "./db/migrate";
import { bootstrapOwner } from "./access";
import { databaseSettingsSchema, databaseUrlSchema } from "./db/settings";

let connection: ReturnType<typeof connect> | undefined;
try {
  const url = databaseUrlSchema.parse(process.env.MIGRATION_DATABASE_URL);
  const settings = databaseSettingsSchema.parse(process.env);
  if (process.env.NODE_ENV === "production" && settings.DB_SSL_MODE !== "verify-full") throw Error("Verified TLS required");
  connection = connect(url, settings);
  const command = process.argv[2];
  if (command === "migrate") await migrateDatabase(connection.pool);
  else if (command === "status") await assertMigrations(connection.pool);
  else if (command === "bootstrap") {
    await assertMigrations(connection.pool);
    const email = z.email().parse(process.env.BOOTSTRAP_OWNER_EMAIL);
    await connection.db.transaction((tx) => bootstrapOwner(tx, email));
  } else throw Error("Unknown operator command");
  process.stdout.write(`TIMELINE ${command}: OK\n`);
} catch {
  process.stderr.write("TIMELINE operator command failed; check command, settings, verified user and migration status\n");
  process.exitCode = 1;
} finally { await connection?.pool.end(); }
