import{ChatOpenRouter} from "@langchain/openrouter";

const model = new ChatOpenRouter({
    model:"deepseek/deepseek-chat";
    temperature: 0,
    maxTokens: 1024
});


export default llm