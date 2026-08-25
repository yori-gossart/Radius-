# Activation Google Routes pour Radius v0.2

Le code est prêt, mais il ne peut fonctionner en production tant que Google
Routes n'est pas activé et que Vercel ne possède pas le secret serveur.

## Configuration requise

1. Dans Google Cloud, utiliser/créer un projet dédié à Radius.
2. Activer la facturation du projet.
3. Activer **Routes API**.
4. Créer une clé API dédiée au backend Radius.
5. Restreindre cette clé à **Routes API** au minimum.
6. Dans Vercel, ajouter la variable d'environnement :

```text
GOOGLE_MAPS_API_KEY=<la clé>
```

La mettre au minimum en Production ; Preview aussi si les déploiements de test
doivent fonctionner.

## Garde-fous

- ne jamais écrire la clé dans GitHub ;
- ne jamais la préfixer `NEXT_PUBLIC_` ou l'insérer dans `index.html` ;
- configurer des quotas/budgets Google Cloud très bas pendant le prototype ;
- après ajout/modification de la variable Vercel, redéployer.
