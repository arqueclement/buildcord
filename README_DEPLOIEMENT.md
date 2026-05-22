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

## Connexion membre

Les membres se connectent avec leur email et un code personnel BuildCord.
Lors de la premiere connexion, le compte est cree automatiquement.
Le code n'est pas stocke en clair: il est hache cote serveur.

## Codes par email avec Resend

Cette version n'a pas besoin de Resend pour la connexion membre.
Tu peux garder `RESEND_API_KEY` dans Netlify si elle existe deja, mais elle n'est plus utilisee par le parcours principal.

Plus tard, tu peux reactiver l'envoi de codes par email si tu veux une validation plus stricte.
