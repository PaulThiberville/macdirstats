# MacDirStat

Visualisez ce qui occupe l'espace disque de votre Mac sous forme de **treemap**, à la manière de WinDirStat, avec une interface moderne.

- **Zéro dépendance** : Node.js ≥ 18 suffit.
- **Rapide** : scan parallèle (environ 30 dossiers à la fois).
- **Tailles exactes** : c'est l'espace réellement occupé sur le disque (comme `du`). Les fichiers iCloud non téléchargés et les fichiers creux APFS sont donc comptés correctement, et les liens physiques ne sont comptés qu'une fois.
- **Actions** : afficher dans le Finder, mettre à la corbeille (récupérable).

## Application Mac (.dmg)

**Télécharger** : onglet *Releases* du dépôt, ou *Actions › Build macOS app › Artifacts*.

**Construire soi-même** sur un Mac :

```bash
npm install
npm run app    # lancer en mode développement
npm run dist   # génère dist/MacDirStat-1.0.0-arm64.dmg
```

**Publier une version** : `git tag v1.1.0 && git push --tags`. GitHub Actions construit le `.dmg` et l'attache à une Release.

**Premier lancement** : l'app est signée ad-hoc, mais pas notarisée par Apple (il faudrait un compte développeur à 99 $/an). macOS la bloque donc au premier lancement. Pour l'autoriser, deux options :
- ouvrir Réglages Système › Confidentialité et sécurité, puis cliquer sur *Ouvrir quand même* ;
- ou lancer `xattr -dr com.apple.quarantine /Applications/MacDirStat.app`.

Pour tout analyser, ajoutez **MacDirStat** à la liste *Accès complet au disque*.

## En ligne de commande (sans Electron)

```bash
node bin/macdirstat.js            # analyse votre dossier personnel
node bin/macdirstat.js ~/Library  # ou n'importe quel dossier
npm link && macdirstat ~/Downloads # installer la commande globalement
```

Le navigateur s'ouvre sur `http://localhost:4280`. Options : `--port 5000`, `--no-open`.

**Disque entier** : analysez `/System/Volumes/Data`. Depuis macOS Catalina, vos données sont sur ce volume, distinct du volume système en lecture seule, et le scan ne traverse jamais d'un volume à un autre.

**Dossiers inaccessibles** : pour tout voir, donnez l'*Accès complet au disque* à votre Terminal dans Réglages Système › Confidentialité et sécurité.

## Utilisation

| Action | Effet |
|---|---|
| Survol | Détails dans l'infobulle |
| Clic | Sélection, synchronisée avec l'arbre |
| Double-clic / Entrée | Zoomer dans le dossier |
| ⌫ / Échap | Remonter d'un niveau |
| Clic sur un type de fichier | Le mettre en évidence dans la carte |

## Architecture

```
electron/main.js    app de bureau : fenêtre native, dialogue de dossier, corbeille native
bin/macdirstat.js   CLI : ouvre l'interface dans le navigateur
lib/server.js       serveur HTTP local (127.0.0.1) + API JSON
lib/scan.js         scan, agrégation, sérialisation
public/             interface (canvas, treemap squarifié, arbre virtualisé)
```

Pour garder une interface fluide même avec des millions de fichiers, le serveur conserve l'arbre complet en mémoire. Il n'envoie au navigateur que les ~50 000 éléments les plus significatifs de la vue courante, et regroupe le reste en « petits éléments ». Zoomer recharge la vue avec plus de détail.

Sécurité : le serveur écoute uniquement en local. L'API exige un jeton aléatoire généré à chaque lancement, ce qui empêche un site web de déclencher une suppression.
