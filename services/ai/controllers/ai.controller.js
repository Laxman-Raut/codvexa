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
        (recent.role == "user" || recent.role == "assistant"),
    )
    .map((msg) => {
      if (msg.role == "user") {
        return new HumanMessage(msg.content);
      } else {
        return new AIMessage(msg.content);
      }
    });
};

const sendEvent = (res, type, data) => {
  if (res.writableEnded || res.destroyed) {
    return false;
  }
  try {
    res.write(`event:${type}\n`);
    res.write(`data:${JSON.stringify(data || {})}\n\n`);
    return true;
  } catch (error) {
    console.error(`SSE error:${error}`);
    return false;
  }
};

const getErrorMessage = (error) => {
  if (error?.name === "GraphRecursionError") {
    return "The AI took too many steps. Try a smaller request.";
  }
  if (error?.status === 429) {
    return "Rate limit reached. Please try again in a moment.";
  }
  if (error?.status === 401 || error?.status === 403) {
    return "AI provider authentication failed. Check your API key.";
  }
  if (error?.status === 400) {
    return "The AI provider rejected the request.";
  }
  return error?.message || "Something went wrong";
};

export const chat = async (req, res) => {
  let desconected = false;
  const controller = new AbortController();

  try {
    const { projectId, message, history = [] } = req.body || {};
    const userId = req.headers["x-user-id"];

    if (!userId) {
      return res.status(401).json({
        message: "user id is not found",
      });
    }

    if (!projectId) {
      return res.status(400).json({
        message: "project id is not found",
      });
    }

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        message: "message is not found",
      });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("x-Accel-Buffering", "no");

    res.flushHeaders?.();

    res.once("close", () => {
      desconected = true;
      controller.abort();
      console.log("ai client desconected");
    });

    sendEvent(res, "start", {
      _success: true,
      message: "AI started",
    });

    const graphData = graph({ projectId, userId });
    const messages = buildHistory(history);
    messages.push(new HumanMessage(message.trim()));

    const stream = await graphData.stream(
      {
        messages,
      },
      {
        streamMode: "updates",
        recursionLimit: 40,
        signal: controller.signal,
      },
    );

    let finalMessage = "";

    for await (const chunk of stream) {
      if (desconected || res.writableEnded) break;

      if (chunk?.agent) {
        const agentMessages = chunk.agent?.messages || [];
        const last = agentMessages[agentMessages.length - 1];
        if (!last) {
          continue;
        }
        if (Array.isArray(last.tool_calls) && last.tool_calls?.length) {
          for (const call of last.tool_calls) {
            sendEvent(res, "tool_start", {
              tool: call.name,
              args: call.args || {},
            });
            continue;
          }
        }
        let content = "";
        if (typeof last.content == "string") {
          content = last.content;
        } else if (Array.isArray(last.content)) {
          content = last.content
            .filter((item) => item.type == "text")
            .map((item) => item.text)
            .join("");
        }
        if (content) {
          finalMessage = content;
          sendEvent(res, "message", { content });
        }
      }
      if (chunk.tools) {
        const toolMessages = chunk.tools?.messages || [];
        for (const toolMessage of toolMessages) {
          let result = null;

          try {
            result =
              typeof toolMessage.content == "string"
                ? JSON.parse(toolMessage.content)
                : toolMessage.content;
          } catch (error) {
            result = null;
          }

          if (result?.success === false) {
            sendEvent(res, "tool_error", {
              tool: toolMessage.name,
              error: result.error || "Tool failed",
            });
            continue;
          }

          if (result?.operation) {
            sendEvent(res, result.operation, result);
            continue;
          }

          sendEvent(res, "tool_result", {
            tool: toolMessage.name,
            content:
              typeof toolMessage.content == "string"
                ? toolMessage.content
                : JSON.stringify(toolMessage.content),
          });
        }
      }
    }

    if (!desconected) {
      sendEvent(res, "done", {
        success: true,
        message: finalMessage,
      });
    }
    return res.end();
  } catch (error) {
    // Client left on purpose, nothing to send
    if (desconected) {
      return res.end();
    }

    console.error("chat error:", error);

    const errorMessage = getErrorMessage(error);

    if (res.headersSent) {
      sendEvent(res, "error", {
        success: false,
        message: errorMessage,
      });
      return res.end();
    }

    return res.status(500).json({
      message: errorMessage,
    });
  }
};
