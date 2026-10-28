import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { graph } from "../graph/graph.js";

const buildHistory = (history) => {
    if (!Array.isArray(history)) {
        return [];
    }

    const recents = history.slice(-6);

    return recents
        .filter(
            (recent) =>
                recent?.content &&
                (recent.role == "user" || recent.role == "assistant")
        )
        .map((msg) => {
            if (msg.role == "user") {
                return new HumanMessage(msg.content);
            } else {
                return new AIMessage(msg.content);
            }
        });
};

export const chat = async (req, res) => {
    try {
        const { projectId, message, history = [] } = req.body;
        const userId = req.headers["x-user-id"];

        if (!projectId) {
            return res.status(400).json({
                message: "project id is not found"
            });
        }

        if (!message) {
            return res.status(400).json({
                message: "message is not found"
            });
        }
       res.setHeader(
"Content-Type",
"text/event-stream; charset=utf-8"
);
res.setHeader(
"Cache-Control",
"no-cache, no-transform"
);
res.setHeader(
"Connection",
"keep-alive"
);
res.setHeader(
    "x-Accel-Buffering",
    "no"
        );

        res.flushHeaders()

        const graphData =  graph({ projectId, userId });
        const messages= buildHistory(history)
        message.push(
            new HumanMessage(message.trim())
        )
    } catch (error) {
        return res.status(500).json({
            message: error.message || "Something went wrong"
        });
    }
};