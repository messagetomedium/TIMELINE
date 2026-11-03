import { z } from "zod";
import { databaseSettingsSchema, databaseUrlSchema } from "./db/settings";
const proxyAddress = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);
const settings = databaseSettingsSchema.extend({
  DATABASE_URL:databaseUrlSchema,
  APP_ORIGIN:z.url().refine((v)=>{ try {const u=new URL(v);return ["http:","https:"].includes(u.protocol)&&u.origin===v&&!u.username&&!u.password;}catch{return false;} }),
  BETTER_AUTH_SECRET:z.string().min(32).refine((s) => !/REPLACE_WITH|CHANGE_ME/.test(s)),
  NODE_ENV:z.enum(["development","test","production"]).default("development"),
  PORT:z.coerce.number().int().min(0).max(65535).default(8080), HOST:z.string().default("127.0.0.1"),
  APP_STORAGE_MODE:z.enum(["local","server"]).default("server"),
  STATIC_ROOT:z.string().min(1).optional(),
  TRUST_PROXY:z.string().default("").transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(proxyAddress.refine((s) => !s.endsWith("/0")))),
  MAILER_MODE:z.enum(["memory","smtp"]).default("memory"), SMTP_HOST:z.string().optional(),SMTP_PORT:z.coerce.number().int().positive().default(587),SMTP_USER:z.string().optional(),SMTP_PASSWORD:z.string().optional(),MAIL_FROM:z.email().default("timeline@example.test"),
}).superRefine((c,ctx)=>{
  if(c.NODE_ENV==="production"&&!c.APP_ORIGIN.startsWith("https://"))ctx.addIssue({code:"custom",path:["APP_ORIGIN"],message:"HTTPS required"});
  if(c.NODE_ENV==="production"&&c.MAILER_MODE!=="smtp")ctx.addIssue({code:"custom",path:["MAILER_MODE"],message:"SMTP required"});
  if(c.NODE_ENV==="production"&&c.DB_SSL_MODE!=="verify-full")ctx.addIssue({code:"custom",path:["DB_SSL_MODE"],message:"Verified database TLS required"});
  if(c.MAILER_MODE==="smtp"&&!c.SMTP_HOST)ctx.addIssue({code:"custom",path:["SMTP_HOST"],message:"SMTP host required"});
});
export type Config=z.infer<typeof settings>;
export function readConfig(env:NodeJS.ProcessEnv=process.env):Config {
  const result=settings.safeParse(env);
  if(!result.success)throw Error(`Invalid server settings: ${[...new Set(result.error.issues.map((i)=>i.path.join(".")))].join(", ")}`);
  return result.data;
}
