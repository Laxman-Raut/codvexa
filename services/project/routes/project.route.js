import express from "express";
import { create, deleteproject, getprojectById, getprojects, getstarredProjects, togglestarred } from "../controllers/project.controller.js";

const router = express.Router();

router.post("/",create);
router.get("/",getprojects);
router.get("/starred",getstarredProjects);
router.get("/:id",getprojectById);
router.patch("/:id",togglestarred);
router.delete("/:id",deleteproject);

export default router;