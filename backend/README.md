# Backend (server.js) Setup

This backend is a Node.js Express server using SQLite. It now reads configuration from environment variables via `dotenv` so you can keep secrets and settings outside the code.

## Prerequisites
- Node.js 18+ (LTS)
- npm 8+

## Install
```
cd backend
npm install
```

## Configure (.env)
Create a `.env` file in `backend/` with the variables you need. Example:

```
# Server
NODE_ENV=production
PORT=3000

# Auth
JWT_SECRET=change-me-strong-and-random
JWT_EXPIRES_IN=7d

# Where the backend fetches assignment JSON (the data/ folder is hosted here)
ASSETS_BASE=https://falingunit.github.io/qbase

# Development helper (do not use in production)
# 1 = temporarily allow all CORS origins
ALLOW_ALL_ORIGINS=0
```

Notes:
- `JWT_SECRET` should be a strong, random string in any non-dev environment.
- `PORT` defaults to `3000` if not set.
- `ASSETS_BASE` controls where assignment data is fetched; set this to where your `data/` is hosted.

## Run
Linux/macOS:
```
cd backend
npm start
```

Windows (PowerShell):
```
cd backend
npm start
```

The server listens on `http://localhost:PORT` (default `3000`).

## Process Managers (optional)
PM2 example:
```
cd backend
npm install -g pm2
pm2 start server.js --name qbase --update-env
pm2 save
```
PM2 will read your `.env` automatically when started from the `backend/` directory.

systemd example (`/etc/systemd/system/qbase.service`):
```
[Unit]
Description=QBase Backend
After=network.target

[Service]
WorkingDirectory=/path/to/repo/backend
ExecStart=/usr/bin/node server.js
Restart=always
EnvironmentFile=/path/to/repo/backend/.env

[Install]
WantedBy=multi-user.target
```
Then:
```
sudo systemctl daemon-reload
sudo systemctl enable --now qbase
```

## Nginx (reverse proxy)
Point an upstream to your Node port and reload Nginx. Example:
```
upstream qbase_backend { server 127.0.0.1:3000; }

server {
  listen 80;
  server_name your-domain.example.com;

  location / {
    proxy_pass http://qbase_backend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Database
- SQLite file: `backend/db.sqlite` (with WAL files `db.sqlite-wal`/`db.sqlite-shm`).
- Code updates do not delete/overwrite the DB, but always back up before major changes: copy the three files while the app is stopped.

Backup example:
```
cp backend/db.sqlite* /backups/qbase-$(date +%F-%H%M)/
```

## Troubleshooting
- CORS during local dev: set `ALLOW_ALL_ORIGINS=1` temporarily while testing.
- Invalid token: clear the frontend token with `localStorage.removeItem('qb_token')` and sign in again.
- 404 for assignment data: make sure `ASSETS_BASE` matches where your `data/` is hosted.

