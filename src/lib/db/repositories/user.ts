import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

export async function getUserById(userId: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  return user ?? null;
}

export async function getUserByEmail(email: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  return user ?? null;
}

export async function touchLastLogin(userId: string) {
  await db
    .update(schema.users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}
