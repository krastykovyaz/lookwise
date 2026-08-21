import "server-only";
import { auth } from "@/auth";

/** Every authenticated API route calls this instead of reading a
 *  userId from the request body/query string (section 11: "never
 *  trust userId from client query parameters — derive user identity
 *  from the authenticated session"). Returns null when there is no
 *  session so callers can 401 without throwing. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
