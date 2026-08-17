import "server-only";
import postgres from "postgres";

// Direct Postgres — the `plaud` schema is deliberately NOT exposed through
// PostgREST, so the service reaches it only from the server (PRD PWA-2:
// server-only data access; the client never holds a key that can reach it).
const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

export const sql =
  globalForDb.__sql ??
  postgres(process.env.DATABASE_URL!, {
    prepare: false, // transaction-mode pooler
    max: 4,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__sql = sql;
