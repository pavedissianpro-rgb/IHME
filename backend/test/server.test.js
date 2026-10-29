import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { calculateAttendanceRate, createApp, start } from "../src/server.js";
import { configureCoachPassword, initializeDatabase, normalizeName } from "../src/db.js";

class FixtureDatabase {
  constructor() {
    this.players = new Map();
    this.responses = new Map();
    this.nextPlayerId = 1;
    this.responseWrites = 0;
  }

  async query(sql) {
    if (sql.trim() === "SELECT 1") return { rows: [{ "?column?": 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }

  async connect() {
    return new FixtureClient(this);
  }
}

class FixtureClient {
  constructor(database) {
    this.database = database;
  }

  async query(sql, values = []) {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT id FROM sessions")) {
      return values[0] === 12 ? { rows: [{ id: 12 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO players")) {
      const [firstName, lastName, normalizedName] = values;
      let player = this.database.players.get(normalizedName);
      if (!player) {
        player = { id: this.database.nextPlayerId++, first_name: firstName, last_name: lastName };
        this.database.players.set(normalizedName, player);
      } else {
        player.first_name = firstName;
        player.last_name = lastName;
      }
      return { rows: [player], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO responses")) {
      const [sessionId, playerId, status] = values;
      const key = `${sessionId}:${playerId}`;
      const response = { session_id: sessionId, player_id: playerId, status };
      this.database.responses.set(key, response);
      this.database.responseWrites += 1;
      return { rows: [response], rowCount: 1 };
    }
    throw new Error(`Unexpected fixture query: ${sql}`);
  }

  release() {}
}

class EmptyMigrationDatabase {
  constructor() {
    this.schema = "";
    this.planningStatements = [];
  }

  async query(sql) {
    if (sql.trim() === "SELECT 1") return { rows: [{ "?column?": 1 }], rowCount: 1 };
    if (sql.includes("CREATE TABLE IF NOT EXISTS sessions")) {
      this.schema = sql;
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("UPDATE sessions")) return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT id, name FROM members") ||
        sql.includes("SELECT a.session_id, m.name, a.response")) {
      const error = new Error("relation does not exist");
      error.code = "42P01";
      throw error;
    }
    if (sql.startsWith("SELECT password_hash")) return { rows: [], rowCount: 0 };
    if (sql.includes("INSERT INTO coach_credentials")) return { rows: [{ id: 1 }], rowCount: 1 };
    if (sql.includes("DELETE FROM coach_sessions")) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected migration query: ${sql}`);
  }

  async connect() {
    return {
      query: async (sql) => {
        this.planningStatements.push(sql);
        return { rows: [], rowCount: 0 };
      },
      release() {}
    };
  }
}

test("la route de santé exécute la requête SQL et ne renvoie que le statut", async () => {
  const database = new FixtureDatabase();
  const response = await request(createApp({ database })).get("/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "ok" });
});

test("la route de santé renvoie 503 sans exposer l’erreur PostgreSQL", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await request(createApp({
      database: { query: async () => { throw new Error("private database detail"); } }
    })).get("/api/health");
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { status: "unavailable" });
  } finally {
    console.error = originalError;
  }
});

test("une réponse joueur valide avec un nom saisi est enregistrée", async () => {
  const database = new FixtureDatabase();
  const response = await request(createApp({ database }))
    .post("/api/responses")
    .send({ sessionId: 12, firstName: "Élodie", lastName: "Durand", status: "present" });

  assert.equal(response.status, 200);
  assert.equal(response.body.response.status, "present");
  assert.equal(database.players.size, 1);
  assert.equal(database.responses.size, 1);
});

test("une seconde réponse normalisée met à jour la première sans doublon", async () => {
  const database = new FixtureDatabase();
  const app = createApp({ database });
  const first = await request(app).post("/api/responses")
    .send({ sessionId: 12, firstName: "Élodie", lastName: "Durand", status: "present" });
  const second = await request(app).post("/api/responses")
    .send({ sessionId: 12, firstName: "  elodie ", lastName: "DURAND ", status: "absent" });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.response.status, "absent");
  assert.equal(database.players.size, 1);
  assert.equal(database.responses.size, 1);
  assert.equal(database.responseWrites, 2);
});

test("les fonctions entraîneur refusent une session non authentifiée", async () => {
  const app = createApp({ database: new FixtureDatabase() });
  const statsResponse = await request(app).get("/api/stats");
  const writeResponse = await request(app).post("/api/sessions").send({});
  assert.equal(statsResponse.status, 401);
  assert.equal(writeResponse.status, 401);
  assert.match(statsResponse.body.error, /Connectez-vous/u);
});

test("les noms ignorent la casse, les accents et les espaces superflus", () => {
  assert.equal(normalizeName("  Élodie   DURAND "), "elodie durand");
});

test("l'absence de COACH_PASSWORD génère un secret aléatoire une seule fois", async () => {
  const coachPassword = process.env.COACH_PASSWORD;
  delete process.env.COACH_PASSWORD;
  let storedHash;
  let credentialExists = false;
  let generatedLog = "";
  const database = {
    async query(sql, values = []) {
      if (sql.startsWith("SELECT password_hash")) {
        return { rows: credentialExists ? [{ password_hash: storedHash }] : [], rowCount: credentialExists ? 1 : 0 };
      }
      if (sql.includes("INSERT INTO coach_credentials")) {
        if (credentialExists) return { rows: [], rowCount: 0 };
        storedHash = values[0];
        credentialExists = true;
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      throw new Error(`Unexpected fixture query: ${sql}`);
    }
  };
  const originalWarn = console.warn;
  console.warn = (...args) => { generatedLog = args.join(" "); };
  try {
    await configureCoachPassword(database);
    const generatedPassword = generatedLog.split(" : ").at(-1);
    assert.ok(generatedPassword.length >= 32);
    assert.match(storedHash, /^\$2[aby]\$/u);
    const bcrypt = await import("bcryptjs");
    assert.equal(await bcrypt.default.compare(generatedPassword, storedHash), true);

    generatedLog = "";
    await configureCoachPassword(database);
    assert.equal(generatedLog, "");
  } finally {
    console.warn = originalWarn;
    if (coachPassword === undefined) delete process.env.COACH_PASSWORD;
    else process.env.COACH_PASSWORD = coachPassword;
  }
});

test("la migration tolère une base vide et crée uniquement le planning", async () => {
  const database = new EmptyMigrationDatabase();
  const coachPassword = process.env.COACH_PASSWORD;
  delete process.env.COACH_PASSWORD;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await initializeDatabase({ database });
  } finally {
    console.warn = originalWarn;
    if (coachPassword === undefined) delete process.env.COACH_PASSWORD;
    else process.env.COACH_PASSWORD = coachPassword;
  }

  assert.match(database.schema, /CREATE TABLE IF NOT EXISTS players/u);
  assert.match(database.schema, /CREATE TABLE IF NOT EXISTS responses/u);
  assert.match(database.schema, /ALTER TABLE sessions ADD COLUMN IF NOT EXISTS starts_at/u);
  assert.ok(database.planningStatements.some((sql) => sql.includes("INSERT INTO sessions")));
  assert.ok(database.planningStatements.every((sql) => !sql.includes("INSERT INTO players")));
  assert.ok(database.planningStatements.every((sql) => !sql.includes("INSERT INTO trainers")));
});

test("le serveur démarre avec DATABASE_URL seul et répond au contrôle de santé", async () => {
  const coachPassword = process.env.COACH_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL;
  delete process.env.COACH_PASSWORD;
  process.env.DATABASE_URL = "postgres://fixture/badminton";
  const database = new EmptyMigrationDatabase();
  const originalWarn = console.warn;
  const originalLog = console.log;
  console.warn = () => {};
  console.log = () => {};
  let server;
  try {
    server = await start({ database, port: 0 });
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    assert.equal(server.address().address, "0.0.0.0");
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  } finally {
    if (server?.listening) await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    console.warn = originalWarn;
    console.log = originalLog;
    if (coachPassword === undefined) delete process.env.COACH_PASSWORD;
    else process.env.COACH_PASSWORD = coachPassword;
    if (databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = databaseUrl;
  }
});

test("le taux de présence gère le dénominateur nul", () => {
  assert.equal(calculateAttendanceRate(2, 3), 66.7);
  assert.equal(calculateAttendanceRate(0, 0), 0);
});

test("une réponse avec un statut invalide est refusée", async () => {
  const response = await request(createApp({ database: new FixtureDatabase() }))
    .post("/api/responses")
    .send({ sessionId: 12, firstName: "Élodie", lastName: "Durand", status: "peut-être" });
  assert.equal(response.status, 400);
});
