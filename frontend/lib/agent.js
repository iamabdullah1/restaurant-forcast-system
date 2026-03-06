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

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ToolMessage } from "@langchain/core/messages";
import { getMCPTools } from "./mcp-client.js";
import { chatPrompt } from "./prompts.js";
import { getChatHistory, addToMemory } from "./memory.js";

// ─── CREATE THE LLM ─────────────────────────────────────
/**
 * 🎓 ChatGoogleGenerativeAI — LangChain's Wrapper for Gemini (Google)
 *
 *    ChatGoogleGenerativeAI wraps Google's Gemini API.
 *    We use Gemini 2.0 Flash — fast, free tier, excellent tool calling.
 *
 *    Parameters:
 *    - model: "gemini-2.0-flash" — Google's fastest Gemini model
 *      (Options: "gemini-2.0-flash" = fast + free,
 *       "gemini-1.5-pro" = more powerful but slower)
 *
 *    - apiKey: from .env → GOOGLE_API_KEY
 *      Free API key from aistudio.google.com
 *      15 requests/min, 1500 requests/day — plenty for us.
 *
 *    - temperature: 0.3
 *      Controls randomness. 0 = deterministic, 1 = creative.
 *      0.3 = mostly consistent but slightly varied responses.
 *      For a data assistant, we want CONSISTENCY (low temperature).
 *      A creative writing bot would use 0.7–0.9.
 *
 * 🎓 WHY LAZY INITIALIZATION?
 *    We create the LLM inside a function (not at module level)
 *    because process.env.GOOGLE_API_KEY might not be available
 *    when the module first loads in Next.js. By creating it
 *    lazily (on first use), we ensure the env var is loaded.
 */
let llmInstance = null;

function getLLM() {
  if (!llmInstance) {
    llmInstance = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GOOGLE_API_KEY,
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
const MAX_TOOL_ITERATIONS = 10;

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
          content: typeof result === "string" ? result : JSON.stringify(result),
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
