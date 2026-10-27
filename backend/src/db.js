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
      coach TEXT NOT NULL DEFAULT 'Entraîneur démo',
      is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
      is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT sessions_valid_time CHECK (ends_at > starts_at)
    );
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS coach TEXT NOT NULL DEFAULT 'Entraîneur démo';
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN NOT NULL DEFAULT FALSE;
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

  if (seedDemo) await ensureDemoMembers();
  await ensureUpcomingSessions({ seedDemo });
  if (seedDemo) await seedDemoAttendance();
}

export async function ensureUpcomingSessions({ seedDemo = false } = {}) {
  const timezone = process.env.CLUB_TIMEZONE || "Europe/Paris";
  const location = seedDemo ? "Gymnase de démonstration" : (process.env.CLUB_LOCATION || "Pillon");
  const schedule = seedDemo
    ? ["Entraîneur démo", "Entraîneur démo", "Entraîneur démo"]
    : [
        process.env.CLUB_TUESDAY_COACH || "Entraîneur",
        process.env.CLUB_THURSDAY_COACH || "Entraîneur",
        process.env.CLUB_FRIDAY_COACH || "Entraîneur"
      ];

  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: timezone });
  } catch {
    throw new Error("CLUB_TIMEZONE doit être un fuseau horaire IANA valide.");
  }
  if (!seedDemo && process.env.ALLOW_REAL_NAMES === "true" &&
      [process.env.CLUB_TUESDAY_COACH, process.env.CLUB_THURSDAY_COACH, process.env.CLUB_FRIDAY_COACH]
        .some((name) => !name?.trim() || name.trim().length > 100)) {
    throw new Error("Configurez les trois noms d'entraîneur dans l'environnement privé du club.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(74192831)");
    await client.query(`
      WITH days AS (
        SELECT (NOW() AT TIME ZONE $1)::date + day_offset AS local_date
        FROM generate_series(0, 14) AS offsets(day_offset)
      ),
      weekly_schedule(weekday, starts, ends, coach) AS (
        VALUES
          (2, TIME '19:00', TIME '21:00', $2::text),
          (4, TIME '19:00', TIME '21:00', $3::text),
          (5, TIME '19:00', TIME '20:00', $4::text)
      ),
      planned AS (
        SELECT
          ((days.local_date + weekly_schedule.starts) AT TIME ZONE $1) AS starts_at,
          ((days.local_date + weekly_schedule.ends) AT TIME ZONE $1) AS ends_at,
          weekly_schedule.coach
        FROM days
        JOIN weekly_schedule ON EXTRACT(ISODOW FROM days.local_date) = weekly_schedule.weekday
      ),
      update_recurring AS (
        UPDATE sessions existing
        SET ends_at = planned.ends_at, location = $5, coach = planned.coach
        FROM planned
        WHERE existing.starts_at = planned.starts_at
          AND existing.is_recurring = TRUE
          AND existing.is_cancelled = FALSE
        RETURNING existing.id
      )
      INSERT INTO sessions (starts_at, ends_at, location, coach, is_recurring)
      SELECT planned.starts_at, planned.ends_at, $5, planned.coach, TRUE
      FROM planned
      WHERE planned.starts_at >= NOW()
        AND planned.starts_at < NOW() + INTERVAL '14 days'
        AND NOT EXISTS (
          SELECT 1 FROM sessions existing
          WHERE existing.starts_at = planned.starts_at
        )
    `, [timezone, ...schedule, location]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureDemoMembers() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(74192832)");
    const safeDemoData = await client.query(`
      SELECT
        NOT EXISTS (SELECT 1 FROM members WHERE name !~ '^Joueur Démo [0-9]{2}$')
        AND NOT EXISTS (SELECT 1 FROM sessions WHERE location !~ '^Gymnase de démonstration$' AND location !~ '^Gymnase de démonstration [0-9]+$')
        AND NOT EXISTS (SELECT 1 FROM sessions WHERE coach !~ '^Entraîneur démo$')
        AS safe
    `);
    if (!safeDemoData.rows[0].safe) {
      throw new Error("La base contient des données non fictives; refus de démarrer en mode démonstration.");
    }

    await client.query("DELETE FROM sessions WHERE location ~ '^Gymnase de démonstration [0-9]+$'");
    await client.query(`
      INSERT INTO members (name)
      SELECT name FROM unnest(ARRAY['Joueur Démo 01', 'Joueur Démo 02', 'Joueur Démo 03']) AS demo_names(name)
      ON CONFLICT (name) DO NOTHING
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedDemoAttendance() {
  await pool.query(`
    INSERT INTO attendance (session_id, member_id, response)
    SELECT sessions.id, members.id, demo.response
    FROM (
      VALUES
        (0, 1, 'present'::text),
        (0, 2, 'maybe'::text),
        (1, 3, 'present'::text)
    ) AS demo(session_number, member_number, response)
    JOIN (
      SELECT id, ROW_NUMBER() OVER (ORDER BY starts_at) - 1 AS session_number
      FROM sessions
      WHERE location = 'Gymnase de démonstration' AND is_cancelled = FALSE AND starts_at >= NOW()
    ) sessions ON sessions.session_number = demo.session_number
    JOIN (
      SELECT id, ROW_NUMBER() OVER (ORDER BY name) AS member_number
      FROM members
      WHERE name LIKE 'Joueur Démo %'
    ) members ON members.member_number = demo.member_number
    ON CONFLICT (session_id, member_id) DO NOTHING
  `);
}
