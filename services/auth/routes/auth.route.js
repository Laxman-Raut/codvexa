import express from "express";
import {login,me} from "../controllers/auth.controller.js"
const router =express.Router();

router.post("/login",login)
export default router;
router.get("/me", me);