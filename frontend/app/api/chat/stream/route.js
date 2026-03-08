/**
 * 🌊 Streaming Chat Endpoint — POST /api/chat/stream
 * ═══════════════════════════════════════════════════════
 *
 * 🎓 WHAT IS THIS?
 *    This is the STREAMING version of /api/chat.
 *    Instead of waiting for the full response and returning JSON,
 *    it keeps the connection open and sends events AS they happen.
 *
 *    /api/chat (Step 3.5):
 *      → Waits 5-30 seconds → returns { reply: "full text" }
 *      → User sees nothing until complete
 *
 *    /api/chat/stream (THIS FILE):
 *      → Immediately starts sending events:
 *        "🧠 Thinking..."
 *        "📦 Checking inventory..."
 *        "📦 Checking inventory ✅"
 *        "Based" " on" " the" " forecast" "," ...  ← word by word!
 *      → User sees live progress + typing effect
 *
 * 🎓 SSE (Server-Sent Events) — THE PROTOCOL:
 *    SSE is a simple HTTP standard for server → client streaming.
 *    The server sends lines that look like this:
 *
 *      data: {"type":"status","message":"🧠 Thinking..."}\n\n
 *      data: {"type":"tool_start","tool":"check_inventory"}\n\n
 *      data: {"type":"tool_end","tool":"check_inventory"}\n\n
 *      data: {"type":"token","content":"Based"}\n\n
 *      data: {"type":"token","content":" on"}\n\n
 *      data: {"type":"done","fullText":"Based on the forecast..."}\n\n
 *
 *    The browser reads these with EventSource or fetch().
 *    Each "data:" line is one event. "\n\n" marks the end of each event.
 *
 * 🎓 EVENT TYPES WE SEND:
 *    ┌──────────────┬──────────────────────────────────────────┐
 *    │ type         │ Meaning                                  │
 *    ├──────────────┼──────────────────────────────────────────┤
 *    │ "status"     │ General status update ("Thinking...")     │
 *    │ "tool_start" │ Tool execution began ("Checking stock...") │
 *    │ "tool_end"   │ Tool execution done ("Checking stock ✅")  │
 *    │ "token"      │ One word of the final response            │
 *    │ "done"       │ All complete — includes full text          │
 *    │ "error"      │ Something went wrong                      │
 *    └──────────────┴──────────────────────────────────────────┘
 *
 * 🎓 WHY A SEPARATE ROUTE?
 *    We keep /api/chat (non-streaming) for simplicity and testing.
 *    The frontend uses /api/chat/stream for the actual UI.
 *    Both call the same agent — just different output formats.
 */

import { runAgentStreaming } from "@/lib/agent.js";

export async function POST(request) {
  try {
    // ── PARSE & VALIDATE ──
    const { message, sessionId } = await request.json();

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

    console.log(
      `🌊 [${sessionId.slice(0, 8)}] Streaming: "${message.slice(0, 80)}${message.length > 80 ? "..." : ""}"`
    );

    // ── GET THE STREAM FROM THE AGENT ──
    /**
     * 🎓 runAgentStreaming() returns a ReadableStream
     *    that emits SSE events as the agent works.
     *    We pass it directly as the Response body.
     */
    const stream = runAgentStreaming(message.trim(), sessionId);

    // ── RETURN SSE RESPONSE ──
    /**
     * 🎓 THE RESPONSE HEADERS — Why Each One Matters:
     *
     *    Content-Type: text/event-stream
     *      → Tells the browser "this is SSE, read events from it"
     *      → Without this, the browser treats it as a regular download
     *
     *    Cache-Control: no-cache
     *      → Prevents caching of the stream
     *      → Each response is unique (different AI answer each time)
     *
     *    Connection: keep-alive
     *      → Tells proxies/load balancers to keep the connection open
     *      → Without this, some proxies close the connection after 30s
     *
     *    These 3 headers are the STANDARD SSE headers — every SSE
     *    endpoint uses them (ChatGPT, Claude, Gemini all do this).
     */
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("❌ /api/chat/stream error:", error);

    return Response.json(
      {
        error: "Something went wrong.",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
