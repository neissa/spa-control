# API Control My Spa (non officielle, relevée dans le portail)

Base : `https://iot.controlmyspa.com/web`. En-tête `Authorization: Bearer <jeton>` (jeton obtenu par `POST /auth/login`, rafraîchi par `POST /auth/refresh`). CORS ouvert (`*`). Réponses : `{statusCode, message, data}`.
Rien ci-dessous n'est documenté officiellement : tout vient de la lecture du code du portail et de requêtes GET. **Les POST n'ont pas été testés sur un vrai spa.**

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
| `/temperature/value` | `value` | consigne **en °F** (le portail convertit depuis °C ; 10,5 °C = 50,9 °F, pas de 0,1 °F) |
| `/temperature/heater-mode` | `mode` | `READY`, `REST`, `READY_REST` |
| `/temperature/range` | `range` | `HIGH`, `LOW` |
| `/temperature/scale` | `scale` | `CELSIUS`, `FAHRENHEIT` (échelle d'affichage du spa) |
| `/time` | `time`, `isMilitaryFormat` | le portail ne l'utilise que pour changer le format 12/24 h, en renvoyant l'heure du spa ; format exact de `time` non confirmé (probablement `HH:MM`) |
| `/filter-cycles/schedule` | `deviceNumber`, `numOfIntervals`, `time` | `deviceNumber` = `port` du filtre ; `numOfIntervals` et `time` : conversions non confirmées |
| `/filter-cycles/toggle-filter2-state` | `state` | `ON`, `OFF` (active le cycle de filtration 2) |

Le portail désactive les commandes quand le spa est hors ligne (`online=false`) ou quand `canControl` est faux (règle inconnue, sans doute rôle du compte). Une erreur renvoie `error.message`.
