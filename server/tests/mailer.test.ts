import { expect, it, vi } from "vitest";
import { createMailer } from "../mailer";
import { readConfig } from "../config";
const sendMail = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail, close: () => undefined }) } }));
it("SMTP failure diagnostics contain an allowlisted code and never credentials, addresses or tokens", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  sendMail.mockRejectedValue({ code: "ECONNREFUSED", message: "credential-and-token-fixture", response: "private@example.test" });
  const mailer = createMailer(readConfig({ DATABASE_URL: "postgresql://app@localhost/test", APP_ORIGIN: "http://localhost:8080", BETTER_AUTH_SECRET: "a-disposable-test-secret-with-more-than-32-characters", MAILER_MODE: "smtp", SMTP_HOST: "smtp.example.test" }));
  try {
    await expect(mailer.send({ to: "private@example.test", subject: "Test", text: "token-fixture" })).rejects.toThrow("SMTP_UNAVAILABLE");
    expect(stderr).toHaveBeenCalledWith("TIMELINE SMTP_FAIL ECONNREFUSED; check outbound connectivity and SMTP settings\n");
    expect(stderr.mock.calls.flat().join(" ")).not.toMatch(/private@|credential-and-token|token-fixture/);
  } finally { stderr.mockRestore(); mailer.close(); }
});
