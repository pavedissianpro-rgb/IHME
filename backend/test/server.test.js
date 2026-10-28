import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { calculateAttendanceRate, createApp } from "../src/server.js";
import { isFictionalPlayerName, isFictionalTrainerName, normalizeName } from "../src/db.js";

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

test("une réponse joueur valide est enregistrée", async () => {
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

test("les joueurs et entraîneurs de démonstration sont fictifs et identifiables", () => {
  assert.equal(isFictionalPlayerName(normalizeName("LINA MARTIN")), true);
  assert.equal(isFictionalPlayerName(normalizeName("Vrai Joueur")), false);
  assert.equal(isFictionalTrainerName("ÉMILE PETIT"), true);
  assert.equal(isFictionalTrainerName("Entraîneur réel"), false);
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
