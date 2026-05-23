# Africa Live API

Backend API pour l'application Africa Live - Streaming Audio Live sur Panels.

## Fonctionnalités

- Authentification (inscription/connexion avec JWT)
- Panels audio en direct
- Chat en temps réel (WebSocket/Socket.IO)
- Système de cadeaux virtuels (coins/diamants)
- Profils utilisateurs
- Système de follow

## Déploiement sur Render.com

1. Uploadez ce code sur GitHub
2. Sur Render.com, créez un nouveau "Web Service"
3. Connectez votre repository GitHub
4. Configuration :
   - **Build Command** : `npm install`
   - **Start Command** : `node index.js`
5. Variables d'environnement :
   - `JWT_SECRET` = `AfricaLive2026SecretKey`
   - `NODE_ENV` = `production`

## API Endpoints

- `POST /api/auth/register` - Inscription
- `POST /api/auth/login` - Connexion
- `GET /api/auth/verify` - Vérifier le token
- `GET /api/panels` - Liste des panels en direct
- `POST /api/panels` - Créer un panel
- `GET /api/gifts/shop` - Boutique de cadeaux
- `POST /api/gifts/send` - Envoyer un cadeau
- `GET /api/users/:id` - Profil utilisateur
- `POST /api/users/:id/follow` - Suivre un utilisateur
- `GET /api/health` - Health check
