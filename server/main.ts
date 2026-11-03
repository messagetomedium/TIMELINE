import { createApp } from "./app";
import { readConfig } from "./config";

try {
  const config = readConfig(), { app } = await createApp(config);
  const shutdown = () => {
    const deadline = setTimeout(() => process.exit(1), 10_000).unref();
    void app.close().then(() => { clearTimeout(deadline); process.exitCode = 0; }, () => { clearTimeout(deadline); process.exitCode = 1; });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await app.listen({ host: config.HOST, port: config.PORT });
  process.stdout.write("TIMELINE API is listening\n");
} catch {
  // Never print a driver/auth exception: it can contain SQL, PII or credentials.
  process.stderr.write("TIMELINE API startup failed; check settings, database role and migration status\n");
  process.exitCode = 1;
}
