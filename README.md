# spa-control

Remplacement léger du portail Control My Spa (Balboa), 100 % navigateur : HTML + JS + localStorage, sans serveur ni dépendance.

Il appelle l'API non officielle `iot.controlmyspa.com/web` (CORS ouvert, peut changer sans prévenir). Il affiche l'état, tient un journal, signale quand le spa passe hors ligne (titre de l'onglet + notification) et calcule les temps de pompes avec/sans chauffe.

## Utiliser
Ouvrir `index.html` (double-clic, ou GitHub Pages), se connecter avec le compte Control My Spa.
Seuls les jetons sont gardés dans localStorage, pas le mot de passe.

## Limites
- Les relevés (1/min) ne se font que **page ouverte** : l'alerte hors ligne et les stats ne couvrent que ces périodes.
- Historique gardé 14 jours (localStorage ~5 Mo).
- **Une seule commande testée sur un vrai spa** (lumière éteinte puis rallumée, confirmée par l'état relu en ~2 s) ; les autres ne l'ont pas été : les requêtes viennent de la lecture du code du portail (voir `docs/API.md`). Rien ne part sans clic ; une commande n'est annoncée réussie que si l'état relu du spa la confirme (sinon « Le spa n'a pas encore confirmé »). Pour une pompe, le spa peut choisir un autre niveau que demandé (essai : LOW demandé, HIGH obtenu) : l'interface affiche alors le niveau réel, sans erreur. Un spa hors ligne ne reçoit rien. Le compte propriétaire peut recevoir des 403 selon son rôle : le message de l'API est alors affiché.
- Hypothèses à vérifier : champ `panelLock` de l'état (verrouillage du panneau), second filtre = deuxième composant `FILTER` (cycle de filtration 2).
- Format du login/refresh, jours des programmes (0 = dimanche supposé) et définition de « chauffe » à vérifier au premier essai.

## Contenu
- Tableau de bord : alertes (dernier ping > 1 h, hors ligne, erreur, horloge à corriger), températures, heure interne du spa, interrupteurs pompes et lumière par spa, « Tout éteindre » (confirmation, résultat par équipement ; filtration, circulation, ozone et chauffage ne sont jamais touchés).
- Détail par spa : pompes, lumières et autres équipements (interrupteur ou bouton à niveaux, noms personnalisables), consigne (± 1 °F entier, affichée en °C arrondis à 0,5, puis Appliquer), mode de chauffe (Prêt / Repos / Prêt en repos), plage Haute / Basse, verrouillage du panneau, cycle de filtration 2, heure et format, programmes, informations techniques, journaux d'erreurs et d'événements du serveur (20 par page, « Charger plus » ; lecture seule, non stockés) avec le relevé local en dessous.
- Pied de page, **Commandes expérimentales** (désactivées par défaut) : format 12/24 h, cycle de filtration, réglage manuel de l'heure du spa sur celle de l'appareil. Étiquetées « Expérimental, non vérifié », chacune derrière une confirmation. Aucune correction d'heure automatique.

`node --test` : tests des calculs de durées (`stats.js`), de la logique de lecture (`spa.js`) et des constructeurs de commandes (`commands.js`).
