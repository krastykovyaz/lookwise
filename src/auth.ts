import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { cookies } from "next/headers";
import { db, schema } from "@/lib/db/client";
import { sendMagicLinkEmail } from "@/lib/email/resend";
import { touchLastLogin } from "@/lib/db/repositories/user";
import { ensureReferralCode, getUserIdByReferralCode, createReferralIfAbsent } from "@/lib/db/repositories/referral";
import { REFERRAL_COOKIE, decodeReferralCookie } from "@/lib/referral/cookies";

// Magic links expire in 15 minutes and are deleted the moment Auth.js
// consumes them (single-use — see schema/auth.ts's verificationTokens
// comment and section 11's security requirements).
const MAGIC_LINK_TTL_SECONDS = 15 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  // Database sessions (not JWT): required by the email/magic-link
  // provider anyway, and gives us real, revocable, httpOnly session
  // rows via the adapter rather than a stateless cookie — satisfies
  // section 11's "secure, httpOnly session cookies through the
  // authentication library" using Auth.js's own cookie handling.
  session: { strategy: "database" },
  providers: [
    Google({
      // Google verifies email ownership before issuing an id_token, so
      // it's safe to auto-link a Google sign-in to an existing account
      // with the same email (section 3's "link both methods to the
      // SAME User record" requirement) rather than erroring as a
      // duplicate. This is what Auth.js's own docs call out as the one
      // provider category where this flag is reasonable.
      allowDangerousEmailAccountLinking: true,
    }),
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.RESEND_FROM_EMAIL,
      maxAge: MAGIC_LINK_TTL_SECONDS,
      async sendVerificationRequest({ identifier, url }) {
        await sendMagicLinkEmail({
          to: identifier,
          url,
          expiresInMinutes: MAGIC_LINK_TTL_SECONDS / 60,
        });
      },
    }),
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        // DrizzleAdapter's getUser/getSessionAndUser select the full
        // row, so a user created after this column existed already
        // carries it here. A pre-existing user (from before this
        // migration) falls back to ensureReferralCode, which is a
        // cheap read-then-write-once — see that function's comment.
        const existingCode = (user as { referralCode?: string | null }).referralCode ?? null;
        session.user.referralCode = existingCode ?? (await ensureReferralCode(user.id).catch(() => null));
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (user.id) await touchLastLogin(user.id);
    },
    // Section 6: if this new user arrived via a ?ref= link, the
    // anonymous compass_ref cookie (set by api/referral/track) carries
    // the referral code — this is the one place that turns "someone
    // visited with this code" into a permanent Referral row, and only
    // once per new account (createReferralIfAbsent is idempotent via
    // the unique index on referredUserId, not a check-then-insert).
    async createUser({ user }) {
      if (!user.id) return;
      try {
        await ensureReferralCode(user.id);
      } catch (err) {
        console.error("[auth] failed to assign referral code:", err);
      }
      try {
        const cookieStore = await cookies();
        const payload = decodeReferralCookie(cookieStore.get(REFERRAL_COOKIE)?.value);
        if (!payload) return;
        const referrerUserId = await getUserIdByReferralCode(payload.code);
        if (!referrerUserId) return;
        await createReferralIfAbsent({
          referrerUserId,
          referredUserId: user.id,
          sourceType: payload.sourceType,
          sourceId: payload.sourceId || null,
        });
      } catch (err) {
        console.error("[auth] failed to attribute signup referral:", err);
      }
    },
  },
});
