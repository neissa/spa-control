# spa-control

Remplacement léger du portail Control My Spa (Balboa), 100 % navigateur : HTML + JS + localStorage, sans serveur ni dépendance.

Il appelle l'API non officielle `iot.controlmyspa.com/web` (CORS ouvert, peut changer sans prévenir). Il affiche l'état, tient un journal, signale quand le spa passe hors ligne (titre de l'onglet + notification) et calcule les temps de pompes avec/sans chauffe.

## Utiliser
Ouvrir `index.html` (double-clic, ou GitHub Pages), se connecter avec le compte Control My Spa.
Seuls les jetons sont gardés dans localStorage, pas le mot de passe.

## Limites
- Les relevés (1/min) ne se font que **page ouverte** : l'alerte hors ligne et les stats ne couvrent que ces périodes.
- Historique gardé 14 jours (localStorage ~5 Mo).
- Commandes (pompes, lumières, consigne) pas encore faites : appels non relevés.
- Format du login/refresh et définition de « chauffe » à vérifier au premier essai.

`node --test` : test des calculs de durées.
