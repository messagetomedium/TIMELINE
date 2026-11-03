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
  return { async send(mail) { await transport.sendMail({...mail,from:config.MAIL_FROM}); }, close(){transport.close();} };
}
