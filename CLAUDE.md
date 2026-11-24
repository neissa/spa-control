# spa-control

Page web 100 % navigateur (index.html + stats.js, localStorage) qui remplace le portail Control My Spa. API non officielle : https://iot.controlmyspa.com/web. Détails dans README.md.

## Règles du projet
- Ne jamais lire, afficher ni committer `.env`, mots de passe ou jetons (le dépôt est public).
- Pas de dépendance ni de build : garder index.html + stats.js. `node --test` doit passer.
- Ne pas envoyer de commande d'écriture au spa (pompes, lumières, consigne) sans accord explicite de l'utilisateur.
- L'utilisateur a demandé de ne plus poser de questions de confirmation (« ne me demande plus, avance », 24/11/2026) : commiter et pousser la branche `feat/web-statique` sans demander, une fois tests et vérifications au vert. Jamais de push sur `main`, jamais de force push, aucune pull request sans demande.
- Essais sur le vrai spa 57547-012603100009 : seulement réversibles, un équipement à la fois, état de départ rétabli et relevé ; l'API ne permet PAS de savoir si quelqu'un utilise le spa (pompes éteintes ne prouve rien ; en mode Ready in Rest la pompe 1 s'allume seule) : ne jamais prétendre savoir qu'il est « libre ». L'utilisateur a supprimé l'exigence de confirmation (« supprime le besoin de confirmation pour les essais sur le vrai spa », 24/11/2026) : les essais réversibles se font sans demander, en acceptant ce risque d'usage simultané, mais on s'arrête dès que l'état change de lui-même pendant l'essai ; vérifier l'origine de l'onglet (https://controlmyspa.com) avant tout POST.

## Méthode de travail
1. Avant toute action : écrire un plan court.
2. Exécuter. Tout agent qui modifie des fichiers est lancé en worktree dédié (`isolation: "worktree"`) ; les agents `spa-scout` et `spa-reviewer` sont en lecture seule et n'en ont pas besoin.
3. Lancer `node --test` et vérifier le résultat réel (syntaxe de index.html, comportement attendu) avant de déclarer que c'est fini.
4. Fusionner le worktree dans la branche seulement si tout est vert, puis demander avant de pousser.

## Interface (UI/UX)
Tout travail d'interface passe par le skill `apple-design` (HIG d'Apple) : le charger avant de dessiner ou modifier une page, lire ses références (accessibility, layout, typography, color, designing-for-ios) et citer les pages utilisées. Les agents qui écrivent de l'UI reçoivent la même consigne et le chemin `C:\Users\A\.claude\skills\apple-design\references\hig`.

## Routage des modèles
Choisir le modèle le moins cher qui fait correctement la tâche. Passer au niveau supérieur seulement si le résultat est faux ou ambigu.

| Tâche | Modèle |
|---|---|
| Chercher/lire du code, répondre « où est X ? », résumer un fichier, git status/diff, retouche de texte ou de README | haiku, via l'agent `spa-scout` |
| Ajouter/modifier une fonction dans index.html ou stats.js, écrire un test, corriger un bug local | sonnet (modèle par défaut de la session) |
| Analyser une réponse d'API inconnue, définir une règle métier (ex. « chauffe », « hors ligne »), changer l'architecture, relire avant publication (sécurité, fuite de secrets, XSS) | opus, via l'agent `spa-reviewer` ou en changeant le modèle de session |

Règles de bascule :
- Un bug qui résiste à 2 essais avec sonnet passe à opus.
- Toute modification touchant l'authentification, les jetons ou localStorage est relue par `spa-reviewer` avant le push.
- Les recherches larges se font avec `spa-scout` pour ne pas remplir le contexte principal.
