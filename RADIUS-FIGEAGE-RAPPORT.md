# Radius — « Le calcul reste figé »

Diagnostic, correction et vérification. 5 septembre 2026.

**Version en ligne :** https://radius-eblouissement.vercel.app
Commit `a83e120`, branche `claude/pwa-prototype-vercel-zttut7`, déploiement
`dpl_Ea1hSLMPuYN46u34zKA41fbJZPBT` — état READY.

> **Sur le téléphone : recharger la page une fois.** Le cache du service worker
> passe en `radius-v4`, l'ancienne page reste servie tant qu'elle n'est pas
> remplacée.

---

## 1. Ce que disent les journaux

Les journaux Vercel de l'heure du relevé, en UTC (17:26 à La Réunion = 13:26 UTC) :

| Heure UTC | Appel | Réponse |
|---|---|---|
| 13:25:46 | `POST /api/route` | 200 |
| 13:25:48 | `POST /api/elevation` | 200 |
| 13:25:50 | `POST /api/weather` | **502** |
| 13:26:48 | `POST /api/route` | 200 |
| 13:26:49 | `POST /api/elevation` | 200 |
| 13:26:50 | `POST /api/weather` | 200 |

Deux analyses, à une minute d'écart. La seconde a vu ses trois appels **partir
et aboutir en deux secondes**. La capture d'écran est postérieure d'au moins dix
secondes, et la page était toujours sur « Calcul en cours… ».

**Le serveur avait fini. La page, non.**

## 2. Ce que cela élimine

Ce n'était ni la clé Google, ni un quota, ni le contrôle d'origine, ni une
adresse mal géocodée, ni un départ passé : tout cela produit une réponse
d'erreur, et donc un message à l'écran.

Ce n'était pas non plus une exception dans le rendu. Tout ce qui suit le dernier
`await` de `analyserTrajet()` est **synchrone**, et une exception y est
rattrapée, affichée, et le `finally` rend le bouton. J'ai relu la chaîne
complète — `render()`, `dessinerLigne()`, `carteEpisode()`, `remplirTech()`,
`drawGlass()`, la construction des épisodes : aucune boucle non bornée, aucune
attente cachée.

Il ne restait qu'une possibilité : **une attente qui ne se termine jamais.**

## 3. Le défaut

Un `try/catch` attrape un **rejet**. Il ne peut rien contre une **absence**.

```js
const r = await fetch('/api/weather', …);   // 200, la connexion est établie
let j = null;
try { j = await r.json(); } catch {}        // ← le corps n'arrive pas au bout
```

Vercel journalise le statut au moment où la fonction rend la main. Le **corps**
de la réponse doit encore traverser le réseau. Sur un téléphone en cellulaire,
une socket à moitié ouverte laisse `await r.json()` en attente sans limite —
et il n'y avait **aucune échéance nulle part** : ni sur `/api/route`, ni sur
`/api/elevation`, ni sur `/api/weather`, ni sur Nominatim.

L'analyse tient un verrou (`state.analyseEnCours`) relâché par un `finally`.
Un `await` qui ne se termine pas n'atteint jamais ce `finally`. Le verrou reste
posé, le bouton grisé, à vie, sans un mot.

**Un 502 sur `/api/weather` une minute plus tôt** montre que cet endpoint était
en mauvaise santé à cet instant précis. C'est cohérent, mais je ne l'ai pas
prouvé sur le téléphone : je n'ai pas de trace réseau de l'appareil. Ce qui est
prouvé, c'est que **rien d'autre dans le code ne peut produire cet écran**, et
que la structure permettait le figeage. Le second essai que vous avez lancé
n'était donc pas de la malchance : c'était le même piège.

### Un second défaut, trouvé au passage

`resetAnalyseTrajet()` s'exécutait **après** la pose du verrou mais **hors** du
`try`. N'importe quelle exception à cet endroit — un identifiant d'élément
disparu, par exemple — produisait exactement le même écran figé. Ce n'est pas ce
qui s'est passé le 5 septembre (aucune requête n'aurait été émise), mais c'était
la même bombe, armée ailleurs.

## 4. La correction

**Aucun appel réseau sans échéance.** Les quatre passent par `fetchBorne()`, qui
lit le **corps sous la même échéance que la connexion** — c'est là que l'attente
se perdait, pas à l'établissement.

| Appel | Échéance | Comportement si dépassée |
|---|---|---|
| `/api/route` | 20 s | échec net, message nommant la durée |
| `/api/elevation` | 12 s | relief `unknown`, **le trajet s'affiche** |
| `/api/weather` | 12 s | météo `unknown`, **le trajet s'affiche** |
| Nominatim | 12 s | recherche d'adresse indisponible |

**Le relief et la météo ne peuvent plus bloquer un résultat.** Ce sont des
couches passives : elles n'entrent dans aucune décision, elles ne peuvent donc
pas empêcher d'en rendre une. Leur panne dégrade leur propre statut en
`unknown` — jamais en valeur inventée — et le trajet s'affiche quand même.

**La panne est nommée, avec sa durée** : « Open-Meteo n'a pas répondu en 12 s. »
apparaît dans les détails techniques. Si cela se reproduit, l'écran dira quoi.

**`resetAnalyseTrajet()` est passé dans le `try`.** Toute la chaîne entre la pose
du verrou et le `finally` qui le retire est désormais gardée.

Ces durées **bornent une attente, elles ne mesurent rien**. Ce ne sont pas des
seuils scientifiques et elles ne se mêlent jamais à `T`.

## 5. Le moteur n'est pas touché

Aucune ligne de `T`, `solar()`, `classify()`, `analyze()`, du rééchantillonnage,
de la détection de zones ni de la couche épisodes ne change. Vérifié sur le diff
et sur la page en production : `maxElev: 8 / maxDelta: 12`, `STEP_METERS = 100`,
`MAX_ALERTS = 4`, `COOLDOWN_MS = 180000`, `EPISODE_GAP_S = 300`,
`MIN_LEAD_SECONDS = 15` — tous intacts.

## 6. Vérification

Nouveau banc `test-figeage.mjs` — 22 contrôles, avec un serveur qui **ne répond
jamais et ne ferme jamais la socket**, seule façon de reproduire ce qu'a vu le
téléphone.

| Cas | Ce qu'il éprouve |
|---|---|
| F-001 | `/api/route` muet → échéance, message, bouton rendu |
| F-002 | `/api/weather` muet → le trajet s'affiche, météo `unknown` |
| F-003 | `/api/elevation` muet → le trajet s'affiche, relief `unknown` |
| F-004 | exception dans la remise à zéro → dite, jamais figée |
| F-005 | après une échéance, un second essai aboutit |

**Avant correction :** F-001 restait figé 28 secondes sans rien dire — le banc a
reproduit votre capture d'écran. F-004 échouait sur les deux contrôles.
**Après :** 22/22.

Non-régression, tous verts :

| Banc | Contrôles |
|---|---|
| `test-route.mjs` | 4 |
| `test-api.mjs` | 78 |
| `test-episodes.mjs` | 53 |
| `test-corrections.mjs` | 57 |
| `test-aller-retour.mjs` (+ scénarios riche, moments, planifié) | 71 |
| `test-figeage.mjs` | 22 |
| **Total** | **285** |

## 7. Ce qui reste ouvert

- **Le plafond de budget Google Cloud n'est toujours pas posé.** C'est la seule
  protection réelle contre un abus de quota, et c'est une action de compte, pas
  de code.
- **Le 502 d'Open-Meteo n'est pas expliqué.** L'application le supporte
  maintenant sans se figer, mais je ne sais pas pourquoi il est survenu. S'il
  revient souvent, il faudra regarder `api/weather.js` de plus près.
- **Aucun relevé de terrain pour `T`.** La phase de mesure n'a toujours pas
  commencé.
