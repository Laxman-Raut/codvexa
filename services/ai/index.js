import dns from "dns";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express from "express";
import { configDotenv } from "dotenv";
import { connectDb } from "./config/db.js";
;

configDotenv();

const port = process.env.PORT || 8004;
const app = express();

app.use(express.json());


app.get("/", (req, res) => {
    res.json({ message: "AI service is up" });
});

app.get("/health", (req, res) => {
    res.status(200).json({ message: "AI service is running" });
});

app.listen(port, () => {
    connectDb();
    console.log(`ai service started at ${port}`);
});