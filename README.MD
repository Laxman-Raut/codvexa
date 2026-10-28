# Codvexa — Backend Architecture

> A **Microservices-based** backend for a collaborative cloud code editor, built with Node.js, Express, MongoDB, Redis, Firebase Authentication, and a LangGraph-powered autonomous AI coding assistant.

---

## Table of Contents

1. [Overview](#overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Directory Structure](#directory-structure)
4. [Services](#services)
   - [1. API Gateway](#1-api-gateway)
   - [2. Auth Service](#2-auth-service)
   - [3. Project Service](#3-project-service)
   - [4. File Service](#4-file-service)
   - [5. AI Service](#5-ai-service)
5. [Shared Layer](#shared-layer)
6. [Data Models](#data-models)
7. [Authentication & Session Flow](#authentication--session-flow)
8. [Redis Caching Strategy](#redis-caching-strategy)
9. [API Reference](#api-reference)
10. [Environment Variables](#environment-variables)
11. [Infrastructure](#infrastructure)
12. [Tech Stack](#tech-stack)
13. [Development Setup](#development-setup)
14. [Planned Features & Roadmap](#planned-features--roadmap)

---

## Overview

Codvexa's backend is architected as an isolated **microservices ecosystem** where each primary domain concern—authentication, project management, virtual filesystem operations, and autonomous AI code assistance—is handled by an independent Node.js service.

All client requests enter through a single entry point: the **API Gateway**. The gateway terminates CORS, parses cookies, validates user sessions directly from **Redis**, and transparently proxies authorized requests to downstream internal services while injecting the authenticated user's ID (`x-user-id`) into the request headers.

---

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT (React / Vite)                                │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTP (REST) + Credentials (Cookies)
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 API GATEWAY  (:8000)                                   │
│                                                                                        │
│  ┌───────────────────────┐   ┌────────────────────────┐   ┌─────────────────────────┐  │
│  │    CORS Middleware    │   │  cookie-parser + JSON  │   │    Morgan dev logging   │  │
│  └───────────────────────┘   └────────────────────────┘   └─────────────────────────┘  │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                               protect() Middleware                               │  │
│  │   - Extracts sessionId cookie                                                    │  │
│  │   - Validates session data against Redis (session-<id>)                          │  │
│  │   - Attaches req.user = { userId, name, email, avatar }                          │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│  Routing & Transparent Proxies:                                                        │
│  ├── /api/auth/*     ───────────────────────────────────► Auth Service     (:8001)     │
│  ├── /api/project/*  (protected) ──x-user-id header─────► Project Service  (:8002)     │
│  ├── /api/file/*     (protected) ──x-user-id header─────► File Service     (:8003)     │
│  ├── /api/ai/*       (protected) ──x-user-id header─────► AI Service       (:8004)     │
│  └── /api/me         (protected, resolved directly from Redis session)                 │
└────────────────────────────────────────────────────────────────────────────────────────┘
          │                     │                     │                     │
          ▼                     ▼                     ▼                     ▼
  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
  │ Auth Service │      │Project Service│     │ File Service │      │  AI Service  │
  │   (:8001)    │      │   (:8002)    │      │   (:8003)    │      │   (:8004)    │
  ├──────────────┤      ├──────────────┤      ├──────────────┤      ├──────────────┤
  │ Firebase     │      │ Projects DB  │      │ Files DB     │      │ LangGraph    │
  │ Admin SDK    │      │ (MongoDB)    │      │ (MongoDB)    │      │ StateGraph   │
  │ + Users DB   │      │ + Redis      │      │ Virtual Tree │      │ + OpenRouter │
  │ (MongoDB)    │      │ Query Cache  │      │ File CRUD    │      │ DeepSeek LLM │
  └──────┬───────┘      └───────┬──────┘      └──────▲───────┘      └──────┬───────┘
         │                      │                    │                     │
         │                      │                    └──── Tool Calls ─────┤
         │                      │                   (fetchFileApis.js)     │
         └──────────┬───────────┴──────────────────────────────────────────┘
                    ▼
          ┌────────────────────┐
          │    Redis (:6379)   │
          │  - User Sessions   │
          │  - Query Cache     │
          └────────────────────┘
```

---

## Directory Structure

```
backend/
├── gateway/                        # API Gateway service
│   ├── controllers/
│   │   └── user.controller.js      # GET /api/me handler
│   ├── middleware/
│   │   └── protect.js              # Session validation middleware via Redis
│   ├── utils/
│   │   └── proxyWithHeader.js      # Proxy wrapper injecting x-user-id header
│   ├── .env                        # Gateway configuration
│   ├── index.js                    # Gateway entry point & route registration
│   └── package.json
│
├── services/
│   ├── auth/                       # Authentication microservice
│   │   ├── config/
│   │   │   ├── db.js               # MongoDB connection
│   │   │   └── firebase.js         # Firebase Admin SDK initialization
│   │   ├── controllers/
│   │   │   └── auth.controller.js  # login, logout, me handlers
│   │   ├── models/
│   │   │   └── user.model.js       # Mongoose User schema
│   │   ├── routes/
│   │   │   └── auth.route.js       # /login, /me, /logout endpoints
│   │   ├── .env
│   │   ├── index.js                # Auth service entry point
│   │   ├── serviceaccount.json     # Firebase service account credential
│   │   └── package.json
│   │
│   ├── project/                    # Project management microservice
│   │   ├── config/
│   │   │   └── db.js               # MongoDB connection
│   │   ├── controllers/
│   │   │   └── project.controller.js # Project CRUD & starred caching logic
│   │   ├── model/
│   │   │   └── project.model.js    # Mongoose Project schema
│   │   ├── routes/
│   │   │   └── project.route.js    # Project REST routes
│   │   ├── .env
│   │   ├── index.js                # Project service entry point
│   │   └── package.json
│   │
│   ├── file/                       # Virtual file tree microservice
│   │   ├── config/
│   │   │   └── db.js               # MongoDB connection
│   │   ├── controllers/
│   │   │   └── file.controllers.js # File/folder CRUD, recursive deletion, tree
│   │   ├── models/
│   │   │   └── file.model.js       # Mongoose File/Folder schema
│   │   ├── routes/
│   │   │   └── file.route.js       # File tree and manipulation routes
│   │   ├── utils/
│   │   │   └── buildtree.js        # Recursive in-memory hierarchical tree builder
│   │   ├── .env
│   │   ├── index.js                # File service entry point
│   │   └── package.json
│   │
│   └── ai/                         # Autonomous AI coding agent microservice
│       ├── config/
│       │   └── db.js               # MongoDB connection
│       ├── controllers/
│       │   └── ai.controller.js    # AI chat & conversation orchestrator
│       ├── graph/
│       │   ├── graph.js            # LangGraph StateGraph, nodes & system prompt
│       │   └── tools.js            # Scoped filesystem tools for the agent
│       ├── utils/
│       │   ├── fetchFileApis.js    # HTTP client for invoking File Service
│       │   └── llm.js              # ChatOpenRouter (DeepSeek) configuration
│       ├── .env
│       ├── index.js                # AI service entry point
│       └── package.json
│
├── shared/                         # Shared utilities across services
│   ├── redis/
│   │   └── redis.js                # Singleton ioredis client instance
│   └── package.json
│
├── docker-compose.yml              # Local infrastructure (Redis container)
├── README.MD                       # Backend documentation
└── .gitignore
```

---

## Services

### 1. API Gateway

**Port:** `8000`  
**File:** [`gateway/index.js`](./gateway/index.js)

The single entry point for all frontend client requests. It handles ingress concerns:

| Responsibility | Detail |
|---|---|
| **CORS** | Allows requests from `FRONTEND_URL` (`http://localhost:5173`) with credentials enabled |
| **Cookie Parsing** | Extracts the `sessionId` cookie from incoming requests |
| **Request Logging** | Uses `morgan` dev logger for HTTP traffic observability |
| **Auth Proxy** | Forwards `/api/auth/*` requests directly to the Auth Service |
| **Session Guard** | Runs `protect` middleware to ensure valid user session in Redis |
| **Header Injection** | Injects authenticated user ID (`x-user-id`) via `proxyWithHeader` utility |
| **Downstream Proxying** | Routes `/api/project/*`, `/api/file/*`, and `/api/ai/*` to their respective microservices |
| **User Info (`/api/me`)** | Directly returns session user profile from Redis without calling downstream services |

#### Route Table

| Method | Path | Auth Required | Proxy Target / Handler |
|---|---|:---:|---|
| `*` | `/api/auth/*` | ❌ | Auth Service (`:8001`) |
| `GET` | `/api/me` | ✅ | Gateway Handler (returns Redis session profile) |
| `*` | `/api/project/*` | ✅ | Project Service (`:8002`) with `x-user-id` |
| `*` | `/api/file/*` | ✅ | File Service (`:8003`) with `x-user-id` |
| `*` | `/api/ai/*` | ✅ | AI Service (`:8004`) with `x-user-id` |
| `GET` | `/health` | ❌ | Gateway (`{ message: "gateway is running" }`) |
| `GET` | `/` | ❌ | Gateway (`{ message: "service is up" }`) |

#### `protect()` Middleware

Located at [`gateway/middleware/protect.js`](./gateway/middleware/protect.js):

```
Incoming Request (Cookie: sessionId=...)
                   │
                   ▼
       Redis.get("session-<sessionId>")
                   │
         ┌─────────┴─────────┐
         │                   │
    [Found JSON]       [Not Found]
         │                   │
         ▼                   ▼
Attach req.user        401 Unauthorized
   and next()
```

#### `proxyWithHeader()` Utility

Located at [`gateway/utils/proxyWithHeader.js`](./gateway/utils/proxyWithHeader.js):
Wraps `express-http-proxy` to forward requests to target microservices while injecting:
```http
x-user-id: <req.user.userId>
```
This isolates downstream microservices from having to duplicate session verification logic.

---

### 2. Auth Service

**Port:** `8001`  
**Directory:** [`services/auth/`](./services/auth/)

Manages identity and user session lifecycles. It validates Google ID tokens issued by **Firebase Authentication** on the client, synchronizes user profile records in MongoDB, and issues Redis-backed session IDs.

#### Login Flow

```
Client sends Firebase ID Token (POST /api/auth/login)
                   │
                   ▼
 Firebase Admin SDK: verifyIdToken(token)
                   │
                   ▼
 Lookup User in MongoDB by firebaseUid
                   │
       ┌───────────┴───────────┐
       │                       │
   [Existing]             [New User]
       │                       │
       │                 Create User Doc
       └───────────┬───────────┘
                   ▼
    Generate crypto.randomUUID() → sessionId
                   │
                   ▼
  Store in Redis: "session-<sessionId>"
  TTL: 7 Days
  Value: { userId, name, email, avatar }
                   │
                   ▼
  Set-Cookie: sessionId (HttpOnly, Secure/Lax)
                   │
                   ▼
  Return 200 OK with User data
```

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/login` | Verifies Firebase ID token, creates/finds user in MongoDB, initializes Redis session |
| `GET` | `/me` | Returns current user from Redis session |
| `POST` | `/logout` | Removes session from Redis, clears `sessionId` cookie |

---

### 3. Project Service

**Port:** `8002`  
**Directory:** [`services/project/`](./services/project/)

Handles CRUD operations for user workspaces and projects. All operations are strictly scoped to the `x-user-id` header passed by the API Gateway.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/` | Creates a new project for the authenticated user |
| `GET` | `/` | Returns all projects owned by the user (cached in Redis) |
| `GET` | `/starred` | Returns all starred projects for the user (cached in Redis) |
| `GET` | `/:id` | Returns a single project and bumps its `lastOpenAt` timestamp |
| `PATCH` | `/:id` | Toggles the project's `starred` state and invalidates caches |
| `DELETE` | `/:id` | Deletes a project and invalidates related Redis caches |

#### Redis Caching Strategy

| Operation | Cache Key Pattern | Behavior |
|---|---|---|
| `getprojects` | `projects-<userId>` | Returns cached array if present; otherwise fetches from MongoDB and caches |
| `getstarredProjects` | `starred-projects-<userId>` | Returns cached starred array or queries MongoDB |
| `create` | `projects-<userId>` | Invalidates `projects-<userId>` |
| `togglestarred` | `projects-<userId>`, `starred-projects-<userId>` | Invalidates both user project caches |
| `deleteproject` | `projects-<userId>`, `starred-projects-<userId>` | Invalidates both user project caches |

---

### 4. File Service

**Port:** `8003`  
**Directory:** [`services/file/`](./services/file/)

Manages the hierarchical virtual filesystem representing the workspace codebase. Files and directories are represented as nodes in MongoDB, self-referencing via `parentId`.

#### Key Features

- **Root Directory Creation**: Each project has a single root directory with `parentId: null`.
- **Folder & File Creation**: Supports nesting folders inside folders and files inside any folder.
- **Hierarchical Tree Assembly**: Fast in-memory tree building ([`utils/buildtree.js`](./services/file/utils/buildtree.js)) transforming flat database documents into nested JSON children trees for frontend rendering.
- **Recursive Cascading Soft Delete**: When a directory is deleted (`isdeleted: true`), a recursive query dynamically traverses all descendants (`parentId: { $in: childIds }`) and marks them soft-deleted, eliminating dangling orphan records.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/create-root-folder` | Creates project root folder (`projectId`, `projectName`) |
| `POST` | `/create-folder` | Creates child folder (`projectId`, `parentId`, `name`) |
| `POST` | `/create-file` | Creates child file (`projectId`, `parentId`, `name`, `content`, `language`) |
| `PATCH` | `/:id` | Updates file name and/or content, recalculates content size |
| `DELETE` | `/:id` | Soft deletes file or folder (cascades recursively to all nested children) |
| `GET` | `/tree/:projectId` | Returns complete nested file and folder tree for the project |
| `GET` | `/:id` | Returns single file details and content |

---

### 5. AI Service

**Port:** `8004`  
**Directory:** [`services/ai/`](./services/ai/)

An autonomous AI coding agent designed for a Cursor-like cloud IDE experience. The agent inspects codebases, reasons over user requests, and implements full file and directory modifications by calling dedicated filesystem tools rather than simulating bash commands.

#### Core Technologies

- **LangGraph** (`@langchain/langgraph`): Orchestrates cyclical agent execution through a directed state graph (`StateGraph`), evaluating when to call tools and when to yield responses.
- **LangChain Core** (`@langchain/core`): Provides message primitives (`HumanMessage`, `AIMessage`, `SystemMessage`) and tool bindings.
- **OpenRouter** (`@langchain/openrouter`): Connects to large language models (such as `deepseek/deepseek-chat`).
- **Filesystem Tools API** ([`utils/fetchFileApis.js`](./services/ai/utils/fetchFileApis.js)): Direct HTTP client interacting with the File Service with authenticated headers (`x-user-id`).

#### LangGraph Agent Architecture

```
                    ┌─────────────────────────┐
                    │      START (Input)      │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │       agent Node        │
                    │  (LLM + Bound Tools)    │
                    └────────────┬────────────┘
                                 │
                                 ▼
                     /───────────────────────\
                    <    shouldContinue()     >
                     \───────────────────────/
                       │                   │
                 [Tool Calls]         [No Tool Calls]
                       │                   │
                       ▼                   ▼
             ┌──────────────────┐   ┌─────────────┐
             │    tools Node    │   │     END     │
             │(Execute File Ops)│   │  (Response) │
             └─────────┬────────┘   └─────────────┘
                       │
                       └────────► [Back to agent Node]
```

#### Filesystem Tool Suite ([`graph/tools.js`](./services/ai/graph/tools.js))

The AI service dynamically creates and binds tools scoped to the active `projectId` and `userId`:

| Tool Name | Parameters | Purpose |
|---|---|---|
| `get_tree` | `{}` | Retrieves the complete hierarchical tree of files and folders to inspect structure. |
| `get_file` | `{ fileId }` | Reads the full content of an existing file before making edits. |
| `create_folder`| `{ name, parentId }` | Creates a new directory inside the specified parent folder. |
| `create_file` | `{ name, parentId, content, language }` | Creates a new file with complete, functional code. |
| `update_file` | `{ fileId, content, name? }` | Replaces the entire content of an existing file. |
| `delete_file` | `{ fileId }` | Permanently soft-deletes a file or directory. |

#### Agent Operational Principles

1. **Filesystem as Single Source of Truth**: There is no terminal/bash shell. The AI interacts with projects exclusively through filesystem tools.
2. **Read Before Modifying**: The agent inspects the file tree (`get_tree`) and reads existing file contents (`get_file`) before applying updates.
3. **Complete Code Generation**: Generates full production code; never leaves placeholders like `// ... rest of code`.
4. **Hierarchical Creation Order**: Automatically provisions parent directories before creating children files.
5. **Scaffolding Intelligence**: Contains specialized prompt presets for modern web templates (React + Vite, HTML/CSS/JS).

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (`{ message: "AI service is running" }`) |
| `GET` | `/` | Root status endpoint |
| `POST` | `/chat` | Chat/code generation endpoint passing `projectId`, `message`, and recent conversation `history` |

---

## Shared Layer

**Directory:** [`shared/`](./shared/)

Contains common configurations shared across microservices:

### `shared/redis/redis.js`

Exports a singleton `ioredis` client instance initialized from `process.env.REDIS_URL`. Utilized across the Gateway, Auth Service, and Project Service for centralized session management and cache invalidation.

```javascript
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);
export default redis;
```

---

## Data Models

```
┌─────────────────────────────────┐           ┌─────────────────────────────────┐
│              User               │           │             Project             │
├─────────────────────────────────┤           ├─────────────────────────────────┤
│ _id           : ObjectId (PK)   │◄─────────►│ _id          : ObjectId (PK)    │
│ firebaseUid   : String (unique) │  1 : N    │ owner        : ObjectId (User)  │
│ name          : String          │           │ name         : String           │
│ email         : String (unique) │           │ description  : String           │
│ avatar        : String          │           │ starred      : Boolean (false)  │
│ createdAt     : Date            │           │ lastOpenAt   : Date             │
│ updatedAt     : Date            │           │ createdAt / updatedAt : Date    │
└─────────────────────────────────┘           └────────────────┬────────────────┘
                                                               │
                                                               │ 1 : N
                                                               ▼
                                              ┌─────────────────────────────────┐
                                              │              File               │
                                              ├─────────────────────────────────┤
                                              │ _id          : ObjectId (PK)    │
                                              │ owner        : ObjectId (User)  │
                                              │ projectId    : ObjectId (Proj)  │
                                              │ parentId     : ObjectId | null  │◄── Self-referential
                                              │ name         : String           │    (Hierarchical tree)
                                              │ type         : "file"|"folder"  │
                                              │ extension    : String           │
                                              │ language     : String           │
                                              │ content      : String           │
                                              │ size         : Number           │
                                              │ isdeleted    : Boolean (false)  │
                                              │ createdAt / updatedAt : Date    │
                                              └─────────────────────────────────┘
```

---

## Authentication & Session Flow

```
┌──────────┐        ┌─────────┐        ┌──────────────┐       ┌───────┐       ┌──────────┐
│  Client  │        │ Gateway │        │ Auth Service │       │ Redis │       │ MongoDB  │
└────┬─────┘        └────┬────┘        └──────┬───────┘       └───┬───┘       └────┬─────┘
     │                   │                    │                   │                │
     │── POST /api/auth/login ───────────────►│                   │                │
     │   { token: firebaseIdToken }           │                   │                │
     │                   │  (Proxy pass-thru) │                   │                │
     │                   │───────────────────►│                   │                │
     │                   │                    │── verifyIdToken() │                │
     │                   │                    │── find/create user ───────────────►│
     │                   │                    │◄── user document ──────────────────│
     │                   │                    │── set("session-<id>", user, 7d) ──►│
     │                   │                    │◄── OK ────────────│                │
     │◄── Set-Cookie: sessionId=... ──────────│                   │                │
     │    200 OK { user }                     │                   │                │
     │                   │                    │                   │                │
     │── GET /api/project ───────────────────►│                   │                │
     │   Cookie: sessionId=...                │                   │                │
     │                   │── get("session-<id>") ────────────────►│                │
     │                   │◄── session user data ──────────────────│                │
     │                   │                                        │                │
     │                   │── Proxy to Project Svc ────────────────────────────────►│
     │                   │   (Header: x-user-id: <id>)                             │
     │◄── 200 OK [projects] ───────────────────────────────────────────────────────│
```

---

## Redis Caching Strategy

| Key Pattern | Data Type | TTL | Managed By | Purpose | Invalidation Triggers |
|---|---|---|---|---|---|
| `session-<uuid>` | String (JSON) | 7 days | Auth Service | User session profile & auth guard | Explicit logout (`POST /api/auth/logout`) |
| `projects-<userId>` | String (JSON) | None | Project Service | User project list query cache | New project created, project deleted, star toggled |
| `starred-projects-<userId>` | String (JSON) | None | Project Service | Starred projects list cache | Project deleted, star toggled |

---

## API Reference

Base Gateway URL: `http://localhost:8000`

### 1. Authentication (`/api/auth`)

| Method | Endpoint | Auth | Request Body / Params | Response |
|---|---|:---:|---|---|
| `POST` | `/api/auth/login` | ❌ | `{ token: string }` | `{ user: User }` + HTTP-Only Cookie |
| `GET` | `/api/auth/me` | ✅ | Cookie (`sessionId`) | `{ userId, name, email, avatar }` |
| `POST` | `/api/auth/logout` | ✅ | Cookie (`sessionId`) | `{ message: "Logged out successfully" }` |
| `GET` | `/api/me` | ✅ | Cookie (`sessionId`) | Handled directly by Gateway from Redis |

### 2. Project Management (`/api/project`)

*All requests require valid session cookie.*

| Method | Endpoint | Request Body / Params | Response |
|---|---|---|---|
| `POST` | `/api/project/` | `{ name: string, description?: string }` | `Project` |
| `GET` | `/api/project/` | None | `Project[]` (cached) |
| `GET` | `/api/project/starred` | None | `Project[]` (cached) |
| `GET` | `/api/project/:id` | `id` (Project ID) | `Project` (updates `lastOpenAt`) |
| `PATCH` | `/api/project/:id` | `id` (Project ID) | `Project` (toggles `starred`) |
| `DELETE` | `/api/project/:id` | `id` (Project ID) | `Project` (deleted) |

### 3. File System (`/api/file`)

*All requests require valid session cookie.*

| Method | Endpoint | Request Body / Params | Response |
|---|---|---|---|
| `POST` | `/api/file/create-root-folder` | `{ projectId: string, projectName: string }` | `File` (type: "folder", parentId: null) |
| `POST` | `/api/file/create-folder` | `{ projectId: string, name: string, parentId: string }` | `File` (type: "folder") |
| `POST` | `/api/file/create-file` | `{ projectId, name, parentId, content?, language? }` | `File` (type: "file") |
| `PATCH` | `/api/file/:id` | `{ name?: string, content?: string }` | `File` (updated content/extension/size) |
| `DELETE` | `/api/file/:id` | `id` (File or Folder ID) | `File` (recursive cascading soft delete) |
| `GET` | `/api/file/tree/:projectId` | `projectId` (Project ID) | `File[]` (hierarchical nested children tree) |
| `GET` | `/api/file/:id` | `id` (File ID) | `File` (complete file details & text) |

### 4. AI Assistant (`/api/ai`)

*All requests require valid session cookie.*

| Method | Endpoint | Request Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/ai/health` | None | `{ message: "AI service is running" }` |
| `POST` | `/api/ai/chat` | `{ projectId: string, message: string, history?: Array }` | Agentic response / file modification status |

---

## Environment Variables

### 1. API Gateway (`gateway/.env`)

```ini
PORT=8000
FRONTEND_URL=http://localhost:5173
AUTH_SERVICE=http://localhost:8001
PROJECT_SERVICE=http://localhost:8002
FILE_SERVICE=http://localhost:8003
AI_SERVICE=http://localhost:8004
REDIS_URL=redis://localhost:6379
```

### 2. Auth Service (`services/auth/.env`)

```ini
PORT=8001
MONGO_URI=mongodb+srv://.../auth?appName=Cluster0
REDIS_URL=redis://localhost:6379
```

### 3. Project Service (`services/project/.env`)

```ini
PORT=8002
MONGO_URI=mongodb+srv://.../project?appName=Cluster0
REDIS_URL=redis://localhost:6379
```

### 4. File Service (`services/file/.env`)

```ini
PORT=8003
MONGODB_URI=mongodb+srv://.../file?appName=Cluster0
REDIS_URL=redis://localhost:6379
```

### 5. AI Service (`services/ai/.env`)

```ini
PORT=8004
MONGODB_URI=mongodb+srv://.../ai?appName=Cluster0
REDIS_URL=redis://localhost:6379
FILE_SERVICE_URI=http://localhost:8003
OPENROUTER_API_KEY=sk-or-v1-...
```

---

## Infrastructure

### Docker Compose

The backend includes a [`docker-compose.yml`](./docker-compose.yml) to spin up Redis locally:

```yaml
services:
  redis:
    image: redis
    ports:
      - 6379:6379
```

Run in the background:
```bash
docker compose up -d
```

---

## Tech Stack

| Domain | Technology | Usage |
|---|---|---|
| **Runtime** | Node.js (ES Modules) | Standard JavaScript runtime across all services |
| **Web Framework** | Express.js v5 | HTTP routing and REST endpoints |
| **Gateway Proxy** | express-http-proxy | Transparent HTTP reverse proxying & header injection |
| **Authentication** | Firebase Admin SDK | Verification of Google OAuth ID tokens |
| **Session & Cache** | Redis + ioredis | Distributed session storage and query caching |
| **Database** | MongoDB + Mongoose | Document storage for users, projects, files, and AI |
| **AI Orchestration** | LangGraph (`@langchain/langgraph`) | Cyclical state machines for tool-calling autonomous agent |
| **LLM Interface** | LangChain Core + OpenRouter | Structured chat prompts and DeepSeek model integration |
| **Schema Validation**| Zod | Dynamic schema definitions for filesystem agent tools |
| **HTTP Client** | Axios | Cross-service communication (AI Service -> File Service) |
| **Observability** | Morgan | HTTP request logging |
| **Development** | Nodemon | Hot-reloading service runner |

---

## Development Setup

### Prerequisites

- Node.js >= 18.x
- Docker Desktop (or local Redis instance running on port `6379`)
- MongoDB Atlas cluster or local MongoDB instance
- Firebase Project with service account credentials (`serviceaccount.json`)
- OpenRouter API Key (for the AI coding agent)

### Starting the Microservices

Open separate terminal tabs or processes for each service:

```bash
# 1. Start Redis
cd backend
docker compose up -d

# 2. Start Auth Service
cd services/auth
npm install
npm run dev     # Runs on http://localhost:8001

# 3. Start Project Service
cd ../project
npm install
npm run dev     # Runs on http://localhost:8002

# 4. Start File Service
cd ../file
npm install
npm run dev     # Runs on http://localhost:8003

# 5. Start AI Service
cd ../ai
npm install
npm run dev     # Runs on http://localhost:8004

# 6. Start API Gateway
cd ../../gateway
npm install
npm run dev     # Runs on http://localhost:8000
```

---

## Planned Features & Roadmap

- [x] Microservices API Gateway with centralized Redis session authentication
- [x] User authentication via Firebase Google OAuth & session cookies
- [x] Project management with Redis query caching & cache invalidation
- [x] Virtual filesystem with hierarchical tree explorer
- [x] Recursive cascading soft-delete for folder trees
- [x] Autonomous LangGraph AI coding agent with scoped filesystem tools
- [ ] Real-time collaborative code editing (Socket.io / WebSocket)
- [ ] Sandboxed multi-language code execution runner
- [ ] Unified Docker Compose for containerized microservice deployment
- [ ] Gateway-level rate limiting and throttling
- [ ] File version history and snapshot rollbacks
