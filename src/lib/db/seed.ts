// Optional dev-only seed: creates one sample user with a filled-in
// style profile so /profile and /explore have something to look at
// immediately after `npm run db:seed`, without needing to sign in
// first. Safe to run repeatedly (upserts by email).
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "./schema/auth";
import { styleProfiles } from "./schema/domain";

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const path = url.startsWith("file:") ? url.slice("file:".length) : url;
const sqlite = new Database(path);
const db = drizzle(sqlite, { schema });

async function main() {
  const email = "demo@compass.local";
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) {
    const now = new Date();
    [user] = await db
      .insert(schema.users)
      .values({ email, name: "Demo User", emailVerified: now, createdAt: now, updatedAt: now })
      .returning();
    console.log(`Created demo user ${user.id}`);
  } else {
    console.log(`Demo user already exists: ${user.id}`);
  }

  const [existingProfile] = await db
    .select()
    .from(styleProfiles)
    .where(eq(styleProfiles.userId, user.id));
  if (!existingProfile) {
    await db.insert(styleProfiles).values({
      userId: user.id,
      styleArchetypes: ["minimalist", "street"],
      budgetRange: "200_400",
      locationCity: "Luxembourg",
      locationCountry: "LU",
      locationSource: "manual",
    });
    console.log("Seeded demo style profile");
  }
}

main()
  .then(() => sqlite.close())
  .catch((err) => {
    console.error(err);
    sqlite.close();
    process.exit(1);
  });
