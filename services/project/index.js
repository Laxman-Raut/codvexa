import dns from "dns";

dns.setServers(["8.8.8.8", "8.8.4.4"]);
import express from "express";

import { configDotenv } from "dotenv";
import { connectDb } from "./config/db.js";
import router from "./routes/project.route.js";

configDotenv();

const port = process.env.PORT || 8002;
const app = express();

app.use(express.json());

app.use("/",router)

app.get("/", (req, res) => {
    res.json({ message: " project service is up" });
}); 

app.get("/health", (req, res) => {
    res.status(200).json({ message: "project service  is running" });
});

app.listen(port, () => {
    connectDb()
    console.log(`project service started at ${port}`);
});