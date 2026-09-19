# Epure — relevé de compteurs

PWA hors-ligne pour la comptabilité électrique d'une guest house : 4 chambres,
4 compteurs Ingelec DDS1531, relevé à l'arrivée et au départ, facture
partageable par WhatsApp ou enregistrable en photo.

**Aucun serveur, aucun compte, aucune synchronisation.** Les données vivent
dans IndexedDB sur le téléphone qui a installé l'app.

## En ligne

**<https://fruitizz.github.io/epure-compteurs/>**

Servie par GitHub Pages depuis la branche `main`. Tout `git push` sur `main`
redéploie l'app en une à deux minutes ; le service worker récupère la nouvelle
version au démarrage suivant, dès qu'il y a du réseau.

Ce sont des fichiers statiques : il n'y a rien à compiler. **HTTPS est
obligatoire** — sans lui, ni la caméra (scan des QR) ni l'installation sur
l'écran d'accueil ne fonctionnent. `localhost` fait exception pour les essais.

## Installation sur les téléphones

- **Android (Chrome)** — ouvrir l'URL → menu ⋮ → *Installer l'application*.
- **iPhone (Safari)** — ouvrir l'URL → bouton Partager → *Sur l'écran d'accueil*.
  Cette étape n'est pas cosmétique : une app web installée est protégée de la
  purge automatique du stockage que Safari applique aux sites peu visités.

## Essai local

```sh
python3 -m http.server 8777
# puis http://127.0.0.1:8777
```

## Utilisation

| Geste | Où |
|---|---|
| Voir l'état des 4 chambres | onglet **Récap** |
| Ouvrir une chambre en scannant son compteur | onglet **Scanner** |
| Enregistrer une arrivée | chambre libre → *Enregistrer une arrivée* |
| Enregistrer un départ et facturer | chambre occupée → *Enregistrer le départ* |
| Retrouver une facture passée | onglet **Archives** |
| Renommer les chambres, prix du kWh, en-tête | ⚙ **Réglages** |
| **Sauvegarder** | ⚙ Réglages → *Sauvegarder maintenant* |

### La sauvegarde n'est pas optionnelle

Sans synchronisation, un téléphone perdu emporte toute la comptabilité.
*Sauvegarder maintenant* produit un fichier JSON complet — relevés, factures et
photos comprises — envoyé via la feuille de partage (WhatsApp vers soi-même,
e-mail, Drive). Un bandeau orange apparaît dès qu'une facture a été clôturée
depuis la dernière sauvegarde. *Restaurer une sauvegarde* repart de ce fichier
sur un téléphone neuf.

## Ce que l'app vérifie à ta place

1. L'index de sortie ne peut pas être inférieur à celui d'entrée.
2. L'index d'entrée ne peut pas être inférieur au dernier relevé de la chambre
   — sauf si la case « le compteur est repassé à zéro » est cochée.
3. Une seule occupation en cours par chambre.
4. Photo du compteur obligatoire à l'arrivée comme au départ.
5. Alerte si la consommation dépasse le seuil par nuit, ou si elle est nulle.
6. Format d'index contrôlé : jusqu'à 7 chiffres et une décimale.

## Pourquoi pas d'OCR

L'afficheur des DDS1531 est un LCD 7 segments. Testé sur les 4 photos réelles
des compteurs, le moteur de reconnaissance d'Apple — le meilleur disponible
sur ces téléphones — s'est trompé **4 fois sur 4**, avec des confiances de 0,30
à 0,50, et n'a jamais restitué la virgule décimale. Tesseract.js, la seule
option en navigateur, fait moins bien. Un chiffre faux qui passe inaperçu est
pire qu'une saisie manuelle : l'app affiche donc la photo juste au-dessus du
champ, et c'est l'œil humain qui tranche.

Les QR codes, eux, se lisent parfaitement (confiance 1,00 sur les 4) et servent
à ouvrir la bonne chambre d'un coup de caméra.

## Le QR change tous les ans

Le QR est imprimé sur la vignette de vérification métrologique de l'ANM, qui
est remplacée à chaque re-vérification annuelle. Quand c'est le cas :
⚙ Réglages → la chambre concernée → *Réassocier le QR*. L'historique est
conservé — la chambre est l'entité durable, le QR n'est qu'un raccourci.

## Fichiers

```
index.html            coquille + écrans
app.js                toute la logique (IndexedDB, écrans, facture, scanner)
styles.css            thème clair/sombre automatique
sw.js                 service worker — cache de la coquille
manifest.webmanifest  installation sur l'écran d'accueil
vendor/jsqr.js        lecture des QR sur Safari iOS (pas de BarcodeDetector)
icons/                icônes d'application
```

Les 4 compteurs sont pré-enregistrés dans `SEED_CHAMBRES` (`app.js`) avec leur
QR, leur vignette et leur index au 19/09/2026 : 363,2 · 241,3 · 538,7 · 517,3.
