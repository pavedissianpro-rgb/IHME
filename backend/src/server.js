import "dotenv/config";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import {
  ensureUpcomingSessions, initializeDatabase, normalizeName, pool
} from "./db.js";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(appDirectory, "../../frontend/dist");
const cookieName = "salbris_coach";
const statuses = new Set(["present", "absent", "incertain"]);
const basePath = normalizeBasePath(process.env.BASE_PATH || "/");
const timezone = process.env.CLUB_TIMEZONE || "Europe/Paris";

function normalizeBasePath(value) {
  if (typeof value !== "string" || !/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(value)) {
    throw new Error("BASE_PATH doit être un chemin absolu sûr se terminant par /.");
  }
  return value;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function normalizedField(value, label, { required = true, maxLength = 100 } = {}) {
  if (typeof value !== "string") {
    if (!required && (value === undefined || value === null)) return "";
    throw new InputError(`Vérifiez le champ « ${label} ».`);
  }
  const result = value.trim().replace(/\s+/gu, " ");
  if ((!result && required) || result.length > maxLength || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new InputError(`Le champ « ${label} » doit contenir au maximum ${maxLength} caractères.`);
  }
  return result;
}

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateSession(body) {
  if (!validDate(body.sessionDate) || !validTime(body.startTime) || !validTime(body.endTime) ||
      body.endTime <= body.startTime) {
    throw new InputError("Vérifiez la date et les heures de la séance.");
  }
  return {
    sessionDate: body.sessionDate,
    startTime: body.startTime,
    endTime: body.endTime,
    location: normalizedField(body.location, "lieu", { maxLength: 160 }),
    coachName: normalizedField(body.coachName, "entraîneur"),
    note: normalizedField(body.note ?? "", "note", { required: false, maxLength: 1000 })
  };
}

function playerName(firstName, lastName) {
  const first = normalizedField(firstName, "prénom");
  const last = normalizedField(lastName, "nom");
  const normalizedName = normalizeName(`${first} ${last}`);
  if (!normalizedName || normalizedName.length > 200) {
    throw new InputError("Le prénom et le nom doivent contenir au maximum 100 caractères chacun.");
  }
  return { firstName: first, lastName: last, normalizedName };
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function calculateAttendanceRate(presentCount, attendanceCount) {
  const present = Number(presentCount);
  const total = Number(attendanceCount);
  if (!Number.isFinite(present) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((present / total) * 1000) / 10;
}

function cookieOptions(req) {
  const secure = process.env.NODE_ENV === "production" &&
    (req.secure || process.env.PUBLIC_ORIGIN?.startsWith("https://"));
  return { httpOnly: true, sameSite: "strict", secure: Boolean(secure), path: basePath, maxAge: 12 * 60 * 60 * 1000 };
}

function coachAuthentication(database) {
  return async (req, res, next) => {
    const token = req.cookies[cookieName];
    if (!token) return res.status(401).json({ error: "Connectez-vous pour accéder à cette fonction." });
    try {
      const result = await database.query(`
        SELECT token_hash FROM coach_sessions
        WHERE token_hash = $1 AND expires_at > NOW()
      `, [tokenHash(token)]);
      if (!result.rowCount) {
        res.clearCookie(cookieName, { ...cookieOptions(req), maxAge: undefined });
        return res.status(401).json({ error: "Votre session a expiré. Veuillez vous reconnecter." });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

class InputError extends Error {}

export function createApp({ database = pool } = {}) {
  const app = express();
  const requireCoach = coachAuthentication(database);
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "20kb" }));
  app.use(cookieParser());

  if (basePath !== "/") {
    const mountedApiPrefix = `${basePath}api`;
    app.use((req, _res, next) => {
      if (req.url === mountedApiPrefix || req.url.startsWith(`${mountedApiPrefix}/`) ||
          req.url.startsWith(`${mountedApiPrefix}?`)) {
        req.url = req.url.slice(basePath.length - 1);
      }
      next();
    });
  }

  app.use((req, res, next) => {
    if (req.body === undefined || req.body === null) req.body = {};
    if (typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Les informations envoyées sont invalides." });
    }
    next();
  });

  app.get("/api/health", async (req, res) => {
    try {
      await database.query("SELECT 1");
      return res.json({ status: "ok" });
    } catch (error) {
      console.error("Vérification de la base indisponible.", error);
      return res.status(503).json({ status: "unavailable" });
    }
  });

  app.post("/api/auth/login", rateLimit({
    windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
    message: { error: "Trop de tentatives. Veuillez réessayer dans quelques minutes." }
  }), asyncRoute(async (req, res) => {
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!password || password.length > 256) {
      return res.status(401).json({ error: "Mot de passe incorrect." });
    }
    const stored = await database.query("SELECT password_hash FROM coach_credentials WHERE id = 1");
    const hash = stored.rows[0]?.password_hash;
    if (!hash || !(await bcrypt.compare(password, hash))) {
      return res.status(401).json({ error: "Mot de passe incorrect." });
    }
    const token = crypto.randomBytes(32).toString("base64url");
    await database.query(`
      INSERT INTO coach_sessions (token_hash, expires_at)
      VALUES ($1, NOW() + INTERVAL '12 hours')
    `, [tokenHash(token)]);
    res.cookie(cookieName, token, cookieOptions(req));
    return res.json({ coach: { authenticated: true } });
  }));

  app.post("/api/auth/logout", asyncRoute(async (req, res) => {
    const token = req.cookies[cookieName];
    if (token) await database.query("DELETE FROM coach_sessions WHERE token_hash = $1", [tokenHash(token)]);
    res.clearCookie(cookieName, { ...cookieOptions(req), maxAge: undefined });
    return res.status(204).end();
  }));

  app.get("/api/auth/me", requireCoach, (_req, res) => res.json({ coach: { authenticated: true } }));

  app.get("/api/sessions", asyncRoute(async (_req, res) => {
    const result = await database.query(`
      SELECT s.id, s.session_date, s.start_time, s.end_time, s.location,
        COALESCE(s.coach_name, s.coach, 'Entraîneur') AS coach_name, s.note,
        s.starts_at, s.ends_at,
        COUNT(r.id) FILTER (WHERE r.status = 'present')::int AS present_count,
        COUNT(r.id) FILTER (WHERE r.status = 'absent')::int AS absent_count,
        COUNT(r.id) FILTER (WHERE r.status = 'incertain')::int AS uncertain_count
      FROM sessions s
      LEFT JOIN responses r ON r.session_id = s.id
      WHERE COALESCE(s.cancelled, s.is_cancelled, FALSE) = FALSE
        AND s.starts_at >= NOW()
      GROUP BY s.id
      ORDER BY s.starts_at
    `);
    return res.json({ sessions: result.rows });
  }));

  app.get("/api/coach/sessions", requireCoach, asyncRoute(async (_req, res) => {
    const result = await database.query(`
      SELECT s.id, s.session_date, s.start_time, s.end_time, s.location,
        COALESCE(s.coach_name, s.coach, 'Entraîneur') AS coach_name, s.note,
        s.starts_at, s.ends_at
      FROM sessions s
      WHERE COALESCE(s.cancelled, s.is_cancelled, FALSE) = FALSE
      ORDER BY s.starts_at
    `);
    return res.json({ sessions: result.rows });
  }));

  app.get("/api/sessions/:id/responses", asyncRoute(async (req, res) => {
    const sessionId = validId(req.params.id);
    if (!sessionId) return res.status(400).json({ error: "Séance introuvable." });
    const session = await database.query(`
      SELECT id FROM sessions
      WHERE id = $1 AND COALESCE(cancelled, is_cancelled, FALSE) = FALSE
    `, [sessionId]);
    if (!session.rowCount) return res.status(404).json({ error: "Cette séance n’existe plus." });
    const result = await database.query(`
      SELECT p.id AS player_id, p.first_name, p.last_name, r.status
      FROM responses r
      JOIN players p ON p.id = r.player_id
      WHERE r.session_id = $1
      ORDER BY p.last_name, p.first_name
    `, [sessionId]);
    const counts = { present: 0, absent: 0, incertain: 0 };
    for (const row of result.rows) counts[row.status] += 1;
    return res.json({ responses: result.rows, counts });
  }));

  app.post("/api/responses", rateLimit({
    windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
    message: { error: "Trop de réponses envoyées. Réessayez dans quelques minutes." }
  }), asyncRoute(async (req, res) => {
    const sessionId = validId(req.body.sessionId);
    const status = req.body.status;
    if (!sessionId || !statuses.has(status)) {
      return res.status(400).json({ error: "Choisissez une séance et un statut valide." });
    }
    const player = playerName(req.body.firstName, req.body.lastName);
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const session = await client.query(`
        SELECT id FROM sessions
        WHERE id = $1 AND COALESCE(cancelled, is_cancelled, FALSE) = FALSE
          AND starts_at >= NOW()
      `, [sessionId]);
      if (!session.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Cette séance est introuvable ou ne prend plus de réponses." });
      }
      const createdPlayer = await client.query(`
        INSERT INTO players (first_name, last_name, normalized_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (normalized_name) DO UPDATE
          SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
        RETURNING id, first_name, last_name
      `, [player.firstName, player.lastName, player.normalizedName]);
      const result = await client.query(`
        INSERT INTO responses (session_id, player_id, status)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id, player_id) DO UPDATE
          SET status = EXCLUDED.status, updated_at = NOW()
        RETURNING session_id, player_id, status
      `, [sessionId, createdPlayer.rows[0].id, status]);
      await client.query("COMMIT");
      return res.status(200).json({ response: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }));

  app.get("/api/trainers", asyncRoute(async (_req, res) => {
    const result = await database.query("SELECT id, name FROM trainers ORDER BY name");
    return res.json({ trainers: result.rows });
  }));

  app.post("/api/trainers", requireCoach, asyncRoute(async (req, res) => {
    const name = normalizedField(req.body.name, "nom de l’entraîneur");
    const result = await database.query(`
      INSERT INTO trainers (name, normalized_name)
      VALUES ($1, $2)
      ON CONFLICT (normalized_name) DO NOTHING
      RETURNING id, name
    `, [name, normalizeName(name)]);
    if (!result.rowCount) return res.status(409).json({ error: "Cet entraîneur figure déjà dans la liste." });
    return res.status(201).json({ trainer: result.rows[0] });
  }));

  app.post("/api/sessions", requireCoach, asyncRoute(async (req, res) => {
    const session = validateSession(req.body);
    await database.query(`
      INSERT INTO trainers (name, normalized_name) VALUES ($1, $2)
      ON CONFLICT (normalized_name) DO NOTHING
    `, [session.coachName, normalizeName(session.coachName)]);
    const result = await database.query(`
      INSERT INTO sessions (
        session_date, start_time, end_time, location, coach_name, note, cancelled,
        starts_at, ends_at, coach, is_recurring, is_cancelled
      )
      VALUES (
        $1::date, $2::time, $3::time, $4, $5, NULLIF($6, ''), FALSE,
        ($1::date + $2::time) AT TIME ZONE $7,
        ($1::date + $3::time) AT TIME ZONE $7,
        $5, FALSE, FALSE
      )
      RETURNING id, session_date, start_time, end_time, location, coach_name, note
    `, [session.sessionDate, session.startTime, session.endTime, session.location, session.coachName, session.note, timezone]);
    return res.status(201).json({ session: result.rows[0] });
  }));

  app.patch("/api/sessions/:id", requireCoach, asyncRoute(async (req, res) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: "Séance introuvable." });
    const session = validateSession(req.body);
    await database.query(`
      INSERT INTO trainers (name, normalized_name) VALUES ($1, $2)
      ON CONFLICT (normalized_name) DO NOTHING
    `, [session.coachName, normalizeName(session.coachName)]);
    const result = await database.query(`
      UPDATE sessions
      SET session_date = $1::date, start_time = $2::time, end_time = $3::time,
        location = $4, coach_name = $5, note = NULLIF($6, ''), cancelled = FALSE,
        starts_at = ($1::date + $2::time) AT TIME ZONE $7,
        ends_at = ($1::date + $3::time) AT TIME ZONE $7,
        coach = $5, is_recurring = FALSE, is_cancelled = FALSE
      WHERE id = $8 AND COALESCE(cancelled, is_cancelled, FALSE) = FALSE
      RETURNING id, session_date, start_time, end_time, location, coach_name, note
    `, [session.sessionDate, session.startTime, session.endTime, session.location, session.coachName, session.note, timezone, id]);
    if (!result.rowCount) return res.status(404).json({ error: "Cette séance n’existe plus." });
    return res.json({ session: result.rows[0] });
  }));

  app.patch("/api/sessions/:id/cancel", requireCoach, asyncRoute(async (req, res) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: "Séance introuvable." });
    const result = await database.query(`
      UPDATE sessions SET cancelled = TRUE, is_cancelled = TRUE
      WHERE id = $1 AND COALESCE(cancelled, is_cancelled, FALSE) = FALSE
      RETURNING id
    `, [id]);
    if (!result.rowCount) return res.status(404).json({ error: "Cette séance n’existe plus." });
    return res.json({ message: "Séance annulée." });
  }));

  app.delete("/api/sessions/:id", requireCoach, asyncRoute(async (req, res) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: "Séance introuvable." });
    const result = await database.query("DELETE FROM sessions WHERE id = $1 RETURNING id", [id]);
    if (!result.rowCount) return res.status(404).json({ error: "Cette séance n’existe plus." });
    return res.status(204).end();
  }));

  app.get("/api/players", requireCoach, asyncRoute(async (_req, res) => {
    const result = await database.query(`
      SELECT p.id, p.first_name, p.last_name, p.created_at,
        COUNT(r.id)::int AS response_count
      FROM players p LEFT JOIN responses r ON r.player_id = p.id
      GROUP BY p.id ORDER BY p.last_name, p.first_name
    `);
    return res.json({ players: result.rows });
  }));

  app.post("/api/players", requireCoach, asyncRoute(async (req, res) => {
    const player = playerName(req.body.firstName, req.body.lastName);
    const result = await database.query(`
      INSERT INTO players (first_name, last_name, normalized_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (normalized_name) DO NOTHING
      RETURNING id, first_name, last_name
    `, [player.firstName, player.lastName, player.normalizedName]);
    if (!result.rowCount) return res.status(409).json({ error: "Ce joueur existe déjà." });
    return res.status(201).json({ player: result.rows[0] });
  }));

  app.delete("/api/players/:id", requireCoach, asyncRoute(async (req, res) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: "Joueur introuvable." });
    const result = await database.query("DELETE FROM players WHERE id = $1 RETURNING id", [id]);
    if (!result.rowCount) return res.status(404).json({ error: "Ce joueur n’existe plus." });
    return res.status(204).end();
  }));

  app.get("/api/players/:id/history", requireCoach, asyncRoute(async (req, res) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: "Joueur introuvable." });
    const result = await database.query(`
      SELECT s.id AS session_id, s.session_date, s.start_time, s.location,
        COALESCE(s.coach_name, s.coach, 'Entraîneur') AS coach_name,
        r.status, r.actual_presence
      FROM responses r
      JOIN sessions s ON s.id = r.session_id
      WHERE r.player_id = $1 AND COALESCE(s.cancelled, s.is_cancelled, FALSE) = FALSE
      ORDER BY s.session_date DESC, s.start_time DESC
    `, [id]);
    return res.json({ history: result.rows });
  }));

  app.post("/api/players/merge", requireCoach, asyncRoute(async (req, res) => {
    const keepId = validId(req.body.keepPlayerId);
    const mergeId = validId(req.body.mergePlayerId);
    if (!keepId || !mergeId || keepId === mergeId) {
      return res.status(400).json({ error: "Sélectionnez deux joueurs différents." });
    }
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const players = await client.query("SELECT id FROM players WHERE id = ANY($1::int[])", [[keepId, mergeId]]);
      if (players.rowCount !== 2) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Un des joueurs sélectionnés n’existe plus." });
      }
      await client.query(`
        INSERT INTO responses (session_id, player_id, status, actual_presence, updated_at)
        SELECT session_id, $1, status, actual_presence, updated_at
        FROM responses WHERE player_id = $2
        ON CONFLICT (session_id, player_id) DO NOTHING
      `, [keepId, mergeId]);
      await client.query("DELETE FROM players WHERE id = $1", [mergeId]);
      await client.query("COMMIT");
      return res.json({ message: "Les joueurs ont été fusionnés." });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }));

  app.get("/api/sessions/:id/coach-responses", requireCoach, asyncRoute(async (req, res) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: "Séance introuvable." });
    const result = await database.query(`
      SELECT p.id AS player_id, p.first_name, p.last_name, r.status, r.actual_presence
      FROM players p
      LEFT JOIN responses r ON r.player_id = p.id AND r.session_id = $1
      WHERE EXISTS (SELECT 1 FROM sessions WHERE id = $1)
      ORDER BY p.last_name, p.first_name
    `, [id]);
    const exists = await database.query("SELECT 1 FROM sessions WHERE id = $1", [id]);
    if (!exists.rowCount) return res.status(404).json({ error: "Cette séance n’existe plus." });
    return res.json({ players: result.rows });
  }));

  app.patch("/api/sessions/:sessionId/responses/:playerId", requireCoach, asyncRoute(async (req, res) => {
    const sessionId = validId(req.params.sessionId);
    const playerId = validId(req.params.playerId);
    const status = req.body.status;
    const actualPresence = req.body.actualPresence;
    if (!sessionId || !playerId || (status !== undefined && status !== null && !statuses.has(status)) ||
        (actualPresence !== undefined && actualPresence !== null && typeof actualPresence !== "boolean")) {
      return res.status(400).json({ error: "Vérifiez le statut et la présence réelle." });
    }
    if (status === undefined && actualPresence === undefined) {
      return res.status(400).json({ error: "Indiquez au moins une correction à enregistrer." });
    }
    if (status === null) {
      const deleted = await database.query(
        "DELETE FROM responses WHERE session_id = $1 AND player_id = $2 RETURNING id",
        [sessionId, playerId]
      );
      if (!deleted.rowCount) return res.status(404).json({ error: "Réponse introuvable." });
      return res.status(204).end();
    }
    if (actualPresence !== undefined) {
      const completedSession = await database.query(
        "SELECT id FROM sessions WHERE id = $1 AND ends_at < NOW()",
        [sessionId]
      );
      if (!completedSession.rowCount) {
        return res.status(400).json({ error: "La présence réelle peut être saisie après la séance." });
      }
    }
    const result = await database.query(`
      INSERT INTO responses (session_id, player_id, status, actual_presence)
      SELECT $1, $2, COALESCE($3, 'incertain'), $4
      WHERE EXISTS (SELECT 1 FROM sessions WHERE id = $1)
        AND EXISTS (SELECT 1 FROM players WHERE id = $2)
      ON CONFLICT (session_id, player_id) DO UPDATE SET
        status = COALESCE($3, responses.status),
        actual_presence = CASE WHEN $5 THEN $4 ELSE responses.actual_presence END,
        updated_at = NOW()
      RETURNING session_id, player_id, status, actual_presence
    `, [sessionId, playerId, status ?? null, actualPresence ?? null, actualPresence !== undefined]);
    if (!result.rowCount) return res.status(404).json({ error: "Séance ou joueur introuvable." });
    return res.json({ response: result.rows[0] });
  }));

  app.get("/api/stats", requireCoach, asyncRoute(async (req, res) => {
    const from = req.query.from || null;
    const to = req.query.to || null;
    if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
      return res.status(400).json({ error: "La période sélectionnée est invalide." });
    }
    const [players, sessions] = await Promise.all([
      database.query(`
        WITH eligible AS (
          SELECT s.id, s.session_date
          FROM sessions s
          WHERE COALESCE(s.cancelled, s.is_cancelled, FALSE) = FALSE
            AND s.starts_at < NOW()
            AND ($1::date IS NULL OR s.session_date >= $1::date)
            AND ($2::date IS NULL OR s.session_date <= $2::date)
        ),
        totals AS (SELECT COUNT(*)::int AS total FROM eligible),
        history AS (
          SELECT r.player_id,
            COUNT(r.id)::int AS responses_count,
            COUNT(r.id) FILTER (WHERE COALESCE(r.actual_presence, r.status = 'present'))::int AS present_count,
            COUNT(r.id) FILTER (WHERE COALESCE(r.actual_presence, r.status = 'absent'))::int AS absent_count,
            COUNT(r.id) FILTER (WHERE r.status = 'incertain')::int AS uncertain_count
          FROM responses r JOIN eligible e ON e.id = r.session_id
          GROUP BY r.player_id
        )
        SELECT p.id, p.first_name, p.last_name,
          totals.total AS sessions_count,
          COALESCE(history.present_count, 0)::int AS present_count,
          COALESCE(history.absent_count, 0)::int AS absent_count,
          COALESCE(history.uncertain_count, 0)::int AS uncertain_count,
          GREATEST(totals.total - COALESCE(history.responses_count, 0), 0)::int AS unanswered_count
        FROM players p CROSS JOIN totals
        LEFT JOIN history ON history.player_id = p.id
        ORDER BY p.last_name, p.first_name
      `, [from, to]),
      database.query(`
        SELECT s.id, s.session_date, s.start_time,
          COALESCE(s.coach_name, s.coach, 'Entraîneur') AS coach_name,
          COUNT(r.id) FILTER (WHERE COALESCE(r.actual_presence, r.status = 'present'))::int AS present_count,
          COUNT(r.id) FILTER (WHERE COALESCE(r.actual_presence, r.status = 'absent'))::int AS absent_count,
          COUNT(r.id)::int AS responses_count,
          CASE WHEN COUNT(r.id) > 0 THEN ROUND(100.0 *
              COUNT(r.id) FILTER (WHERE COALESCE(r.actual_presence, r.status = 'present'))
              / NULLIF(COUNT(r.id), 0), 1)
            ELSE 0 END AS attendance_rate
        FROM sessions s
        LEFT JOIN responses r ON r.session_id = s.id
        WHERE COALESCE(s.cancelled, s.is_cancelled, FALSE) = FALSE
          AND s.starts_at < NOW()
          AND ($1::date IS NULL OR s.session_date >= $1::date)
          AND ($2::date IS NULL OR s.session_date <= $2::date)
        GROUP BY s.id ORDER BY s.session_date, s.start_time
      `, [from, to])
    ]);
    const playerStats = players.rows.map((player) => ({
      ...player,
      attendance_rate: calculateAttendanceRate(player.present_count, player.sessions_count)
    })).sort((left, right) => right.attendance_rate - left.attendance_rate ||
      left.last_name.localeCompare(right.last_name, "fr") ||
      left.first_name.localeCompare(right.first_name, "fr"));
    return res.json({ players: playerStats, sessions: sessions.rows });
  }));

  app.get("/api/stats.csv", requireCoach, asyncRoute(async (req, res) => {
    const from = req.query.from || null;
    const to = req.query.to || null;
    if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
      return res.status(400).json({ error: "La période sélectionnée est invalide." });
    }
    const result = await database.query(`
      WITH eligible AS (
        SELECT id, session_date FROM sessions
        WHERE COALESCE(cancelled, is_cancelled, FALSE) = FALSE AND starts_at < NOW()
          AND ($1::date IS NULL OR session_date >= $1::date)
          AND ($2::date IS NULL OR session_date <= $2::date)
      ),
      total AS (SELECT COUNT(*)::int AS count FROM eligible),
      player_stats AS (
        SELECT p.id, p.first_name, p.last_name,
          COUNT(r.id)::int AS response_count,
          COUNT(r.id) FILTER (WHERE COALESCE(r.actual_presence, r.status = 'present'))::int AS present_count,
          COUNT(r.id) FILTER (WHERE COALESCE(r.actual_presence, r.status = 'absent'))::int AS absent_count,
          COUNT(r.id) FILTER (WHERE r.status = 'incertain')::int AS uncertain
        FROM players p LEFT JOIN responses r ON r.player_id = p.id AND r.session_id IN (SELECT id FROM eligible)
        GROUP BY p.id
      )
      SELECT first_name, last_name, total.count AS sessions_count,
        present_count, absent_count,
        uncertain::int AS uncertain_count,
        GREATEST(total.count - response_count, 0)::int AS unanswered_count,
        total.count::int AS attendance_denominator
      FROM player_stats CROSS JOIN total ORDER BY last_name, first_name
    `, [from, to]);
    const headers = ["Prénom", "Nom", "Séances", "Présences", "Absences", "Incertaines", "Sans réponse", "Taux de présence (%)"];
    const formulaSafe = (value) => {
      const text = String(value ?? "");
      return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    };
    const csv = [headers, ...result.rows.map((row) => [
      row.first_name, row.last_name, row.sessions_count, row.present_count, row.absent_count,
      row.uncertain_count, row.unanswered_count,
      calculateAttendanceRate(row.present_count, row.attendance_denominator)
    ])].map((row) => row.map((field) => `"${formulaSafe(field).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    res.type("text/csv; charset=utf-8");
    res.set("Content-Disposition", 'attachment; filename="statistiques-salbris.csv"');
    return res.send(`\uFEFF${csv}`);
  }));

  if (existsSync(frontendDirectory)) {
    app.use(basePath, express.static(frontendDirectory, { index: false, maxAge: "1h" }));
    app.use(express.static(frontendDirectory, { index: false, maxAge: "1h" }));
  }
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Cette page n’existe pas." });
    const indexPath = path.join(frontendDirectory, "index.html");
    if (!existsSync(indexPath)) return res.status(404).json({ error: "Cette page n’existe pas." });
    res.sendFile(indexPath, (error) => { if (error) next(error); });
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof InputError) return res.status(400).json({ error: error.message });
    console.error("Erreur de traitement de la requête.", error);
    if (res.headersSent) return;
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Les informations envoyées ne sont pas valides." });
    if (error.type === "entity.too.large") return res.status(413).json({ error: "Les informations envoyées sont trop volumineuses." });
    return res.status(500).json({ error: "Une erreur est survenue. Veuillez réessayer." });
  });
  return app;
}

export async function start({ database = pool, port = Number(process.env.PORT || 3000) } = {}) {
  if (process.env.COACH_PASSWORD && process.env.COACH_PASSWORD.length < 12) {
    throw new Error("COACH_PASSWORD doit contenir au moins 12 caractères.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL doit désigner la base PostgreSQL.");
  await initializeDatabase({ database });
  const app = createApp({ database });
  const server = app.listen(port, "0.0.0.0", () => console.log(`Badminton Club de Salbris écoute sur le port ${port}.`));
  const refresh = setInterval(() => {
    ensureUpcomingSessions({ database }).catch((error) => {
      console.error("Impossible de compléter le planning des deux prochaines semaines.", error);
    });
  }, 60 * 60 * 1000);
  refresh.unref();
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch(async (error) => {
    console.error("Impossible de démarrer l’application.", error);
    await pool.end();
    process.exitCode = 1;
  });
}
