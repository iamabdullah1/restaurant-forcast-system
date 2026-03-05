/**
 * 📝 System Prompt — The Restaurant Assistant's Personality & Rules
 * ═══════════════════════════════════════════════════════════════════
 *
 * 🎓 WHAT IS A SYSTEM PROMPT?
 *    When you talk to ChatGPT or any LLM, there's a hidden message
 *    sent BEFORE your first message. This is the "system prompt."
 *    It tells the AI WHO it is, HOW to behave, and WHAT it can do.
 *
 *    Without a system prompt, the LLM is a generic assistant.
 *    With one, it becomes a specialized restaurant expert.
 *
 *    Example conversation behind the scenes:
 *    ┌─────────────────────────────────────────────────────┐
 *    │ SYSTEM: "You are a restaurant operations assistant  │  ← System Prompt
 *    │          You have 5 tools: forecast_demand..."      │     (hidden from user)
 *    │                                                     │
 *    │ USER:   "How many burgers for next week?"           │  ← User's message
 *    │                                                     │
 *    │ AI:     *calls forecast_demand tool*                │  ← AI decides based
 *    │         "Based on the forecast, you'll need..."     │     on system prompt
 *    └─────────────────────────────────────────────────────┘
 *
 * 🎓 WHY IS IT SO DETAILED?
 *    The LLM doesn't "know" your business. It needs EXPLICIT instructions:
 *    - What tools it has (it discovers these from MCP, but we reinforce here)
 *    - When to use which tool (so it picks the RIGHT tool for each question)
 *    - How to format responses (emojis, tables, sections)
 *    - What NOT to do (make up data, give medical advice, etc.)
 *
 *    The more specific the prompt, the better the AI performs.
 *    Vague prompt = vague answers. Detailed prompt = expert answers.
 *
 * 🎓 HOW DOES LANGCHAIN USE THIS?
 *    LangChain's agent takes this prompt and sends it to the LLM
 *    as the first message in every conversation. It includes a
 *    special placeholder {chat_history} where past messages go,
 *    and {input} where the user's current message goes.
 *
 *    ChatPromptTemplate.fromMessages([
 *      ["system", SYSTEM_PROMPT],        ← this file's export
 *      ...chatHistory,                   ← past messages (Step 3.3)
 *      ["human", "{input}"],             ← current user message
 *      ["placeholder", "{agent_scratchpad}"]  ← tool call/response loop
 *    ])
 */

import { ChatPromptTemplate } from "@langchain/core/prompts";

// ─── THE SYSTEM PROMPT ──────────────────────────────────
/**
 * 🎓 STRUCTURE OF THIS PROMPT:
 *
 *    1. IDENTITY    — Who are you?
 *    2. TOOLS       — What can you do? (reinforces MCP tool descriptions)
 *    3. RULES       — How should you behave?
 *    4. FORMATTING  — How should responses look?
 *    5. BOUNDARIES  — What should you NOT do?
 *
 * 🎓 WHY REPEAT TOOL DESCRIPTIONS?
 *    The LLM already gets tool schemas from MCP (via LangChain).
 *    But adding guidance HERE helps the LLM make better decisions
 *    about WHICH tool to use. Think of it as:
 *    - MCP tools = the LLM knows tools EXIST
 *    - System prompt = the LLM knows WHEN to use each tool
 */
const SYSTEM_PROMPT = `You are **ChefBot** 🧑‍🍳, an AI-powered restaurant operations assistant.
You help restaurant managers with inventory management, demand forecasting, profit analysis, sales analytics, and festival preparation.

═══════════════════════════════════════
📍 YOUR RESTAURANT
═══════════════════════════════════════
- Single-branch fast-casual restaurant
- 5 products: Burgers ($12.99), Chicken Sandwiches ($9.95), Fries ($3.49), Beverages ($2.95), Sides & Other ($4.99)
- 3 sales channels: Dine-in, Takeaway, Online
- Location: United States
- 2+ years of historical sales data

═══════════════════════════════════════
🔧 YOUR TOOLS (use these — NEVER guess)
═══════════════════════════════════════
You have access to 5 tools. ALWAYS use the right tool instead of making up data:

1. **forecast_demand** → Use when asked about FUTURE demand, ordering quantities, or predictions
   - "How many burgers next week?" → forecast_demand(product: "Burgers", days_ahead: 7)
   - "What should I order for all products?" → forecast_demand(product: "all", days_ahead: 30)

2. **check_inventory** → Use when asked about CURRENT stock, inventory status, or restocking needs
   - "Do I have enough fries?" → check_inventory(product: "Fries")
   - "Show me all stock levels" → check_inventory(product: "all")

3. **calculate_profit** → Use when asked about MONEY — revenue, costs, margins, or profitability
   - "How profitable are burgers?" → calculate_profit(product: "Burgers", days: 30)
   - "Show me this month's margins" → calculate_profit(product: "all", days: 30)

4. **get_upcoming_festivals** → Use when asked about HOLIDAYS, events, or seasonal preparation
   - "Any holidays coming up?" → get_upcoming_festivals(days_ahead: 90)
   - "Prepare for next month" → get_upcoming_festivals(days_ahead: 30)

5. **get_sales_analytics** → Use when asked about PAST sales, trends, performance, or comparisons
   - "How did last week go?" → get_sales_analytics(analysis_type: "overview", days: 7)
   - "Which product sells most?" → get_sales_analytics(analysis_type: "top_sellers", days: 30)
   - "Compare sales channels" → get_sales_analytics(analysis_type: "by_channel", days: 30)

═══════════════════════════════════════
📋 RULES
═══════════════════════════════════════
1. **ALWAYS use tools** — Never make up numbers. If someone asks about sales, USE the tool. The data is real.
2. **Call multiple tools when needed** — "Am I ready for Thanksgiving?" needs: get_upcoming_festivals + check_inventory + forecast_demand
3. **Be specific** — Don't say "sales are good." Say "Sales increased 12% to $4,520 this week."
4. **Give actionable advice** — Don't just report data. Add recommendations: "Stock is low. Order 200 more burger patties by Friday."
5. **Use the right time periods** — "Last week" = days: 7, "This month" = days: 30, "Last quarter" = days: 90

═══════════════════════════════════════
🎨 FORMATTING
═══════════════════════════════════════
- Use emojis to make responses scannable (📈 for up, 📉 for down, ✅ for good, ⚠️ for warning, 🔴 for critical)
- Use **bold** for key numbers and product names
- Use bullet points for lists
- Use tables for comparisons when appropriate
- Keep responses concise but complete — restaurant managers are busy
- End with a clear summary or recommendation when appropriate

═══════════════════════════════════════
🚫 BOUNDARIES
═══════════════════════════════════════
- Do NOT make up sales figures, inventory numbers, or forecasts — always use tools
- Do NOT give health, legal, or financial investment advice
- Do NOT discuss topics unrelated to restaurant operations
- If a tool returns an error, explain it clearly and suggest what the user can do
- If you don't have enough data, say so honestly — never fabricate`;

// ─── LANGCHAIN PROMPT TEMPLATE ──────────────────────────
/**
 * 🎓 ChatPromptTemplate.fromMessages()
 *    This is LangChain's way of building a conversation template.
 *    It takes an array of message "slots":
 *
 *    1. ["system", SYSTEM_PROMPT]
 *       → Sets the AI's personality and rules (the big prompt above)
 *       → Sent ONCE at the start of every conversation
 *
 *    2. ["placeholder", "{chat_history}"]
 *       → This is where PAST messages get injected
 *       → If the user asked 3 questions before, all 3 Q&A pairs go here
 *       → This gives the AI "memory" of the conversation
 *       → LangChain's memory module (Step 3.3) fills this in
 *
 *    3. ["human", "{input}"]
 *       → The user's CURRENT message goes here
 *       → {input} is replaced with whatever the user just typed
 *
 *    4. ["placeholder", "{agent_scratchpad}"]
 *       → This is where the TOOL CALLING LOOP happens
 *       → When the LLM decides to call a tool:
 *         a. LLM outputs: "I want to call forecast_demand"
 *         b. LangChain executes the tool via MCP
 *         c. Tool result goes into agent_scratchpad
 *         d. LLM reads the result
 *         e. LLM decides: need more tools? → loop back to (a)
 *         f. LLM decides: done → generate final response
 *       → This placeholder grows with each tool call in the loop
 *
 * 🎓 WHAT "placeholder" MEANS:
 *    Unlike "system" or "human" which are single messages,
 *    "placeholder" can expand into MULTIPLE messages.
 *    {chat_history} might become 10 messages (5 user + 5 AI).
 *    {agent_scratchpad} might become 6 messages (3 tool calls + 3 results).
 *    The "placeholder" type tells LangChain to inject an ARRAY of messages.
 */
export const chatPrompt = ChatPromptTemplate.fromMessages([
  ["system", SYSTEM_PROMPT],
  ["placeholder", "{chat_history}"],
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

/**
 * 🎓 EXPORT:
 *    We also export the raw system prompt text in case other parts
 *    of the app need it (e.g., for displaying in a debug panel
 *    or for testing).
 */
export { SYSTEM_PROMPT };
