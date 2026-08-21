import type { Config } from "drizzle-kit";

const url = (process.env.DATABASE_URL ?? "file:./dev.db").replace(/^file:/, "");

export default {
  schema: "./src/lib/db/schema/*.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url,
  },
} satisfies Config;
