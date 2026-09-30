import dns from "dns";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { configDotenv } from "dotenv";
import { connectDb } from "./config/db.js";
import router from "./routes/auth.route.js";

configDotenv();

const port = process.env.PORT || 8001;
const app = express();

app.use(cors({
    origin: "http://localhost:5173",
    credentials: true
}));

app.use(express.json());
app.use(cookieParser());

app.get("/", (req, res) => {
    res.json({ message: "service is up" });
});

app.use("/", router);

app.get("/health", (req, res) => {
    res.status(200).json({ message: "auth is running" });
});

app.listen(port, () => {
    connectDb();
    console.log(`auth service started at ${port}`);
});