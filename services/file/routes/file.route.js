import express from "express";

import {
  createrootFolder,
  createFolder,
  createFile,
  updateFile,
  deleteFile,
  getFile,
  getTree
} from "../controllers/file.controllers.js";

const router = express.Router();

router.post("/create-root-folder", createrootFolder);

router.post("/create-folder", createFolder);

router.post("/create-file", createFile);

router.patch("/:id", updateFile);

router.delete("/:id", deleteFile);

router.get("/tree/:projectId", getTree);

router.get("/:id", getFile);

export default router;