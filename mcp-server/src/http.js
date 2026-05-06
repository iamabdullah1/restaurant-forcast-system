import http from "http";
import { URL } from "url";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import { handleGetUpcomingFestivals } from "./tools/festivals.js";
import { handleCheckInventory } from "./tools/inventory.js";
import { handleGetSalesAnalytics } from "./tools/analytics.js";
import { handleCalculateProfit } from "./tools/profit.js";
import { handleForecastDemand } from "./tools/forecast.js";
import { handleCreateChart } from "./tools/chart.js";

const toolHandlers = {
  forecast_demand: handleForecastDemand,
  check_inventory: handleCheckInventory,
  calculate_profit: handleCalculateProfit,
  get_upcoming_festivals: handleGetUpcomingFestivals,
  get_sales_analytics: handleGetSalesAnalytics,
  create_chart: handleCreateChart,
};

const DEFAULT_BODY_LIMIT = 1024 * 1024; // 1MB

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function parseBody(req, limit = DEFAULT_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function unwrapToolResponse(result) {
  const text = result?.content?.[0]?.text;
  if (!text || typeof text !== "string") return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

const transports = new Map();

export function startHttpServer(mcpServer) {
  const port = Number(process.env.MCP_HTTP_PORT || process.env.PORT || 3333);

  const server = http.createServer(async (req, res) => {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname || "/";

    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, { status: "ok" });
    }

    // ─── NEW: MCP STANDARD SSE TRANSPORT ────────────────────
    if (mcpServer) {
      if (pathname === "/mcp/sse") {
        const transport = new SSEServerTransport("/mcp/messages", res);
        await mcpServer.connect(transport);
        transports.set(transport.sessionId, transport);
        transport.onclose = () => {
          transports.delete(transport.sessionId);
        };
        await transport.start();
        return;
      }

      if (pathname === "/mcp/messages" && req.method === "POST") {
        const sessionId = url.searchParams.get("sessionId");
        const transport = transports.get(sessionId);
        if (!transport) {
          return sendJson(res, 404, { error: "Session not found" });
        }
        await transport.handlePostMessage(req, res);
        return;
      }
    }

    if (req.method === "GET" && pathname === "/tools") {
      return sendJson(res, 200, { tools: Object.keys(toolHandlers) });
    }

    if (req.method === "POST" && pathname.startsWith("/tool/")) {
      const toolName = pathname.replace("/tool/", "").trim();
      const handler = toolHandlers[toolName];
      if (!handler) {
        return sendJson(res, 404, { error: `Unknown tool: ${toolName}` });
      }

      let body = {};
      try {
        body = await parseBody(req);
      } catch (error) {
        return sendJson(res, 400, { error: "Invalid JSON body" });
      }

      try {
        const result = await handler(body || {});
        const payload = unwrapToolResponse(result);
        const status = result?.isError ? 400 : 200;
        return sendJson(res, status, payload);
      } catch (error) {
        return sendJson(res, 500, { error: error.message || "Tool execution failed" });
      }
    }

    return sendJson(res, 404, { error: "Not found" });
  });

  server.listen(port, "0.0.0.0", () => {
    console.error(`🌐 MCP HTTP API listening on port ${port}`);
    console.error("   REST API: GET /health, GET /tools, POST /tool/:name");
    console.error("   MCP SSE:  GET /mcp/sse (client connects here)");
  });

  return server;
}