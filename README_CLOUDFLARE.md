# BuildCord sur Cloudflare Pages

Ce projet utilise une Function Cloudflare dans `functions/api/tickets.js`.

Pour que les tickets fonctionnent, il faut ajouter un stockage KV :

1. Dans Cloudflare, ouvre ton projet Pages `buildcord`.
2. Va dans `Settings` puis `Functions`.
3. Dans `KV namespace bindings`, ajoute un binding.
4. Nom de variable obligatoire :
   `BUILDCORD_KV`
5. Cree ou choisis un namespace KV, par exemple :
   `buildcord`
6. Sauvegarde, puis redeploie le projet.

Le site appelle maintenant :

```text
/api/tickets
```

Identifiants admin actuels :

```text
Identifiant : BuildMoi.123
Mot de passe : @123build
```
