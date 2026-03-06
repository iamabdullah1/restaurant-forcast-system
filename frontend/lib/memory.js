/**
 * 🧠 Chat Memory — Gives ChefBot Conversation Context
 * ═════════════════════════════════════════════════════
 *
 * 🎓 WHAT IS CHAT MEMORY?
 *    LLMs are STATELESS — each API call is independent.
 *    If you ask "How many burgers?" and then "What about fries?",
 *    the LLM has NO idea you were talking about forecasting.
 *
 *    Without memory:
 *    ┌────────────────────────────────────────────────────┐
 *    │ User: "How many burgers will I need next week?"    │
 *    │ AI:   "Based on forecast, ~342 burgers."           │
 *    │                                                    │
 *    │ User: "What about fries?"                          │
 *    │ AI:   "I don't know what you're asking about."  ❌ │  ← No context!
 *    └────────────────────────────────────────────────────┘
 *
 *    With memory:
 *    ┌────────────────────────────────────────────────────┐
 *    │ User: "How many burgers will I need next week?"    │
 *    │ AI:   "Based on forecast, ~342 burgers."           │
 *    │                                                    │
 *    │ User: "What about fries?"                          │
 *    │ AI:   "For fries next week, ~580 units."        ✅ │  ← Remembers!
 *    └────────────────────────────────────────────────────┘
 *
 *    Memory works by replaying the ENTIRE conversation to the LLM
 *    every time. When "What about fries?" is asked, the LLM sees:
 *
 *    [system prompt]
 *    [human: "How many burgers will I need next week?"]
 *    [ai: "Based on forecast, ~342 burgers."]
 *    [human: "What about fries?"]                        ← Current message
 *
 *    Now the LLM understands "fries" means "forecast fries for next week."
 *
 * 🎓 WHY PER-SESSION MEMORY?
 *    Different users (or different browser tabs) should have
 *    SEPARATE conversation histories. If User A asks about burgers
 *    and User B asks about profit, their memories shouldn't mix.
 *
 *    We use a SESSION ID to keep conversations separate:
 *    - sessionId "abc123" → memory for User A (burger conversation)
 *    - sessionId "xyz789" → memory for User B (profit conversation)
 *
 * 🎓 HOW LANGCHAIN MEMORY WORKS:
 *    LangChain provides ChatMessageHistory — a simple list that stores
 *    HumanMessage and AIMessage objects in order. Each session gets its
 *    own ChatMessageHistory instance.
 *
 *    When the agent runs:
 *    1. Agent reads chat_history from the session's memory
 *    2. Injects all past messages into the prompt (the {chat_history} slot)
 *    3. LLM sees full conversation → understands context
 *    4. LLM responds → new message pair saved to memory
 *    5. Next question → repeat from step 1 with longer history
 */

import { ChatMessageHistory } from "@langchain/core/chat_history";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

// ─── SESSION STORE ──────────────────────────────────────
/**
 * 🎓 Map<string, ChatMessageHistory>
 *
 *    A JavaScript Map where:
 *    - KEY:   sessionId (string, like "abc123")
 *    - VALUE: ChatMessageHistory (LangChain's message list)
 *
 *    Why Map instead of a plain object {}?
 *    - Map is designed for key-value storage (slightly better performance)
 *    - Map keys can be anything (objects, numbers), not just strings
 *    - Map has .size property to count sessions easily
 *    - For our use case, either works — Map is the "proper" choice
 *
 * 🎓 IN-MEMORY STORAGE:
 *    This Map lives in Node.js process memory. If the server restarts,
 *    ALL conversation history is lost. This is fine for our project.
 *
 *    In production, you'd use Redis or a database to persist memory
 *    across restarts. But for a portfolio project, in-memory is perfect.
 *
 *    ┌─────────────────────────────────────────────────────┐
 *    │  sessionStore (Map)                                 │
 *    │                                                     │
 *    │  "abc123" → ChatMessageHistory [                    │
 *    │               HumanMessage("How many burgers?"),    │
 *    │               AIMessage("~342 burgers needed"),     │
 *    │               HumanMessage("What about fries?"),    │
 *    │               AIMessage("~580 fries needed"),       │
 *    │             ]                                       │
 *    │                                                     │
 *    │  "xyz789" → ChatMessageHistory [                    │
 *    │               HumanMessage("Show me profits"),      │
 *    │               AIMessage("Margins: Burgers 57%..."), │
 *    │             ]                                       │
 *    └─────────────────────────────────────────────────────┘
 */
const sessionStore = new Map();

// ─── GET OR CREATE SESSION MEMORY ───────────────────────
/**
 * Returns the ChatMessageHistory for a given session.
 * Creates a new empty one if the session doesn't exist yet.
 *
 * 🎓 HOW THIS IS USED:
 *    When a user sends a message to /api/chat, the request includes
 *    a sessionId (from the browser). We use it to:
 *    1. Look up their conversation history
 *    2. Pass it to the LangChain agent
 *    3. After the agent responds, save the new messages
 *
 * @param {string} sessionId - Unique identifier for the conversation
 * @returns {ChatMessageHistory} - The message history for this session
 */
export function getSessionHistory(sessionId) {
  if (!sessionStore.has(sessionId)) {
    sessionStore.set(sessionId, new ChatMessageHistory());
  }
  return sessionStore.get(sessionId);
}

// ─── ADD MESSAGES TO MEMORY ─────────────────────────────
/**
 * Save a human message + AI response pair to the session's memory.
 *
 * 🎓 WHY SAVE BOTH TOGETHER?
 *    A conversation is always in pairs:
 *    Human: "question" → AI: "answer"
 *    Human: "question" → AI: "answer"
 *
 *    We save them together to keep the history consistent.
 *    If we saved only the human message and the AI call failed,
 *    the history would be broken (question without answer).
 *
 * 🎓 HumanMessage vs AIMessage:
 *    These are LangChain classes that tag messages with their role:
 *    - HumanMessage("text") → role: "user"
 *    - AIMessage("text")    → role: "assistant"
 *
 *    The LLM uses these roles to understand WHO said WHAT in the
 *    conversation. It knows the difference between its own past
 *    responses and the user's past questions.
 *
 * @param {string} sessionId - Which session to save to
 * @param {string} userMessage - What the user said
 * @param {string} aiResponse - What ChefBot responded
 */
export async function addToMemory(sessionId, userMessage, aiResponse) {
  const history = getSessionHistory(sessionId);
  await history.addMessage(new HumanMessage(userMessage));
  await history.addMessage(new AIMessage(aiResponse));
}

// ─── GET CHAT HISTORY AS MESSAGES ARRAY ─────────────────
/**
 * Retrieve all past messages for a session as a flat array.
 *
 * 🎓 THIS IS WHAT FILLS {chat_history} IN THE PROMPT:
 *    Remember the prompt template from Step 3.2?
 *
 *    ["system", SYSTEM_PROMPT],
 *    ["placeholder", "{chat_history}"],    ← THIS gets filled
 *    ["human", "{input}"],
 *    ["placeholder", "{agent_scratchpad}"]
 *
 *    This function returns the array of messages that goes into
 *    the {chat_history} placeholder. The agent calls this before
 *    every LLM request to inject conversation context.
 *
 * @param {string} sessionId - Which session to read from
 * @returns {Promise<Array>} - Array of HumanMessage & AIMessage objects
 */
export async function getChatHistory(sessionId) {
  const history = getSessionHistory(sessionId);
  return await history.getMessages();
}

// ─── CLEAR SESSION ──────────────────────────────────────
/**
 * Delete all conversation history for a session.
 *
 * 🎓 WHEN IS THIS USED?
 *    - User clicks "New Conversation" in the UI
 *    - Session times out (you could add a TTL/expiry system)
 *    - User explicitly asks to "forget everything"
 *
 * @param {string} sessionId - Which session to clear
 */
export function clearSession(sessionId) {
  sessionStore.delete(sessionId);
}

// ─── GET SESSION COUNT (for debugging) ──────────────────
/**
 * Returns how many active sessions exist.
 * Useful for debugging/monitoring.
 *
 * @returns {number} - Number of active sessions in memory
 */
export function getActiveSessionCount() {
  return sessionStore.size;
}
