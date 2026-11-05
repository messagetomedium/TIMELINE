import nodemailer from "nodemailer";
import type { Config } from "./config";
export interface Mail { to:string; subject:string; text:string }
export interface Mailer { send(mail:Mail):Promise<void>; close():void }
/** Injected in tests; there is deliberately no public mailbox/token endpoint. */
export class MemoryMailer implements Mailer {
  readonly messages:Mail[]=[];
  send(mail:Mail) { this.messages.push(mail);return Promise.resolve(); }
  close() { this.messages.length=0; }
}
export function createMailer(config:Config):Mailer {
  if(config.MAILER_MODE==="memory")return new MemoryMailer();
  const transport=nodemailer.createTransport({host:config.SMTP_HOST,port:config.SMTP_PORT,secure:config.SMTP_PORT===465,requireTLS:config.SMTP_PORT!==465,...(config.SMTP_USER?{auth:{user:config.SMTP_USER,pass:config.SMTP_PASSWORD}}:{})});
  return { async send(mail) {
    try { await transport.sendMail({...mail,from:config.MAIL_FROM}); }
    catch (error) {
      throw smtpFailure(error);
    }
  }, close(){transport.close();} };
}

function smtpFailure(error: unknown) {
  const code: unknown = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const reason = typeof code === "string" && ["ETIMEDOUT","ECONNREFUSED","ENOTFOUND","EAUTH","ESOCKET"].includes(code) ? code : "UNKNOWN";
  process.stderr.write(`TIMELINE SMTP_FAIL ${reason}; check outbound connectivity and SMTP settings\n`);
  return Error("SMTP_UNAVAILABLE", { cause: reason });
}
