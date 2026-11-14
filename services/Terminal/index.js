import "dotenv/config";
import dns from "dns";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express from "express";
import http from "http";
import { Server } from "socket.io";
import { connectDb } from "./config/db.js";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { watch } from "fs";
import pty from "node-pty";

const port = process.env.PORT || 8005;
const app = express();

const gatewayUrl = (
  process.env.GATEWAY_URL || "http://localhost:8000"
).replace(/\/+$/, "");
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

app.use(express.json());

const fileServiceUrl = (
  process.env.FILE_SERVICE_URI || "http://localhost:8003"
).replace(/\/+$/, "");

const WORKSPACE_ROOT = path.join(os.tmpdir(), "Codvexa-AI");

const SHELL = process.platform === "win32" ? "powershell.exe" : "bash";

const IGNORED = ["node_modules", ".git", "dist", "build", ".next"];

const LANGUAGES = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  html: "html",
  css: "css",
  md: "markdown",
  py: "python",
};

app.get("/", (req, res) => {
  res.json({ message: "Terminal service is up" });
});

app.get("/health", (req, res) => {
  res.status(200).json({ message: "Terminal service is running" });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: frontendUrl,
    credentials: true,
  },
});

const sessions = new Map();

io.use(async (socket, next) => {
  const cookie = socket.handshake.headers.cookie;

  if (!cookie) {
    next(new Error("unauthorized"));
    return;
  }

  try {
    const response = await fetch(`${gatewayUrl}/api/me`, {
      headers: { cookie },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      next(new Error("unauthorized"));
      return;
    }

    const user = await response.json();
    const userId = user.userId || user._id || user.id;

    if (!userId) {
      next(new Error("unauthorized"));
      return;
    }

    socket.data.userId = String(userId);
    next();
  } catch (error) {
    console.error("terminal socket authentication failed:", error.message);
    next(new Error("authentication service unavailable"));
  }
});

const send = (socket, data) => {
  if (!socket.connected) {
    return;
  }

  socket.emit("terminal:data", String(data || ""));
};

const safeName = (name) => {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new Error(`Invalid file/folder name: ${name}`);
  }

  return name;
};

const workspace = (projectId) => {
  return path.join(WORKSPACE_ROOT, String(projectId));
};

const normaliseCols = (cols) => {
  const value = Number(cols);

  if (!Number.isFinite(value)) {
    return 80;
  }

  return Math.max(20, Math.min(Math.floor(value), 500));
};

const normaliseRow = (rows) => {
  const value = Number(rows);

  if (!Number.isFinite(value)) {
    return 30;
  }

  return Math.max(5, Math.min(Math.floor(value), 200));
};

const guessLanguage = (name) =>
  LANGUAGES[name.split(".").pop().toLowerCase()] || "plaintext";

// ------------------------------------------------------------------
// File service -> terminal workspace
// ------------------------------------------------------------------
const getTree = async (projectId, userId) => {
  const url = `${fileServiceUrl}/tree/${projectId}`;

  const response = await fetch(url, {
    headers: {
      "x-user-id": String(userId),
    },
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      data.message || `File service returned ${response.status}`
    );
  }

  // The file service returns the tree as a raw array; also accept wrapped
  // responses so the terminal stays compatible with either response shape.
  if (Array.isArray(data)) return data;
  return Array.isArray(data.tree) ? data.tree : [];
};

const writeNodes = async (nodes, directory) => {
  if (!Array.isArray(nodes)) return;

  for (const node of nodes) {
    const name = safeName(node.name);
    const target = path.join(directory, name);

    if (node.type === "folder") {
      await fs.mkdir(target, { recursive: true });
      await writeNodes(node.children, target);
      continue;
    }

    if (node.type === "file") {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const content = node.content || "";
      const currentContent = await fs.readFile(target, "utf8").catch(() => null);
      if (currentContent !== content) {
        await fs.writeFile(target, content, "utf8");
      }
    }
  }
};

const projectNodes = (tree) =>
  tree.length === 1 && tree[0].type === "folder"
    ? tree[0].children || []
    : tree;

const collectFilePaths = (nodes, base = "", paths = new Set()) => {
  for (const node of nodes || []) {
    const name = safeName(node.name);
    const relativePath = base ? `${base}/${name}` : name;

    if (node.type === "folder") {
      collectFilePaths(node.children, relativePath, paths);
    } else if (node.type === "file") {
      paths.add(relativePath);
    }
  }

  return paths;
};

const syncProject = async (projectId, userId) => {
  const tree = await getTree(projectId, userId);
  const root = workspace(projectId);
  await fs.mkdir(root, { recursive: true });
  const nodes = projectNodes(tree);
  await writeNodes(nodes, root);

  return {
    root,
    remoteFilePaths: collectFilePaths(nodes),
  };
};

const syncWorkspaceFromFileService = async (session) => {
  const tree = await getTree(session.projectId, session.userId);
  const nodes = projectNodes(tree);
  const nextFilePaths = collectFilePaths(nodes);

  // Remove files that were present in the previous database snapshot but were
  // deleted remotely. Only unlink files managed by the file service; leave
  // terminal-generated and ignored files such as node_modules untouched.
  for (const relativePath of session.remoteFilePaths || []) {
    if (nextFilePaths.has(relativePath)) continue;

    const target = path.resolve(session.cwd, ...relativePath.split("/"));
    const fromRoot = path.relative(session.cwd, target);
    if (
      !fromRoot ||
      fromRoot === ".." ||
      fromRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(fromRoot)
    ) {
      continue;
    }

    try {
      const stat = await fs.lstat(target);
      if (stat.isFile()) await fs.unlink(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  await writeNodes(nodes, session.cwd);
  session.remoteFilePaths = nextFilePaths;
};

// ------------------------------------------------------------------
// Terminal workspace -> file service
// ------------------------------------------------------------------
const call = async (method, urlPath, userId, body) => {
  const response = await fetch(`${fileServiceUrl}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": String(userId),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `File service returned ${response.status}`);
  }

  return data;
};

const flatten = (nodes, base = "", map = new Map()) => {
  for (const node of nodes || []) {
    const rel = base ? `${base}/${node.name}` : node.name;
    map.set(rel, node);
    if (node.type === "folder") flatten(node.children, rel, map);
  }
  return map;
};

// Pushes only the paths that changed in the terminal workspace to the file service
const syncPaths = async (session, relPaths) => {
  const { projectId, userId, cwd } = session;

  const tree = await getTree(projectId, userId);
  const single = tree.length === 1 && tree[0].type === "folder";
  const rootId = single ? tree[0]._id : null;
  const remote = flatten(single ? tree[0].children : tree);
  let changed = false;

  const ensureFolder = async (rel) => {
    if (!rel) return rootId;

    const existing = remote.get(rel);
    if (existing) return existing._id;

    const slash = rel.lastIndexOf("/");
    const parentId = await ensureFolder(slash === -1 ? "" : rel.slice(0, slash));

    const data = await call("POST", "/create-folder", userId, {
      projectId,
      name: rel.slice(slash + 1),
      parentId,
    });

    const node = data.folder || data;
    remote.set(rel, node);
    changed = true;
    return node._id;
  };

  const sorted = [...relPaths].sort(
    (a, b) => a.split("/").length - b.split("/").length
  );

  for (const rel of sorted) {
    const full = path.join(cwd, ...rel.split("/"));
    const slash = rel.lastIndexOf("/");
    const parentRel = slash === -1 ? "" : rel.slice(0, slash);
    const name = rel.slice(slash + 1);
    const node = remote.get(rel);

    let stat = null;
    try {
      stat = await fs.stat(full);
    } catch {}

    // Deleted in the terminal
    if (!stat) {
      if (node) {
        await call("DELETE", `/${node._id}`, userId);
        changed = true;
      }
      continue;
    }

    if (stat.isDirectory()) {
      await ensureFolder(rel);
      continue;
    }

    const content = await fs.readFile(full, "utf8");

    if (!node) {
      const parentId = await ensureFolder(parentRel);
      await call("POST", "/create-file", userId, {
        projectId,
        name,
        parentId,
        content,
        language: guessLanguage(name),
      });
      changed = true;
    } else if ((node.content || "") !== content) {
      await call("PATCH", `/${node._id}`, userId, { content });
      changed = true;
    }
  }

  if (changed) {
    const updatedTree = await getTree(projectId, userId);
    session.remoteFilePaths = collectFilePaths(projectNodes(updatedTree));
  }

  return changed;
};

const startWatcher = (socket, session) => {
  const pending = new Set();
  const watchers = new Map();
  let timer = null;
  let running = false;
  let stopped = false;

  const isIgnored = (rel) =>
    rel.split("/").some((part) => IGNORED.includes(part));

  const queueChange = (rel) => {
    pending.add(rel);
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
  };

  const removeWatchersUnder = (directory) => {
    for (const [watchedDirectory, watcher] of watchers) {
      const relative = path.relative(directory, watchedDirectory);
      if (
        watchedDirectory === directory ||
        (relative && relative !== ".." && !relative.startsWith(`..${path.sep}`))
      ) {
        watcher.close();
        watchers.delete(watchedDirectory);
      }
    }
  };

  const flush = async () => {
    if (stopped) return;

    if (running) {
      timer = setTimeout(flush, 500);
      return;
    }

    running = true;
    const paths = [...pending];
    pending.clear();

    try {
      if (paths.length) {
        const changed = await syncPaths(session, paths);
        if (changed) {
          socket.emit("terminal:files-changed", { projectId: session.projectId });
        }
      }
    } catch (error) {
      console.log("sync to file service failed:", error.message);
    } finally {
      running = false;
    }
  };

  const addDirectoryWatcher = async (directory, includeContents = false) => {
    if (stopped || watchers.has(directory)) return;

    let watcher;
    try {
      watcher = watch(directory, (_event, filename) => {
        if (stopped || !filename) return;

        const absolutePath = path.resolve(directory, filename.toString());
        const relPath = path.relative(session.cwd, absolutePath);
        if (
          !relPath ||
          relPath === ".." ||
          relPath.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relPath)
        ) {
          return;
        }

        const rel = relPath.split(path.sep).join("/");
        if (isIgnored(rel)) return;

        queueChange(rel);

        fs.lstat(absolutePath)
          .then((stat) => {
            if (stat.isDirectory()) {
              void addDirectoryWatcher(absolutePath, true);
            }
          })
          .catch(() => removeWatchersUnder(absolutePath));
      });
    } catch (error) {
      console.warn(`could not watch terminal directory ${directory}:`, error.message);
      return;
    }

    watchers.set(directory, watcher);
    watcher.on("error", (error) => {
      console.warn(`terminal directory watcher failed for ${directory}:`, error.message);
      removeWatchersUnder(directory);
    });

    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const childPath = path.join(directory, entry.name);
      if (includeContents) {
        const childRel = path.relative(session.cwd, childPath).split(path.sep).join("/");
        if (!isIgnored(childRel)) queueChange(childRel);
      }

      if (entry.isDirectory() && !IGNORED.includes(entry.name)) {
        await addDirectoryWatcher(childPath, includeContents);
      }
    }
  };

  void addDirectoryWatcher(session.cwd);

  return () => {
    stopped = true;
    clearTimeout(timer);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
};

// ------------------------------------------------------------------
// Socket handlers
// ------------------------------------------------------------------
io.on("connection", (socket) => {
  console.log("terminal connected");

  socket.on("terminal:init", async (projectId, requestedUserId, cols = 80, rows = 30) => {
    try {
      projectId = String(projectId || "");
      const userId = socket.data.userId;

      if (!projectId || !userId) {
        throw new Error("project id and user id are required");
      }

      if (requestedUserId && String(requestedUserId) !== userId) {
        throw new Error("authenticated user does not match terminal session");
      }

      if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
        throw new Error("invalid project id");
      }

      const existingSession = sessions.get(socket.id);
      if (existingSession) {
        existingSession.stopWatcher?.();
        try {
          existingSession.ptyProcess.kill();
        } catch (error) {}
        sessions.delete(socket.id);
      }

      cols = normaliseCols(cols);
      rows = normaliseRow(rows);

      const { root, remoteFilePaths } = await syncProject(projectId, userId);
      const ptyProcess = pty.spawn(SHELL, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: root,
        env: {
          ...process.env,
          FORCE_COLOR: "1",
        },
      });

      ptyProcess.onData((data) => {
        send(socket, data);
      });

      ptyProcess.onExit(({ exitCode }) => {
        send(socket, `\r\n\x1b[90m[shell exited: ${exitCode}]\x1b[0m\r\n`);
        const session = sessions.get(socket.id);
        if (session?.ptyProcess == ptyProcess) {
          session.stopWatcher?.();
          sessions.delete(socket.id);
        }
      });

      const session = {
        projectId,
        userId,
        cwd: root,
        ptyProcess,
        remoteFilePaths,
      };
      session.stopWatcher = startWatcher(socket, session);
      sessions.set(socket.id, session);

      socket.emit("terminal:ready", { cols, rows });
    } catch (error) {
      console.log("terminal:init error", error);
      socket.emit("terminal:error", { message: error.message });
      send(socket, `\r\n\x1b[31m[terminal error: ${error.message}]\x1b[0m\r\n`);
    }
  });

  socket.on("terminal:sync", async () => {
    const session = sessions.get(socket.id);
    if (!session) return;

    const syncTask = (session.syncQueue || Promise.resolve())
      .catch(() => {})
      .then(() => syncWorkspaceFromFileService(session));
    session.syncQueue = syncTask;

    try {
      await syncTask;
      socket.emit("terminal:sync-complete", {
        projectId: session.projectId,
      });
    } catch (error) {
      console.warn("file service -> terminal sync failed:", error.message);
      socket.emit("terminal:sync-error", {
        message: error.message || "Workspace sync failed.",
      });
    }
  });

  socket.on("terminal:write", (data) => {
    const session = sessions.get(socket.id);
    if (!session) return;
    session.ptyProcess.write(String(data));
  });

  socket.on("terminal:resize", ({ cols, rows }) => {
    const session = sessions.get(socket.id);
    if (!session) return;
    cols = Number(cols);
    rows = Number(rows);
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    cols = normaliseCols(cols);
    rows = normaliseRow(rows);

    session.ptyProcess.resize(cols, rows);
  });

  socket.on("disconnect", () => {
    console.log("terminal disconnected");
    const session = sessions.get(socket.id);
    if (!session) return;

    session.stopWatcher?.();

    try {
      session.ptyProcess.kill();
    } catch (error) {}

    sessions.delete(socket.id);
  });
});

const startServer = async () => {
  try {
    await connectDb();

    server.listen(port, () => {
      console.log(`Terminal service started at ${port}`);
    });
  } catch (error) {
    console.error("Terminal service startup failed:", error.message);
    process.exit(1);
  }
};

startServer();
