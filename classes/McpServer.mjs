// McpServer.mjs
import express from "express";
import { McpServer as SDKMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { CdpAutomation } from "./CdpAutomation.mjs";
import { InteractiveElementSelector } from "./InteractiveElementSelector.mjs";

export class McpServer {
  #cdpAutomation;
  #interactiveElementSelector;
  #sdkMcpServer;
  #expressApp;
  #port;
  #cdpEndpoint;
  #activeTransports = new Map();

  constructor(app, cdpEndpoint, port) {
    if (!app || !cdpEndpoint || !port) {
      throw new Error("app, cdpEndpoint, and port must be provided.");
    }
    this.#expressApp = app;
    this.#cdpEndpoint = cdpEndpoint;
    this.#port = port;
    this.#cdpAutomation = new CdpAutomation(this.#cdpEndpoint);
    this.#interactiveElementSelector = new InteractiveElementSelector(this.#cdpEndpoint);
    this.#sdkMcpServer = new SDKMcpServer({ name: "browser-automation-mcp-server", version: "1.1.0" });
    this.#registerTools();
    this.#setupExpressRoutes();
  }

  #registerTools() {
    // navigate
    this.#sdkMcpServer.tool("navigate", "Navigates to a URL.",
      { url: z.string().describe("The full URL to navigate to (e.g., 'https://google.com').") },
      async ({ url }) => {
        await this.#cdpAutomation.navigate(url);
        return { content: [{ type: "text", text: `Navigation on ${url} is initiated.` }] };
      }
    );

    // clickElementByNumber
    this.#sdkMcpServer.tool("clickElementByNumber", "Clicks an element by its number from the list.",
      { elementNumber: z.string().describe("The number of the element to click (e.g., '3').") },
      async ({ elementNumber }) => {
        const num = parseInt(elementNumber, 10);
        if (isNaN(num)) throw new Error("elementNumber must be a valid number string.");
        await this.#interactiveElementSelector.clickElementByNumber(num);
        return { content: [{ type: "text", text: `Clicking on element #${num} is done.` }] };
      }
    );

    // typeTextByNumber
    this.#sdkMcpServer.tool("typeTextByNumber", "Types text into an element by its number.",
      {
        elementNumber: z.string().describe("The number of the element to type into (e.g., '5')."),
        text: z.string().describe("The text to type."),
      },
      async ({ elementNumber, text }) => {
        const num = parseInt(elementNumber, 10);
        if (isNaN(num)) throw new Error("elementNumber must be a valid number string.");
        await this.#interactiveElementSelector.typeTextByNumber(num, text);
        return { content: [{ type: "text", text: `Text has been entered into element #${num}.` }] };
      }
    );
    
    // scrollPage
    this.#sdkMcpServer.tool("scrollPage", "Scrolls the page.",
      {
        direction: z.enum(['screenDown', 'screenUp', 'end', 'start']).describe("Scroll direction: 'screenDown' (one screen down), 'screenUp' (one screen up), 'end' (to the bottom), 'start' (to the top)."),
      },
      async ({ direction }) => {
          await this.#cdpAutomation.scrollPage(direction);
          return { content: [{ type: "text", text: `Page scrolled: ${direction}.` }] };
      }
    );

    // getCookies
    this.#sdkMcpServer.tool("getCookies", "Retrieves cookies.",
      { domain: z.string().describe("Domain to filter by. Use 'ALL' to get all cookies.") },
      async ({ domain }) => {
        const targetDomain = (domain && domain.toUpperCase() !== 'ALL') ? domain : null;
        const cookies = await this.#cdpAutomation.getCookiesCdp(targetDomain);
        return { content: [{ type: "text", text: JSON.stringify(cookies, null, 2) }] };
      }
    );
    
    // getLocalStorage
    this.#sdkMcpServer.tool("getLocalStorage", "Retrieves localStorage for the current page.",
      { scope: z.string().describe("Specify 'CURRENT' to get data for the current page. This parameter is required.") },
      async () => { // Параметр scope не используется, он нужен только для обхода бага
        const localStorageData = await this.#cdpAutomation.getLocalStorageCdp();
        return { content: [{ type: "text", text: JSON.stringify(localStorageData, null, 2) }] };
      }
    );

    // takeScreenshot
    this.#sdkMcpServer.tool("takeScreenshot", "Takes a screenshot.",
      {
        quality: z.string().describe("Image quality for jpeg/webp (0-100). E.g., '80'. Not used for PNG."),
      },
      async ({ quality }) => {
        const q = parseInt(quality, 10);
        const screenshot = await this.#cdpAutomation.takeScreenshotBase64('jpeg', isNaN(q) ? 80 : q);
        return { content: [{ type: "image", mimeType: `image/jpeg`, data: screenshot }] };
      }
    );

    // getPageOverview
    this.#sdkMcpServer.tool("getPageOverview", "Gets a comprehensive overview of the current page state.",
      {
        view: z.string().describe("Specify 'default' to get a standard view. This parameter is required."),
      },
      async () => {
        // Параметры для вызова внутренней функции можно оставить как есть (true),
        // т.к. этот инструмент всегда должен возвращать полную информацию.
        const observations = await this.#interactiveElementSelector.getPageOverview(true, true, true);
        return { content: [{ type: "text", text: observations }] };
      }
    );
    
    // getScrollableContainers
    this.#sdkMcpServer.tool("getScrollableContainers", "Finds all scrollable containers.",
        { filter: z.string().describe("A CSS selector to filter containers. Use 'ANY' to find all.") },
        async ({ filter }) => {
            const containers = await this.#interactiveElementSelector.getScrollableContainers(filter);
            return { content: [{ type: "text", text: JSON.stringify(containers, null, 2) }] };
        }
    );
    
    // getPageScrollStatus
    this.#sdkMcpServer.tool("getPageScrollStatus", "Gets the global page scroll status.",
        { scope: z.string().describe("Specify 'GLOBAL' to get the status. This parameter is required.") },
        async () => {
            const status = await this.#interactiveElementSelector.getPageScrollStatus();
            return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
        }
    );

    // pressKey
    this.#sdkMcpServer.tool("pressKey", "Simulates pressing a specified key on the keyboard.",
      {
        keyName: z.enum(['Enter', 'Escape']).describe("The name of the key to press: 'Enter' or 'Escape'. This parameter is required for tool call validation."),
      },
      async ({ keyName }) => {
        if (!['Enter', 'Escape'].includes(keyName)) {
            throw new Error("Invalid keyName. Must be 'Enter' or 'Escape'.");
        }
        await this.#cdpAutomation.pressKey(keyName);
        return { content: [{ type: "text", text: `${keyName} key pressed successfully.` }] };
      }
    );
  }

  // #setupExpressRoutes
  #setupExpressRoutes() {
    this.#expressApp.use(express.json());
    this.#expressApp.get("/", (req, res) => res.status(200).send("MCP Server is running."));

    this.#expressApp.get("/mcp", async (req, res) => {
      try {
        const transport = new SSEServerTransport("/messages", res);
        const sessionId = transport.sessionId;
        this.#activeTransports.set(sessionId, transport);
        transport.onclose = () => this.#activeTransports.delete(sessionId);
        await this.#sdkMcpServer.connect(transport);
        console.log(`Established SSE stream with session ID: ${sessionId}`);
      } catch (error) {
        console.error("Error establishing SSE stream:", error);
        if (!res.headersSent) res.status(500).send("SSE Error");
      }
    });

    this.#expressApp.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId;
      const transport = this.#activeTransports.get(sessionId);
      if (!sessionId || !transport) {
        return res.status(404).send("Session not found");
      }

      if (req.body?.method === "function_call" && req.body?.params?.call?.function && req.body.params.call.function.arguments === undefined) {
        req.body.params.call.function.arguments = "{}";
        console.log(`[${sessionId}] Patched incoming function_call: added missing 'arguments' field for tool '${req.body.params.call.function.name}'.`);
      }

      if (req.body?.method === "function_call" && typeof req.body?.params?.call?.function?.arguments === 'string') {
          try {
              req.body.params.call.function.arguments = JSON.parse(req.body.params.call.function.arguments);
          } catch(e) {
              console.error(`[${sessionId}] Failed to parse arguments string for tool '${req.body.params.call.function.name}'.`);
              return res.status(400).send("Invalid arguments JSON string.");
          }
      }

      try {
        await transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        console.error("Error handling request:", error);
        if (!res.headersSent) res.status(500).send("Request handling error");
      }
    });
  }

  async start() {
    return new Promise((resolve) => {
      this.#expressApp.listen(this.#port, () => {
        console.log(`✅ MCP SSE Server listening on http://localhost:${this.#port}`);
        resolve();
      });
    });
  }

  async stop() {
    console.log(`🛑 Stopping MCP Server on port ${this.#port}...`);
    for (const transport of this.#activeTransports.values()) {
      await transport.close();
    }
    console.log("Server shutdown complete.");
  }
}