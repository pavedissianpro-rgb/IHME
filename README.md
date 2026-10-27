# Badminton Club

Application web pour organiser les séances d'un club de badminton et gérer les réponses de présence des membres.

## Fonctionnalités

- Calendrier des séances à venir avec horaires, lieu et décompte des réponses.
- Réponse sans compte par sélection du nom : présent, absent ou peut-être.
- Consultation des réponses des membres pour chaque séance.
- Espace entraîneur protégé par mot de passe : création, modification et suppression des séances et des membres.
- Statistiques des séances passées et des présences par membre.
- Persistance PostgreSQL et déploiement avec Docker Compose.

## Démarrage avec Docker

Prérequis : Docker Desktop avec Docker Compose.

1. Copiez `.env.example` vers `.env`.
2. Remplacez toutes les valeurs d’exemple, notamment `POSTGRES_PASSWORD`, `JWT_SECRET` (au moins 32 caractères aléatoires) et `ADMIN_PASSWORD`, par des secrets robustes. Le fichier `.env` est ignoré par Git.
3. Depuis la racine du dépôt, lancez :

   ```bash
   docker compose up --build
   ```

4. Ouvrez [http://localhost:8080](http://localhost:8080) (ou le port défini par `APP_PORT`).
5. Connectez-vous à l’espace entraîneur avec `ADMIN_EMAIL` et `ADMIN_PASSWORD`.

Arrêter les services :

```bash
docker compose down
```

Les données PostgreSQL sont conservées dans le volume `postgres_data`. Pour arrêter les services sans perdre les données, ne supprimez pas ce volume. La suppression des données (`docker compose down -v`) est irréversible.

Le compte entraîneur est créé au premier démarrage. `ADMIN_EMAIL` et `ADMIN_PASSWORD` sont des identifiants d'initialisation : modifier ces variables après la création du compte ne change pas le mot de passe déjà enregistré.

## Développement sans Docker

Prérequis : Node.js 20 ou plus récent et PostgreSQL.

1. Créez une base `badminton` et configurez les variables d'environnement nécessaires à l'API :

   ```text
   DATABASE_URL=postgres://utilisateur:mot-de-passe@localhost:5432/badminton
   JWT_SECRET=une-cle-aleatoire-d-au-moins-32-caracteres
   ADMIN_EMAIL=coach@example.com
   ADMIN_PASSWORD=un-mot-de-passe-robuste
   ```

2. Dans un terminal, démarrez l'API :

   ```bash
   cd backend
   npm install
   npm run dev
   ```

3. Dans un autre terminal, démarrez le frontend :

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

L'interface de développement est disponible à l'adresse indiquée par Vite (habituellement [http://localhost:5173](http://localhost:5173)). Vite relaie les appels `/api` vers l'API sur le port 3000.

## API

L'interface et l'API sont servies sur la même origine dans Docker. Les routes principales sont :

| Méthode | Route | Accès |
|---|---|---|
| `GET` | `/api/health` | Public |
| `GET` | `/api/sessions` | Public |
| `GET` | `/api/sessions/:id/attendance` | Public |
| `PUT` | `/api/sessions/:id/attendance` | Public |
| `GET` | `/api/members` | Public |
| `POST` | `/api/auth/login` | Public |
| `POST` | `/api/auth/logout` | Public |
| `GET` | `/api/auth/me` | Entraîneur |
| `POST`, `PATCH`, `DELETE` | `/api/sessions` | Entraîneur |
| `POST`, `DELETE` | `/api/members` | Entraîneur |
| `GET` | `/api/stats` | Entraîneur |

L'API crée les tables nécessaires au démarrage. Les réponses aux séances et les noms des membres sont visibles sans compte, conformément au fonctionnement prévu pour le club.

## Démonstration sur le serveur étudiant IHME

Le serveur étudiant est réservé aux **données fictives**. En l’absence des trois variables `ADMIN_EMAIL`, `ADMIN_PASSWORD` et `JWT_SECRET`, l’application démarre en mode démonstration : elle crée des joueurs et des séances explicitement fictifs, permet de tester les réponses, et désactive la connexion et les fonctions de gestion entraîneur. Elle refuse de démarrer en mode démo si la base contient des membres ou des lieux qui ne correspondent pas aux données fictives. N’y importez pas les noms, présences ou coordonnées de vrais membres du club.

Le workflow `.github/workflows/publish.yml` reprend le parcours de publication du dépôt [ihme-suivi](https://github.com/cedrictisseyre/ihme-suivi) :

- Un push sur `main` construit et publie l’image versionnée dans GitHub Container Registry.
- Pour la publier sur le serveur, lancer ensuite **Actions → Construire et publier l’image → Run workflow**, cocher **Déployer cette version après construction**, puis valider. La construction seule ne change pas la version en ligne.
- L’image utilise le dépôt `ghcr.io/pavedissianpro-rgb/ihme` ; il doit être autorisé dans l’affectation du serveur.
- Configurer dans les paramètres **du dépôt de cette application** la variable `IHME_DEPLOY_URL` (URL HTTPS fournie par l’enseignant, chemin `/__deploy/pNN`), le secret `IHME_DEPLOY_TOKEN` attribué au projet et, si nécessaire, la variable `IHME_BASE_PATH` (chemin public avec `/` initiale et finale, par exemple `/mon-projet/`). Ces valeurs privées ne doivent pas être ajoutées au code.
- Le serveur injecte `DATABASE_URL`, `PUBLIC_ORIGIN` et `BASE_PATH`, exécute l’application sous un compte sans privilèges, vérifie `/api/health` et limite la taille du pool PostgreSQL.

Le build local du frontend prend également en charge le chemin `BASE_PATH`. L’application et ses appels API sont servis sur le port 3000 par une seule image, conformément au contrat de déploiement étudiant.
