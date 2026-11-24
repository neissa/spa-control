# API Control My Spa (non officielle, relevée dans le portail)

Base : `https://iot.controlmyspa.com/web`. En-tête `Authorization: Bearer <jeton>` (jeton obtenu par `POST /auth/login`, rafraîchi par `POST /auth/refresh`). CORS ouvert (`*`). Réponses : `{statusCode, message, data}`.
Rien ci-dessous n'est documenté officiellement : tout vient de la lecture du code du portail et de requêtes GET. **Seule la commande `component-state` sur une lumière a été testée sur un vrai spa (24/11/2026) ; les autres POST ne l'ont pas été.**

Essai vérifié : `POST /spa-commands/component-state` avec `{spaId, via:"WEB", componentType:"light", state:"OFF", deviceNumber:0}` puis `state:"HIGH"` ; réponse HTTP 200 `{"message":"Component state has been set successfully.","data":{"success":true}}` en ~1,1 s ; `current-state` reflète le nouvel état ~2 s plus tard (mise à jour de `updatedAt`).

Essai pompe (24/11/2026, pompe 2 = `componentType:"jet"`, `deviceNumber:1`, `availableValues` `OFF/LOW/HIGH`) : la demande `state:"LOW"` renvoie HTTP 200 mais l'état relu devient **`HIGH`**, pas `LOW` ; la demande `state:"OFF"` éteint la pompe (confirmé en ~2 s). Le niveau demandé n'est donc pas garanti pour une pompe : toujours relire l'état réel (cette pompe est peut-être mono-vitesse malgré la liste d'états).

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
| `/component-state` | `componentType`, `state`, `deviceNumber?` | `componentType` : `jet` (PUMP), `circ-pump`, `light`, `blower`, `mister`, `microsilk`, `aux`, `ozone`. `state` : `OFF`, `LOW`, `MED`, `HIGH`, `ON` selon `availableValues` du composant (une pompe `ON` est envoyée `HIGH`). `deviceNumber` = `port` du composant, pour PUMP, LIGHT, BLOWER, MISTER, AUX seulement |
| `/panel/state` | `state` | `LOCK_PANEL`, `UNLOCK_PANEL`, `LOCK_TEMP_SETTING`, `UNLOCK_TEMP_SETTING` |
| `/temperature/value` | `value` | consigne en **°F ENTIER** (jamais de décimale ; 10,5 °C = 51 °F). Toutes les températures de l'état (`currentTemp`, `desiredTemp`, `setupParams.*`) sont aussi en °F, quel que soit `celsius` (simple échelle d'affichage du panneau). L'interface arrondit le °F à l'entier puis affiche des °C arrondis à 0,5 ; `currentTemp` 0 ou hors 32–140 °F (ex. `262.00`, sonde non lue) s'affiche « — » ; plafond absolu des consignes : 50–104 °F (10–40 °C) |
| `/temperature/heater-mode` | `mode` | `READY`, `REST`, `READY_REST` |
| `/temperature/range` | `range` | `HIGH`, `LOW` |
| `/temperature/scale` | `scale` | `CELSIUS`, `FAHRENHEIT` (échelle d'affichage du spa) |
| `/time` | `time`, `isMilitaryFormat` | le portail ne l'utilise que pour changer le format 12/24 h, en renvoyant l'heure du spa ; format exact de `time` non confirmé (probablement `HH:MM`) |
| `/filter-cycles/schedule` | `deviceNumber`, `numOfIntervals`, `time` | `deviceNumber` = `port` du filtre ; `numOfIntervals` et `time` : conversions non confirmées |
| `/filter-cycles/toggle-filter2-state` | `state` | `ON`, `OFF` (active le cycle de filtration 2) |

Le portail désactive les commandes quand le spa est hors ligne (`online=false`) ou quand `canControl` est faux (règle inconnue, sans doute rôle du compte). Une erreur renvoie `error.message`.

## Utilisation dans l'interface (`index.html`)
- `command(req)` envoie `POST /spa-commands{path}` (jeton Bearer, 401 -> refresh puis nouvel essai) pour les seuls chemins du tableau ci-dessus ; les corps sont construits par `SpaCmd` (`commands.js`). Jamais de commande hors clic. Message d'erreur affiché : `error.message` (ou `message`) de la réponse.
- Après un envoi accepté : relecture de `current-state` et `current-c8z` de ce spa à ~2 s, ~6 s, ~10 s ; succès annoncé seulement si l'état relu correspond. `/temperature/scale` n'a pas d'écran.
- Disponibles par défaut : `/component-state` (PUMP, LIGHT, BLOWER, MISTER, AUX, MICROSILK ; jamais circulation ni ozone ; aucun contrôle si le `port` requis manque ou si deux composants ont la même clé), `/temperature/value`, `/temperature/heater-mode`, `/temperature/range`, `/panel/state` (`LOCK_PANEL` / `UNLOCK_PANEL` seulement, et seulement si la clé `panelLock` est présente dans l'état).
- Garde-fous : aucune commande si le dernier état connu a plus de 3 min (90 s pour `/time`) ; une seule commande de composant ou « Tout éteindre » à la fois par spa ; « Tout éteindre » saute et signale les composants allumés sans état OFF ou sans port.
- Derrière « Commandes expérimentales » (`spa.experimental` dans localStorage, revérifié à l'envoi) : `/time` (format 12/24 h et réglage manuel sur l'heure de l'appareil), `/filter-cycles/schedule` et `/filter-cycles/toggle-filter2-state` (interrupteur affiché seulement si le 2e composant `FILTER` existe et n'est pas `DISABLED`).
- Hypothèses de relecture : verrouillage = `state.panelLock` (booléen ou texte `LOCK_*`) ; filtre 2 = deuxième composant `FILTER`, actif si sa valeur n'est pas `OFF`. Le cycle de filtration n'est pas relisible : l'interface l'indique.
- Journaux : `/events/by-spa/{id}/historical` et `/fault-logs/by-spa/{id}/historical` (`page`, `pageSize=20`, `totalItems`) lus à l'ouverture du détail et par « Charger plus » ; gardés en mémoire seulement. Une erreur (403 ...) laisse le relevé local affiché.
