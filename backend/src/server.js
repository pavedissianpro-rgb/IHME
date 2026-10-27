import "dotenv/config";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { initializeDatabase, pool } from "./db.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const cookieName = "badminton_coach";
const demoMode = !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET;
const frontendDirectory = fileURLToPath(new URL("../../frontend/dist/", import.meta.url));
const responses = new Set(["present", "absent", "maybe"]);

if ((!process.env.DATABASE_URL && !(process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD)) ||
    (process.env.NODE_ENV === "production" && !process.env.PUBLIC_ORIGIN) ||
    ([process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, process.env.JWT_SECRET].some(Boolean) && demoMode)) {
  throw new Error("Configurez la base de données, PUBLIC_ORIGIN en production, et les trois identifiants entraîneur ensemble.");
}
if (!demoMode && process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET doit contenir au moins 32 caractères.");
}
if (process.env.PUBLIC_ORIGIN) {
  const origin = new URL(process.env.PUBLIC_ORIGIN);
  if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== process.env.PUBLIC_ORIGIN) {
    throw new Error("PUBLIC_ORIGIN doit être une origine HTTP(S) sans chemin.");
  }
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.body === undefined || req.body === null) req.body = {};
  if (typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ error: "Le corps de la requête doit être un objet JSON." });
  }
  next();
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireCoach(req, res, next) {
  if (demoMode) return res.status(403).json({ error: "La gestion entraîneur est désactivée sur la démonstration." });
  const token = req.cookies[cookieName];
  if (!token) return res.status(401).json({ error: "Connexion entraîneur requise." });

  try {
    req.coach = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    res.clearCookie(cookieName, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    return res.status(401).json({ error: "Session expirée, veuillez vous reconnecter." });
  }
}

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validLocation(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 160;
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", version: process.env.APP_VERSION || "local" });
}));

app.get("/api/config", (_req, res) => res.json({ demoMode }));

app.post("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }), asyncRoute(async (req, res) => {
  if (demoMode) return res.status(403).json({ error: "La connexion entraîneur est désactivée sur la démonstration." });
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const result = await pool.query("SELECT id, email, password_hash FROM coaches WHERE email = $1", [email]);
  const coach = result.rows[0];
  if (!coach || !(await bcrypt.compare(password, coach.password_hash))) {
    return res.status(401).json({ error: "Adresse e-mail ou mot de passe incorrect." });
  }

  const token = jwt.sign({ id: coach.id, email: coach.email }, process.env.JWT_SECRET, { expiresIn: "12h" });
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: process.env.BASE_PATH || "/",
    maxAge: 12 * 60 * 60 * 1000
  });
  return res.json({ coach: { email: coach.email } });
}));

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(cookieName, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: process.env.BASE_PATH || "/" });
  res.status(204).end();
});

app.get("/api/auth/me", requireCoach, (req, res) => res.json({ coach: { email: req.coach.email } }));

app.get("/api/members", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT id, name FROM members ORDER BY name");
  res.json({ members: result.rows });
}));

app.post("/api/members", requireCoach, asyncRoute(async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 100) return res.status(400).json({ error: "Le nom doit contenir entre 1 et 100 caractères." });

  try {
    const result = await pool.query("INSERT INTO members (name) VALUES ($1) RETURNING id, name", [name]);
    return res.status(201).json({ member: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Ce membre existe déjà." });
    throw error;
  }
}));

app.delete("/api/members/:id", requireCoach, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Identifiant de membre invalide." });
  const result = await pool.query("DELETE FROM members WHERE id = $1 RETURNING id", [id]);
  if (!result.rowCount) return res.status(404).json({ error: "Membre introuvable." });
  res.status(204).end();
}));

app.get("/api/sessions", asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT s.id, s.starts_at, s.ends_at, s.location,
      COUNT(a.member_id) FILTER (WHERE a.response = 'present')::int AS present_count,
      COUNT(a.member_id) FILTER (WHERE a.response = 'maybe')::int AS maybe_count,
      COUNT(a.member_id) FILTER (WHERE a.response = 'absent')::int AS absent_count
    FROM sessions s
    LEFT JOIN attendance a ON a.session_id = s.id
    WHERE s.starts_at >= NOW() - INTERVAL '1 day'
    GROUP BY s.id
    ORDER BY s.starts_at
  `);
  res.json({ sessions: result.rows });
}));

app.post("/api/sessions", requireCoach, asyncRoute(async (req, res) => {
  const { startsAt, endsAt, location } = req.body;
  if (!validDate(startsAt) || !validDate(endsAt) || Date.parse(endsAt) <= Date.parse(startsAt) || !validLocation(location)) {
    return res.status(400).json({ error: "Vérifiez les dates, horaires et le lieu de la séance." });
  }
  const result = await pool.query(
    "INSERT INTO sessions (starts_at, ends_at, location) VALUES ($1, $2, $3) RETURNING id, starts_at, ends_at, location",
    [startsAt, endsAt, location.trim()]
  );
  res.status(201).json({ session: result.rows[0] });
}));

app.patch("/api/sessions/:id", requireCoach, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { startsAt, endsAt, location } = req.body;
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Identifiant de séance invalide." });
  if (!validDate(startsAt) || !validDate(endsAt) || Date.parse(endsAt) <= Date.parse(startsAt) || !validLocation(location)) {
    return res.status(400).json({ error: "Vérifiez les dates, horaires et le lieu de la séance." });
  }
  const result = await pool.query(
    "UPDATE sessions SET starts_at = $1, ends_at = $2, location = $3 WHERE id = $4 RETURNING id, starts_at, ends_at, location",
    [startsAt, endsAt, location.trim(), id]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Séance introuvable." });
  res.json({ session: result.rows[0] });
}));

app.delete("/api/sessions/:id", requireCoach, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Identifiant de séance invalide." });
  const result = await pool.query("DELETE FROM sessions WHERE id = $1 RETURNING id", [id]);
  if (!result.rowCount) return res.status(404).json({ error: "Séance introuvable." });
  res.status(204).end();
}));

app.get("/api/sessions/:id/attendance", asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Identifiant de séance invalide." });
  const session = await pool.query("SELECT id FROM sessions WHERE id = $1", [id]);
  if (!session.rowCount) return res.status(404).json({ error: "Séance introuvable." });
  const result = await pool.query(`
    SELECT m.id, m.name, a.response
    FROM members m
    LEFT JOIN attendance a ON a.member_id = m.id AND a.session_id = $1
    ORDER BY m.name
  `, [id]);
  res.json({ attendance: result.rows });
}));

app.put("/api/sessions/:id/attendance", asyncRoute(async (req, res) => {
  const sessionId = Number(req.params.id);
  const memberId = Number(req.body.memberId);
  const response = req.body.response;
  if (!Number.isInteger(sessionId) || sessionId < 1 || !Number.isInteger(memberId) || memberId < 1 || !responses.has(response)) {
    return res.status(400).json({ error: "Séance, membre ou réponse invalide." });
  }
  const result = await pool.query(`
    INSERT INTO attendance (session_id, member_id, response)
    SELECT s.id, m.id, $3 FROM sessions s, members m
    WHERE s.id = $1 AND m.id = $2
    ON CONFLICT (session_id, member_id)
    DO UPDATE SET response = EXCLUDED.response, updated_at = NOW()
    RETURNING session_id, member_id, response
  `, [sessionId, memberId, response]);
  if (!result.rowCount) return res.status(404).json({ error: "Séance ou membre introuvable." });
  res.json({ attendance: result.rows[0] });
}));

app.get("/api/stats", requireCoach, asyncRoute(async (_req, res) => {
  const [summary, members] = await Promise.all([
    pool.query(`
      SELECT COUNT(DISTINCT s.id)::int AS sessions_count,
        COUNT(a.member_id) FILTER (WHERE a.response = 'present')::int AS present_count,
        COUNT(a.member_id) FILTER (WHERE a.response = 'maybe')::int AS maybe_count,
        COUNT(a.member_id) FILTER (WHERE a.response = 'absent')::int AS absent_count
      FROM sessions s LEFT JOIN attendance a ON a.session_id = s.id
      WHERE s.starts_at < NOW()
    `),
    pool.query(`
      SELECT m.id, m.name, COALESCE(history.attended_count, 0)::int AS attended_count
      FROM members m
      LEFT JOIN (
        SELECT a.member_id, COUNT(*) FILTER (WHERE a.response = 'present') AS attended_count
        FROM attendance a
        JOIN sessions s ON s.id = a.session_id
        WHERE s.starts_at < NOW()
        GROUP BY a.member_id
      ) history ON history.member_id = m.id
      ORDER BY attended_count DESC, m.name
    `)
  ]);
  res.json({ summary: summary.rows[0], members: members.rows });
}));

if (existsSync(frontendDirectory)) {
  app.use(express.static(frontendDirectory, { index: false, maxAge: "1h" }));
}
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Route introuvable." });
  if (!existsSync(path.join(frontendDirectory, "index.html"))) return res.status(404).json({ error: "Route introuvable." });
  res.sendFile(path.join(frontendDirectory, "index.html"), (error) => {
    if (error) next(error);
  });
});
app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Le corps JSON est invalide." });
  if (error.type === "entity.too.large") return res.status(413).json({ error: "Le corps de la requête est trop volumineux." });
  res.status(500).json({ error: "Une erreur interne est survenue." });
});

async function start() {
  await initializeDatabase({ seedDemo: demoMode });
  if (!demoMode) {
    const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await pool.query(
      "INSERT INTO coaches (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING",
      [email, passwordHash]
    );
  }
  app.listen(port, "0.0.0.0", () => console.log(`API Badminton Club démarrée sur le port ${port}.`));
}

start().catch(async (error) => {
  console.error("Impossible de démarrer l'API.", error);
  await pool.end();
  process.exitCode = 1;
});
