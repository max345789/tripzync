# Tripzync Backend

Production API for Tripzync mobile clients.

## Core endpoints
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/social-login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `POST /api/generate-trip`
- `GET /api/trips`
- `GET /api/trip/:id`
- `PATCH /api/trip/:id`
- `POST /api/trip/:id/regenerate`
- `DELETE /api/trip/:id`
- `GET /api/explore`

API envelope and payload contracts are frozen in `API_CONTRACT.md`.

## Local run
```bash
npm install
npm run prisma:generate
npm run build
npm run dev
```
