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
import pty from "node-pty";
const port = process.env.PORT || 8005;
const app = express();

app.use(express.json());

const fileServiceUrl = process.env.FILE_SERVICE_URI;

const WORKSPACE_ROOT = path.join(os.tmpdir(), "Codvexa-AI");

const SHELL = process.platform === "win32" ? "powershell.exe" : "bash";

app.get("/", (req, res) => {
  res.json({ message: "Terminal service is up" });
});

app.get("/health", (req, res) => {
  res.status(200).json({ message: "Terminal service is running" });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

const sessions = new Map();

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
      await fs.writeFile(target, node.content || "", "utf8");
    }
  }
};

const syncProject = async (projectId, userId) => {
  const tree = await getTree(projectId, userId);
  const root = workspace(projectId);
  await fs.mkdir(root, { recursive: true });

  if (tree.length == 1 && tree[0].type == "folder") {
    await writeNodes(tree[0].children || [], root);
  } else {
    await writeNodes(tree, root);
  }

  return root;
};

io.on("connection", (socket) => {
  console.log("terminal connected");

  socket.on("terminal:init", async (projectId, userId, cols = 80, rows = 30) => {
    try {
      projectId = String(projectId || "");
      userId = String(userId || "");

      if (!projectId || !userId) {
        throw new Error("project id and user id are required");
      }

      const existingSession = sessions.get(socket.id);
      if (existingSession) {
        try {
          existingSession.ptyProcess.kill();
        } catch (error) {}
        sessions.delete(socket.id);
      }

      cols = normaliseCols(cols);
      rows = normaliseRow(rows);

      const root = await syncProject(projectId, userId);
      const ptyProcess = pty.spawn(
        SHELL,
        [],
        {
          name: "xterm-256color",
          cols,
          rows,
          cwd: root,
          env: {
            ...process.env,
            FORCE_COLOR: "1",
          },
        }
      );
      ptyProcess.onData((data) => {
        send(socket, data);
      });
      ptyProcess.onExit(({ exitCode }) => {
        send(socket, `\r\n\x1b[90m[shell exited: ${exitCode}]\x1b[0m\r\n`);
        const session = sessions.get(socket.id);
        if (session?.ptyProcess == ptyProcess) {
          sessions.delete(socket.id);
        }
      });

      sessions.set(socket.id, {
        projectId,
        userId,
        cwd: root,
        ptyProcess,
      });

      socket.emit("terminal:ready", { cols, rows });
    } catch (error) {
      console.log("terminal:init error", error);
      send(socket, `\r\n\x1b[31m[terminal error: ${error.message}]\x1b[0m\r\n`);
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