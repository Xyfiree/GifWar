# 🎮 GifWar

Jeu multijoueur de GIFs — bataille de réactions en temps réel.

## Lancer en local

```bash
npm install
node server.js
```

Ouvre http://localhost:3000

## Déployer sur Railway

1. Crée un compte sur [railway.app](https://railway.app)
2. Clique **"New Project"** → **"Deploy from GitHub repo"**
3. Connecte ton GitHub et sélectionne ce repo
4. Dans l'onglet **Variables**, ajoute :
   - `GIPHY_KEY` → ta clé Giphy
   - `GEMINI_KEY` → ta clé Google AI
5. Railway détecte automatiquement Node.js et lance `npm start`
6. Clique sur le domaine généré — ton jeu est en ligne 🚀

## Modes de jeu

- **Mode 1 — Conversation** : une conversation générée par IA apparaît, les joueurs trouvent le GIF de réaction parfait
- **Mode 2 — Situation** : une phrase/situation apparaît, même principe

## Système de points

- **+2 pts** par vote reçu sur son GIF
- **+1 pt** si tu as voté pour le GIF gagnant

## Stack technique

- Backend : Node.js + Express + Socket.io
- IA : Google Gemini 1.5 Flash
- GIFs : Giphy API
- Frontend : HTML/CSS/JS vanilla
