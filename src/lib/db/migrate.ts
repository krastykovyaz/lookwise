import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const path = url.startsWith("file:") ? url.slice("file:".length) : url;

const sqlite = new Database(path);
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: "./drizzle" });
console.log(`Migrations applied to ${path}`);
sqlite.close();
