import "dotenv/config";
import { initializeDatabase, pool } from "./db.js";

try {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL doit désigner la base PostgreSQL.");
  await initializeDatabase({ seedDemo: true });
  console.log("Jeu de démonstration fictif ajouté ou déjà à jour.");
} catch (error) {
  console.error("Impossible de préparer les données de démonstration.", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
