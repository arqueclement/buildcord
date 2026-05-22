# BuildCord - Deploiement avec vrais tickets

Le site utilise une Netlify Function pour creer, lire et fermer les tickets.
Pour que les tickets fonctionnent vraiment, il faut deployer le projet avec le build Netlify.

## Methode recommandee

1. Mets tous les fichiers du projet dans un depot GitHub.
2. Dans Netlify, va dans ton site Buildcord.
3. Va dans `Configuration du projet` puis connecte le depot GitHub.
4. Laisse Netlify utiliser ces reglages:
   - Build command: vide
   - Publish directory: `.`
   - Functions directory: `netlify/functions`
5. Lance un nouveau deploy.

Le simple glisser-deposer Netlify Drop publie les fichiers statiques, mais il ne suffit pas toujours pour construire les Functions et installer `@netlify/blobs`.

## Test apres deploiement

Ouvre:

`https://buildcord.netlify.app/.netlify/functions/tickets`

Si la Function existe, tu dois voir une reponse du serveur, meme si la methode GET est refusee.

## Codes par email avec Resend

Pour que les membres recoivent un code par email, ajoute cette variable dans Netlify:

- `RESEND_API_KEY`: ta cle API Resend

Optionnel:

- `RESEND_FROM_EMAIL`: expediteur, par exemple `BuildCord <onboarding@resend.dev>` ou une adresse de ton domaine verifie.

Sans domaine verifie sur Resend, l'adresse `onboarding@resend.dev` sert surtout aux tests. Pour envoyer a tout le monde proprement, ajoute plus tard un domaine BuildCord dans Resend.
