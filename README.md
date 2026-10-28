# Badminton Club de Salbris

Application React, Express et PostgreSQL pour consulter les entraînements du club, annoncer sa présence et permettre à l’entraîneur de suivre les séances. L’interface est en français et conçue pour être utilisée sur téléphone.

## Fonctionnalités

- Séance à venir mise en avant, avec date, horaires, gymnase et entraîneur.
- Réponse publique sans compte avec prénom, nom et statut **Présent**, **Absent** ou **Incertain**.
- Une réponse répétée pour le même prénom/nom normalisé et la même séance remplace la précédente.
- Liste publique des réponses et compteurs par statut.
- Espace entraîneur protégé côté serveur par mot de passe bcrypt et cookie de session `httpOnly`.
- Création, modification, annulation et suppression de séances ; note facultative et liste d’entraîneurs réutilisable.
- Gestion des joueurs, correction des réponses, fusion de doublons et présence réellement constatée.
- Statistiques filtrées par dates, historique d’un joueur, graphique et export CSV.
- Planning récurrent du mardi (19 h–21 h), du jeudi (19 h–21 h) et du vendredi (19 h–20 h), proposé sur les 14 prochains jours.
- Migration PostgreSQL idempotente et seed de démonstration composé de joueurs, entraîneurs et séances fictifs.

Les joueurs saisissent leur identité sans compte ; leurs noms et réponses sont visibles dans la liste publique des séances. Ne publiez pas de mot de passe, jeton ou données privées dans le dépôt. Les valeurs du seed sont fictives et ne remplacent pas une politique d’information des membres.

## Cadrage du besoin

L’application fournit deux parcours :

1. **Joueur** : choisir une séance à venir, saisir prénom et nom, choisir un statut, puis consulter les réponses déjà reçues.
2. **Entraîneur** : s’authentifier, administrer les séances et joueurs, enregistrer la présence réelle après l’entraînement et consulter les statistiques.

Le fuseau d’affichage et de calcul du planning est `Europe/Paris`. Le lieu par défaut est `Gymnase Pillon`. Les entraîneurs initiaux (`Camille Martin`, `Émile Petit`, `Lina Moreau`) et les dix joueurs ajoutés par le seed sont fictifs ; l’entraîneur connecté peut réutiliser ces noms ou en ajouter d’autres.

## Modèle de données

Les tables `members` et `attendance` de l’ancienne version sont conservées pour compatibilité. La migration copie leurs membres et réponses vers les nouvelles tables sans supprimer les données historiques.

```mermaid
erDiagram
    PLAYERS ||--o{ RESPONSES : annonce
    SESSIONS ||--o{ RESPONSES : reçoit
    TRAINERS }o..o{ SESSIONS : coach_name
    PLAYERS {
      int id PK
      text first_name
      text last_name
      text normalized_name UK
      timestamptz created_at
    }
    SESSIONS {
      int id PK
      date session_date
      time start_time
      time end_time
      text location
      text coach_name
      text note
      boolean cancelled
    }
    RESPONSES {
      int id PK
      int session_id FK
      int player_id FK
      text status
      boolean actual_presence
      timestamptz updated_at
    }
    TRAINERS {
      int id PK
      text name
      text normalized_name UK
    }
```

`responses` impose une réponse unique par `(session_id, player_id)`. `status` accepte `present`, `absent` ou `incertain`. `actual_presence` est indépendant de la réponse annoncée : `true` signifie présent réellement, `false` absent réellement et `NULL` pas encore constaté. Les identifiants sont reliés par des clés étrangères avec suppression en cascade.

À chaque démarrage, l’application exécute les créations de tables/index idempotentes (`IF NOT EXISTS`) et ajoute les colonnes manquantes. La migration historique garde les colonnes utilisées par l’ancienne version. Le pool PostgreSQL est limité à quatre connexions.

## API et règles métier

L’API est exposée sous `/api` par Express, qui sert aussi le build React.

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| `GET` | `/api/health` | Public | Exécute `SELECT 1`; réponse `{ "status": "ok" }` ou HTTP 503 `{ "status": "unavailable" }`. |
| `GET` | `/api/sessions` | Public | Séances à venir non annulées et compteurs. |
| `GET` | `/api/sessions/:id/responses` | Public | Réponses et compteurs de la séance. |
| `POST` | `/api/responses` | Public, limité en débit | Crée ou met à jour la réponse du joueur identifié par son nom normalisé. |
| `POST` | `/api/auth/login` | Public, limité en débit | Compare le mot de passe avec bcrypt et établit un cookie de session. |
| `POST` | `/api/auth/logout` | Public | Révoque la session et supprime le cookie. |
| `GET` | `/api/auth/me` | Entraîneur | Vérifie la session. |
| `GET` | `/api/coach/sessions`, `/api/players`, `/api/trainers` | Entraîneur | Données d’administration. |
| `POST`, `PATCH`, `DELETE` | `/api/sessions...` | Entraîneur | Gérer, annuler ou supprimer une séance. |
| `POST`, `DELETE` | `/api/players...` | Entraîneur | Gérer les joueurs. |
| `POST` | `/api/players/merge` | Entraîneur | Fusionner un joueur doublon vers le joueur conservé. |
| `PATCH` | `/api/sessions/:id/responses/:playerId` | Entraîneur | Corriger une réponse et/ou enregistrer la présence réelle. |
| `GET` | `/api/players/:id/history`, `/api/stats`, `/api/stats.csv` | Entraîneur | Historique, statistiques par période et export CSV. |

Les requêtes SQL utilisent des paramètres. Les entrées sont contrôlées côté serveur. Les erreurs techniques sont journalisées côté serveur et remplacées par un message français compréhensible pour le client.

## Installation et variables d’environnement

Prérequis : Node.js 24, npm et PostgreSQL 17 (ou Docker avec Docker Compose).

Copier `.env.example` vers `.env`, puis remplacer les valeurs d’exemple :

| Variable | Obligatoire | Description |
|---|---:|---|
| `DATABASE_URL` | Oui | URL PostgreSQL, par exemple `postgres://badminton:mot-de-passe-url-safe@database:5432/badminton` dans Compose. |
| `COACH_PASSWORD` | Production : oui | Mot de passe entraîneur (au moins 12 caractères). Il est haché avec bcrypt avant stockage. |
| `BASE_PATH` | Non | Chemin de publication ; valeur par défaut Docker `/ihme/`. |
| `CLUB_TIMEZONE` | Non | Fuseau IANA du club, par défaut `Europe/Paris`. |
| `CLUB_LOCATION` | Non | Lieu utilisé par les séances récurrentes, par défaut `Gymnase Pillon`. |
| `CLUB_TUESDAY_COACH`, `CLUB_THURSDAY_COACH`, `CLUB_FRIDAY_COACH` | Non | Entraîneurs du planning récurrent en mode privé. Laisser vides pour les entraîneurs fictifs par défaut. |
| `POSTGRES_PASSWORD` | Compose | Mot de passe du conteneur PostgreSQL ; doit correspondre à celui de `DATABASE_URL`. Utiliser une valeur URL-safe. |
| `APP_PORT` | Compose | Port publié sur l’hôte, par défaut `3000`. |

Si `COACH_PASSWORD` est absent, l’application utilise le mot de passe fictif `SalbrisDemo2026!` et active le seed de démonstration. Le compte entraîneur de démonstration permet de tester les fonctions d’administration, mais ne contient que des données fictives ; en production démo, seules les personnes fictives préchargées peuvent répondre ou être ajoutées. Une base contenant des joueurs, entraîneurs ou lieux non fictifs est refusée en mode démo. Pour un vrai club et des données réelles, définissez impérativement un `COACH_PASSWORD` privé et robuste (au moins 12 caractères) dans l’environnement de déploiement ; ne réutilisez jamais le mot de passe de démonstration.

### Développement avec PostgreSQL local

Créer une base PostgreSQL, définir `DATABASE_URL` avec l’hôte local (`localhost`), puis lancer les deux processus :

```powershell
cd backend
npm install
npm run dev
```

Dans un second terminal :

```powershell
cd frontend
npm install
npm run dev
```

Vite démarre habituellement sur `http://localhost:5173`. Il relaie les appels API vers Express sur le port `3000`. Pour disposer des données fictives en base :

```powershell
cd backend
npm run seed:demo
```

Le seed peut être exécuté plusieurs fois sans créer de doublons. Il est destiné à une base de démonstration ; ne l’exécutez pas sur une base contenant les données réelles du club.

### Tests et build du frontend

```powershell
cd backend
npm test
```

```powershell
cd frontend
npm test
npm run build
$env:BASE_PATH = "/ihme/"
npm run build
```

Les tests automatisés et les essais exécutés sont consignés dans [docs/TESTS.md](./docs/TESTS.md).

## Déploiement

### Docker Compose

Après avoir renseigné `.env` avec des mots de passe privés :

```powershell
docker compose up --build -d
```

Le site est servi par **un seul processus Express** sur le port `3000`, à l’adresse `http://localhost:3000/ihme/` avec la configuration par défaut. La vérification de santé est disponible sur `http://localhost:3000/api/health` et `http://localhost:3000/ihme/api/health`. PostgreSQL persiste dans le volume `postgres_data`.

Arrêt sans supprimer les données :

```powershell
docker compose down
```

Le Dockerfile racine construit Vite puis copie le build dans l’image Express. Le processus du conteneur s’exécute comme l’utilisateur non privilégié `node` (UID 1000). Pour le build seul :

```powershell
docker build --build-arg BASE_PATH=/ihme/ -t badminton-salbris .
```

### Chemin `/ihme/` et proxy

Vite compile les assets et le client appelle l’API sous `${import.meta.env.BASE_URL}api`. Pour `BASE_PATH=/ihme/`, les appels navigateur arrivent sur `/ihme/api/...`. Le proxy public doit **retirer le préfixe `/ihme`** avant de transmettre à Express ; les routes Express restent `/api/...`. Le cookie entraîneur est `httpOnly`, limité au chemin `BASE_PATH`, et sécurisé en production derrière HTTPS.

Pour l’hébergement étudiant IHME, la construction d’image seule ne remplace pas le site publié. Avant la construction, configurer `IHME_BASE_PATH` dans les variables GitHub avec `/ihme/` (ou exactement le préfixe attribué au site) : sans cette variable, le workflow inchangé construit les assets à la racine `/`. Après la publication, ouvrir **Actions → Construire et publier l’image → Run workflow**, sélectionner `main`, puis cocher **« Déployer cette version après construction »** avant de lancer. L’image doit être autorisée pour le projet et les paramètres privés de déploiement (`IHME_DEPLOY_URL`, `IHME_DEPLOY_TOKEN`) configurés dans GitHub ; ne les ajoutez jamais au dépôt. Le workflow et `deploy/request.py` ne sont pas modifiés par ce projet.

## Structure du projet

```text
backend/
  src/db.js          Pool, migration additive, planning et seed fictif
  src/server.js      API Express, authentification, règles métier et fichiers statiques
  src/seed.js        Commande de seed de démonstration
  test/              Tests HTTP et métier de l’API
frontend/
  src/App.jsx        Parcours joueur et espace entraîneur
  src/styles.css     Identité visuelle responsive et accessible
  src/App.test.jsx   Test du formulaire connecté à l’API simulée
deploy/request.py    Client de déploiement IHME (inchangé)
Dockerfile          Build frontend et image Express finale
docker-compose.yml  Application et PostgreSQL
docs/TESTS.md       Scénarios et résultats des essais
```

## Choix de conception

- L’identité d’un joueur est normalisée en Unicode : casse, accents et espaces superflus sont ignorés. Une réponse répétée met à jour l’enregistrement unique de la séance.
- Les noms renseignés par les joueurs et les réponses sont visibles dans l’interface publique ; aucun compte joueur n’est requis.
- Le cookie de session ne contient pas le mot de passe. Le jeton opaque est stocké sous forme SHA-256 en base, avec expiration, et le mot de passe de l’entraîneur est vérifié avec bcrypt.
- Les stats ne divisent jamais par zéro : taux nul quand il n’y a ni présence constatée ni réponse. Si aucune présence réelle n’a été saisie, le taux s’appuie sur les réponses annoncées.
- Le taux par joueur est le nombre de séances où la présence est confirmée (réelle lorsqu’elle est saisie, sinon annoncée) divisé par le nombre total de séances non annulées de la période. Une séance sans réponse compte dans les absences sans réponse, et aucune séance donne un taux de `0 %`.
- Le seed n’utilise que des personnes fictives. Les données existantes de l’ancienne application sont migrées sans effacer les tables historiques.
