import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  ...(process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE || "badminton"
      }),
  max: 4,
  idleTimeoutMillis: 30_000
});

export async function initializeDatabase({ seedDemo = false } = {}) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coaches (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      location TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT sessions_valid_time CHECK (ends_at > starts_at)
    );
    CREATE TABLE IF NOT EXISTS attendance (
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      response TEXT NOT NULL CHECK (response IN ('present', 'absent', 'maybe')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (session_id, member_id)
    );
    CREATE INDEX IF NOT EXISTS sessions_starts_at_idx ON sessions(starts_at);
    CREATE INDEX IF NOT EXISTS attendance_member_idx ON attendance(member_id);
  `);

  if (!seedDemo) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(74192831)");
    const safeDemoData = await client.query(`
      SELECT
        NOT EXISTS (SELECT 1 FROM members WHERE name !~ '^Joueur Démo [0-9]{2}$')
        AND NOT EXISTS (SELECT 1 FROM sessions WHERE location !~ '^Gymnase de démonstration [0-9]+$')
        AS safe
    `);
    if (!safeDemoData.rows[0].safe) {
      throw new Error("La base contient des données non fictives; refus de démarrer en mode démonstration.");
    }
    const existing = await client.query("SELECT EXISTS (SELECT 1 FROM members) OR EXISTS (SELECT 1 FROM sessions) AS has_data");
    if (existing.rows[0].has_data) {
      await client.query("COMMIT");
      return;
    }

    const names = ["Joueur Démo 01", "Joueur Démo 02", "Joueur Démo 03"];
    const memberIds = [];
    for (const name of names) {
      const result = await client.query("INSERT INTO members (name) VALUES ($1) RETURNING id", [name]);
      memberIds.push(result.rows[0].id);
    }

    const sessionIds = [];
    for (const [index, dayOffset] of [2, 5, 8].entries()) {
      const startsAt = new Date(Date.now() + dayOffset * 86_400_000);
      startsAt.setUTCHours(18, 30, 0, 0);
      const endsAt = new Date(startsAt.getTime() + 90 * 60_000);
      const result = await client.query(
        "INSERT INTO sessions (starts_at, ends_at, location) VALUES ($1, $2, $3) RETURNING id",
        [startsAt, endsAt, `Gymnase de démonstration ${index + 1}`]
      );
      sessionIds.push(result.rows[0].id);
    }

    const sampleResponses = [
      [sessionIds[0], memberIds[0], "present"],
      [sessionIds[0], memberIds[1], "maybe"],
      [sessionIds[1], memberIds[2], "present"]
    ];
    for (const [sessionId, memberId, response] of sampleResponses) {
      await client.query(
        "INSERT INTO attendance (session_id, member_id, response) VALUES ($1, $2, $3)",
        [sessionId, memberId, response]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
