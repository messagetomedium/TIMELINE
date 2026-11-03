import { z } from "zod";
import { connect } from "./db/connection";
import { assertMigrations, migrateDatabase } from "./db/migrate";
import { bootstrapOwner } from "./access";

let connection: ReturnType<typeof connect> | undefined;
try {
  const url = z.url().refine((s) => ["postgres:", "postgresql:"].includes(new URL(s).protocol)).parse(process.env.MIGRATION_DATABASE_URL);
  connection = connect(url);
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
