import dns from "dns";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express from "express";
import { configDotenv } from "dotenv";
import { connectDb } from "./config/db.js";
import router from "./routes/file.route.js";

configDotenv();

const port = process.env.PORT || 8003;
const app = express();

app.use(express.json());


app.get("/", (req, res) => {
    res.json({ message: "file service is up" });
});
app.use("/",router)
app.get("/health", (req, res) => {
    res.status(200).json({ message: "file service is running" });
});

app.listen(port, () => {
    connectDb();
    console.log(`file service started at ${port}`);
});