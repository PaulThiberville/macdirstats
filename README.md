# MacDirStat

Visualisez ce qui occupe l'espace disque de votre Mac sous forme de **treemap**, à la manière de WinDirStat, avec une interface moderne.

- **Zéro dépendance** : Node.js ≥ 18 suffit.
- **Rapide** : scan parallèle (environ 30 dossiers à la fois).
- **Tailles exactes** : c'est l'espace réellement occupé sur le disque (comme `du`). Les fichiers iCloud non téléchargés et les fichiers creux APFS sont donc comptés correctement, et les liens physiques ne sont comptés qu'une fois.
- **Actions** : afficher dans le Finder, mettre à la corbeille (récupérable).

## Installer

1. Téléchargez le `.dmg` depuis la **[dernière Release](https://github.com/paulthiberville/macdirstats/releases/latest)**.
2. Ouvrez-le et glissez **MacDirStat** dans *Applications*.
3. **Premier lancement uniquement** : l'app n'est pas notarisée par Apple, donc macOS la bloque. Ouvrez Réglages Système › Confidentialité et sécurité et cliquez sur **Ouvrir quand même**.
4. Recommandé : ajoutez MacDirStat à *Accès complet au disque*, dans ce même panneau, pour pouvoir tout analyser.

Ensuite, il suffit d'ouvrir l'app : elle analyse votre dossier personnel dès le lancement.

**Publier une nouvelle version** : modifiez `version` dans `package.json` et poussez sur `master`. GitHub Actions construit le `.dmg` et crée la Release. Pour construire en local sur un Mac : `npm install && npm run dist`.

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
