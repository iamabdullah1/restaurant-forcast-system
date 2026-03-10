/**
 * 🤖 Agent Executor — The Brain That Ties Everything Together
 * ════════════════════════════════════════════════════════════
 *
 * 🎓 WHAT IS AN AGENT?
 *    An "agent" is an LLM that can USE TOOLS. Instead of just
 *    generating text, it can DECIDE to call functions and use
 *    the results to build a better answer.
 *
 *    Regular LLM:
 *      User: "How many burgers next week?"
 *      LLM:  "I don't have access to your data." ← useless
 *
 *    Agent (LLM + Tools):
 *      User: "How many burgers next week?"
 *      LLM:  *thinks* "I should call forecast_demand"
 *      LLM:  *calls tool* → gets {total_predicted: 342}
 *      LLM:  "Based on the forecast, you'll need ~342 burgers." ← useful!
 *
 * 🎓 WHAT THIS FILE DOES:
 *    Wires together the 3 pieces we built in Steps 3.1–3.3:
 *
 *    ┌─────────────────────────────────────────────────────┐
 *    │  Step 3.1: MCP Client     → 5 tools (from MCP Server)  │
 *    │  Step 3.2: System Prompt  → ChefBot personality         │
 *    │  Step 3.3: Chat Memory    → conversation history        │
 *    │                                                         │
 *    │  Step 3.4: THIS FILE      → combines all three + LLM   │
 *    │            into an AGENT that can:                      │
 *    │            1. Read user message                         │
 *    │            2. Decide which tools to call                │
 *    │            3. Call tools (via MCP)                      │
 *    │            4. Read results                              │
 *    │            5. Decide if more tools needed               │
 *    │            6. Generate final response                   │
 *    └─────────────────────────────────────────────────────┘
 *
 * 🎓 THE AGENT LOOP (Most Important Concept):
 *
 *    This is a LOOP, not a single call. The LLM can call multiple
 *    tools in sequence before giving a final answer:
 *
 *    ┌──────────────────────────────────────────────────┐
 *    │                                                  │
 *    │  ① Send messages to LLM                          │
 *    │     (system prompt + history + user message)     │
 *    │                 │                                │
 *    │                 ▼                                │
 *    │  ② LLM responds                                 │
 *    │     ├── Has tool_calls? ──YES──┐                 │
 *    │     │                          │                 │
 *    │     │                    ③ Execute each tool     │
 *    │     │                      (via MCP Server)      │
 *    │     │                          │                 │
 *    │     │                    ④ Add results to        │
 *    │     │                      messages              │
 *    │     │                          │                 │
 *    │     │                    ⑤ Go back to ①  ◄──────┘
 *    │     │                                            │
 *    │     └── No tool_calls? ──► ⑥ Return text        │
 *    │                               (final answer)     │
 *    │                                                  │
 *    └──────────────────────────────────────────────────┘
 *
 *    Example: "Am I ready for Thanksgiving?"
 *    Loop 1: LLM calls get_upcoming_festivals → gets dates
 *    Loop 2: LLM calls check_inventory → gets stock levels
 *    Loop 3: LLM calls forecast_demand → gets predictions
 *    Loop 4: LLM has all data → generates final answer (no more tools)
 *
 * 🎓 WHY NOT USE AgentExecutor?
 *    Older LangChain versions had a class called AgentExecutor
 *    that did this loop for you. But the modern approach is to
 *    build the loop explicitly — it's simpler, more transparent,
 *    and you understand exactly what's happening. LangChain's
 *    own docs now recommend this approach.
 */

import { ChatGroq } from "@langchain/groq";
import { ToolMessage } from "@langchain/core/messages";
import { getMCPTools } from "./mcp-client.js";
import { chatPrompt } from "./prompts.js";
import { getChatHistory, addToMemory } from "./memory.js";

// ─── CREATE THE LLM ─────────────────────────────────────
/**
 * 🎓 ChatGroq — LangChain's Wrapper for Groq
 *
 *    Groq runs open-source LLMs on custom LPU (Language Processing Unit)
 *    hardware — making them BLAZING FAST (often 10x faster than GPU APIs).
 *
 *    We use Llama 3.3 70B Versatile — an excellent open-source model from Meta
 *    that rivals GPT-4 on many benchmarks, especially tool calling.
 *
 *    Parameters:
 *    - model: "llama-3.3-70b-versatile" — Meta's best open-source model
 *      (Options: "llama-3.3-70b-versatile" = best quality,
 *       "llama-3.1-8b-instant" = faster but less capable)
 *
 *    - apiKey: from .env → GROQ_API_KEY
 *      Free API key from console.groq.com
 *      30 requests/min, 14,400 requests/day — very generous!
 *
 *    - temperature: 0.3
 *      Controls randomness. 0 = deterministic, 1 = creative.
 *      0.3 = mostly consistent but slightly varied responses.
 *      For a data assistant, we want CONSISTENCY (low temperature).
 *
 * 🎓 WHY LAZY INITIALIZATION?
 *    We create the LLM inside a function (not at module level)
 *    because process.env.GROQ_API_KEY might not be available
 *    when the module first loads in Next.js. By creating it
 *    lazily (on first use), we ensure the env var is loaded.
 */
let llmInstance = null;

function getLLM() {
  if (!llmInstance) {
    llmInstance = new ChatGroq({
      model: "llama-3.1-8b-instant",
      apiKey: process.env.GROQ_API_KEY,
      temperature: 0.3,
    });
  }
  return llmInstance;
}

// ─── THE AGENT LOOP ─────────────────────────────────────
/**
 * 🎓 MAX_TOOL_ITERATIONS — Safety Limit
 *
 *    What if the LLM gets stuck in a loop, calling tools forever?
 *    This limit stops it after 10 rounds. In practice, most
 *    questions need 1–3 tool calls. 10 is a generous safety net.
 *
 *    "Am I ready for Thanksgiving?" → 3 tool calls
 *    "Check burger stock" → 1 tool call
 *    "Give me a full weekly review" → 4–5 tool calls
 */
const MAX_TOOL_ITERATIONS = 5;

/**
 * Run the agent: take a user message, let the LLM decide which
 * tools to call, execute them via MCP, and return the final answer.
 *
 * 🎓 STEP-BY-STEP WALKTHROUGH:
 *
 *    1. Load tools from MCP Server (or cache)
 *    2. Bind tools to the LLM (so the LLM knows what's available)
 *    3. Build the prompt (system + history + current message)
 *    4. Enter the LOOP:
 *       a. Send prompt to LLM
 *       b. If LLM wants to call tools → execute them → loop
 *       c. If LLM is done → return the text response
 *    5. Save the Q&A pair to memory
 *
 * @param {string} userMessage - What the user typed
 * @param {string} sessionId - Unique session identifier
 * @returns {Promise<string>} - ChefBot's final response text
 */
export async function runAgent(userMessage, sessionId) {
  // ── STEP 1: GET MCP TOOLS ──
  /**
   * 🎓 getMCPTools() returns the 5 LangChain-wrapped tools
   *    from Step 3.1. On first call, it spawns the MCP Server
   *    and discovers tools. On subsequent calls, returns cached.
   */
  const tools = await getMCPTools();

  // ── STEP 2: BIND TOOLS TO LLM ──
  /**
   * 🎓 bindTools() — CRITICAL METHOD
   *
   *    This tells the LLM "here are tools you can use."
   *    Internally, it converts our LangChain tools into the format
   *    the xAI API expects (OpenAI-compatible function calling format):
   *
   *    {
   *      "tools": [
   *        {
   *          "type": "function",
   *          "function": {
   *            "name": "forecast_demand",
   *            "description": "Predict demand...",
   *            "parameters": { ... JSON Schema ... }
   *          }
   *        },
   *        ... 4 more tools
   *      ]
   *    }
   *
   *    The LLM reads these descriptions and decides which to call
   *    based on the user's question. The LLM was TRAINED to understand
   *    function calling — it knows how to pick tools and format args.
   */
  const llm = getLLM();
  const llmWithTools = llm.bindTools(tools);

  // ── STEP 3: BUILD THE PROMPT ──
  /**
   * 🎓 chatPrompt.formatMessages()
   *
   *    Takes our prompt template (from Step 3.2) and fills in
   *    the placeholders:
   *
   *    ["system", SYSTEM_PROMPT]           → ChefBot personality
   *    ["placeholder", "{chat_history}"]   → past messages from Step 3.3
   *    ["human", "{input}"]               → user's current message
   *    ["placeholder", "{agent_scratchpad}"] → empty for now (fills during loop)
   *
   *    The result is an array of Message objects ready to send to the LLM.
   */
  const chatHistory = await getChatHistory(sessionId);

  const messages = await chatPrompt.formatMessages({
    input: userMessage,
    chat_history: chatHistory,
    agent_scratchpad: [], // Starts empty, grows during tool loop
  });

  // ── STEP 4: THE AGENT LOOP ──
  /**
   * 🎓 HOW THE LOOP WORKS:
   *
   *    `messages` is an array that GROWS with each iteration:
   *
   *    Iteration 0 (initial):
   *      [SystemMessage, ...history, HumanMessage("How many burgers?")]
   *
   *    LLM responds with tool_call: forecast_demand({product: "Burgers"})
   *
   *    Iteration 1 (after tool call):
   *      [...previous, AIMessage(tool_calls), ToolMessage(result)]
   *         ↑ LLM's decision to call   ↑ The tool's output
   *
   *    LLM sees the result, decides it's done, responds with text.
   *
   *    Final: return "Based on the forecast, you'll need ~342 burgers."
   */
  let lastToolSignature = ""; // Track duplicate tool calls
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    // Send all messages to the LLM
    const response = await llmWithTools.invoke(messages);

    // ── CHECK: Does the LLM want to call tools? ──
    /**
     * 🎓 response.tool_calls
     *
     *    When the LLM decides to use a tool, it doesn't return text.
     *    Instead, it returns a special message with `tool_calls`:
     *
     *    {
     *      content: "",  ← empty or partial text
     *      tool_calls: [
     *        {
     *          id: "call_abc123",
     *          name: "forecast_demand",
     *          args: { product: "Burgers", days_ahead: 7 }
     *        }
     *      ]
     *    }
     *
     *    The LLM can request MULTIPLE tools in one response
     *    (parallel tool calling). We execute all of them.
     */
    if (!response.tool_calls || response.tool_calls.length === 0) {
      // ── NO TOOL CALLS → LLM is done, return the text ──
      /**
       * 🎓 This is the EXIT POINT of the loop.
       *    The LLM has all the data it needs and generated a
       *    final text response. We save to memory and return.
       */
      const finalText = response.content;

      // Save this Q&A pair to memory for future context
      await addToMemory(sessionId, userMessage, finalText);

      return finalText;
    }

    // ── TOOL CALLS FOUND → Execute each one ──
    /**
     * 🎓 We add the LLM's response to messages FIRST.
     *    This is important! The LLM needs to see its OWN
     *    tool_call decision in the history, followed by the
     *    tool results. The conversation looks like:
     *
     *    [...messages, AIMessage(tool_calls), ToolMessage(result1), ToolMessage(result2), ...]
     *
     *    Then on the next loop, the LLM sees everything and
     *    can decide what to do next.
     */

    // Detect duplicate tool calls (same tool + same args twice in a row)
    const currentSignature = JSON.stringify(
      response.tool_calls.map((tc) => ({ name: tc.name, args: tc.args }))
    );
    if (currentSignature === lastToolSignature) {
      console.error("⚠️  Duplicate tool call detected, forcing text response...");
      messages.push(response);
      for (const toolCall of response.tool_calls) {
        messages.push(
          new ToolMessage({
            content: "Already retrieved. Please use the data above to answer the user's question now.",
            tool_call_id: toolCall.id,
            name: toolCall.name,
          })
        );
      }
      const forcedResponse = await llm.invoke(messages);
      const finalText = forcedResponse.content;
      await addToMemory(sessionId, userMessage, finalText);
      return finalText;
    }
    lastToolSignature = currentSignature;

    messages.push(response);

    // Execute each tool call and collect results
    for (const toolCall of response.tool_calls) {
      /**
       * 🎓 FINDING THE RIGHT TOOL:
       *    The LLM says "call forecast_demand". We need to find
       *    the matching tool object from our tools array to
       *    actually execute it.
       */
      const tool = tools.find((t) => t.name === toolCall.name);

      let result;
      if (tool) {
        try {
          /**
           * 🎓 tool.invoke(args)
           *    This calls the DynamicStructuredTool's func() from
           *    Step 3.1, which calls client.callTool() on the MCP
           *    Server. The MCP Server executes the real handler
           *    (MongoDB query, ML service call, etc.) and returns
           *    the result as text.
           *
           *    The chain: tool.invoke() → MCP Client → MCP Server → handler
           */
          result = await tool.invoke(toolCall.args);
        } catch (error) {
          result = `Error executing ${toolCall.name}: ${error.message}`;
        }
      } else {
        result = `Tool "${toolCall.name}" not found.`;
      }

      /**
       * 🎓 ToolMessage — Special Message Type
       *
       *    After executing a tool, we create a ToolMessage that
       *    links the result back to the specific tool_call via
       *    tool_call_id. This is how the LLM knows which result
       *    belongs to which tool call (important when multiple
       *    tools are called in parallel).
       *
       *    {
       *      content: "{...forecast data JSON...}",
       *      tool_call_id: "call_abc123",  ← matches the tool_call above
       *      name: "forecast_demand"
       *    }
       */
      messages.push(
        new ToolMessage({
          content: summarizeToolResult(toolCall.name, typeof result === "string" ? result : JSON.stringify(result)),
          tool_call_id: toolCall.id,
          name: toolCall.name,
        })
      );
    }

    // Loop back to ① — send updated messages to LLM
    // The LLM will see its tool_calls + the results
    // and decide: need more tools? or generate final answer?
  }

  // ── SAFETY: Max iterations reached ──
  /**
   * 🎓 If we get here, the LLM called tools 10 times without
   *    giving a final answer. This should never happen in practice.
   *    We return a graceful message instead of crashing.
   */
  const fallbackMsg =
    "I apologize, but I'm having difficulty processing your request. " +
    "Could you try rephrasing your question?";

  await addToMemory(sessionId, userMessage, fallbackMsg);
  return fallbackMsg;
}

// ─── TOOL RESULT SUMMARIZER ─────────────────────────────
/**
 * 🎓 summarizeToolResult — Compact tool output for LLM context
 *
 *    MCP tools return HUGE JSON (14 forecast rows = ~3000 tokens).
 *    The LLM doesn't need every row — it needs the SUMMARY to:
 *    1. Write a good text answer for the user
 *    2. Decide whether to call create_chart (and know the field names)
 *
 *    The FULL data is already sent to the frontend via SSE "tool_end".
 *    This function creates a compact version for the LLM's context window.
 *
 *    Why? Groq free tier = 6,000 TPM. A 14-day forecast uses ~3000 tokens.
 *    System prompt + tools = ~2500 tokens. 3000 + 2500 = 5500 → barely fits.
 *    Two tool calls? 6000+ → rate limit error! 💥
 *
 * @param {string} toolName - Which tool produced this result
 * @param {string} fullResult - The full JSON string
 * @returns {string} - Compact JSON string safe for LLM context
 */
function summarizeToolResult(toolName, fullResult) {
  try {
    const data = JSON.parse(fullResult);

    switch (toolName) {
      case "forecast_demand": {
        // Keep metadata + summary + profit_projection + first 2 days + field names hint
        const summary = {
          metadata: data.metadata,
          summary: data.summary,
          profit_projection: data.profit_projection,
          daily_forecast_sample: [
            ...(data.daily_forecast?.slice(0, 2) || []),
            ...(data.daily_forecast?.slice(-1) || []),
          ],
          _chart_hint: `Full daily_forecast has ${data.daily_forecast?.length || 0} rows. Fields: ${
            data.daily_forecast?.[0] ? Object.keys(data.daily_forecast[0]).join(", ") : "N/A"
          }. Call create_chart(source_tool="forecast_demand", chart_type="line", x_field="date", y_field="predicted_quantity", data_path="daily_forecast") to visualize.`,
        };
        return JSON.stringify(summary);
      }

      case "get_sales_analytics": {
        const innerData = data.data;
        const sample = Array.isArray(innerData) ? innerData.slice(0, 3) : innerData;
        const summary = {
          analysis_type: data.analysis_type,
          period: data.period,
          data_sample: sample,
          total_rows: Array.isArray(innerData) ? innerData.length : 1,
          _chart_hint: Array.isArray(innerData) && innerData[0]
            ? `Fields: ${Object.keys(innerData[0]).join(", ")}. Call create_chart(source_tool="get_sales_analytics", data_path="data") to visualize.`
            : "",
        };
        return JSON.stringify(summary);
      }

      case "calculate_profit": {
        const summary = {
          period: data.period,
          product_filter: data.product_filter,
          totals: data.totals,
          insights: data.insights,
          product_breakdown: data.product_breakdown,
          _chart_hint: data.product_breakdown
            ? `Call create_chart(source_tool="calculate_profit", chart_type="bar", x_field="product", y_field="gross_profit", data_path="product_breakdown") to visualize.`
            : "",
        };
        // Strip trend data if present (can be huge)
        if (data.trend) {
          summary.trend_rows = data.trend.length;
        }
        return JSON.stringify(summary);
      }

      case "check_inventory":
      case "create_chart":
      case "get_upcoming_festivals":
        // These are already small, keep as-is
        return fullResult;

      default:
        if (fullResult.length > 2000) {
          return fullResult.slice(0, 2000) + "...(truncated)";
        }
        return fullResult;
    }
  } catch {
    if (fullResult.length > 2000) {
      return fullResult.slice(0, 2000) + "...(truncated)";
    }
    return fullResult;
  }
}

// ─── STREAMING VERSION OF THE AGENT ─────────────────────
/**
 * 🎓 WHAT IS STREAMING?
 *    In the non-streaming version (runAgent above), the user
 *    waits for the ENTIRE response — all tool calls + final
 *    answer — before seeing anything. This can take 5-30 seconds.
 *
 *    With streaming, we send LIVE UPDATES as things happen:
 *
 *    Non-streaming (bad UX):
 *    ┌──────────────────────────────────────────┐
 *    │ User: "Am I ready for Thanksgiving?"      │
 *    │                                           │
 *    │ [........... 15 seconds of nothing ......] │
 *    │                                           │
 *    │ AI: "Here's your full report: ..."        │  ← all at once
 *    └──────────────────────────────────────────┘
 *
 *    Streaming (great UX):
 *    ┌──────────────────────────────────────────┐
 *    │ User: "Am I ready for Thanksgiving?"      │
 *    │                                           │
 *    │ 🔧 Checking upcoming festivals...         │  ← instant feedback
 *    │ 🔧 Checking inventory levels...           │  ← 2 sec later
 *    │ 🔧 Forecasting demand...                  │  ← 4 sec later
 *    │ Here's your Thanksgiving prep report:     │  ← word
 *    │ Here's your Thanksgiving prep report: 🧡  │  ← by
 *    │ Here's your Thanksgiving prep report: 🧡  │  ← word
 *    │ Thanksgiving is in 22 days...             │  ← typing effect!
 *    └──────────────────────────────────────────┘
 *
 * 🎓 HOW SSE (Server-Sent Events) WORKS:
 *    SSE is a web standard where the server keeps an HTTP connection
 *    open and pushes events to the client one at a time:
 *
 *    Server sends:
 *      data: {"type":"tool_start","tool":"forecast_demand"}\n\n
 *      data: {"type":"tool_end","tool":"forecast_demand"}\n\n
 *      data: {"type":"token","content":"Based"}\n\n
 *      data: {"type":"token","content":" on"}\n\n
 *      data: {"type":"token","content":" the"}\n\n
 *      data: {"type":"done","fullText":"Based on the forecast..."}\n\n
 *
 *    Client receives each event as it arrives → updates UI instantly.
 *
 * 🎓 READABLE STREAM:
 *    We use a Web API ReadableStream to push SSE events.
 *    The stream stays open while the agent works, sends events
 *    as things happen, and closes when the agent is done.
 *
 *    This is how ChatGPT, Claude, and Gemini do their typing effect.
 *
 * @param {string} userMessage - What the user typed
 * @param {string} sessionId - Unique session identifier
 * @returns {ReadableStream} - SSE event stream
 */
export function runAgentStreaming(userMessage, sessionId) {
  /**
   * 🎓 ReadableStream — A Web API for streaming data
   *
   *    The `start(controller)` function runs when the stream begins.
   *    We use `controller.enqueue()` to push data chunks to the client.
   *    We use `controller.close()` when we're done.
   *
   *    Each chunk is an SSE-formatted string: "data: {...json...}\n\n"
   *    The double newline (\n\n) tells the browser "this event is complete."
   */
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      /**
       * 🎓 HELPER: Send an SSE event to the client
       *    Formats the data as an SSE message and pushes it to the stream.
       *    SSE format: "data: {json}\n\n"
       */
      function sendEvent(data) {
        const sseMessage = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(sseMessage));
      }

      try {
        // ── Same setup as runAgent ──
        const tools = await getMCPTools();
        const llm = getLLM();
        const llmWithTools = llm.bindTools(tools);
        const chatHistory = await getChatHistory(sessionId);

        const messages = await chatPrompt.formatMessages({
          input: userMessage,
          chat_history: chatHistory,
          agent_scratchpad: [],
        });

        // Tell the client we're starting
        sendEvent({ type: "status", message: "🧠 Thinking..." });

        let fullText = "";
        let lastToolSignature = ""; // Track duplicate tool calls

        // ── THE AGENT LOOP (same logic, but with events) ──
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          const response = await llmWithTools.invoke(messages);

          if (!response.tool_calls || response.tool_calls.length === 0) {
            // ── FINAL RESPONSE — Stream it word by word ──
            /**
             * 🎓 WHY SPLIT INTO WORDS?
             *    The LLM returns the full text at once (since tool
             *    calling doesn't support token-level streaming easily).
             *    We split it into words and send them with tiny delays
             *    to create a natural typing effect.
             *
             *    Real token streaming (like ChatGPT) streams from the
             *    LLM API itself. Our approach simulates it — the visual
             *    effect is the same for the user.
             */
            fullText = response.content;

            // Split into small chunks (words) for typing effect
            const words = fullText.split(" ");
            for (let w = 0; w < words.length; w++) {
              const chunk = w === 0 ? words[w] : " " + words[w];
              sendEvent({ type: "token", content: chunk });
            }

            // Send completion event with full text
            sendEvent({ type: "done", fullText });

            // Save to memory
            await addToMemory(sessionId, userMessage, fullText);

            controller.close();
            return;
          }

          // ── TOOL CALLS — Send status updates ──
          /**
           * 🎓 DUPLICATE TOOL CALL DETECTION:
           *    Some models (especially Llama) can get stuck calling
           *    the same tool repeatedly. We detect this by comparing
           *    the current tool call "signature" (name + args) with
           *    the previous one. If they match, we force the LLM to
           *    generate a text response by re-invoking WITHOUT tools.
           */
          const currentSignature = JSON.stringify(
            response.tool_calls.map((tc) => ({ name: tc.name, args: tc.args }))
          );

          if (currentSignature === lastToolSignature) {
            console.error("⚠️  Duplicate tool call detected, forcing text response...");
            // Re-invoke the LLM WITHOUT tools to force a text answer
            messages.push(response);
            for (const toolCall of response.tool_calls) {
              messages.push(
                new ToolMessage({
                  content: "Already retrieved. Please use the data above to answer the user's question now.",
                  tool_call_id: toolCall.id,
                  name: toolCall.name,
                })
              );
            }
            const forcedResponse = await llm.invoke(messages);
            fullText = forcedResponse.content;
            const words = fullText.split(" ");
            for (let w = 0; w < words.length; w++) {
              const chunk = w === 0 ? words[w] : " " + words[w];
              sendEvent({ type: "token", content: chunk });
            }
            sendEvent({ type: "done", fullText });
            await addToMemory(sessionId, userMessage, fullText);
            controller.close();
            return;
          }
          lastToolSignature = currentSignature;

          messages.push(response);

          for (const toolCall of response.tool_calls) {
            /**
             * 🎓 TOOL STATUS EVENTS
             *    We send "tool_start" when a tool begins executing,
             *    and "tool_end" when it finishes. The frontend can
             *    show a "Checking inventory..." indicator.
             *
             *    Friendly names make the UI nicer than raw tool names:
             *    "forecast_demand" → "📈 Forecasting demand..."
             */
            const friendlyNames = {
              forecast_demand: "📈 Forecasting demand",
              check_inventory: "📦 Checking inventory",
              calculate_profit: "💰 Calculating profits",
              get_upcoming_festivals: "🎉 Checking festivals",
              get_sales_analytics: "📊 Analyzing sales",
              create_chart: "📊 Creating chart",
            };

            const friendlyName =
              friendlyNames[toolCall.name] || `🔧 Running ${toolCall.name}`;

            sendEvent({
              type: "tool_start",
              tool: toolCall.name,
              message: `${friendlyName}...`,
            });

            const tool = tools.find((t) => t.name === toolCall.name);
            let result;

            if (tool) {
              try {
                result = await tool.invoke(toolCall.args);
              } catch (error) {
                result = `Error executing ${toolCall.name}: ${error.message}`;
              }
            } else {
              result = `Tool "${toolCall.name}" not found.`;
            }

            sendEvent({
              type: "tool_end",
              tool: toolCall.name,
              message: `${friendlyName} ✅`,
              data: typeof result === "string" ? result : JSON.stringify(result),
            });

            /**
             * 🎓 TOKEN-SAVING: SUMMARIZE TOOL RESULTS FOR THE LLM
             *
             *    The raw tool output (e.g., 14 rows of daily forecast) can be
             *    2000-4000 tokens. The LLM doesn't need all that detail — it
             *    just needs the SUMMARY to write a good answer and decide
             *    whether to call create_chart.
             *
             *    But the FRONTEND needs the full data (for chart rendering).
             *    So we:
             *    1. Send FULL data → SSE "tool_end" event (above) → frontend
             *    2. Send COMPACT summary → ToolMessage → LLM context
             *
             *    This keeps the LLM within token limits (Groq free tier = 6000 TPM)
             *    while still giving the frontend everything it needs.
             */
            const fullResult = typeof result === "string" ? result : JSON.stringify(result);
            const compactResult = summarizeToolResult(toolCall.name, fullResult);

            messages.push(
              new ToolMessage({
                content: compactResult,
                tool_call_id: toolCall.id,
                name: toolCall.name,
              })
            );
          }

          // Send status update between iterations
          sendEvent({ type: "status", message: "🧠 Processing results..." });
        }

        // Max iterations fallback
        const fallbackMsg =
          "I apologize, but I'm having difficulty processing your request. " +
          "Could you try rephrasing your question?";
        sendEvent({ type: "token", content: fallbackMsg });
        sendEvent({ type: "done", fullText: fallbackMsg });
        await addToMemory(sessionId, userMessage, fallbackMsg);
        controller.close();
      } catch (error) {
        // Log the FULL error server-side so we can debug
        console.error("❌ runAgentStreaming error:", error);
        // Send error event to the client
        sendEvent({
          type: "error",
          message: "Something went wrong. Please try again.",
          details: error.message,
        });
        controller.close();
      }
    },
  });

  return stream;
}
