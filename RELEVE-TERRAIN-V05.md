# Radius V0.5 — relevé de terrain

À remplir **après** le trajet, jamais pendant. Une ligne par moment annoncé ou
rencontré. Papier, notes du téléphone, tableur : peu importe — Radius
n'enregistre rien et n'enregistrera rien tant que la question du stockage n'aura
pas été tranchée.

## Avant de partir

Ouvrir « Détails techniques » et recopier, ou photographier, le bloc des
épisodes. Il donne pour chaque moment : ses zones sources, son étendue, son
exposition, son côté dominant, son anticipation cible, et s'il est sélectionné
ou écarté — avec la raison.

Sans ce bloc, un relevé est inexploitable : on ne saura pas si Radius s'est tu
parce qu'il n'avait rien vu, ou parce que le plafond était atteint.

## Pour chaque moment

| Champ | Valeurs |
|---|---|
| Épisode | `EP-01`, `EP-02`… |
| Heure réelle de passage | hh:mm |
| Annoncé ? | oui / non |
| Si non annoncé, raison du journal | plafond / cooldown / trop tard / non éligible |
| Moment de l'annonce | trop tôt / bon / trop tard |
| Soleil réellement visible ? | oui / non |
| Gêne vécue | rien / visible / gênant / très gênant |
| Élévation solaire au moment du passage | ° (bloc technique de la zone représentative) |
| Horizon | dégagé / relief / bâtiments / arbres |
| Commentaire | libre |

## Les deux seaux, à ne jamais mélanger

**Seau A — horizon dégagé.** Côte, plaine, mer devant soi. C'est le seul seau
qui peut faire bouger `T`.

**Seau B — horizon masqué.** Relief, immeubles, végétation. Ces observations se
notent, s'analysent, et ne touchent **jamais** à `T`. À La Réunion, le relief
coupe le soleil trente à soixante minutes avant l'horizon astronomique :
« annoncé mais rien vu » y sera l'observation la plus fréquente, et elle sera
souvent astronomiquement juste.

## Ce que ce relevé doit permettre de décider, plus tard

| Observation répétée | Ce qui bougerait — après plusieurs trajets, jamais après un seul |
|---|---|
| « annoncé, rien vu » en horizon dégagé | `T` — les seuils de détection |
| « gêné sans avoir été prévenu » en horizon dégagé | `T` |
| « trop d'annonces sur un même trajet » | `EPISODE_GAP_S`, ou le plafond |
| « deux cartes pour un seul moment vécu » | `EPISODE_GAP_S` |
| « une carte pour deux moments distincts » | `EPISODE_GAP_S` |
| « annoncé trop tôt, j'avais oublié » | `LEAD_*` |
| « annoncé trop tard pour m'y préparer » | `LEAD_*` |
| « je n'ai pas compris la phrase » | la microcopie |

**Aucune constante ne se modifie automatiquement.** Ni `T`, ni les constantes
V0.5. Le relevé s'accumule d'abord ; l'ajustement vient ensuite, et se justifie
par ce qui est écrit ici.
