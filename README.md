# spa-control

Remplacement léger du portail Control My Spa (Balboa) : état en direct, journal, alerte hors ligne, temps de fonctionnement avec/sans chauffe.

Utilise l'API non officielle `iot.controlmyspa.com/web` (peut changer sans prévenir). Aucune dépendance, Node >= 22.5.

## Lancer
1. Copier `.env.example` en `.env` et renseigner `CMS_EMAIL` / `CMS_PASSWORD` (jamais commité).
2. `npm start` puis ouvrir http://127.0.0.1:3000

Un relevé est stocké dans `data/spa.db` (SQLite) toutes les `POLL_SECONDS`. L'API ne fournit pas d'historique : les stats ne couvrent que la période où le serveur tourne.

## Pas encore fait
- Commandes (pompes, lumières, consigne) : appels non relevés.
- Format exact de la réponse de login et définition de « chauffe » à vérifier au premier lancement.
- Pas d'authentification sur la page : écoute en local uniquement par défaut.
