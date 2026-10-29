# Badminton Club de Salbris

Un site web pour organiser les entraînements du club de badminton de Salbris.

- Les **joueurs** disent s'ils viennent ou non à l'entraînement.
- L'**entraîneur** crée les séances, voit qui sera là et consulte les statistiques de présence.

Le site est en français et se lit bien sur téléphone.

## Sommaire

1. [Ce que fait le site](#ce-que-fait-le-site)
2. [Vrais noms des joueurs et des entraîneurs](#vrais-noms-des-joueurs-et-des-entraîneurs)
3. [Cadrage du besoin](#cadrage-du-besoin)
4. [Modèle de données](#modèle-de-données)
5. [API et règles métier](#api-et-règles-métier)
6. [Lancer le site sur son ordinateur](#lancer-le-site-sur-son-ordinateur)
7. [Tests](#tests)
8. [Déploiement (mise en ligne)](#déploiement-mise-en-ligne)
9. [Données personnelles](#données-personnelles)
10. [Organisation des dossiers](#organisation-des-dossiers)
11. [Choix de conception](#choix-de-conception)
12. [Petit lexique](#petit-lexique)

## Ce que fait le site

### Pour un joueur (aucun compte à créer)

- Voir la prochaine séance : date, horaires, gymnase et nom de l'entraîneur.
- Écrire son prénom et son nom, puis choisir **Présent**, **Absent** ou **Incertain**.
- Changer d'avis : si le même joueur répond une deuxième fois pour la même séance, sa nouvelle réponse remplace l'ancienne (pas de doublon). Les majuscules, les accents et les espaces en trop sont ignorés.
- Voir la liste des réponses et le nombre de présents, d'absents et d'incertains.

### Pour l'entraîneur (avec un mot de passe)

- Créer, modifier, annuler ou supprimer une séance. Chaque séance a son entraîneur, une note facultative et un gymnase.
- Gérer les joueurs : en ajouter, en supprimer, corriger une réponse, et **fusionner deux fiches** quand un joueur apparaît en double (par exemple « Jean Dupont » et « Dupont Jean »).
- Noter après la séance qui était **réellement** présent. C'est différent de la réponse donnée avant.
- Consulter les **statistiques** : taux de présence de chacun, historique d'un joueur, graphique, et export CSV (un fichier lisible dans Excel).
- Utiliser le **planning habituel** proposé automatiquement pour les 14 prochains jours : mardi 19 h–21 h, jeudi 19 h–21 h et vendredi 19 h–20 h.

## Vrais noms des joueurs et des entraîneurs

Le site s'utilise avec les **vrais noms** des joueurs et des entraîneurs du club de Salbris. Sur une base neuve, aucun joueur ni entraîneur n'est ajouté automatiquement : seuls les entraînements récurrents des 14 prochains jours sont proposés. Les joueurs sont ajoutés lors de leur première réponse et les entraîneurs lorsqu'une séance est créée. Les migrations conservent les données déjà présentes dans une ancienne base.

Ne mettez jamais de mot de passe ou de jeton dans le dépôt GitHub. Comme les noms des joueurs sont visibles sur le site, lisez aussi la section [Données personnelles](#données-personnelles).

## Cadrage du besoin

**Le problème :** l'entraîneur ne sait pas à l'avance combien de joueurs viendront, et ne garde pas de trace de la présence de chacun.

**La solution :** un site où chaque joueur répond en quelques secondes, et où l'entraîneur voit les réponses et les statistiques.

**Deux parcours :**

1. **Joueur** : choisir une séance, écrire son prénom et son nom, choisir un statut, puis voir les réponses déjà reçues.
2. **Entraîneur** : se connecter, gérer les séances et les joueurs, noter la présence réelle après l'entraînement, et consulter les statistiques.

**Repères :** les dates et heures suivent le fuseau `Europe/Paris`. Le lieu par défaut est le `Gymnase Pillon`. Noah BULUT entraîne le jeudi ; Maxime MICHEL entraîne le mardi et le vendredi. Ces noms peuvent être changés dans l'espace entraîneur ou avec les variables `CLUB_TUESDAY_COACH`, `CLUB_THURSDAY_COACH` et `CLUB_FRIDAY_COACH` (voir le tableau plus bas).

## Modèle de données

Les informations sont rangées dans une **base de données** (PostgreSQL), sous forme de tableaux appelés *tables*. Il y en a quatre :

- **players** : la liste des joueurs (prénom, nom).
- **sessions** : la liste des séances (date, heures, gymnase, entraîneur, note, annulée ou non).
- **responses** : les réponses. Une réponse relie **un joueur** à **une séance** et contient son statut (présent, absent ou incertain) et, plus tard, sa présence réelle.
- **trainers** : la liste des entraîneurs, que l'on peut réutiliser d'une séance à l'autre.

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

Comment lire ce schéma : un joueur peut avoir plusieurs réponses (une par séance), et une séance peut recevoir plusieurs réponses (une par joueur).

**Les règles de la table `responses` :**

- Un joueur ne peut avoir **qu'une seule** réponse par séance.
- `status` vaut `present`, `absent` ou `incertain`, rien d'autre.
- `actual_presence` est la présence **réelle**, notée par l'entraîneur après la séance : `true` = était là, `false` = n'était pas là, vide = pas encore noté. Elle est indépendante de la réponse donnée avant.
- Si on supprime un joueur ou une séance, ses réponses sont supprimées avec lui.

**Au démarrage**, le site vérifie que les tables existent et les crée si besoin, sans effacer ce qui est déjà là. On peut donc le relancer sans risque. Les anciennes tables `members` et `attendance` de la première version sont gardées, et leurs données sont copiées dans les nouvelles. Le site utilise au maximum **4 connexions** à la base en même temps.

## API et règles métier

L'**API** est la « porte » par laquelle le site affiché dans le navigateur (le *frontend*) parle au serveur (le *backend*). Toutes les adresses commencent par `/api`.

Schéma simple d'un échange :

```text
Téléphone du joueur  →  Serveur (Express)  →  Base de données (PostgreSQL)
  (le site React)    ←                      ←
```

| Méthode | Adresse | Qui peut l'utiliser | À quoi ça sert |
|---|---|---|---|
| `GET` | `/api/health` | Tout le monde | Vérifier que le site fonctionne : répond `{ "status": "ok" }`, ou une erreur 503 si la base est inaccessible. |
| `GET` | `/api/sessions` | Tout le monde | Voir les séances à venir (non annulées) et les compteurs. |
| `GET` | `/api/sessions/:id/responses` | Tout le monde | Voir les réponses d'une séance. |
| `POST` | `/api/responses` | Tout le monde (limité en nombre d'essais) | Envoyer ou modifier sa réponse. |
| `POST` | `/api/auth/login` | Tout le monde (limité en nombre d'essais) | Se connecter comme entraîneur. |
| `POST` | `/api/auth/logout` | Tout le monde | Se déconnecter. |
| `GET` | `/api/auth/me` | Entraîneur | Vérifier qu'on est bien connecté. |
| `GET` | `/api/coach/sessions`, `/api/players`, `/api/trainers` | Entraîneur | Lire les données d'administration. |
| `POST`, `PATCH`, `DELETE` | `/api/sessions...` | Entraîneur | Créer, modifier, annuler ou supprimer une séance. |
| `POST`, `DELETE` | `/api/players...` | Entraîneur | Ajouter ou supprimer un joueur. |
| `POST` | `/api/players/merge` | Entraîneur | Fusionner deux fiches du même joueur. |
| `PATCH` | `/api/sessions/:id/responses/:playerId` | Entraîneur | Corriger une réponse ou noter la présence réelle. |
| `GET` | `/api/players/:id/history`, `/api/stats`, `/api/stats.csv` | Entraîneur | Historique d'un joueur, statistiques, export CSV. |

*(`GET` = lire des informations ; `POST` = envoyer ou créer ; `PATCH` = modifier ; `DELETE` = supprimer.)*

**Règles de fonctionnement :**

- Les actions de l'entraîneur sont **vérifiées par le serveur** : cacher un bouton ne suffit pas, le serveur refuse l'action si on n'est pas connecté.
- Toutes les informations reçues sont **contrôlées** (longueur, statut autorisé…) et les requêtes SQL sont écrites de façon sûre.
- En cas de problème technique, le détail est gardé dans les journaux du serveur et la personne voit un **message simple en français**.

**Comment est calculé le taux de présence d'un joueur :**

> nombre de séances où il était présent ÷ nombre de séances non annulées de la période

- Si l'entraîneur a noté la présence réelle, on l'utilise. Sinon, on utilise la réponse donnée par le joueur.
- Une séance sans réponse compte comme une absence sans réponse.
- Il n'y a jamais de division par zéro : s'il n'y a aucune séance, le taux est de `0 %`.

## Lancer le site sur son ordinateur

### Ce qu'il faut installer

- **Node.js 24** et **npm** : pour faire fonctionner le code JavaScript.
- **PostgreSQL 17** : la base de données. Ou bien **Docker** avec Docker Compose, qui s'occupe de tout (voir plus bas).

### Réglages (variables d'environnement)

Ce sont des réglages secrets ou propres à chaque installation. Copiez le fichier `.env.example` vers `.env`, puis remplacez les valeurs d'exemple.

| Réglage | Obligatoire ? | Explication |
|---|---:|---|
| `DATABASE_URL` | Oui | L'adresse de la base de données, par exemple `postgres://badminton:mot-de-passe@database:5432/badminton`. Sur le serveur du cours, elle est fournie automatiquement. |
| `COACH_PASSWORD` | Oui | Mot de passe privé de l'entraîneur, 12 caractères minimum. Le serveur refuse de démarrer si cette variable est absente ou trop courte. Le mot de passe est haché avec bcrypt avant d'être enregistré. |
| `BASE_PATH` | Non | Le « sous-dossier » du site dans l'adresse web. Par défaut `/ihme/` avec Docker. Utilisez `/` si le site est à la racine d'un domaine. |
| `CLUB_TIMEZONE` | Non | Le fuseau horaire, par défaut `Europe/Paris`. |
| `CLUB_LOCATION` | Non | Le gymnase des séances habituelles, par défaut `Gymnase Pillon`. |
| `CLUB_TUESDAY_COACH`, `CLUB_THURSDAY_COACH`, `CLUB_FRIDAY_COACH` | Non | L'entraîneur du mardi, du jeudi et du vendredi. Ces noms peuvent aussi être modifiés dans l'espace entraîneur. |
| `POSTGRES_PASSWORD` | Avec Compose | Le mot de passe de la base dans Docker. Il doit être **identique** à celui de `DATABASE_URL`. Évitez les caractères spéciaux. |
| `APP_PORT` | Avec Compose | Le port d'accès sur votre ordinateur, par défaut `3000`. |

**Choisissez toujours un `COACH_PASSWORD` privé et solide.** Ne réutilisez jamais un mot de passe déjà utilisé ailleurs et ne le publiez pas dans le dépôt Git.

### Étapes sans Docker

1. Créez une base PostgreSQL et indiquez son adresse dans `DATABASE_URL` (avec `localhost` comme serveur).
2. Dans un premier terminal, lancez le serveur :

```powershell
cd backend
npm install
npm run dev
```

3. Dans un deuxième terminal, lancez l'affichage :

```powershell
cd frontend
npm install
npm run dev
```

4. Ouvrez `http://localhost:5173` dans votre navigateur. Cette adresse transmet automatiquement les demandes au serveur, qui tourne sur le port `3000`.

## Tests

Les tests vérifient automatiquement que le site fonctionne comme prévu. Pour les lancer :

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

La commande `npm run build` prépare la version finale du site. On la lance une fois normalement et une fois avec le chemin `/ihme/`, pour vérifier que les deux fonctionnent.

Les essais effectués, avec ce qu'on a entré, ce qu'on attendait et ce qu'on a obtenu, sont écrits dans [docs/TESTS.md](./docs/TESTS.md).

## Déploiement (mise en ligne)

Mettre le site « en ligne » veut dire le faire tourner sur un serveur, pour qu'on puisse y accéder depuis Internet. Nous utilisons **Docker** : c'est une « boîte » qui contient tout ce qu'il faut pour que le site fonctionne de la même façon partout.

### Essayer avec Docker Compose

Une fois le fichier `.env` rempli avec des mots de passe privés :

```powershell
docker compose up --build -d
```

- Le site est alors disponible sur `http://localhost:3000/ihme/` (avec les réglages par défaut).
- Pour vérifier qu'il fonctionne : `http://localhost:3000/api/health` ou `http://localhost:3000/ihme/api/health`.
- Les données de la base sont conservées dans un espace appelé `postgres_data`.

Pour arrêter sans perdre les données :

```powershell
docker compose down
```

Pour construire seulement l'image (la « boîte ») :

```powershell
docker build --build-arg BASE_PATH=/ihme/ -t badminton-salbris .
```

Le site tourne dans la boîte avec un utilisateur sans droits spéciaux (`node`, numéro 1000), pour des raisons de sécurité.

### 1. Serveur du cours IHME

C'est le serveur partagé du cours. Sa galerie de la promotion donne accès aux projets : toute personne qui ouvre votre site peut voir la liste des réponses. Voir [Données personnelles](#données-personnelles).

**Ne déployez pas cette configuration sur IHME pour le club.** La galerie est publique, le planning affiche les vrais noms des entraîneurs, le formulaire accepte les vrais noms des joueurs, et les présences sont visibles publiquement. De plus, le workflow actuel ne configure pas le secret obligatoire `COACH_PASSWORD` pour le serveur IHME. Pour utiliser le site avec le club, choisissez un hébergement privé qui permet de définir ce secret ; n'y ajoutez des données réelles qu'après avoir vérifié qui peut les consulter.

Le site est publié sous l'adresse `/ihme/`. Le serveur retire ce préfixe avant de transmettre la demande à notre programme : dans le code, les adresses de l'API commencent donc simplement par `/api`. Le cookie de connexion de l'entraîneur est limité à ce chemin et sécurisé (HTTPS).

Étapes :

0. Ne lancer ce déploiement qu'après avoir confirmé que la plateforme fournit `COACH_PASSWORD` de manière privée et qu'aucun nom ou présence réelle ne sera exposé dans la galerie publique.
1. Dans GitHub : **Settings → Secrets and variables → Actions**, vérifier que la variable `IHME_BASE_PATH` vaut `/ihme/` (ou exactement le chemin attribué). Sinon, le site est construit pour la racine `/` et s'affiche mal.
2. Vérifier que `IHME_DEPLOY_URL` (variable) et `IHME_DEPLOY_TOKEN` (secret) sont renseignés. Ne les écrivez **jamais** dans le dépôt.
3. Envoyer le code sur GitHub (`git add`, `git commit`, `git push`). L'image Docker est alors préparée.
4. Dans GitHub : **Actions → Construire et publier l'image → Run workflow**, choisir `main`, cocher **« Déployer cette version après construction »**, puis lancer.

Le fichier de workflow et `deploy/request.py` ne sont pas modifiés par ce projet.

### 2. Option : hébergement privé du club

Si vous préférez que le site ne soit pas dans la galerie du cours, vous pouvez le mettre sur un hébergement **à part**, qui fournit une base PostgreSQL et une adresse sécurisée (HTTPS).

1. Construire l'image à la racine du domaine : `docker build --build-arg BASE_PATH=/ -t badminton-salbris .`
2. Régler sur l'hébergeur : `DATABASE_URL` (base privée), `COACH_PASSWORD` (privé, solide), et si besoin `CLUB_LOCATION` et les entraîneurs du planning.
3. Vérifier `/api/health`, se connecter comme entraîneur, puis ajouter les entraîneurs et laisser les joueurs répondre.
4. Activer les sauvegardes de la base.

## Données personnelles

Avec de vrais joueurs, le site manipule des **données personnelles**.

- **Ce qui est enregistré :** prénom, nom, réponse (présent, absent, incertain) et présence réelle.
- **Ce que tout le monde voit :** la liste des réponses d'une séance, avec prénoms, noms et statuts. Sur le serveur du cours, cela inclut les personnes de la promotion qui ouvrent la galerie.
- **Ce que seul l'entraîneur voit :** l'historique par joueur, les statistiques et l'export CSV. Ce fichier contient des noms : ne le publiez pas et ne l'ajoutez pas dans Git.
- **Suppression :** l'entraîneur peut supprimer un joueur à sa demande.
- **Conseils :** prévenir les membres de l'usage de leurs noms, demander l'accord des parents pour les mineurs, choisir un hébergement sécurisé (HTTPS) de préférence en Union européenne, sauvegarder la base et ne garder les données que le temps nécessaire.

Ces conseils ne remplacent pas un avis juridique.

## Organisation des dossiers

```text
backend/                 Le serveur (la « cuisine »)
  src/db.js              Connexion à la base, création des tables, planning
  src/server.js          L'API, la connexion entraîneur, les règles et l'envoi du site
  test/                  Les tests du serveur
frontend/                Le site affiché dans le navigateur (la « salle »)
  src/App.jsx            Les pages joueur et entraîneur
  src/styles.css         L'apparence (couleurs, mise en page, téléphone)
  src/App.test.jsx       Un test du formulaire
deploy/request.py        Le programme qui envoie le site sur le serveur du cours (ne pas modifier)
Dockerfile               La recette pour fabriquer la « boîte » Docker
docker-compose.yml       Lance le site et sa base de données ensemble
docs/TESTS.md            Les essais réalisés et leurs résultats
```

## Choix de conception

- **Pas de compte joueur.** On écrit simplement son prénom et son nom : c'est rapide sur téléphone. L'inconvénient : quelqu'un peut répondre à la place d'un autre.
- **Noms normalisés.** « émile petit » et « Emile  Petit » sont reconnus comme la même personne.
- **Réponses visibles par tous.** Aucun compte n'est demandé, donc la liste est publique (voir [Données personnelles](#données-personnelles)).
- **Connexion entraîneur sûre.** Le mot de passe est brouillé avant d'être enregistré. Le cookie de connexion ne contient pas le mot de passe, mais un code aléatoire stocké en version brouillée (SHA-256) avec une date d'expiration.
- **Présence annoncée et présence réelle séparées.** Ce que dit le joueur avant n'est pas forcément ce qui se passe ensuite : les deux sont conservés.
- **Statistiques sans erreur.** Pas de division par zéro, et les séances annulées ne comptent pas.

## Petit lexique

| Mot | Sens simple |
|---|---|
| **Frontend** | La partie du site que l'on voit et utilise dans le navigateur (écrite avec React). |
| **Backend** | Le programme sur le serveur, que l'on ne voit pas (écrit avec Node.js et Express). |
| **API** | Les « portes » par lesquelles le frontend demande des informations au backend. |
| **Base de données** | L'endroit où les informations sont rangées durablement (PostgreSQL). |
| **Table** | Un tableau dans la base de données (par exemple, la liste des joueurs). |
| **Variable d'environnement** | Un réglage secret ou propre à chaque installation, comme un mot de passe. |
| **Migration** | La création ou la mise à jour des tables au démarrage, sans perdre les données. |
| **Docker** | Une « boîte » qui contient le site et tout ce qu'il lui faut pour fonctionner partout. |
| **Haché (bcrypt)** | Un mot de passe transformé en code illisible : même si on le vole, on ne le lit pas. |
| **Cookie de session** | Un petit code gardé par le navigateur pour rester connecté. |
| **HTTPS** | La version sécurisée d'une adresse web : les échanges sont chiffrés. |
| **CSV** | Un fichier de tableau simple, que l'on ouvre avec Excel. |