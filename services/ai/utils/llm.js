import "dotenv/config";
import { ChatOpenRouter } from "@langchain/openrouter";

const llm = new ChatOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: "deepseek/deepseek-chat",
  temperature: 0,
  maxTokens: 8192,
});

export default llm;
