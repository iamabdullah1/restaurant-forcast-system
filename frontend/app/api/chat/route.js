/**
 * 🌐 Chat API Endpoint — POST /api/chat
 * ═══════════════════════════════════════
 *
 * 🎓 WHAT IS A NEXT.JS API ROUTE?
 *    Next.js lets you create backend API endpoints inside the `app/` folder.
 *    Any file named `route.js` inside `app/api/...` becomes an HTTP endpoint.
 *
 *    File:     app/api/chat/route.js
 *    URL:      POST http://localhost:3000/api/chat
 *
 *    This is a SERVERLESS function — it runs on the server, not in the browser.
 *    The frontend (React) sends HTTP requests to this endpoint.
 *    This endpoint runs the LangChain agent and returns the response.
 *
 * 🎓 WHY AN API ROUTE?
 *    We can't run the LangChain agent in the browser because:
 *    1. API keys (XAI_API_KEY) must stay on the server (security)
 *    2. MCP Server runs as a child process (needs Node.js, not a browser)
 *    3. MongoDB connection happens server-side
 *
 *    So the flow is:
 *    ┌─────────────┐    HTTP POST     ┌────────────────┐
 *    │  Browser     │ ──────────────► │  /api/chat      │
 *    │  (React UI)  │                 │  (this file)    │
 *    │              │ ◄────────────── │  runs agent     │
 *    │  shows reply │    JSON response│  → MCP → tools  │
 *    └─────────────┘                  └────────────────┘
 *
 * 🎓 THE REQUEST/RESPONSE FORMAT:
 *
 *    REQUEST (from frontend):
 *    POST /api/chat
 *    Content-Type: application/json
 *    {
 *      "message": "How many burgers next week?",
 *      "sessionId": "abc-123-def"
 *    }
 *
 *    RESPONSE (from this endpoint):
 *    200 OK
 *    Content-Type: application/json
 *    {
 *      "reply": "Based on the forecast, you'll need ~342 burgers...",
 *      "sessionId": "abc-123-def"
 *    }
 *
 *    ERROR RESPONSE:
 *    500 Internal Server Error
 *    {
 *      "error": "Something went wrong",
 *      "details": "Connection to MCP Server failed"
 *    }
 */

import { runAgent } from "@/lib/agent.js";
import { clearSession, getActiveSessionCount } from "@/lib/memory.js";

// ─── POST HANDLER ───────────────────────────────────────
/**
 * 🎓 export async function POST(request)
 *
 *    In Next.js App Router, you export a function named after
 *    the HTTP method you want to handle:
 *    - export function GET()  → handles GET requests
 *    - export function POST() → handles POST requests
 *    - export function PUT()  → handles PUT requests
 *
 *    We use POST because we're SENDING data (user message) to
 *    the server. GET is for retrieving data without a body.
 *
 *    The `request` parameter is a standard Web API Request object:
 *    https://developer.mozilla.org/en-US/docs/Web/API/Request
 *
 *    Next.js passes it automatically — you just read from it.
 */
export async function POST(request) {
  try {
    // ── STEP 1: PARSE THE REQUEST BODY ──
    /**
     * 🎓 request.json()
     *    Reads the HTTP request body and parses it as JSON.
     *    This is a standard Web API method (not Next.js specific).
     *
     *    The frontend sends:
     *    { "message": "How many burgers?", "sessionId": "abc-123" }
     *
     *    We destructure it into two variables.
     */
    const { message, sessionId } = await request.json();

    // ── STEP 2: VALIDATE INPUT ──
    /**
     * 🎓 INPUT VALIDATION — Always Validate User Input!
     *
     *    Never trust data from the client. The message could be:
     *    - Empty string
     *    - null/undefined
     *    - Missing entirely
     *
     *    We check for both required fields and return a clear
     *    error message if they're missing.
     *
     *    400 = "Bad Request" — the client sent invalid data.
     *    (vs 500 = "Server Error" — our code broke)
     */
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return Response.json(
        { error: "Message is required and must be a non-empty string." },
        { status: 400 }
      );
    }

    if (!sessionId || typeof sessionId !== "string") {
      return Response.json(
        { error: "sessionId is required." },
        { status: 400 }
      );
    }

    // ── STEP 3: RUN THE AGENT ──
    /**
     * 🎓 runAgent() — from Step 3.4
     *
     *    This is where the magic happens. runAgent():
     *    1. Gets MCP tools (Step 3.1)
     *    2. Builds the prompt with memory (Steps 3.2 + 3.3)
     *    3. Runs the agent loop (Step 3.4)
     *       - Grok reads message → decides tools → calls via MCP
     *       - MCP Server executes → returns data
     *       - Grok reads data → maybe calls more tools → loop
     *       - Grok generates final answer
     *    4. Saves Q&A to memory (Step 3.3)
     *    5. Returns the final text
     *
     *    All of that happens in this one await call.
     *    The API route just passes the message and sessionId.
     */
    console.log(
      `💬 [${sessionId.slice(0, 8)}] User: "${message.slice(0, 80)}${message.length > 80 ? "..." : ""}"`
    );

    const reply = await runAgent(message.trim(), sessionId);

    console.log(
      `🤖 [${sessionId.slice(0, 8)}] ChefBot: "${reply.slice(0, 80)}${reply.length > 80 ? "..." : ""}"`
    );

    // ── STEP 4: RETURN THE RESPONSE ──
    /**
     * 🎓 Response.json()
     *    Creates an HTTP response with JSON content type.
     *    This is the standard Web API way to return JSON.
     *
     *    The frontend receives:
     *    { reply: "Based on forecast...", sessionId: "abc-123" }
     *
     *    We also include the sessionId so the frontend can
     *    confirm which session the response belongs to.
     */
    return Response.json({
      reply,
      sessionId,
    });
  } catch (error) {
    // ── ERROR HANDLING ──
    /**
     * 🎓 WHY CATCH ALL ERRORS?
     *    Many things can go wrong:
     *    - MCP Server fails to start
     *    - MongoDB connection timeout
     *    - Grok API rate limit
     *    - ML Service is down
     *
     *    Instead of crashing the server, we catch the error and
     *    return a friendly 500 response. The frontend can show
     *    a "Something went wrong" message to the user.
     *
     *    We log the full error on the server (for debugging)
     *    but only send a generic message to the client
     *    (for security — never expose internal errors to users).
     */
    console.error("❌ /api/chat error:", error);

    return Response.json(
      {
        error: "Something went wrong processing your request.",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// ─── DELETE HANDLER — Clear Session ─────────────────────
/**
 * 🎓 DELETE /api/chat?sessionId=abc-123
 *
 *    Clears the conversation memory for a session.
 *    Called when the user clicks "New Conversation" in the UI.
 *
 *    We use DELETE because we're REMOVING data (the session's history).
 *    REST convention:
 *    - POST = create/send
 *    - GET = read
 *    - PUT = update
 *    - DELETE = remove
 */
export async function DELETE(request) {
  try {
    /**
     * 🎓 request.nextUrl.searchParams
     *    For DELETE requests, we use query parameters instead of a body.
     *    URL: DELETE /api/chat?sessionId=abc-123
     *
     *    nextUrl is a Next.js extension of the standard URL object.
     *    searchParams lets us read query string parameters.
     */
    const { searchParams } = request.nextUrl;
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return Response.json(
        { error: "sessionId query parameter is required." },
        { status: 400 }
      );
    }

    clearSession(sessionId);

    return Response.json({
      success: true,
      message: "Session cleared.",
      activeSessions: getActiveSessionCount(),
    });
  } catch (error) {
    console.error("❌ DELETE /api/chat error:", error);
    return Response.json(
      { error: "Failed to clear session." },
      { status: 500 }
    );
  }
}
