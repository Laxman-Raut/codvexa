# Codvexa — Backend Architecture

> A **Microservices-based** backend for a collaborative cloud code editor, built with Node.js, Express, MongoDB, Redis, Firebase Authentication, LangGraph, and a real-time Server-Sent Events (SSE) autonomous AI coding assistant.

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
   - [6. Terminal Service (WIP)](#6-terminal-service-wip)
5. [Shared Layer](#shared-layer)
6. [Data Models](#data-models)
7. [Authentication & Session Flow](#authentication--session-flow)
8. [Redis Caching Strategy](#redis-caching-strategy)
9. [API Reference](#api-reference)
   - [API Gateway & Auth Endpoints](#1-authentication--session-api-gateway--auth-service)
   - [Project Management Endpoints](#2-project-management-project-service)
   - [Virtual Filesystem Endpoints](#3-virtual-filesystem-file-service)
   - [AI Assistant & SSE Protocol](#4-ai-assistant--sse-stream-ai-service)
10. [Environment Variables](#environment-variables)
11. [Infrastructure](#infrastructure)
12. [Tech Stack](#tech-stack)
13. [Development Setup](#development-setup)
14. [Planned Features & Roadmap](#planned-features--roadmap)

---

## Overview

Codvexa's backend is architected as an isolated **microservices ecosystem** where each primary domain concern—authentication, project management, virtual filesystem operations, and autonomous AI code assistance—is handled by an independent Node.js service.

All client requests enter through a single unified ingress: the **API Gateway**. The gateway terminates CORS, parses cookies, validates user sessions directly from **Redis**, and transparently proxies authorized requests to downstream internal services while injecting the authenticated user's ID (`x-user-id`) into the request headers.

### Architectural Principles

- **Zero-Trust Downstream**: Internal microservices do not deal with raw cookies or authentication verification; they trust the `x-user-id` header validated and injected exclusively by the API Gateway.
- **Stateless Services & Distributed Cache**: Services maintain no in-memory session state. User sessions and query caches reside in a shared Redis instance.
- **Event-Driven AI Streaming**: The AI Service leverages Server-Sent Events (SSE) to stream real-time tokens, tool invocations, and filesystem lifecycle events directly to the IDE frontend.
- **Decoupled Cross-Service Communication**: The AI service invokes virtual filesystem actions via internal REST requests to the File Service with delegated authentication headers.

---

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT (React / Vite)                                │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTP (REST + SSE) + Credentials (Cookies)
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
   │ (MongoDB)    │      │ Query Cache  │      │ File CRUD    │      │ SSE Stream   │
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
├── gateway/                        # API Gateway Service (:8000)
│   ├── controllers/
│   │   └── user.controller.js      # GET /api/me handler
│   ├── middleware/
│   │   └── protect.js              # Session validation middleware via Redis
│   ├── utils/
│   │   └── proxyWithHeader.js      # Proxy wrapper injecting x-user-id header
│   ├── .env                        # Gateway environment variables
│   ├── .gitignore
│   ├── index.js                    # Gateway entry point & route definitions
│   ├── package.json
│   └── package-lock.json
│
├── services/
│   ├── auth/                       # Authentication Microservice (:8001)
│   │   ├── config/
│   │   │   ├── db.js               # MongoDB connection
│   │   │   └── firebase.js         # Firebase Admin SDK initialization
│   │   ├── controllers/
│   │   │   └── auth.controller.js  # login, logout, me handlers
│   │   ├── models/
│   │   │   └── user.model.js       # Mongoose User schema
│   │   ├── routes/
│   │   │   └── auth.route.js       # /login, /me, /logout routes
│   │   ├── .env
│   │   ├── .gitignore
│   │   ├── index.js                # Auth service entry point
│   │   ├── serviceaccount.json     # Firebase service account credential
│   │   ├── package.json
│   │   └── package-lock.json
│   │
│   ├── project/                    # Project Management Microservice (:8002)
│   │   ├── config/
│   │   │   └── db.js               # MongoDB connection
│   │   ├── controllers/
│   │   │   └── project.controller.js # Project CRUD & Redis cache logic
│   │   ├── model/
│   │   │   └── project.model.js    # Mongoose Project schema
│   │   ├── routes/
│   │   │   └── project.route.js    # Project REST routes
│   │   ├── .env
│   │   ├── index.js                # Project service entry point
│   │   ├── package.json
│   │   └── package-lock.json
│   │
│   ├── file/                       # Virtual Filesystem Microservice (:8003)
│   │   ├── config/
│   │   │   └── db.js               # MongoDB connection
│   │   ├── controllers/
│   │   │   └── file.controllers.js # File/folder CRUD, recursive deletion, tree
│   │   ├── models/
│   │   │   └── file.model.js       # Mongoose File/Folder schema
│   │   ├── routes/
│   │   │   └── file.route.js       # File tree and manipulation routes
│   │   ├── utils/
│   │   │   └── buildtree.js        # Recursive hierarchical tree builder
│   │   ├── .env
│   │   ├── index.js                # File service entry point
│   │   ├── package.json
│   │   └── package-lock.json
│   │
│   ├── ai/                         # Autonomous AI Coding Agent Microservice (:8004)
│   │   ├── config/
│   │   │   └── db.js               # MongoDB connection
│   │   ├── controllers/
│   │   │   └── ai.controller.js    # Real-time SSE streaming orchestrator
│   │   ├── graph/
│   │   │   ├── graph.js            # LangGraph StateGraph, nodes & system prompt
│   │   │   └── tools.js            # Scoped filesystem tools (Zod validated)
│   │   ├── routes/
│   │   │   └── ai.routes.js        # POST /chat route definition
│   │   ├── utils/
│   │   │   ├── fetchFileApis.js    # Internal HTTP client for File Service
│   │   │   └── llm.js              # ChatOpenRouter (DeepSeek) configuration
│   │   ├── .env                    # AI Service environment variables
│   │   ├── index.js                # AI service entry point (with DNS fallback)
│   │   ├── package.json
│   │   └── package-lock.json
│   │
│   └── Terminal/                   # Sandboxed Terminal Execution Service (WIP)
│       └── index.js                # Terminal service entry point
│
├── shared/                         # Cross-service shared utilities
│   ├── redis/
│   │   └── redis.js                # Singleton ioredis client instance
│   └── package.json
│
├── docker-compose.yml              # Local development container runner (Redis)
├── README.MD                       # Comprehensive backend documentation
└── .gitignore
```

---

## Services

### 1. API Gateway

**Port:** `8000`  
**Entry Point:** [`gateway/index.js`](./gateway/index.js)

The single entry point for all frontend client traffic. It manages core cross-cutting ingress concerns:

| Responsibility | Implementation Details |
|---|---|
| **CORS** | Configured via `cors` middleware for `FRONTEND_URL` (`http://localhost:5173`) with `credentials: true`. |
| **Cookie Parsing** | Parses incoming HTTP-only cookies to extract the `sessionId`. |
| **Request Logging** | Uses `morgan("dev")` for concise developer HTTP traffic logging. |
| **Session Guard** | Applies [`middleware/protect.js`](./gateway/middleware/protect.js) which validates the session against Redis. |
| **Header Injection** | Transparently attaches `x-user-id: <userId>` before proxying via [`utils/proxyWithHeader.js`](./gateway/utils/proxyWithHeader.js). |
| **Route Proxying** | Leverages `express-http-proxy` to route requests to Auth, Project, File, and AI microservices. |
| **Self-Contained `/api/me`** | Directly returns session profile payload from Redis without incurring downstream service latency. |

#### Route Table

| Method | Path | Auth Guard | Downstream Target / Handler |
|---|---|:---:|---|
| `*` | `/api/auth/*` | ❌ | Auth Service (`:8001`) |
| `GET` | `/api/me` | ✅ | Gateway Handler (resolves directly from Redis session) |
| `*` | `/api/project/*` | ✅ | Project Service (`:8002`) with `x-user-id` |
| `*` | `/api/file/*` | ✅ | File Service (`:8003`) with `x-user-id` |
| `*` | `/api/ai/*` | ✅ | AI Service (`:8004`) with `x-user-id` |
| `GET` | `/health` | ❌ | Gateway (`{ message: "gateway is running" }`) |
| `GET` | `/` | ❌ | Gateway (`{ message: "service is up" }`) |

#### `protect()` Middleware Flow

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
    Attach req.user     401 Unauthorized
       and next()
```

---

### 2. Auth Service

**Port:** `8001`  
**Directory:** [`services/auth/`](./services/auth/)

Handles user authentication, Google OAuth verification, user document synchronization, and session lifecycle management.

#### Key Mechanics

- **Firebase Token Verification**: Receives Firebase ID Tokens from the client and verifies them using the **Firebase Admin SDK** ([`config/firebase.js`](./services/auth/config/firebase.js)).
- **Database Synchronization**: If the user does not exist in MongoDB, a new `User` document is created using their Firebase UID, name, email, and avatar. Existing users are retrieved by `firebaseUid`.
- **Redis Session Creation**: Generates a cryptographically random UUID (`crypto.randomUUID()`), stores `{ userId, name, email, avatar }` in Redis under `session-<uuid>` with a 7-day TTL (`60 * 60 * 24 * 7`).
- **Secure Cookie Issuance**: Sets an HTTP-only `sessionId` cookie (`sameSite: "lax"`, `secure: false` in dev) sent back with the response.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/login` | Verifies Firebase ID token, creates or fetches MongoDB user, writes Redis session, sets cookie |
| `GET` | `/me` | Returns current user from Redis session |
| `POST` | `/logout` | Deletes session from Redis and clears the client `sessionId` cookie |

---

### 3. Project Service

**Port:** `8002`  
**Directory:** [`services/project/`](./services/project/)

Manages workspaces and project metadata. All operations are strictly scoped to the `x-user-id` header passed down by the API Gateway.

#### Features & Caching

- **Fast Retrieval**: Project listings (`GET /`) and starred project listings (`GET /starred`) are aggressively cached in Redis (`projects-<userId>` and `starred-projects-<userId>`).
- **Automated Cache Invalidation**: Creating, deleting, or toggling stars automatically flushes the affected user's Redis cache keys.
- **Activity Tracking**: Accessing a project via `GET /:id` automatically bumps the `lastOpenAt` timestamp.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/` | Creates a new project for the authenticated user and clears `projects-<userId>` cache |
| `GET` | `/` | Returns all projects owned by the user (Redis cached) |
| `GET` | `/starred` | Returns all starred projects owned by the user (Redis cached) |
| `GET` | `/:id` | Returns a single project document and updates its `lastOpenAt` timestamp |
| `PATCH` | `/:id` | Toggles the project's `starred` state and invalidates both project caches |
| `DELETE` | `/:id` | Deletes a project and invalidates both project caches |

---

### 4. File Service

**Port:** `8003`  
**Directory:** [`services/file/`](./services/file/)

Manages the hierarchical virtual filesystem representing the workspace codebase. Files and directories are represented as documents in MongoDB, self-referencing via `parentId`.

#### Architectural Highlights

- **Root Directory Initialization**: Every project requires an initial root folder created via `/create-root-folder` (`parentId: null`).
- **Hierarchical Tree Assembly**: [`utils/buildtree.js`](./services/file/utils/buildtree.js) performs in-memory hierarchical tree reconstruction from flat MongoDB documents, grouping children under parent folders for fast frontend rendering.
- **Recursive Cascading Soft Delete**: When a directory is deleted, the service recursively fetches all descendant folder and file IDs (`parentId: { $in: childIds }`) and soft deletes them (`isdeleted: true`), guaranteeing that nested orphan files never linger.
- **Dynamic File Metadata**: Automatically determines file extension, detects programming language, and calculates byte size upon creation and updates.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/create-root-folder` | Creates the root folder for a project (`projectId`, `projectName`, `parentId: null`) |
| `POST` | `/create-folder` | Creates a folder inside a designated `parentId` |
| `POST` | `/create-file` | Creates a file with name, extension, language, content, and `parentId` |
| `PATCH` | `/:id` | Updates file name, content, language, and recalculates size |
| `DELETE` | `/:id` | Soft-deletes a file or directory with recursive cascading deletion to all nested children |
| `GET` | `/tree/:projectId` | Returns the fully resolved, nested children folder/file tree |
| `GET` | `/:id` | Returns file metadata and full text content |

---

### 5. AI Service

**Port:** `8004`  
**Directory:** [`services/ai/`](./services/ai/)

An autonomous AI coding agent designed for a Cursor-like cloud IDE experience. The agent inspects codebases, reasons over user prompts, and executes filesystem operations by invoking dedicated microservice tools via internal REST calls.

#### Core Technologies & Features

- **LangGraph Directed StateGraph**: Built with `@langchain/langgraph` utilizing `MessagesAnnotation`. Cyclically transitions between the `agent` LLM node and the `tools` execution node until all modifications are complete.
- **OpenRouter & DeepSeek LLM**: Configured in [`utils/llm.js`](./services/ai/utils/llm.js) with `deepseek/deepseek-chat`, `temperature: 0`, and `maxTokens: 8192`.
- **DNS Google Fallback**: Configured at startup (`dns.setServers(["8.8.8.8", "8.8.4.4"])`) to ensure reliable DNS resolution across local and containerized development setups.
- **Real-Time SSE Streaming**: The `/chat` endpoint uses **Server-Sent Events (`text/event-stream`)** to stream incremental LLM responses, tool calls, and granular file operations directly to the client.
- **Client Disconnect Handling**: Employs `AbortController` linked to `res.once("close")` to immediately terminate LangGraph stream loops if the user closes their browser or tab.
- **Content Truncation Protection**: Reads up to `50,000` characters per file with a `truncated: true` safety flag to prevent context window overflow.

#### Filesystem Tool Suite ([`graph/tools.js`](./services/ai/graph/tools.js))

The AI service binds tools dynamically scoped to the authenticated `userId` and active `projectId`:

| Tool Name | Parameters | Purpose |
|---|---|---|
| `get_tree` | `{}` | Retrieves complete project hierarchy (`_id`, `parentId`, `name`, `type`, `language`, `extension`, `children`). |
| `get_file` | `{ fileId }` | Reads full content of an existing file (capped at 50k chars with `truncated` flag). Never accepts folder IDs. |
| `create_folder`| `{ name, parentId? }` | Creates a directory inside `parentId` or at root. Returns `operation: "folder_created"`. |
| `create_file` | `{ name, parentId?, content, language? }` | Creates a new file with full functional code. Returns `operation: "file_created"`. |
| `update_file` | `{ fileId, content, name? }` | Overwrites existing file content and/or renames it. Returns `operation: "file_updated"`. |
| `delete_file` | `{ fileId }` | Soft-deletes a file. Returns `operation: "file_deleted"`. |

#### Server-Sent Events (SSE) Protocol

When calling `POST /api/ai/chat`, the client receives a continuous stream of events in standard SSE format (`event: <type>\ndata: <json>\n\n`):

| SSE Event | Payload Structure | Description |
|---|---|---|
| `start` | `{"_success": true, "message": "AI started"}` | Initial handshake confirming stream initialization |
| `tool_start` | `{"tool": "create_file", "args": { ... }}` | Emitted immediately when the LLM decides to invoke a tool |
| `message` | `{"content": "I am creating the components..."}` | Incremental or final textual explanation from the AI |
| `folder_created` | `{"success": true, "operation": "folder_created", "folder": { ... }}` | Emitted when a directory is successfully created |
| `file_created` | `{"success": true, "operation": "file_created", "file": { ... }}` | Emitted when a new file is created |
| `file_updated` | `{"success": true, "operation": "file_updated", "file": { ... }}` | Emitted when an existing file is updated |
| `file_deleted` | `{"success": true, "operation": "file_deleted", "file": { ... }}` | Emitted when a file is deleted |
| `tool_result` | `{"tool": "get_tree", "content": "..."}` | General output from read-only tools like `get_tree` or `get_file` |
| `tool_error` | `{"tool": "create_file", "error": "Reason"}` | Emitted if a tool operation fails |
| `done` | `{"success": true, "message": "Final summary"}` | Final event marking the completion of the entire agent execution |
| `error` | `{"success": false, "message": "Error details"}` | Emitted if an unhandled or recursion error occurs |

---

### 6. Terminal Service (WIP)

**Directory:** [`services/Terminal/`](./services/Terminal/)

An upcoming service planned for executing terminal commands, package management (`npm install`), and running user application processes within isolated Docker containers or sandboxed virtual machines.

---

## Shared Layer

**Directory:** [`shared/`](./shared/)

Contains common shared infrastructure modules imported across multiple microservices.

### Singleton Redis Client ([`shared/redis/redis.js`](./shared/redis/redis.js))

Instantiates and exports a singleton `ioredis` instance initialized from `process.env.REDIS_URL`:

```javascript
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);

redis.on("connect", () => {
    console.log("redis connected");
});

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
                                              │ type         : "file" | "folder"│
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
| `session-<uuid>` | String (JSON) | 7 Days | Auth Service | User session store and gateway authentication guard | Explicit logout (`POST /api/auth/logout`) |
| `projects-<userId>` | String (JSON) | None | Project Service | User project list query cache | Project created, project deleted, or starred state toggled |
| `starred-projects-<userId>` | String (JSON) | None | Project Service | Starred projects list query cache | Project deleted or starred state toggled |

---

## API Reference

Base Gateway Address: `http://localhost:8000`

### 1. Authentication & Session (API Gateway & Auth Service)

| Method | Endpoint | Auth | Headers / Cookie | Request Body | Response |
|---|---|:---:|---|---|---|
| `POST` | `/api/auth/login` | ❌ | None | `{ token: string }` | `{ user: User }` + HTTP-Only Cookie |
| `GET` | `/api/auth/me` | ✅ | Cookie (`sessionId`) | None | `{ userId, name, email, avatar }` |
| `POST` | `/api/auth/logout` | ✅ | Cookie (`sessionId`) | None | `{ message: "Logged out successfully" }` |
| `GET` | `/api/me` | ✅ | Cookie (`sessionId`) | None | Handled directly by Gateway via Redis session |

### 2. Project Management (Project Service)

*Requires valid `sessionId` cookie. Gateway automatically injects `x-user-id`.*

| Method | Endpoint | Request Body / Params | Response |
|---|---|---|---|
| `POST` | `/api/project/` | `{ name: string, description?: string }` | `Project` |
| `GET` | `/api/project/` | None | `Project[]` (cached in Redis) |
| `GET` | `/api/project/starred` | None | `Project[]` (cached in Redis) |
| `GET` | `/api/project/:id` | `id` (MongoDB Project ObjectId) | `Project` (updates `lastOpenAt`) |
| `PATCH` | `/api/project/:id` | `id` (MongoDB Project ObjectId) | `Project` (toggles `starred` boolean) |
| `DELETE` | `/api/project/:id` | `id` (MongoDB Project ObjectId) | `Project` (deleted document) |

### 3. Virtual Filesystem (File Service)

*Requires valid `sessionId` cookie. Gateway automatically injects `x-user-id`.*

| Method | Endpoint | Request Body / Params | Response |
|---|---|---|---|
| `POST` | `/api/file/create-root-folder` | `{ projectId: string, projectName: string }` | `File` (`type: "folder"`, `parentId: null`) |
| `POST` | `/api/file/create-folder` | `{ projectId: string, name: string, parentId: string }` | `File` (`type: "folder"`) |
| `POST` | `/api/file/create-file` | `{ projectId, name, parentId, content?, language? }` | `File` (`type: "file"`) |
| `PATCH` | `/api/file/:id` | `{ name?: string, content?: string }` | `File` (recalculated size and language) |
| `DELETE` | `/api/file/:id` | `id` (File or Folder ObjectId) | `File` (recursive cascading soft delete) |
| `GET` | `/api/file/tree/:projectId` | `projectId` (Project ObjectId) | `File[]` (hierarchical nested children tree) |
| `GET` | `/api/file/:id` | `id` (File ObjectId) | `File` (complete file details & content) |

### 4. AI Assistant & SSE Stream (AI Service)

*Requires valid `sessionId` cookie. Gateway automatically injects `x-user-id`.*

| Method | Endpoint | Content-Type | Request Body | Response Mode |
|---|---|---|---|---|
| `GET` | `/api/ai/health` | `application/json` | None | `{ message: "AI service is running" }` |
| `GET` | `/api/ai/` | `application/json` | None | `{ message: "AI service is up" }` |
| `POST` | `/api/ai/chat` | `application/json` | `{ projectId: string, message: string, history?: Array }` | **Server-Sent Events (`text/event-stream`)** streaming real-time tokens & operations |

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
MONGO_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/auth?appName=Cluster0
REDIS_URL=redis://localhost:6379
```
*Note: Requires `services/auth/serviceaccount.json` containing Firebase Admin credentials.*

### 3. Project Service (`services/project/.env`)

```ini
PORT=8002
MONGO_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/project?appName=Cluster0
REDIS_URL=redis://localhost:6379
```

### 4. File Service (`services/file/.env`)

```ini
PORT=8003
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/file?appName=Cluster0
REDIS_URL=redis://localhost:6379
```

### 5. AI Service (`services/ai/.env`)

```ini
PORT=8004
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/ai?appName=Cluster0
REDIS_URL=redis://localhost:6379
FILE_SERVICE_URI=http://localhost:8003
OPENROUTER_API_KEY=sk-or-v1-your-openrouter-key
```

---

## Infrastructure

### Docker Compose

The backend repository includes a [`docker-compose.yml`](./docker-compose.yml) configured to spin up Redis locally:

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

To stop:
```bash
docker compose down
```

---

## Tech Stack

| Domain | Technology | Usage & Purpose |
|---|---|---|
| **Runtime** | Node.js (ES Modules) | Standard JavaScript runtime across all services (`"type": "module"`) |
| **Framework** | Express.js v5 | High-performance routing and REST middleware |
| **Gateway Proxy** | express-http-proxy | Transparent HTTP reverse proxying & header injection |
| **Authentication** | Firebase Admin SDK | Server-side verification of Google OAuth ID tokens |
| **Session & Cache** | Redis + ioredis | Distributed fast session storage and project query caching |
| **Database** | MongoDB + Mongoose | Schema validation and document persistence for users, projects, files |
| **AI Orchestration** | LangGraph (`@langchain/langgraph`) | Cyclical state graphs (`StateGraph`) for autonomous tool execution |
| **LLM Provider** | LangChain OpenRouter (`ChatOpenRouter`) | DeepSeek (`deepseek/deepseek-chat`) LLM integration |
| **Tool Validation** | Zod v3 (`zod/v3`) | Strict input/output schema validation for filesystem tools |
| **Streaming Protocol** | Server-Sent Events (SSE) | Real-time push notifications for chat responses and file operations |
| **HTTP Client** | Axios | AI Service to File Service inter-service communication |
| **Logging** | Morgan | HTTP request logging for development debugging |
| **Development** | Nodemon | Hot-reloading development runner |

---

## Development Setup

### Prerequisites

- Node.js >= 18.x
- Docker Desktop (or local Redis instance running on port `6379`)
- MongoDB Atlas cluster (or local MongoDB database)
- Firebase Project with service account credentials (`serviceaccount.json`)
- OpenRouter API Key (for the autonomous AI coding assistant)

### Starting the Microservices

Open separate terminal windows or run them concurrently:

```bash
# 1. Start Redis
cd backend
docker compose up -d

# 2. Start Auth Service
cd services/auth
npm install
npm run dev     # Starts on http://localhost:8001

# 3. Start Project Service
cd ../project
npm install
npm run dev     # Starts on http://localhost:8002

# 4. Start File Service
cd ../file
npm install
npm run dev     # Starts on http://localhost:8003

# 5. Start AI Service
cd ../ai
npm install
npm run dev     # Starts on http://localhost:8004

# 6. Start API Gateway
cd ../../gateway
npm install
npm run dev     # Starts on http://localhost:8000
```

---

## Planned Features & Roadmap

- [x] Microservices API Gateway with centralized Redis session authentication
- [x] User authentication via Firebase Google OAuth & HTTP-only session cookies
- [x] Project management with Redis query caching & automated invalidation
- [x] Virtual filesystem with hierarchical tree explorer
- [x] Recursive cascading soft-delete for folder trees
- [x] Autonomous LangGraph AI coding agent with scoped filesystem tools
- [x] Real-time Server-Sent Events (SSE) streaming for AI tokens and file mutation events
- [ ] Containerized Terminal execution service (`services/Terminal`) with pty / docker execution
- [ ] Real-time collaborative code editing (Socket.io / WebSocket CRDTs)
- [ ] Sandboxed multi-language code runner with output capture
- [ ] Unified Docker Compose for containerized microservice deployment
- [ ] Gateway-level rate limiting and throttling
- [ ] File version history and snapshot rollbacks
