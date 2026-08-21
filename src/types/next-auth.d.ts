import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      // Public, non-sensitive (see schema/auth.ts's users.referralCode
      // comment) — null for pre-existing users until they trigger
      // ensureReferralCode (auth.ts's events.createUser sets it for
      // every new signup going forward).
      referralCode: string | null;
    } & DefaultSession["user"];
  }
}
