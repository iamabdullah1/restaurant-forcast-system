/**
 * 🔌 MCP Client Bridge — Connects LangChain to our MCP Server
 * ═══════════════════════════════════════════════════════════════
 *
 * 🎓 WHAT THIS FILE DOES:
 *    This is the BRIDGE between LangChain (the orchestrator) and our
 *    MCP Server (the tool executor). It does 4 things:
 *
 *    1. SPAWNS the MCP Server as a child process (via STDIO transport)
 *    2. DISCOVERS all 5 tools from the MCP Server automatically
 *    3. CONVERTS MCP tools into LangChain-compatible tools
 *    4. EXPORTS them so the LangChain agent can use them
 *
 * 🎓 WHY STDIO TRANSPORT?
 *    Our MCP Server communicates via stdin/stdout (JSON-RPC messages).
 *    This is the same way Claude Desktop connects to it.
 *    The StdioClientTransport spawns the MCP Server as a child process
 *    and pipes JSON messages through stdin/stdout.
 *
 *    ┌──────────────┐   stdin/stdout    ┌───────────────┐
 *    │  MCP Client  │◄════════════════►│  MCP Server    │
 *    │  (this file) │   JSON-RPC        │  (child proc)  │
 *    └──────────────┘                   └───────────────┘
 *
 * 🎓 WHY SINGLETON PATTERN?
 *    Opening a connection to the MCP Server is expensive (spawns a
 *    process, connects to MongoDB inside it, etc.). We don't want to
 *    do this on EVERY API request. Instead, we create ONE connection
 *    and REUSE it across all requests. The `globalThis` trick keeps
 *    the instance alive even when Next.js hot-reloads in dev mode.
 *
 * 🎓 WHY JSON SCHEMA → ZOD CONVERSION?
 *    MCP tools describe their inputs using JSON Schema (the standard).
 *    LangChain tools need Zod schemas (a TypeScript/JS validation lib).
 *    We convert one to the other so LangChain's agent can understand
 *    what arguments each tool expects.
 *
 * 🎓 THE FLOW:
 *    getMCPTools()
 *      → creates MCP Client (if not already)
 *      → spawns MCP Server child process
 *      → client.listTools() → gets 5 tool definitions
 *      → converts each to DynamicStructuredTool
 *      → returns LangChain-compatible tool array
 *      → LangChain agent passes these to the LLM
 *      → LLM decides which to call
 *      → LangChain invokes the tool's func()
 *      → func() calls client.callTool() → MCP Server executes
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import path from "path";

// ─── SINGLETON STORAGE ──────────────────────────────────
/**
 * 🎓 WHY globalThis?
 *    In Next.js dev mode, modules get re-imported on every hot reload.
 *    Normal module-level variables (like `let client = null`) get RESET.
 *    But `globalThis` persists across hot reloads because it's the
 *    actual Node.js global object — it survives module re-evaluation.
 *
 *    Without this: every code change → new MCP Server spawn → memory leak
 *    With this:    hot reload → reuses existing connection → clean
 */
const globalForMCP = globalThis;

// ─── JSON SCHEMA → ZOD CONVERTER ────────────────────────
/**
 * 🎓 WHAT IS JSON SCHEMA?
 *    A standard format to describe data structures. Example:
 *    {
 *      "type": "object",
 *      "properties": {
 *        "product": { "type": "string", "enum": ["Burgers", "Fries"] },
 *        "days":    { "type": "number", "minimum": 1, "maximum": 90 }
 *      },
 *      "required": ["product"]
 *    }
 *
 * 🎓 WHAT IS ZOD?
 *    A JS library that does the same thing but in code:
 *    z.object({
 *      product: z.enum(["Burgers", "Fries"]),
 *      days: z.number().min(1).max(90).optional()
 *    })
 *
 * 🎓 WHY CONVERT?
 *    MCP Server defines tool inputs as JSON Schema (MCP standard).
 *    LangChain expects Zod schemas (JS ecosystem standard).
 *    This function translates between the two.
 *
 *    It handles the types our 5 tools use:
 *    - string (with optional enum list)
 *    - number (with optional min/max)
 *    - boolean
 *    - default values
 *    - required vs optional fields
 */
function jsonSchemaPropertyToZod(prop, isRequired) {
  let zodField;

  switch (prop.type) {
    case "string":
      // If enum is defined → z.enum(["Burgers", "Fries", ...])
      // Otherwise → z.string()
      if (prop.enum && prop.enum.length > 0) {
        zodField = z.enum(prop.enum);
      } else {
        zodField = z.string();
      }
      break;

    case "number":
    case "integer":
      zodField = z.number();
      // Apply min/max constraints if present
      if (prop.minimum !== undefined) zodField = zodField.min(prop.minimum);
      if (prop.maximum !== undefined) zodField = zodField.max(prop.maximum);
      break;

    case "boolean":
      zodField = z.boolean();
      break;

    default:
      // Fallback: accept anything (shouldn't happen with our tools)
      zodField = z.any();
  }

  // Add description (LLM reads this to understand the parameter)
  if (prop.description) {
    zodField = zodField.describe(prop.description);
  }

  // Apply default value if defined in the schema
  if (prop.default !== undefined) {
    zodField = zodField.default(prop.default);
  }

  // Make optional if NOT in the required array
  if (!isRequired) {
    zodField = zodField.optional();
  }

  return zodField;
}

/**
 * Convert a full JSON Schema object → Zod object schema
 *
 * 🎓 EXAMPLE INPUT (from MCP Server's forecast_demand tool):
 *    {
 *      type: "object",
 *      properties: {
 *        product:    { type: "string", enum: [...], description: "..." },
 *        days_ahead: { type: "number", min: 1, max: 90, default: 30, description: "..." }
 *      },
 *      required: ["product"]
 *    }
 *
 * 🎓 EXAMPLE OUTPUT:
 *    z.object({
 *      product:    z.enum([...]).describe("..."),
 *      days_ahead: z.number().min(1).max(90).default(30).describe("...").optional()
 *    })
 */
function jsonSchemaToZod(schema) {
  // Safety check: if no properties defined, return empty object schema
  if (!schema || !schema.properties) {
    return z.object({});
  }

  const requiredFields = schema.required || [];
  const shape = {};

  for (const [key, prop] of Object.entries(schema.properties)) {
    const isRequired = requiredFields.includes(key);
    shape[key] = jsonSchemaPropertyToZod(prop, isRequired);
  }

  return z.object(shape);
}

// ─── MCP TOOL → LANGCHAIN TOOL WRAPPER ──────────────────
/**
 * 🎓 WHAT THIS DOES:
 *    Takes ONE MCP tool definition and wraps it as a LangChain
 *    DynamicStructuredTool. The wrapper:
 *
 *    1. Keeps the same name + description (LLM sees these)
 *    2. Converts the JSON Schema → Zod (LLM uses for arguments)
 *    3. Creates a func() that forwards calls to the MCP Server
 *
 * 🎓 WHAT IS DynamicStructuredTool?
 *    A LangChain class that represents a tool the LLM can call.
 *    "Dynamic" = we create it at runtime (not hardcoded)
 *    "Structured" = it takes an OBJECT of named parameters
 *                   (not just a single string input)
 *
 *    When the LLM decides to call "forecast_demand", LangChain:
 *    1. Validates the args against the Zod schema
 *    2. Calls our func() with the validated args
 *    3. Our func() forwards to MCP Server via client.callTool()
 *    4. MCP Server executes the real logic
 *    5. Result comes back as text → LLM reads it
 *
 * @param {object} mcpTool - Tool from client.listTools()
 *   { name, description, inputSchema }
 * @param {Client} client - Connected MCP Client instance
 * @returns {DynamicStructuredTool} - LangChain-compatible tool
 */
function wrapMCPToolForLangChain(mcpTool, client) {
  return new DynamicStructuredTool({
    name: mcpTool.name,
    description: mcpTool.description,
    schema: jsonSchemaToZod(mcpTool.inputSchema),

    // This function runs when the LLM decides to call this tool
    func: async (input) => {
      try {
        /**
         * 🎓 client.callTool() — THE KEY MCP CALL
         *
         *    This sends a JSON-RPC message to the MCP Server:
         *    {
         *      "jsonrpc": "2.0",
         *      "method": "tools/call",
         *      "params": {
         *        "name": "forecast_demand",
         *        "arguments": { "product": "Burgers", "days_ahead": 30 }
         *      }
         *    }
         *
         *    The MCP Server receives this, looks up the tool handler,
         *    executes it (queries MongoDB, calls ML service, etc.),
         *    and sends back:
         *    {
         *      "jsonrpc": "2.0",
         *      "result": {
         *        "content": [{ "type": "text", "text": "{...JSON data...}" }]
         *      }
         *    }
         */
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: input,
        });

        // MCP returns content as an array of {type, text} blocks
        // We join them into a single string for LangChain
        const text = result.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");

        return text || "Tool returned no text content.";
      } catch (error) {
        // Return error as text (not throw) so the LLM can read it
        // and decide what to tell the user
        return `Error calling ${mcpTool.name}: ${error.message}`;
      }
    },
  });
}

// ─── MAIN EXPORT: getMCPTools() ─────────────────────────
/**
 * 🎓 THE MAIN FUNCTION — Called by the LangChain agent
 *
 *    Returns an array of LangChain tools that are backed by the MCP Server.
 *    Uses singleton pattern: first call creates the connection,
 *    subsequent calls reuse it.
 *
 * 🎓 THE FULL CHAIN:
 *    API Request → getMCPTools() → [5 LangChain tools]
 *                                       │
 *                                  passed to Agent
 *                                       │
 *                                  LLM decides which
 *                                       │
 *                                  tool.func(args)
 *                                       │
 *                                  client.callTool()
 *                                       │
 *                                  MCP Server executes
 *                                       │
 *                                  result → LLM reads
 *
 * @returns {Promise<DynamicStructuredTool[]>} Array of 5 LangChain tools
 */
export async function getMCPTools() {
  // ── RETURN CACHED TOOLS IF ALREADY INITIALIZED ──
  if (globalForMCP._mcpTools && globalForMCP._mcpTools.length > 0) {
    return globalForMCP._mcpTools;
  }

  console.log("🔌 Initializing MCP Client — connecting to MCP Server...");

  // ── STEP 1: CREATE MCP CLIENT ──
  /**
   * 🎓 The Client class is the MCP SDK's way to connect to an MCP Server.
   *    "name" identifies this client during the MCP handshake.
   *    The server logs this so you know WHO is connected.
   */
  const client = new Client({
    name: "restaurant-dashboard",
    version: "1.0.0",
  });

  // ── STEP 2: CREATE STDIO TRANSPORT ──
  /**
   * 🎓 StdioClientTransport — HOW we connect to the MCP Server
   *
   *    This spawns the MCP Server as a CHILD PROCESS:
   *      command: "node"
   *      args: ["src/index.js"]
   *      cwd: "../mcp-server"  (where the server code lives)
   *
   *    Communication happens via stdin/stdout pipes:
   *      Client writes JSON → Server's stdin
   *      Server writes JSON → Client reads from stdout
   *
   *    The `env` option passes environment variables to the child process.
   *    We spread process.env so the MCP Server inherits everything,
   *    including MONGODB_URI, ML_SERVICE_URL, etc.
   *
   *    🎓 WHY path.resolve?
   *       `process.cwd()` in Next.js is the `frontend/` directory.
   *       Our MCP Server is at `../mcp-server/`.
   *       path.resolve converts this to an absolute path so Node.js
   *       can find the server code regardless of where we run from.
   */
  const mcpServerPath = path.resolve(process.cwd(), "..", "mcp-server");

  const transport = new StdioClientTransport({
    command: "node",
    args: ["src/index.js"],
    cwd: mcpServerPath,
    env: {
      ...process.env, // Inherit all env vars (MONGODB_URI, etc.)
    },
  });

  // ── STEP 3: CONNECT TO MCP SERVER ──
  /**
   * 🎓 client.connect(transport)
   *    This does the MCP HANDSHAKE:
   *    1. Client sends "initialize" request with its capabilities
   *    2. Server responds with its capabilities + name + version
   *    3. Client sends "initialized" notification
   *    4. Connection is ready — we can list tools, call tools, etc.
   *
   *    After this, the MCP Server child process is running with
   *    MongoDB connected and all 5 tools registered.
   */
  await client.connect(transport);
  console.log("✅ MCP Client connected to MCP Server");

  // ── STEP 4: DISCOVER TOOLS FROM MCP SERVER ──
  /**
   * 🎓 client.listTools()
   *    Sends a "tools/list" request to the MCP Server.
   *    The server responds with ALL registered tools:
   *
   *    {
   *      tools: [
   *        {
   *          name: "forecast_demand",
   *          description: "Predict demand for a product...",
   *          inputSchema: {
   *            type: "object",
   *            properties: {
   *              product: { type: "string", enum: [...] },
   *              days_ahead: { type: "number", ... }
   *            }
   *          }
   *        },
   *        { name: "check_inventory", ... },
   *        { name: "calculate_profit", ... },
   *        { name: "get_upcoming_festivals", ... },
   *        { name: "get_sales_analytics", ... }
   *      ]
   *    }
   *
   *    These are the SAME tools defined in mcp-server/src/index.js.
   *    We didn't hardcode them here — we DISCOVERED them from the server.
   *    If someone adds a 6th tool to the MCP Server, our dashboard
   *    automatically picks it up. Zero duplication!
   */
  const { tools: mcpTools } = await client.listTools();
  console.log(`🔧 Discovered ${mcpTools.length} tools from MCP Server:`);
  mcpTools.forEach((t) => console.log(`   - ${t.name}`));

  // ── STEP 5: CONVERT MCP TOOLS → LANGCHAIN TOOLS ──
  /**
   * 🎓 For each MCP tool, we create a LangChain DynamicStructuredTool.
   *    The wrapper:
   *    - Keeps the same name + description (LLM uses these to decide)
   *    - Converts JSON Schema → Zod (LLM needs this for arguments)
   *    - Creates a func() that forwards calls to MCP Server
   *
   *    The result is an array of 5 LangChain tools that are
   *    BACKED BY the MCP Server. LangChain thinks they're normal
   *    tools, but every call goes through MCP.
   */
  const langchainTools = mcpTools.map((mcpTool) =>
    wrapMCPToolForLangChain(mcpTool, client)
  );

  // ── CACHE IN GLOBAL (singleton) ──
  globalForMCP._mcpClient = client;
  globalForMCP._mcpTools = langchainTools;

  console.log("✅ MCP tools wrapped for LangChain — ready for agent");

  return langchainTools;
}

// ─── CLEANUP FUNCTION ───────────────────────────────────
/**
 * 🎓 Call this when the Next.js server shuts down.
 *    Closes the MCP Client connection and kills the child process.
 *    Without this, the MCP Server child process would become a
 *    "zombie process" running in the background.
 */
export async function closeMCPClient() {
  if (globalForMCP._mcpClient) {
    console.log("🛑 Closing MCP Client connection...");
    await globalForMCP._mcpClient.close();
    globalForMCP._mcpClient = null;
    globalForMCP._mcpTools = null;
    console.log("✅ MCP Client closed");
  }
}
