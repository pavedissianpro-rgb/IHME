# Badminton Club

Application web pour organiser les séances d'un club de badminton et gérer les réponses de présence des membres.

## Objectifs

- Consulter les prochaines séances du club.
- Répondre présent, absent ou incertain pour une séance.
- Voir les membres inscrits à chaque séance.
- Permettre aux responsables de créer et modifier des séances.
- Consulter des statistiques de participation.

## Technologies

- **Frontend :** React
- **Backend :** Node.js avec Express
- **Base de données :** PostgreSQL
- **Conteneurisation :** Docker et Docker Compose

L'application est destinée à un seul club. Le frontend communique avec le backend via une API HTTP. Le backend gère les règles de l'application et l'accès à PostgreSQL. Les identifiants de la base de données sont fournis par des variables d'environnement et ne doivent pas être enregistrés dans Git.

## Architecture envisagée

```text
badminton-club/
├── frontend/           # Application React
├── backend/            # API Node.js et Express
├── docker-compose.yml  # Services de l'application et de PostgreSQL
├── .env.example        # Exemple de configuration locale
├── .gitignore
└── README.md
```

Les dossiers et fichiers seront ajoutés au fur et à mesure du développement. Cette structure est une proposition de départ.

## Fonctionnalités

### Pour les membres
- Consulter les séances à venir, avec leur date, leur horaire et leur lieu.
- Accéder à l'application sans créer de compte.
- Choisir leur nom dans la liste des membres et indiquer leur réponse : présent, absent ou incertain.
- Consulter la liste des participants.

### Pour l'entraîneur
- Créer, modifier et supprimer une séance.
- Consulter les réponses des membres.
- Accéder aux statistiques de participation.
- Se connecter à un espace protégé pour gérer les séances.

### À définir
- Besoin éventuel de récupérer le mot de passe de l'entraîneur.

## Démarrage avec Docker

Une fois `docker-compose.yml` et les fichiers de configuration créés, les services pourront être lancés depuis la racine du projet avec :

```bash
docker compose up --build
```

Pour arrêter les services :

```bash
docker compose down
```

Les ports de l'application et de l'API, ainsi que les variables d'environnement nécessaires, seront documentés ici lorsqu'ils seront définis. Ne placez pas de vrais mots de passe dans le fichier `.env.example`.

## Développement sans Docker

Les commandes de lancement dépendront des scripts définis dans les projets React et Express. Le démarrage local du frontend, du backend et de PostgreSQL sera précisé après la création de ces projets.

## État du projet

Projet en cours de définition. Les fonctionnalités ci-dessus décrivent le périmètre envisagé ; elles ne sont pas nécessairement déjà implémentées. Une première étape de réalisation peut être la mise en place de l'API Express, de la base PostgreSQL et de l'application React dans Docker Compose.

## Informations complémentaires

Les choix suivants sont retenus :

- L'application gère un seul club.
- Les membres utilisent l'application sans compte et choisissent leur nom dans la liste pour répondre à une séance.
- Seul l'entraîneur peut créer, modifier ou supprimer les séances ; son espace de gestion est protégé par connexion.

Les éventuelles consignes de cours sur les bibliothèques ou l'organisation des dossiers restent à préciser.