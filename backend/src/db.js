import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30_000
});

export function normalizeName(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr")
    .trim()
    .replace(/\s+/gu, " ");
}

function splitName(value) {
  const parts = value.trim().replace(/\s+/gu, " ").split(" ");
  return { firstName: parts.shift(), lastName: parts.join(" ") || "-" };
}

const weeklySchedule = [
  { weekday: 2, start: "19:00", end: "21:00", env: "CLUB_TUESDAY_COACH", defaultCoach: "Maxime MICHEL" },
  { weekday: 4, start: "19:00", end: "21:00", env: "CLUB_THURSDAY_COACH", defaultCoach: "Noah BULUT" },
  { weekday: 5, start: "19:00", end: "20:00", env: "CLUB_FRIDAY_COACH", defaultCoach: "Maxime MICHEL" }
];

export async function initializeDatabase() {
  const timezone = process.env.CLUB_TIMEZONE || "Europe/Paris";
  new Intl.DateTimeFormat("fr-FR", { timeZone: timezone });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      location TEXT,
      coach TEXT,
      is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
      is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT sessions_valid_time CHECK (ends_at > starts_at)
    );
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_date DATE;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS start_time TIME;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS end_time TIME;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS coach_name TEXT;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS note TEXT;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cancelled BOOLEAN;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS coach TEXT;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS responses (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'incertain')),
      actual_presence BOOLEAN,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, player_id)
    );
    CREATE TABLE IF NOT EXISTS trainers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS coach_credentials (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS coach_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE responses ADD COLUMN IF NOT EXISTS actual_presence BOOLEAN;
    CREATE INDEX IF NOT EXISTS sessions_date_idx ON sessions(session_date, start_time);
    CREATE INDEX IF NOT EXISTS sessions_starts_at_idx ON sessions(starts_at);
    CREATE INDEX IF NOT EXISTS responses_player_idx ON responses(player_id);
    CREATE INDEX IF NOT EXISTS responses_session_idx ON responses(session_id);
    CREATE INDEX IF NOT EXISTS coach_sessions_expiry_idx ON coach_sessions(expires_at);
  `);

  await pool.query(`
    UPDATE sessions
    SET session_date = (starts_at AT TIME ZONE $1)::date,
        start_time = (starts_at AT TIME ZONE $1)::time,
        end_time = (ends_at AT TIME ZONE $1)::time,
        coach_name = COALESCE(NULLIF(coach_name, ''), coach, ''),
        cancelled = COALESCE(cancelled, is_cancelled, FALSE)
    WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL
      AND (session_date IS NULL OR start_time IS NULL OR end_time IS NULL
        OR coach_name IS NULL OR cancelled IS NULL)
  `, [timezone]);

  await migrateLegacyMembers();
  await configureCoachPassword();
  await ensureUpcomingSessions();
  await migrateLegacyAttendance();
  await pool.query("DELETE FROM coach_sessions WHERE expires_at <= NOW()");
}

async function migrateLegacyMembers() {
  const result = await pool.query(`
    SELECT id, name FROM members
  `).catch((error) => {
    if (error.code === "42P01") return { rows: [] };
    throw error;
  });

  for (const member of result.rows) {
    const name = member.name.trim().replace(/\s+/gu, " ");
    if (!name) continue;
    const { firstName, lastName } = splitName(name);
    const normalizedName = normalizeName(`${firstName} ${lastName}`);
    await pool.query(`
      INSERT INTO players (first_name, last_name, normalized_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (normalized_name) DO NOTHING
    `, [firstName, lastName, normalizedName]);
  }
}

async function migrateLegacyAttendance() {
  const attendance = await pool.query(`
    SELECT a.session_id, m.name, a.response
    FROM attendance a
    JOIN members m ON m.id = a.member_id
  `).catch((error) => {
    if (error.code === "42P01") return { rows: [] };
    throw error;
  });

  for (const row of attendance.rows) {
    const { firstName, lastName } = splitName(row.name);
    const normalizedName = normalizeName(`${firstName} ${lastName}`);
    const status = row.response === "maybe" ? "incertain" : row.response;
    if (!["present", "absent", "incertain"].includes(status)) continue;
    await pool.query(`
      INSERT INTO responses (session_id, player_id, status)
      SELECT $1, id, $3 FROM players WHERE normalized_name = $2
      ON CONFLICT (session_id, player_id) DO NOTHING
    `, [row.session_id, normalizedName, status]);
  }
}

async function configureCoachPassword() {
  const password = process.env.COACH_PASSWORD;
  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.default.hash(password, 12);
  await pool.query(`
    INSERT INTO coach_credentials (id, password_hash)
    VALUES (1, $1)
    ON CONFLICT (id) DO UPDATE
    SET password_hash = EXCLUDED.password_hash, updated_at = NOW()
  `, [passwordHash]);
}

export async function ensureUpcomingSessions() {
  const timezone = process.env.CLUB_TIMEZONE || "Europe/Paris";
  const location = process.env.CLUB_LOCATION || "Gymnase Pillon";
  const names = weeklySchedule.map(({ env, defaultCoach }) => process.env[env]?.trim() || defaultCoach);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(74192831)");
    await client.query(`
      WITH days AS (
        SELECT (NOW() AT TIME ZONE $1)::date + day_offset AS local_date
        FROM generate_series(0, 13) AS offsets(day_offset)
      ),
      weekly_schedule(weekday, starts, ends, coach_name) AS (
        VALUES
          (2, TIME '19:00', TIME '21:00', $2::text),
          (4, TIME '19:00', TIME '21:00', $3::text),
          (5, TIME '19:00', TIME '20:00', $4::text)
      ),
      planned AS (
        SELECT days.local_date AS session_date, weekly_schedule.starts AS start_time,
          weekly_schedule.ends AS end_time, weekly_schedule.coach_name,
          (days.local_date + weekly_schedule.starts) AT TIME ZONE $1 AS starts_at,
          (days.local_date + weekly_schedule.ends) AT TIME ZONE $1 AS ends_at
        FROM days
        JOIN weekly_schedule ON EXTRACT(ISODOW FROM days.local_date) = weekly_schedule.weekday
      )
      UPDATE sessions existing
      SET ends_at = planned.ends_at, end_time = planned.end_time,
          location = $5, coach = planned.coach_name,
          coach_name = planned.coach_name
      FROM planned
      WHERE existing.session_date = planned.session_date
        AND existing.start_time = planned.start_time
        AND existing.is_recurring = TRUE
        AND existing.cancelled = FALSE
        AND existing.is_cancelled = FALSE
    `, [timezone, ...names, location]);

    await client.query(`
      WITH days AS (
        SELECT (NOW() AT TIME ZONE $1)::date + day_offset AS local_date
        FROM generate_series(0, 13) AS offsets(day_offset)
      ),
      weekly_schedule(weekday, starts, ends, coach_name) AS (
        VALUES
          (2, TIME '19:00', TIME '21:00', $2::text),
          (4, TIME '19:00', TIME '21:00', $3::text),
          (5, TIME '19:00', TIME '20:00', $4::text)
      ),
      planned AS (
        SELECT days.local_date AS session_date, weekly_schedule.starts AS start_time,
          weekly_schedule.ends AS end_time, weekly_schedule.coach_name,
          (days.local_date + weekly_schedule.starts) AT TIME ZONE $1 AS starts_at,
          (days.local_date + weekly_schedule.ends) AT TIME ZONE $1 AS ends_at
        FROM days
        JOIN weekly_schedule ON EXTRACT(ISODOW FROM days.local_date) = weekly_schedule.weekday
      )
      INSERT INTO sessions (
        starts_at, ends_at, location, coach, is_recurring, is_cancelled,
        session_date, start_time, end_time, coach_name, cancelled
      )
      SELECT starts_at, ends_at, $5, coach_name, TRUE, FALSE,
        session_date, start_time, end_time, coach_name, FALSE
      FROM planned
      WHERE starts_at >= NOW()
        AND starts_at < NOW() + INTERVAL '14 days'
        AND NOT EXISTS (
          SELECT 1 FROM sessions existing
          WHERE existing.session_date = planned.session_date
            AND existing.start_time = planned.start_time
        )
    `, [timezone, ...names, location]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
