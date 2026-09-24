/**
 * Test database: PGlite (Postgres in WebAssembly) with a tiny stub of Supabase's auth schema.
 * Lets us test the real migrations, RLS policies and scheduling SQL without Docker or Supabase.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, "../../../../supabase/migrations");
/** Needs Supabase-only extensions (pgmq, pg_cron, storage). */
const SKIP = ["_platform.sql"];

const AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
`;

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !SKIP.some((s) => f.endsWith(s))).sort();
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "../seed.sql"), "utf8"));
  // Supabase grants table access to 'authenticated'; RLS then limits rows.
  await db.exec(`
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);
  return db;
}

/** Run a callback as a signed-in user (RLS applies). */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set request.jwt.claim.sub = '${userId}'; set role authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`);
  }
}

export async function createUser(db: PGlite): Promise<string> {
  const r = await db.query<{ id: string }>(`insert into auth.users default values returning id`);
  return r.rows[0]!.id;
}
