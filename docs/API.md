# API Control My Spa (non officielle, relevée dans le portail)

Base : `https://iot.controlmyspa.com/web`. En-tête `Authorization: Bearer <jeton>` (jeton obtenu par `POST /auth/login`, rafraîchi par `POST /auth/refresh`). CORS ouvert (`*`). Réponses : `{statusCode, message, data}`.
Rien ci-dessous n'est documenté officiellement : tout vient de la lecture du code du portail et de requêtes GET. **Seules `component-state` (lumière, pompes), `UNLOCK_PANEL` et `LOCK_PANEL` (sans effet constaté) ont été testées sur un vrai spa (24/11/2026) ; les autres POST ne l'ont pas été.**

Essai vérifié : `POST /spa-commands/component-state` avec `{spaId, via:"WEB", componentType:"light", state:"OFF", deviceNumber:0}` puis `state:"HIGH"` ; réponse HTTP 200 `{"message":"Component state has been set successfully.","data":{"success":true}}` en ~1,1 s ; `current-state` reflète le nouvel état ~2 s plus tard (mise à jour de `updatedAt`).

Essai pompe (24/11/2026, pompe 2 = `componentType:"jet"`, `deviceNumber:1`, `availableValues` `OFF/LOW/HIGH`) : la demande `state:"LOW"` renvoie HTTP 200 mais l'état relu devient **`HIGH`**, pas `LOW` ; la demande `state:"OFF"` éteint la pompe (confirmé en ~2 s). Le niveau demandé n'est donc pas garanti pour une pompe : toujours relire l'état réel (cette pompe est peut-être mono-vitesse malgré la liste d'états).

### Essais réels sur un spa (24/11/2026, 3 pompes + 1 lumière, tous HTTP 200 « …set successfully »)
- **Lumière** (`light`, `deviceNumber:0`) : `OFF` puis `HIGH`, chacun confirmé par `current-state` en ~2 s.
- **Pompes 1, 2, 3** (`jet`, `deviceNumber` 0, 1, 2) : demander `LOW` depuis l'arrêt fait passer la pompe en **`HIGH`** en ~2 s, à chaque essai (4 essais sur 3 pompes). Une demande `HIGH` depuis l'arrêt n'a produit **aucun changement** en 18 s (1 essai) : pour allumer une pompe, demander `LOW` puis lire l'état réel.
- **Arrêt** : `state:"OFF"` éteint les 3 pompes (confirmé en ~2 s, ~9 s pour la pompe 1), y compris la pompe 1 dont `availableValues` est seulement `LOW/HIGH` : l'absence de `OFF` dans la liste n'empêche pas l'arrêt.
- **Verrouillage du panneau** : `UNLOCK_PANEL` fonctionne (HTTP 200, `panelLock` passe à `false` après ~9 s). `LOCK_PANEL` répond HTTP 200 mais `panelLock` est resté `false` plus d'une minute (2 envois) : le verrouillage à distance n'a pas pu être confirmé.
- **Code d'erreur 38** (indication de l'utilisateur, cohérente avec les relevés) : « pas de filtration, donc pas de valeur de température » ; `currentTemp` vaut alors 0 ou une valeur absurde (262). Dès qu'une pompe a tourné : `errorCode:0`, plus de `statusMessages`, température lue. Ce n'est pas une panne.
- **Consigne** (`/temperature/value`) : `value:51` puis `value:50.9` (spa en °C, plage LOW, consigne 50 °F) répondent HTTP 200 « set successfully » mais `desiredTemp` relu reste `50.00` après plusieurs rafraîchissements : **effet non observé**, cause inconnue (hypothèse non confirmée : le spa attend des demi-degrés Celsius exacts, mais 50,9 = 10,5 °C n'a pas fonctionné non plus). Le programme existant du spa enregistre `heaterTemp: 50.9`.
- En mode `READY_REST` (« Ready in Rest »), la pompe 1 peut s'allumer seule : un équipement allumé ne prouve pas une utilisation humaine, et des pompes éteintes ne prouvent pas que le spa est libre.
- `current-state` n'est rafraîchi par le serveur que toutes les ~30 s quand rien ne bouge : une confirmation peut attendre jusqu'à ~30 s.

## Lecture (GET, vérifiée)
| Route | Contenu |
|---|---|
| `/spas?page=0&pageSize=100` | `data.spas[]` : `_id`, `serialNumber`, `modelType`, `dealerName`, `oemName`, `buildNumber`, … |
| `/spas/{id}/current-state` | état complet (voir `spa.js`) |
| `/spas/{id}/current-c8z` | `c8zHeaterState`, `c8zStatus` |
| `/spas/{id}/current-gateway-agent` | `buildNumber` de la passerelle |
| `/spa-schedules/findBySpa/{id}` | `data.schedules[]` : `name`, `enabled`, `settings:{days,hour,minute,timeZone}`, `values:{heaterTemp,heaterMode,tempRange}` |
| `/events/by-spa/{id}/historical?page=0&pageSize=20` | `data.events[]` : `id`, `type`, `description`, `date`, `eventOccuredTimestamp` ; `data.totalItems` |
| `/fault-logs/by-spa/{id}/historical?page=0&pageSize=20` | `data.faultLogs[]` : `code`, `description`, `severity`, `timestamp`, `sensorATemp`, `sensorBTemp`, `targetTemp`, `celcius` |

Refusé (403) pour un compte propriétaire : `/spa-schedule-execution-logs`, `/mqtt-message-logs`, `/ota-firmware-files`.

## Commandes (POST, relevées dans le code du portail, NON testées)
Toutes sous `/spa-commands`, corps JSON contenant toujours `spaId` et `via: "WEB"`.

| Route | Champs en plus | Valeurs |
|---|---|---|
| `/component-state` | `componentType`, `state`, `deviceNumber?` | `componentType` : `jet` (PUMP), `circ-pump`, `light`, `blower`, `mister`, `microsilk`, `aux`, `ozone`. `state` : `OFF`, `LOW`, `MED`, `HIGH`, `ON` selon `availableValues` du composant (une pompe `ON` est envoyée `HIGH`). Exception mesurée : `OFF` est toujours accepté pour une pompe, même absent de `availableValues`. Pour **allumer** une pompe, envoyer `LOW` (le spa la passe en `HIGH`), jamais `HIGH` direct. `deviceNumber` = `port` du composant, pour PUMP, LIGHT, BLOWER, MISTER, AUX seulement. **`circ-pump` (CIRCULATION_PUMP, `availableValues` OFF/LOW/HIGH ou OFF/HIGH selon le spa) : jamais de `deviceNumber`** (comme le portail officiel) ; `OFF` toujours accepté comme pour une pompe. Commande circulation NON testée sur un vrai spa. Elle fonctionne aussi seule (filtration, chauffage) : le spa peut la rallumer ou la couper lui-même |
| `/panel/state` | `state` | `LOCK_PANEL`, `UNLOCK_PANEL`, `LOCK_TEMP_SETTING`, `UNLOCK_TEMP_SETTING` |
| `/temperature/value` | `value` | consigne en **°F ENTIER** (jamais de décimale ; 10,5 °C = 51 °F). Toutes les températures de l'état (`currentTemp`, `desiredTemp`, `setupParams.*`) sont aussi en °F, quel que soit `celsius` (simple échelle d'affichage du panneau). L'interface arrondit le °F à l'entier puis affiche des °C arrondis à 0,5 ; `currentTemp` 0 ou hors 32–140 °F (ex. `262.00`, sonde non lue) s'affiche « — » ; plafond absolu des consignes : 50–104 °F (10–40 °C) |
| `/temperature/heater-mode` | `mode` | `READY`, `REST`, `READY_REST` |
| `/temperature/range` | `range` | `HIGH`, `LOW` |
| `/temperature/scale` | `scale` | `CELSIUS`, `FAHRENHEIT` (échelle d'affichage du spa) |
| `/time` | `time`, `isMilitaryFormat` | `time` = heure actuelle en 24 h `HH:MM` (format confirmé par le portail, voir « Requêtes capturées ») ; le portail ne l'utilise que pour changer le format 12/24 h. **Aucun effet observé sur le spa …0009** |
| `/filter-cycles/schedule` | `deviceNumber`, `numOfIntervals`, `time` | `deviceNumber` = `port` du composant `FILTER` (0 = cycle 1, 1 = cycle 2) ; `numOfIntervals` = minutes / 15 (60 min = 4) et `time` = `HH:MM`, confirmés par le portail ; **aucun effet observé sur le spa …0009** |
| `/filter-cycles/toggle-filter2-state` | `state` | `ON`, `OFF` (active le cycle de filtration 2) |

Le portail désactive les commandes quand le spa est hors ligne (`online=false`) ou quand `canControl` est faux (règle inconnue, sans doute rôle du compte). Une erreur renvoie `error.message`.

## Utilisation dans l'interface (`index.html`)
- `command(req)` envoie `POST /spa-commands{path}` (jeton Bearer, 401 -> refresh puis nouvel essai) pour les seuls chemins du tableau ci-dessus ; les corps sont construits par `SpaCmd` (`commands.js`). Aucune commande ne part sans clic, sauf la correction d'heure automatique (activée par défaut, désactivable en pied de page, une tentative par spa toutes les 30 min, arrêt après 2 échecs). Message d'erreur affiché : `error.message` (ou `message`) de la réponse.
- Après un envoi accepté : relecture de `current-state` et `current-c8z` de ce spa ; succès annoncé seulement si l'état relu correspond. Fenêtres : composants 2, 4, 7, 10, 15, 20 s ; panneau (`/panel/state`) toutes les 3 s jusqu'à 45 s (message d'attente « Le spa met jusqu'à une minute à répondre ») ; autres commandes 2, 6, 10 s. Le serveur ne rafraîchit l'état que toutes les ~30 s : pas de conclusion d'échec avant la fin de la fenêtre. `/temperature/scale` n'a pas d'écran.
- Commandes de composants (interrupteurs, bouton à niveaux, actions rapides, « Tout éteindre ») : la relecture compare la valeur relue à la valeur d'avant l'envoi (`SpaView.outcome`) et s'arrête dès qu'elle est confirmée (= niveau demandé) ou qu'elle a changé vers un autre niveau (message neutre « le spa a choisi HIGH », pas une erreur) ; « Réessayez : le spa n'a pas réagi » seulement si rien n'a changé à la fin de la fenêtre. Le bouton d'une pompe éteinte envoie `LOW` (cycle OFF -> LOW -> HIGH -> OFF, `OFF` toujours dans le cycle d'une pompe) ; il part toujours de l'état relu.
- Disponibles par défaut : `/component-state` (PUMP, CIRCULATION_PUMP sans port, LIGHT, BLOWER, MISTER, AUX, MICROSILK ; jamais ozone ; « Tout éteindre » n'inclut jamais la circulation : la couper coupe aussi la filtration, action délibérée à faire dans le détail du spa, et le dialogue le rappelle ; aucun contrôle si le `port` requis manque ou si deux composants ont la même clé ; une pompe sans `OFF` dans `availableValues` reste pilotable), `/temperature/value`, `/temperature/heater-mode`, `/temperature/range`, `/panel/state` (`LOCK_PANEL` / `UNLOCK_PANEL` seulement, et seulement si la clé `panelLock` est présente dans l'état). Sans confirmation à 45 s : « Verrouillage non confirmé par le spa ».
- Garde-fous : aucune commande si le dernier état connu a plus de 3 min (90 s pour `/time`) ; une seule commande de composant ou « Tout éteindre » à la fois par spa ; « Tout éteindre » saute et signale les composants allumés sans port ou en double, et, hors pompes, sans état OFF (une pompe est éteinte avec `OFF`).
- Code d'erreur 38 : alerte de niveau `info` (`nofilter`), pas critique ; la température s'affiche « — » avec « pas de filtration ». Les messages d'état `INFO` ne génèrent pas d'alerte. Tout autre code non nul reste critique.
- Heure et filtration (toujours disponibles, comme les autres commandes) : `/time` (format 12/24 h et réglage manuel sur l'heure de l'appareil, avec confirmation courte), `/filter-cycles/schedule` (bouton « Modifier » de chaque cycle activé : heure de début et durée), `/filter-cycles/toggle-filter2-state` (le cycle 2 est toujours affiché quand le 2e composant `FILTER` existe : `DISABLED` => bouton « Activer le cycle 2 » (`state: ON`) ; `OFF` ou `ON` => bouton « Désactiver le cycle 2 » (`state: OFF`) ; relecture jusqu'à 45 s : la valeur doit quitter `DISABLED` (activation) ou y revenir (désactivation)). Le cycle 1 n'a aucune commande d'activation (ni dans l'API ni dans le portail) : lecture seule de son état (`ON` en cours, `OFF` pas en cours), début et durée modifiables. `/panel/state` accepte aussi `LOCK_TEMP_SETTING` / `UNLOCK_TEMP_SETTING` (verrouillage de la consigne, affiché si `tempLock` est présent dans l'état).
- Hypothèses de relecture : verrouillage = `state.panelLock` (booléen ou texte `LOCK_*`) ; cycle 2 = deuxième composant `FILTER` (port 1), activé si sa valeur n'est pas `DISABLED`. Les cycles de filtration se lisent dans `components` (voir plus bas).
- Journaux : `/events/by-spa/{id}/historical` et `/fault-logs/by-spa/{id}/historical` (`page`, `pageSize=20`, `totalItems`) lus à l'ouverture du détail et par « Charger plus » ; gardés en mémoire seulement. Une erreur (403 ...) laisse le relevé local affiché.

## Requêtes capturées dans le portail officiel (24/11/2026, spa 57547-012603100009)
Relevées en observant les appels du portail quand on y clique (enregistreur XHR dans l'onglet). Toutes renvoient HTTP 200 (201 pour une création), `via:"WEB"`.

| Action du portail | Requête | Corps |
|---|---|---|
| Consigne | `POST /spa-commands/temperature/value` | `{spaId, via, value:51}` (°F **entier**, le portail convertit les °C affichés au 0,5) |
| Verrouiller le panneau | `POST /spa-commands/panel/state` | `{spaId, via, state:"LOCK_PANEL"}` |
| Mode de chauffe | `POST /spa-commands/temperature/heater-mode` | `{spaId, via, mode:"READY"}` (réponse « Heater mode toggled successfully ») |
| Format de l'heure | `POST /spa-commands/time` | `{spaId, via, time:"18:16", isMilitaryFormat:false}` (`time` = heure actuelle du spa en 24 h `HH:MM`) |
| Cycle de filtration | `POST /spa-commands/filter-cycles/schedule` | `{spaId, deviceNumber:0, numOfIntervals:4, time:"23:15", via}` (`numOfIntervals` = minutes / 15 : 60 min = 4) |
| Créer un programme | `POST /spa-schedules` | `{spaId, name, values:{heaterTemp:50, heaterMode:"REST"}, settings:{days:[0], hour:18, minute:18}, enabled:true}` → 201 |
| Modifier un programme | `PATCH /spa-schedules/{id}` | `{name, values:{heaterTemp:51, heaterMode:"REST"}, settings:{days:[0..6], hour, minute}}` |
| Exécuter un programme | `POST /spa-schedules/{id}/trigger` | `{}` |
| Supprimer un programme | `DELETE /spa-schedules/{id}` | aucun (le portail demande une confirmation) |

- Jours des programmes : tableau de nombres, **0 = dimanche … 6 = samedi** (confirmé : `[0..6]` s'affiche « Sun … Sat »). `heaterTemp` est en °F entier (le portail a réécrit 50.9 en 51 à l'enregistrement).
- Cycles de filtration lisibles dans `current-state.components` (FILTER) : `hour`, `minute`, `durationMinutes` (ex. cycle 1 à 23:15 pendant 60 min ; cycle 2 `DISABLED`).
- La section « C8Zone » du portail est en lecture seule (C8ZMODE, C8ZHEATERSTATE) : aucune commande C8 n'existe dans le portail.
- Le portail n'a pas de commande pour verrouiller la consigne (`LOCK_TEMP_SETTING` / `UNLOCK_TEMP_SETTING` existent dans l'énumération de `/panel/state`).

### Comportement observé : commandes acceptées mais sans effet sur ce spa
Sur le spa …0009 (passerelle 1.16), ces commandes répondent HTTP 200 « set successfully » **y compris lorsqu'elles viennent du portail officiel**, mais l'état relu ne change pas (relu pendant 40 s à 3 min) : consigne (`value`), `LOCK_PANEL`, `heater-mode`, format 12/24 h (`/time`), arrêt de la pompe de circulation. Elles sont identiques octet pour octet à celles de cette application. Seuls fonctionnent : lumière, pompes 1 à 3, `UNLOCK_PANEL`. Cause inconnue (comportement du spa ou du cloud).

## Fonctions ajoutées (interface)
- **Cycles de filtration (lecture)** : section « Filtration » du détail, `SpaView.filterCycles(state)` : pour chaque composant `FILTER`, état (`OFF`/`ON`), début `HH:MM` (`hour`, `minute`) et durée (`durationMinutes`, ex. « 1 h », « 1 h 30 ») ; un cycle `DISABLED` s'affiche « Désactivé » sans heure.
- **Clim8Zone (pompe à chaleur)** : sous-section « Clim8Zone » du Chauffage, visible seulement si `c8zStatus` existe et n'est pas `C8Z_STATUS_NOT_PRESENT` : état de connexion (connectée, en dégivrage, communication perdue, erreur), chauffage d'appoint en cours (`c8zHeaterState` : `OFF` = arrêté, autre = en marche) et trois contrôles segmentés Mode / Vitesse / Chauffage d'appoint (voir « Commande Clim8Zone » plus bas). Tableau de bord : ligne « Clim8Zone : mode · vitesse » sans contrôle. Historique : `c8z:mode`, `c8z:speed`, `c8z:heater` (« Clim8Zone — mode : Désactivée → Chauffage »), puce de filtre « Clim8Zone ».
- **Programmes** (`SpaCmd.scheduleCreate / scheduleUpdate / scheduleTrigger / scheduleDelete`, renvoient `{method, path, body}` avec le chemin complet depuis `/web`) : création `POST /spa-schedules`, modification `PATCH /spa-schedules/{id}`, exécution `POST /spa-schedules/{id}/trigger` (corps `{}`), suppression `DELETE /spa-schedules/{id}` (sans corps ; confirmation « Cette action est définitive »). Validation : nom non vide de 40 caractères au plus, au moins un jour (0 = dimanche … 6 = samedi), heure 0-23, minute 0-59, mode `READY` ou `REST`, consigne 10-40 °C convertie en °F entier ; `{id}` = 24 caractères hexadécimaux. `command()` n'accepte ces routes que par méthode + motif strict ; elles ne dépendent pas de l'état en ligne du spa (seul un jeton est requis). Après succès, `/spa-schedules/findBySpa/{id}` est relu au bout de ~1 s. Non testés sur un vrai spa (requêtes identiques à celles capturées dans le portail).
- **Heure automatique** : réglage « Correction automatique de l'heure » (pied de page, activé par défaut, `spa.autoTime`). Page ouverte, si un spa en ligne (état < 90 s, dernier signal `uplinkTimestamp`/`updatedAt` < 5 min, `military` booléen connu, aucune commande ni confirmation en cours sur ce spa) a un écart d'horloge > 5 min (ou horloge non réglée), l'interface envoie UNE fois `POST /spa-commands/time` `{spaId, via:"WEB", time:"HH:MM", isMilitaryFormat:<format actuel>}` avec l'heure de l'appareil (même source que l'alerte d'horloge ; `settings.timeZone` des programmes n'est pas utilisé). Écart inconnu : rien n'est envoyé. L'état par spa (dernier essai, échecs consécutifs) est gardé dans `localStorage` `spa.autoTimeState` et relu/écrit avant l'envoi : au plus une tentative par spa toutes les 30 min, même après rechargement ou avec plusieurs onglets ; 2 échecs consécutifs (refus ou écart inchangé après relecture) : arrêt, jusqu'à ce que l'utilisateur réactive l'interrupteur (remise à zéro). Un succès confirmé remet les échecs à zéro. Événements locaux « Heure corrigée automatiquement (écart de N min) » ou « Correction de l'heure sans effet (le spa n'a pas changé) ». C'est la seule commande envoyée sans clic. **Sur le spa …0009 cette commande n'a pas d'effet observé** : elle y échouera deux fois puis s'arrêtera (`SpaView.autoTimeDecision`).
- **Consigne au tableau de bord** : chaque carte a le stepper ±1 °F entier (affiché en °C au 0,5 + °F) et « Appliquer » (`SpaCmd.temperatureF`, mêmes garde-fous que le détail ; code partagé `tempCtl`).
- **Verrouillage de la consigne** : `SpaCmd.tempLock(spaId, locked)` -> `POST /spa-commands/panel/state` `LOCK_TEMP_SETTING` / `UNLOCK_TEMP_SETTING` ; interrupteur dans « Commandes expérimentales » (visible seulement si activées, avec confirmation), état lu dans `state.tempLock` (masqué si la clé est absente), confirmation par relecture sur 45 s. **Non vérifié sur un vrai spa** (le portail n'a pas cette commande). Consigne verrouillée : le stepper affiche « Consigne verrouillée » et « Appliquer » est désactivé.

### Comparaison de la page avec le portail (24/11/2026, compte réel, spa …0009)
- **Lecture** : après rafraîchissement, la page et l'API donnent les mêmes valeurs (température 58 °F -> 14,5 °C, consigne 50 °F -> 10,0 °C, mode, pompes, lumière, heure du spa). Un écart passager vient du décalage de ~30 s entre deux mises à jour du cloud.
- **Commande depuis la page** (clic sur l'interrupteur de la lumière) : requête identique à celle du portail et à celle d'un script (`component-state`, `componentType:"light"`, `state:"OFF"`, `deviceNumber:0`). La page affiche « envoyé, en attente » puis, sans changement relu pendant ~20 s, « Réessayez : le spa n'a pas réagi » (message exact).
- **Le spa ignorait la commande** à ce moment-là (18:46-18:48) : la lumière est restée à `HIGH` après `OFF` envoyé par la page (2 fois) et par script (1 fois), pompes allumées puis éteintes, mode `READY_REST`. La même commande avait fonctionné en ~2 s à 16:20 et 17:12. Cause inconnue (le spa est en mode « Ready in Rest » depuis 16:52 ; hypothèse non confirmée : ce mode bloque les commandes à distance).

### Essais réels depuis la page (24/11/2026)
Les deux spas du compte ne réagissent pas pareil aux commandes de **réglage**. Le spa à passerelle récente (`buildNumber` 1133/129, 59304***2511050162) les applique en ~4,5 s ; le spa à passerelle 1.16 (57547-012603100009) les accepte (HTTP 200) sans rien changer.

| Essai depuis la page | Passerelle 1133/129 | Passerelle 1.16 |
|---|---|---|
| Cycle de filtration 1 : début 04:00 -> 04:15 -> 04:00 (`filter-cycles/schedule`, `numOfIntervals:4`) | appliqué et confirmé en 4,5 s, deux fois | cycle 23:15 -> 23:30 : inchangé après ~1,5 min |
| Cycle 2 : activer puis désactiver (`toggle-filter2-state` `ON` puis `OFF`) | `DISABLED` -> « Activé, en cours » (06:15, 15 h 30) puis retour `DISABLED`, confirmés en 4,5 s | non essayé |
| Lumière | allumée en 4,5 s | commande ignorée depuis 18:46 |

- Activer le cycle 2 le met en marche tout de suite si l'heure actuelle tombe dans sa plage (pompe et ozone se sont allumés avec lui).
- Le cycle 1 n'a aucune commande d'activation (API et portail).

## Routes de l'application mobile officielle (Control My Spa 4.1.13, relevées dans l'APK, 25/11/2026)
Même hôte `https://iot.controlmyspa.com`, **sans préfixe `/web`**, commandes avec `via:"MOBILE"`. Le jeton du portail web est accepté par ces routes. Liste extraite des chaînes du code de l'application (rien d'exécuté) ; les corps de requête ne sont pas tous connus.

| Domaine | Routes |
|---|---|
| Compte | `POST /auth/login`, `/auth/refresh`, `/auth/signup`, `/auth/get-otp`, `/auth/forgot-password`, `/auth/check-email-availability` ; `/user-management/profile`, `/user-management/profile/device`, `/user-agreements/current`, `/user-agreements/agree`, `/tacs/current`, `/account-deletion-requests` |
| Spas | `GET /spas/owned`, `GET /spas/{id}/dashboard`, `/spas/claim`, `/spas/check-availability`, `/spas/set-default`, `/spas/{id}/set-default`, `/spas/{id}/alias`, `/spas/{id}/unlink` |
| Commandes | `/spa-commands/component-state`, `/panel/state`, `/time`, `/temperature/{value,range,scale,heater-mode}`, `/filter-cycles/{schedule,toggle-filter2-state}`, `/c8zone/state`, `/chromozone/{state,power,color,speed,intensity}` |
| Programmes | `/spa-schedules`, `/spa-schedules/findBySpa/{id}`, `/spa-schedules/{id}`, `/spa-schedules/{id}/status`, `/spa-schedules/{id}/trigger` |
| Journaux | `GET /events/by-spa/{id}`, `GET /fault-logs/by-spa/{id}` |
| Firmware | `GET /ota-update-rules/by-spa/{id}`, `POST /ota-update-rules/approve/{rule_id}` (le propriétaire approuve une mise à jour proposée ; `hasOtaUpdate` du tableau de bord) |
| Autres | `/notifications`, `/notifications/{id}/read`, `/remote-sessions/incoming`, `/remote-sessions/{id}/{approve,cancel,decline}` (accès à distance du revendeur), `/measurements`, `/waterbodies` (chimie de l'eau) |

### Commande Clim8Zone (`/spa-commands/c8zone/state`)
Relevée dans l'application officielle et confirmée par les messages de validation du serveur. **Attention : sans le préfixe `/web`** (`/web/spa-commands/c8zone/state` répond 404) et avec `via:"MOBILE"`. Le jeton du portail web est accepté.

`POST https://iot.controlmyspa.com/spa-commands/c8zone/state`, corps JSON `{spaId, via:"MOBILE", modeState?, speedState?, heaterState?}` : au moins un des trois champs.

| Champ | Valeurs permises |
|---|---|
| `modeState` | `C8Z_MODE_DISABLED`, `C8Z_MODE_HEAT`, `C8Z_MODE_COOL`, `C8Z_MODE_BOTH` |
| `speedState` | `C8Z_SPEED_SMART`, `C8Z_SPEED_SILENT`, `C8Z_SPEED_POWERFUL` |
| `heaterState` | `C8Z_HEATER_M7`, `C8Z_HEATER_DISABLED`, `C8Z_HEATER_AUTO`, `C8Z_HEATER_CONTINUOUS` |

- Le serveur accepte un seul champ (message réel : « Command must contain at least one of the following properties: 'modeState', 'speedState' or 'heaterState' ») ; une valeur hors liste est refusée avec un message de validation (le constructeur `SpaCmd.c8z(spaId, {mode, speed, heater})` refuse aussi avant l'envoi, en français, et accepte les valeurs courtes `HEAT`, `SILENT`, `M7`… comme les complètes).
- État lu : `GET /web/spas/{id}/current-c8z` -> `c8zMode`, `c8zSpeed`, `c8zHeater` (mêmes valeurs), `c8zHeaterState` (`OFF`/`ON`… : ce que le chauffage d'appoint fait en ce moment) et `c8zStatus` : `C8Z_STATUS_CONNECTED`, `C8Z_STATUS_NOT_PRESENT` (spa sans module : rien de commandable), `C8Z_STATUS_COMMLOST`, `C8Z_STATUS_DEFROST`, `C8Z_STATUS_ERROR`. Exemple anonymisé : `{c8zHeater:"C8Z_HEATER_M7", c8zMode:"C8Z_MODE_DISABLED", c8zSpeed:"C8Z_SPEED_SMART", c8zHeaterState:"OFF", c8zStatus:"C8Z_STATUS_CONNECTED"}`.
- Interface : un clic sur un segment non actif envoie UNE commande avec le seul champ concerné ; pendant l'envoi et la relecture, les trois groupes Clim8Zone sont désactivés (le verrou ne bloque pas les autres commandes du spa) ; garde-fous : spa en ligne, état de moins de 3 min, `SpaCmd.c8zGuard` (refus si module absent, communication perdue ou erreur ; le dégivrage est autorisé). Confirmation par relecture de `current-c8z` toutes les 3 s jusqu'à 45 s (« Le spa met jusqu'à une minute à répondre ») ; sinon « Réessayez : le spa n'a pas réagi. ».
- `command()` n'accepte l'hôte racine que pour ce chemin exact en POST (`SpaCmd.route`, testé) ; les autres routes de la liste ci-dessus gardent leurs motifs stricts.

- **Aucune commande de redémarrage** (passerelle ou agent) dans l'application : seul le revendeur ou le constructeur peut redémarrer à distance (les noms `REBOOT_GATEWAY` / `RESTART_AGENT` existent côté serveur). Les routes `/spa-commands/reboot*` et `/restart-agent` essayées répondent 404.
- `GET /spas/{id}/dashboard` apporte en plus du portail : `systemInfo.pingTime`, `systemInfo.buildNumber`, `hasOtaUpdate`, `totalAlerts`, `currentFaultMessage` (code, description, gravité), `isOnHold`, `rangeLimits`, `isMilitaryTime`, `isPanelLocked`, `alias`.
- L'état brut du portail (`/web/spas/{id}/current-state`) expose aussi `ethernetPluggedIn` et `rs485AcquiredAddress`. Sur le spa à passerelle 1.16 qui ignore les réglages, `rs485AcquiredAddress` vaut 0 (17 sur l'autre spa) et `ethernetPluggedIn` est faux.
- L'application contient aussi un parcours Bluetooth (`BLUETOOTH_VIEW_…`) pour configurer la passerelle ; non étudié.
- Essai : la consigne envoyée par ce canal (`via:"MOBILE"`) sur le spa …0009 est acceptée (HTTP 200) mais sans effet, comme par le canal web.

### Essai réel de la Clim8Zone depuis la page (25/11/2026, spa à passerelle 1.16)
`POST https://iot.controlmyspa.com/spa-commands/c8zone/state` `{spaId, via:"MOBILE", speedState:"C8Z_SPEED_SILENT"}` puis `"C8Z_SPEED_SMART"` : appliqué et confirmé par la relecture de `current-c8z` en ~4,5 s chaque fois, retour à l'état de départ vérifié. C'est le seul réglage qui s'applique sur ce spa, dont la consigne, le mode de chauffe, le format de l'heure et le verrouillage du panneau sont acceptés (HTTP 200) sans effet : la Clim8Zone passe par un autre chemin que le contrôleur principal. Le mode (`modeState`) et le chauffage d'appoint (`heaterState`) n'ont pas été essayés (mode laissé `C8Z_MODE_DISABLED`). CORS ouvert sur cette route (origine quelconque).
