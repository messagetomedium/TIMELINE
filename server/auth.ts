import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Database } from "./db/connection";
import * as schema from "./db/schema";
import type { Config } from "./config";
import type { Mailer } from "./mailer";
export function createAuth(db:Database,config:Config,mailer:Mailer) {
  return betterAuth({
    database:drizzleAdapter(db,{provider:"pg",schema}), secret:config.BETTER_AUTH_SECRET,baseURL:config.APP_ORIGIN,basePath:"/api/auth",trustedOrigins:[config.APP_ORIGIN],
    emailAndPassword:{enabled:true,minPasswordLength:12,maxPasswordLength:128,requireEmailVerification:true,autoSignIn:false,resetPasswordTokenExpiresIn:900,revokeSessionsOnPasswordReset:true,
      async sendResetPassword({user,url}) {await mailer.send({to:user.email,subject:"TIMELINE: восстановление пароля",text:url});}},
    emailVerification:{sendOnSignUp:true,autoSignInAfterVerification:false,expiresIn:3600,
      async sendVerificationEmail({user,url}) {await mailer.send({to:user.email,subject:"TIMELINE: подтверждение почты",text:url});}},
    session:{expiresIn:60*60*24*7,updateAge:60*60,cookieCache:{enabled:false}},
    verification:{storeIdentifier:"hashed"},
    rateLimit:{enabled:true,storage:"database",window:60,max:30},
    advanced:{database:{generateId:"uuid"},ipAddress:{ipAddressHeaders:["x-timeline-client-ip"]},useSecureCookies:config.APP_ORIGIN.startsWith("https://"),defaultCookieAttributes:{httpOnly:true,sameSite:"lax",secure:config.APP_ORIGIN.startsWith("https://")}},
    logger:{disabled:true},
  });
}
