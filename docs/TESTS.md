# Essais automatisés

## Scénarios

| Essai | Entrée | Résultat attendu | Résultat obtenu |
|---|---|---|---|
| Réponse valide d’un joueur | `sessionId: 12`, prénom `Élodie`, nom `Durand`, statut `present` | HTTP 200, réponse enregistrée et joueur créé une seule fois, sans liste de noms préchargés. | Réussi : test `une réponse joueur valide avec un nom saisi est enregistrée` ; une réponse et un joueur dans la base simulée. |
| Réponse en doublon | Deux envois pour `Élodie Durand`, avec casse et espaces différents, d’abord `present`, puis `absent`. | Même identité normalisée, réponse mise à jour, pas de doublon joueur ni séance/joueur. | Réussi : test `une seconde réponse normalisée met à jour la première sans doublon` ; 1 joueur, 1 réponse, 2 écritures de mise à jour. |
| Accès entraîneur non authentifié | `GET /api/stats` sans cookie. | HTTP 401 avec un message français ; aucune donnée statistique divulguée. | Réussi : test `les fonctions entraîneur refusent une session non authentifiée` ; HTTP 401 et message de connexion requis. |
| Disponibilité PostgreSQL | Faire échouer `SELECT 1` sur `/api/health`. | HTTP 503 avec `{ "status": "unavailable" }`, sans détail technique. | Réussi : test `la route de santé renvoie 503 sans exposer l’erreur PostgreSQL`. |
| Mot de passe entraîneur sans variable dédiée | Initialiser la base sans `COACH_PASSWORD`, puis répéter l'initialisation. | Un mot de passe aléatoire fort est haché et journalisé une seule fois ; le hash existant est conservé au redémarrage. | Réussi : test `l'absence de COACH_PASSWORD génère un secret aléatoire une seule fois` ; le hash bcrypt correspond au secret et aucun nouveau secret n'est affiché au second passage. |
| Migration base vide / tables historiques absentes | Exécuter l'initialisation avec une base simulée sans tables `members` ni `attendance` et sans mot de passe configuré. | Les absences de tables historiques sont tolérées ; tables applicatives et séances récurrentes sont créées, sans joueur ni entraîneur préchargé. | Réussi : test `la migration tolère une base vide et crée uniquement le planning` ; les requêtes de création et de planning sont émises sans insert de joueur ou entraîneur. |
| Démarrage avec la seule URL de base | Définir `DATABASE_URL`, supprimer `COACH_PASSWORD`, démarrer le serveur avec une base simulée. | Le serveur écoute sur `0.0.0.0` et `GET /api/health` renvoie HTTP 200 `{ "status": "ok" }`. | Réussi : test `le serveur démarre avec DATABASE_URL seul et répond au contrôle de santé` ; l'adresse d'écoute et la réponse JSON correspondent. |
| Taux de présence et dénominateur nul | 2 présences sur 3 séances, puis 0 présence sur 0 séance comptabilisable. | Respectivement `66,7 %` et `0 %`, sans division par zéro. | Réussi : test `le taux de présence gère le dénominateur nul` ; les deux valeurs correspondent. |
| Interface joueur reliée à l’API | Saisie prénom/nom, choix d’une séance, sélection Présent et envoi du formulaire. | Le POST contient les champs saisis et l’interface affiche la confirmation. | Réussi : test Vitest `envoie les champs saisis et affiche la confirmation`. |

Les tests HTTP et migration du backend utilisent une base simulée : ils vérifient les routes, les contrôles d’accès et le parcours de migration lorsque les tables historiques sont absentes, mais ne remplacent pas un essai d’intégration contre un serveur PostgreSQL. La génération du planning récurrent ne crée ni joueurs ni fiches d’entraîneur ; sur une base neuve, ces tables restent vides tant que des membres ne répondent pas ou que l’entraîneur n’ajoute personne.

## Exécution constatée

- `backend`: `npm test` — 11 tests réussis, 0 échec.
- `frontend`: `npm test` — 1 test réussi, 0 échec.
- `frontend`: `npm run build` — build Vite réussi.
- `frontend`: `BASE_PATH=/ihme/ npm run build` — build réussi ; l’HTML généré référence `/ihme/assets/...` et `/ihme/favicon.svg`.
- `backend`: `node --check` sur `src/db.js`, `src/server.js` et `test/server.test.js` — réussi.
- Tests historiques du client de déploiement : `python -m unittest discover -s tests -p '*_test.py'` — 5 tests réussis.
- Audit npm frontend et backend — 0 vulnérabilité après la mise à jour de Vitest.

## Vérifications non exécutées localement

Docker, Docker Compose et PostgreSQL ne sont pas installés dans l’environnement de développement. Le build d’image, le démarrage de PostgreSQL, la migration sur une ancienne base et les requêtes réelles vers `/api/health` restent donc à vérifier dans un environnement équipé de Docker. Les vérifications statiques des changements et les builds/tests frontend et API simulée ont été effectués.
