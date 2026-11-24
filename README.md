# spa-control

Remplacement léger du portail Control My Spa (Balboa), 100 % navigateur : HTML + JS + localStorage, sans serveur ni dépendance.

Il appelle l'API non officielle `iot.controlmyspa.com/web` (CORS ouvert, peut changer sans prévenir). Il affiche l'état, tient un journal, signale quand le spa passe hors ligne (titre de l'onglet + notification) et calcule les temps de pompes avec/sans chauffe.

## Utiliser
Ouvrir `index.html` (double-clic, ou GitHub Pages), se connecter avec le compte Control My Spa.
Seuls les jetons sont gardés dans localStorage, pas le mot de passe.

## Limites
- Les relevés (1/min) ne se font que **page ouverte** : l'alerte hors ligne et les stats ne couvrent que ces périodes.
- Historique gardé 14 jours (localStorage ~5 Mo).
- **Lecture seule** : le compte propriétaire n'a accès, via l'API du portail, à aucune commande (pompes, lumières, consigne, heure, filtration, mise à jour du firmware) ni aux journaux serveur (403/404). Le journal d'événements est celui relevé localement par la page. Pour piloter le spa, il faudrait relever les appels d'une autre interface (ex. l'application mobile officielle).
- Format du login/refresh, jours des programmes (0 = dimanche supposé) et définition de « chauffe » à vérifier au premier essai.

## Contenu
- Tableau de bord : alertes (dernier ping > 1 h, hors ligne, erreur, horloge à corriger), températures, heure interne du spa.
- Détail par spa : pompes et lumières (noms personnalisables), chauffage et C8Z, heure et format, programmes, informations techniques, erreurs, journal.

`node --test` : tests des calculs de durées (`stats.js`) et de la logique de lecture (`spa.js`).
