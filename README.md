# Nexora Shipping Backend API

Node.js + Express + TypeScript + Prisma backend for Nexora Shipping.

## Stack
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Language**: TypeScript
- **ORM**: Prisma
- **Database**: PostgreSQL (Google Cloud SQL)
- **Storage**: Google Cloud Storage
- **Auth**: JWT (access + refresh tokens)
- **Deployment**: Render.com

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | — | Register |
| POST | /api/auth/login | — | Login |
| POST | /api/auth/refresh | — | Refresh access token |
| GET | /api/auth/me | ✓ | Get current user |
| GET | /api/shipments/track/:trackingNumber | — | Public tracking |
| GET | /api/orders | ✓ | List orders |
| POST | /api/orders | ✓ | Create order |
| POST | /api/orders/:id/confirm | ✓ | Confirm order (creates shipment) |
| GET | /api/shipments | ✓ | List shipments |
| PATCH | /api/shipments/:id/status | Admin | Update shipment status |
| POST | /api/documents/upload | ✓ | Upload document to GCS |
| GET | /api/documents/:id/signed-url | ✓ | Get secure download URL |

## Local Setup

```bash
cp .env.example .env
# Fill in DATABASE_URL and GCS credentials

npm install
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

## Deploy to Render

1. Connect your GitHub repo to Render
2. Set environment variables in Render dashboard (see `.env.example`)
3. The `render.yaml` configures automatic deploy

## Google Cloud SQL Setup

```sql
-- Create database
CREATE DATABASE nexora_shipping;
CREATE USER nexora_user WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE nexora_shipping TO nexora_user;
```

Set `DATABASE_URL` to:
```
postgresql://nexora_user:your_password@YOUR_CLOUD_SQL_IP:5432/nexora_shipping?sslmode=require
```
