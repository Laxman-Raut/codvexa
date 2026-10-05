# Codvexa — Backend Architecture

> A **Microservices-based** backend for a collaborative cloud code editor, built with Node.js, Express, MongoDB, Redis, and Firebase Authentication.

---

## Table of Contents

1. [Overview](#overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Directory Structure](#directory-structure)
4. [Services](#services)
   - [API Gateway](#1-api-gateway)
   - [Auth Service](#2-auth-service)
   - [Project Service](#3-project-service)
   - [File Service](#4-file-service)
5. [Shared Layer](#shared-layer)
6. [Data Models](#data-models)
7. [Authentication & Session Flow](#authentication--session-flow)
8. [Redis Caching Strategy](#redis-caching-strategy)
9. [API Reference](#api-reference)
10. [Environment Variables](#environment-variables)
11. [Infrastructure](#infrastructure)
12. [Tech Stack](#tech-stack)
13. [Development Setup](#development-setup)

---

## Overview

Codvexa's backend is built on a **microservices architecture** where each domain concern (authentication, project management, file management) is handled by an isolated Node.js service. All external traffic enters through a single **API Gateway**, which handles CORS, authentication verification via Redis sessions, and transparent HTTP proxying to the appropriate downstream service.

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            CLIENT (React/Vite)                           │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │ HTTP (REST)
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY  :8000                              │
│                                                                          │
│  ┌──────────────────┐   ┌──────────────┐   ┌──────────────────────────┐ │
│  │  CORS Middleware  │   │ cookieParser │   │     Morgan (Logging)     │ │
│  └──────────────────┘   └──────────────┘   └──────────────────────────┘ │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    protect() Middleware                            │  │
│  │        Reads sessionId cookie → validates against Redis           │  │
│  │        Attaches req.user = { userId, name, email, avatar }        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  /api/auth/*  ──────────────────────────────────► Auth Service  :8001   │
│  /api/project/* (protected) ──x-user-id header──► Project Svc   :8002   │
│  /api/file/*  ──────────────────────────────────► File Service  :8003   │
│  /api/me      (protected, handled in gateway)                           │
└──────────────────────────────────────────────────────────────────────────┘
          │                    │                      │
          ▼                    ▼                      ▼
  ┌──────────────┐    ┌──────────────────┐   ┌──────────────────┐
  │ Auth Service │    │ Project Service   │   │  File Service    │
  │   :8001      │    │     :8002         │   │    :8003         │
  │              │    │                  │   │                  │
  │ Firebase     │    │ MongoDB           │   │ MongoDB          │
  │ Admin SDK    │    │ (projects DB)     │   │ (files DB)       │
  │ + MongoDB    │    │ + Redis Cache     │   │                  │
  │   (users DB) │    │                  │   │                  │
  └──────┬───────┘    └────────┬─────────┘   └──────────────────┘
         │                     │
         └──────────┬──────────┘
                    ▼
          ┌──────────────────┐
          │   Redis  :6379   │
          │  (Session Store  │
          │  + Query Cache)  │
          └──────────────────┘
```

---

## Directory Structure

```
backend/
├── gateway/                        # API Gateway service
│   ├── controllers/
│   │   └── user.controller.js      # GET /api/me handler
│   ├── middleware/
│   │   └── protect.js              # Session validation middleware
│   ├── utils/
│   │   └── proxyWithHeader.js      # Proxy helper that injects x-user-id
│   ├── .env                        # Gateway environment variables
│   ├── index.js                    # Gateway entry point & route definitions
│   └── package.json
│
├── services/
│   ├── auth/                       # Authentication microservice
│   │   ├── config/
│   │   │   ├── db.js               # MongoDB connection
│   │   │   └── firebase.js         # Firebase Admin SDK init
│   │   ├── controllers/
│   │   │   └── auth.controller.js  # login / logout / me handlers
│   │   ├── models/
│   │   │   └── user.model.js       # Mongoose User schema
│   │   ├── routes/
│   │   │   └── auth.route.js       # POST /login, GET /me, POST /logout
│   │   ├── .env
│   │   ├── index.js                # Auth service entry point
│   │   ├── serviceaccount.json     # Firebase service account (secret!)
│   │   └── package.json
│   │
│   ├── project/                    # Project management microservice
│   │   ├── config/
│   │   │   └── db.js               # MongoDB connection
│   │   ├── controllers/
│   │   │   └── project.controller.js  # CRUD + starred logic
│   │   ├── model/
│   │   │   └── project.model.js    # Mongoose Project schema
│   │   ├── routes/
│   │   │   └── project.route.js    # RESTful project routes
│   │   ├── .env
│   │   ├── index.js                # Project service entry point
│   │   └── package.json
│   │
│   └── file/                       # File/folder tree microservice
│       ├── config/
│       │   └── db.js               # MongoDB connection
│       ├── controllers/
│       │   └── file.controllers.js # Root folder creation handler
│       ├── models/
│       │   └── file.model.js       # Mongoose File schema
│       ├── .env
│       ├── index.js                # File service entry point
│       └── package.json
│
├── shared/                         # Shared utilities (used by all services)
│   ├── redis/
│   │   └── redis.js                # Shared ioredis client instance
│   └── package.json
│
├── docker-compose.yml              # Spins up Redis container
└── .gitignore
```

---

## Services

### 1. API Gateway

**Port:** `8000`  
**File:** [`gateway/index.js`](./gateway/index.js)

The single entry point for all client requests. It is responsible for:

| Responsibility | Detail |
|---|---|
| **CORS** | Allows requests from the configured `FRONTEND_URL` with credentials |
| **Cookie Parsing** | Reads `sessionId` from HTTP-only cookies |
| **Request Logging** | Uses `morgan` in dev mode |
| **Auth Proxy** | Forwards `/api/auth/*` transparently to the Auth Service |
| **Session Guard** | Runs `protect()` middleware on protected routes |
| **Authenticated Proxy** | Forwards `/api/project/*` to Project Service with `x-user-id` header injected |
| **File Proxy** | Forwards `/api/file/*` to File Service |
| **Me Endpoint** | Handles `GET /api/me` directly from Redis session data |

#### Route Table

| Method | Path | Auth Required | Forwards To |
|--------|------|:---:|---|
| `*` | `/api/auth/*` | ❌ | Auth Service |
| `GET` | `/api/me` | ✅ | Handled in Gateway |
| `*` | `/api/project/*` | ✅ | Project Service (with `x-user-id`) |
| `*` | `/api/file/*` | ❌ | File Service |
| `GET` | `/health` | ❌ | Returns `{ message: "gateway is running" }` |

#### `protect()` Middleware

Located at [`gateway/middleware/protect.js`](./gateway/middleware/protect.js)

```
Request Cookie (sessionId)
       │
       ▼
Redis.get("session-<sessionId>")
       │
  ┌────┴────┐
  │  Found  │──► Parse JSON → attach to req.user → next()
  └────┬────┘
       │ Not Found
       ▼
  401 Unauthorized
```

#### `proxyWithHeader()` Utility

Located at [`gateway/utils/proxyWithHeader.js`](./gateway/utils/proxyWithHeader.js)

Wraps `express-http-proxy` to automatically inject the `x-user-id` header before forwarding requests to the Project Service. This allows downstream services to identify the authenticated user without re-validating the session.

---

### 2. Auth Service

**Port:** `8001`  
**Directory:** [`services/auth/`](./services/auth/)

Handles all user identity operations. Integrates with **Firebase Authentication** to verify Google ID tokens from the frontend, then manages server-side sessions via **Redis**.

#### Flow: Login

```
Client sends Firebase ID Token
         │
         ▼
  Firebase Admin SDK verifyIdToken(token)
         │
         ▼
  Lookup user in MongoDB by firebaseUid
         │
    ┌────┴────┐
    │  Found  │
    └────┬────┘
    Not Found → Create new User document
         │
         ▼
  Generate crypto.randomUUID() → sessionId
         │
         ▼
  Redis.set("session-<sessionId>", { userId, name, email, avatar }, EX: 7 days)
         │
         ▼
  Set HTTP-Only cookie: sessionId
         │
         ▼
  Return 200 with user object
```

#### Endpoints

| Method | Path | Description |
|--------|------|---|
| `POST` | `/login` | Verifies Firebase token, creates/finds user, creates Redis session |
| `GET` | `/me` | Returns current user from Redis session |
| `POST` | `/logout` | Deletes Redis session, clears cookie |

#### User Model

```js
{
  firebaseUid: String,   // Unique Firebase UID (required, unique)
  name:        String,   // Display name from Google
  email:       String,   // Email (unique, lowercase)
  avatar:      String,   // Profile picture URL
  timestamps:  true      // createdAt, updatedAt
}
```

---

### 3. Project Service

**Port:** `8002`  
**Directory:** [`services/project/`](./services/project/)

Manages the lifecycle of user projects. Receives `x-user-id` header from the Gateway (never from the client directly) to scope all operations to the authenticated user.

#### Endpoints

| Method | Path | Description |
|--------|------|---|
| `POST` | `/` | Create a new project |
| `GET` | `/` | Get all projects for the current user |
| `GET` | `/starred` | Get all starred projects for the current user |
| `GET` | `/:id` | Get a single project by ID (updates `lastOpenedAt`) |
| `PATCH` | `/:id` | Toggle starred status for a project |
| `DELETE` | `/:id` | Delete a project |

#### Caching Strategy

The Project Service uses Redis to cache project list queries and invalidates the cache on mutations:

| Operation | Redis Action |
|---|---|
| `getprojects` | Read from `projects-<userId>` or populate from MongoDB |
| `getstarredProjects` | Read from `starred-projects-<userId>` or populate |
| `create` | Invalidates `projects-<userId>` |
| `togglestarred` | Invalidates `projects-<userId>` and `starred-projects-<userId>` |
| `deleteproject` | Invalidates `projects-<userId>` and `starred-projects-<userId>` |

#### Project Model

```js
{
  owner:       ObjectId,  // Reference to User._id
  name:        String,    // Project name (required)
  description: String,    // Optional description
  starred:     Boolean,   // Default: false
  lastOpenAt:  Date,      // Default: Date.now
  timestamps:  true       // createdAt, updatedAt
}
```

---

### 4. File Service

**Port:** `8003`  
**Directory:** [`services/file/`](./services/file/)

Manages the virtual file system for each project — a hierarchical tree of files and folders stored in MongoDB.

> ⚠️ **In Development** — Currently only the `createRootFolder` endpoint is implemented. Additional file/folder CRUD operations are planned.

#### Endpoints

| Method | Path | Description |
|--------|------|---|
| `POST` | `/root` | Creates a root folder for a given project |

#### File Model

```js
{
  owner:     ObjectId,              // Reference to User._id
  parentId:  ObjectId | null,       // Parent folder (null = root)
  projectId: ObjectId,              // Reference to Project._id
  name:      String,                // File or folder name
  type:      "file" | "folder",     // Node type
  extension: String,                // e.g. "js", "ts", "py"
  language:  String,                // e.g. "javascript", "python"
  content:   String,                // File content (for files)
  size:      Number,                // Content size in bytes
  isdeleted: Boolean,               // Soft delete flag
  timestamps: true                  // createdAt, updatedAt
}
```

The `parentId: null` convention identifies the root folder of a project. The tree is traversed by querying `parentId` recursively.

---

## Shared Layer

**Directory:** [`shared/`](./shared/)

Contains utilities shared across all microservices to avoid code duplication.

### `shared/redis/redis.js`

A singleton `ioredis` client configured via the `REDIS_URL` environment variable. Both the Auth Service and Project Service import this shared module to connect to the same Redis instance.

```js
import Redis from "ioredis";
const redis = new Redis(process.env.REDIS_URL);
```

---

## Data Models

```
┌─────────────────────┐        ┌──────────────────────────┐
│        User         │        │          Project          │
├─────────────────────┤        ├──────────────────────────┤
│ _id (ObjectId)      │◄──────►│ owner (ObjectId → User)  │
│ firebaseUid         │        │ name                     │
│ name                │        │ description              │
│ email               │        │ starred (Boolean)        │
│ avatar              │        │ lastOpenAt (Date)        │
│ createdAt           │        │ createdAt / updatedAt    │
│ updatedAt           │        └──────────────────────────┘
└─────────────────────┘                    │
                                           │ 1:many
                                           ▼
                              ┌──────────────────────────┐
                              │           File           │
                              ├──────────────────────────┤
                              │ owner (ObjectId → User)  │
                              │ projectId (ObjectId)     │
                              │ parentId (ObjectId|null) │◄─ Self-referential
                              │ name                     │   (tree structure)
                              │ type (file | folder)     │
                              │ extension                │
                              │ language                 │
                              │ content                  │
                              │ size                     │
                              │ isdeleted (soft delete)  │
                              │ createdAt / updatedAt    │
                              └──────────────────────────┘
```

---

## Authentication & Session Flow

```
┌──────────┐        ┌─────────┐       ┌──────────────┐      ┌───────┐      ┌──────────┐
│  Client  │        │ Gateway │       │ Auth Service │      │ Redis │      │ MongoDB  │
└────┬─────┘        └────┬────┘       └──────┬───────┘      └───┬───┘      └────┬─────┘
     │                   │                   │                   │               │
     │── POST /api/auth/login ──────────────►│                   │               │
     │  { token: firebaseIdToken }           │                   │               │
     │                   │   proxy request   │                   │               │
     │                   │──────────────────►│                   │               │
     │                   │                   │── verifyIdToken() │               │
     │                   │                   │── findOne/create ─────────────────►
     │                   │                   │◄──────────────────────────────────│
     │                   │                   │── redis.set("session-X") ────────►│
     │                   │                   │◄── OK ────────────────────────────│
     │◄── Set-Cookie: sessionId=X ───────────│                   │               │
     │    200 { user }                       │                   │               │
     │                   │                   │                   │               │
     │── GET /api/project/ ─────────────────►│                   │               │
     │  Cookie: sessionId=X                  │                   │               │
     │                   │── redis.get("session-X") ────────────►│               │
     │                   │◄── { userId, name, email, avatar } ───│               │
     │                   │── proxy + x-user-id header ──────────────────────────►│
     │◄── 200 [projects] ────────────────────────────────────────────────────────│
```

---

## Redis Caching Strategy

Redis serves **two purposes** in this architecture:

| Purpose | Key Pattern | TTL | Set By | Invalidated By |
|---|---|---|---|---|
| **Session Store** | `session-<uuid>` | 7 days | Auth Service (login) | Auth Service (logout) |
| **Project List Cache** | `projects-<userId>` | None (manual) | Project Service | create / delete / toggleStar |
| **Starred List Cache** | `starred-projects-<userId>` | None (manual) | Project Service | delete / toggleStar |

---

## API Reference

All requests go through the Gateway at `http://localhost:8000`.

### Auth Routes (`/api/auth`)

```
POST   /api/auth/login       Body: { token: string }     → { user }
GET    /api/auth/me                                       → { userId, name, email, avatar }
POST   /api/auth/logout                                   → { message }
GET    /api/me               (handled in gateway)         → { userId, name, email, avatar }
```

### Project Routes (`/api/project`) — 🔒 Protected

```
POST   /api/project/          Body: { name, description }   → Project
GET    /api/project/                                         → Project[]
GET    /api/project/starred                                  → Project[]
GET    /api/project/:id                                      → Project
PATCH  /api/project/:id                                      → Project (starred toggled)
DELETE /api/project/:id                                      → Project (deleted)
```

### File Routes (`/api/file`) — 🚧 In Development

```
POST   /api/file/root        Body: { projectId, projectName }  → File (root folder)
```

---

## Environment Variables

### Gateway (`gateway/.env`)

| Variable | Description | Example |
|---|---|---|
| `PORT` | Gateway listen port | `8000` |
| `AUTH_SERVICE` | Auth service base URL | `http://localhost:8001` |
| `PROJECT_SERVICE` | Project service base URL | `http://localhost:8002` |
| `FILE_SERVICE` | File service base URL | `http://localhost:8003` |
| `FRONTEND_URL` | Allowed CORS origin | `http://localhost:5173` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

### Auth Service (`services/auth/.env`)

| Variable | Description |
|---|---|
| `PORT` | `8001` |
| `MONGO_URI` | MongoDB connection string (users DB) |
| `REDIS_URL` | Redis connection string |

### Project Service (`services/project/.env`)

| Variable | Description |
|---|---|
| `PORT` | `8002` |
| `MONGO_URI` | MongoDB connection string (projects DB) |
| `REDIS_URL` | Redis connection string |

### File Service (`services/file/.env`)

| Variable | Description |
|---|---|
| `PORT` | `8003` |
| `MONGO_URI` | MongoDB connection string (files DB) |

---

## Infrastructure

### Docker Compose

[`docker-compose.yml`](./docker-compose.yml) currently manages:

```yaml
services:
  redis:
    image: redis
    ports:
      - 6379:6379
```

> Each Node.js service is currently started manually via `npm run dev` during development. Dockerizing the services is a planned future step.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Runtime** | Node.js (ESM) | All services |
| **Framework** | Express.js v5 | HTTP server for each service |
| **API Gateway** | express-http-proxy | Transparent HTTP proxying |
| **Authentication** | Firebase Admin SDK | Google ID token verification |
| **Session Store** | Redis (ioredis) | Server-side session management |
| **Database** | MongoDB + Mongoose | Primary data persistence |
| **Logging** | Morgan | HTTP request logging |
| **Dev** | Nodemon | Hot reload during development |
| **Containerization** | Docker / Docker Compose | Redis container |
| **Frontend** | React + Vite + Redux | UI (separate `frontend/` directory) |

---

## Development Setup

### Prerequisites

- Node.js >= 18
- Docker Desktop (for Redis)
- MongoDB Atlas or local MongoDB instance
- Firebase project with a service account

### Steps

```bash
# 1. Start Redis via Docker
cd backend
docker compose up -d

# 2. Start Auth Service
cd services/auth
npm install
npm run dev   # runs on :8001

# 3. Start Project Service
cd ../project
npm install
npm run dev   # runs on :8002

# 4. Start File Service
cd ../file
npm install
npm run dev   # runs on :8003

# 5. Start API Gateway
cd ../../gateway
npm install
npm run dev   # runs on :8000
```

> ⚠️ Make sure all `.env` files are correctly configured with MongoDB URIs, Redis URL, and Firebase service account before starting the services.

---

## Planned Features

- [ ] Full File/Folder CRUD (create, rename, delete, move)
- [ ] Real-time collaborative editing (WebSocket / Socket.io)
- [ ] Code execution service (sandboxed runner)
- [ ] Docker Compose for all services (production-ready setup)
- [ ] Rate limiting at the Gateway level
- [ ] File content versioning / history
