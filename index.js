// index.js
import express from "express";
import { McpServer } from "./classes/McpServer.mjs";

// Define your CDP endpoint
// Теперь читаем CDP_ENDPOINT из переменной окружения, или используем значение по умолчанию
const CDP_ENDPOINT = process.env.CDP_ENDPOINT || "http://localhost:9223";
const MCP_SERVER_PORT = process.env.MCP_SERVER_PORT
  ? parseInt(process.env.MCP_SERVER_PORT)
  : 3000;

// Main function to start the MCP server
async function startMcpServer() {
  const app = express();
  const mcpServer = new McpServer(app, CDP_ENDPOINT, MCP_SERVER_PORT);

  try {
    await mcpServer.start();
    console.log(
      "MCP Server is running via SDK on HTTP. You can now send HTTP requests to interact with the browser."
    );
    console.log(`CDP Endpoint in use: ${CDP_ENDPOINT}`);
    console.log(`MCP Server Port: ${MCP_SERVER_PORT}`);
  } catch (error) {
    console.error("Failed to start MCP Server:", error.message);
    process.exit(1);
  }
}

// Start the MCP Server
startMcpServer();

// Handle server shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down server...");
  console.log("Server shutdown complete");
  process.exit(0);
});
