/**
 * 🏠 ChatWindow — The Main Chat Container
 * ═════════════════════════════════════════
 *
 * 🎓 WHAT IS THIS COMPONENT?
 *    This is the ASSEMBLER — it takes all the pieces we built
 *    in Steps 4.2–4.5 and wires them together into a working chat.
 *
 *    Think of it like building a car:
 *      Step 4.2 (useChat)       = Engine          → powers everything
 *      Step 4.3 (ChatMessage)   = Seats           → displays messages
 *      Step 4.4 (ToolStatus)    = Dashboard lights → shows tool status
 *      Step 4.5 (ChatInput)     = Steering wheel  → user control
 *      Step 4.6 (THIS FILE)     = Car body        → holds it all together
 *
 * 🎓 THE LAYOUT:
 *
 *    ┌─────────────────────────────────────────────────┐
 *    │  🧑‍🍳 ChefBot        [New Chat]                   │ ← HEADER
 *    ├─────────────────────────────────────────────────┤
 *    │                                                 │
 *    │  (Welcome screen with suggested prompts         │
 *    │   OR scrollable message list)                   │ ← MESSAGES AREA
 *    │                                                 │
 *    │  ⟳ 📦 Checking inventory...                     │ ← TOOL STATUS
 *    │  ✅ 📈 Forecasting complete ✅                   │
 *    │                                                 │
 *    ├─────────────────────────────────────────────────┤
 *    │  ┌──────────────────────────────┐  ┌──┐        │ ← INPUT BAR
 *    │  │ Ask ChefBot anything...      │  │➤ │        │
 *    │  └──────────────────────────────┘  └──┘        │
 *    └─────────────────────────────────────────────────┘
 *
 * 🎓 TWO STATES:
 *
 *    1. EMPTY (no messages) → Shows welcome screen with:
 *       - ChefBot avatar and greeting
 *       - 6 suggested prompt buttons
 *       - Clicking a prompt sends it as a message
 *
 *    2. ACTIVE (has messages) → Shows:
 *       - Scrollable message list
 *       - Tool status indicators (when agent is working)
 *       - Auto-scrolls to newest message
 */

"use client";

import { useRef, useEffect } from "react";
import { useChat } from "@/hooks/useChat";
import ChatMessage from "@/components/ChatMessage";
import ToolStatus from "@/components/ToolStatus";
import ChatInput from "@/components/ChatInput";

/**
 * 🎓 SUGGESTED PROMPTS:
 *
 *    When the chat is empty, we show clickable prompt cards
 *    to help users discover what ChefBot can do.
 *
 *    Each prompt maps to one of our 5 MCP tools:
 *    - Forecast   → forecast_demand
 *    - Inventory  → check_inventory
 *    - Profit     → calculate_profit
 *    - Sales      → get_sales_analytics
 *    - Festivals  → get_upcoming_festivals
 *
 *    Plus a multi-tool prompt that triggers 2-3 tools at once.
 */
const SUGGESTED_PROMPTS = [
  {
    emoji: "📈",
    title: "Demand Forecast",
    prompt: "How many burgers will I need for the next 2 weeks?",
  },
  {
    emoji: "📦",
    title: "Inventory Check",
    prompt: "What's my current stock level for all products?",
  },
  {
    emoji: "💰",
    title: "Profit Analysis",
    prompt: "Show me the profit margins for all products this month.",
  },
  {
    emoji: "📊",
    title: "Sales Trends",
    prompt: "What are my top selling products by revenue in the last 30 days?",
  },
  {
    emoji: "🎉",
    title: "Festival Prep",
    prompt: "Are there any upcoming holidays I should prepare for?",
  },
  {
    emoji: "🧠",
    title: "Full Analysis",
    prompt:
      "Give me a complete overview: inventory status, profit margins, and any upcoming holidays I should prepare for.",
  },
];

export default function ChatWindow() {
  /**
   * 🎓 USING THE HOOK:
   *
   *    This one line gives us EVERYTHING:
   *    - messages[]        → render as chat bubbles
   *    - toolStatuses[]    → render as tool indicators
   *    - isStreaming        → control UI state
   *    - error             → show error banner
   *    - sendMessage()     → wire to input
   *    - stopStreaming()   → wire to stop button
   *    - clearChat()       → wire to "New Chat" button
   *
   *    All the complex SSE streaming logic is hidden inside
   *    the hook. This component just renders data.
   */
  const {
    messages,
    toolStatuses,
    isStreaming,
    error,
    sendMessage,
    stopStreaming,
    clearChat,
  } = useChat();

  /**
   * 🎓 AUTO-SCROLL REF:
   *
   *    We place an invisible <div> at the bottom of the message list.
   *    After each new message or token, we scroll this div into view.
   *    This keeps the latest message visible as the AI types.
   *
   *    scrollIntoView({ behavior: "smooth" }) creates a nice animation
   *    instead of jumping instantly.
   */
  const messagesEndRef = useRef(null);

  /**
   * 🎓 AUTO-SCROLL EFFECT:
   *
   *    This effect runs whenever messages or toolStatuses change.
   *    That means it scrolls down when:
   *    - A new user message is added
   *    - A new AI token arrives (typing effect)
   *    - A tool status changes
   *
   *    The slight delay (requestAnimationFrame) ensures the DOM
   *    has updated before we try to scroll.
   */
  useEffect(() => {
    if (messagesEndRef.current) {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }, [messages, toolStatuses]);

  const hasMessages = messages.length > 0;

  return (
    /**
     * 🎓 THE OUTER CONTAINER:
     *    - h-screen: full viewport height
     *    - flex flex-col: vertical layout (header → messages → input)
     *    - The 3 sections fill the screen without scrollbars on the page
     */
    <div className="flex h-screen flex-col bg-[--bg-primary]">
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          📌 HEADER BAR
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/**
       * 🎓 THE HEADER:
       *    Fixed at the top with the app name and action buttons.
       *    - "ChefBot" branding with avatar
       *    - "New Chat" button (clears conversation)
       *    - border-b creates a separator line
       */}
      <header className="flex items-center justify-between border-b border-[--border] bg-[--bg-secondary] px-6 py-3">
        {/* ── Left: Logo & Title ── */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-600 text-lg shadow-md">
            🧑‍🍳
          </div>
          <div>
            <h1 className="text-base font-semibold text-[--text-primary]">
              ChefBot
            </h1>
            <p className="text-[11px] text-[--text-muted]">
              Restaurant Forecast Assistant
            </p>
          </div>
        </div>

        {/* ── Right: Action Buttons ── */}
        <div className="flex items-center gap-2">
          {/**
           * 🎓 NEW CHAT BUTTON:
           *    Only shown when there are messages (no point clearing
           *    an already empty chat). Calls clearChat() from useChat
           *    which resets local state + clears server memory.
           */}
          {hasMessages && (
            <button
              onClick={clearChat}
              disabled={isStreaming}
              className="flex items-center gap-2 rounded-lg border border-[--border] px-3 py-1.5 text-xs text-[--text-secondary] transition-all hover:border-[--accent] hover:text-[--accent] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              New Chat
            </button>
          )}
        </div>
      </header>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          💬 MESSAGES AREA (scrollable middle section)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/**
       * 🎓 flex-1 + overflow-y-auto:
       *    - flex-1: take up ALL remaining space between header and input
       *    - overflow-y-auto: scroll when messages overflow
       *    This creates the "fixed header + scrollable middle + fixed input"
       *    layout that every chat app uses.
       */}
      <div className="chat-scroll flex-1 overflow-y-auto">
        {!hasMessages ? (
          /* ━━━━ WELCOME SCREEN (no messages yet) ━━━━ */
          /**
           * 🎓 THE WELCOME SCREEN:
           *    Shown when the chat is empty. It serves two purposes:
           *    1. Tells the user what ChefBot can do
           *    2. Provides clickable prompts to get started quickly
           *
           *    This pattern is used by ChatGPT, Claude, Gemini — all
           *    AI chat interfaces show suggested prompts when empty.
           */
          <div className="flex h-full flex-col items-center justify-center px-6 py-12">
            {/* ── Avatar ── */}
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-600 text-3xl shadow-lg shadow-orange-500/20">
              🧑‍🍳
            </div>

            {/* ── Greeting ── */}
            <h2 className="mb-2 text-xl font-semibold text-[--text-primary]">
              Welcome to ChefBot!
            </h2>
            <p className="mb-8 max-w-md text-center text-sm text-[--text-secondary]">
              I'm your AI restaurant assistant. I can forecast demand, check
              inventory, analyze profits, track sales, and help you prepare for
              upcoming holidays.
            </p>

            {/* ── Suggested Prompts Grid ── */}
            {/**
             * 🎓 THE PROMPT GRID:
             *    6 cards in a responsive grid:
             *    - Mobile: 1 column
             *    - Tablet: 2 columns
             *    - Desktop: 3 columns
             *
             *    Each card is a button that calls sendMessage()
             *    with a pre-written prompt. This lets new users
             *    try ChefBot without knowing what to ask.
             */}
            <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SUGGESTED_PROMPTS.map((item, index) => (
                <button
                  key={index}
                  onClick={() => sendMessage(item.prompt)}
                  className="group flex flex-col gap-2 rounded-xl border border-[--border] bg-[--bg-secondary] p-4 text-left transition-all hover:border-[--accent]/50 hover:shadow-lg hover:shadow-[--accent-glow]"
                >
                  <span className="text-xl">{item.emoji}</span>
                  <span className="text-sm font-medium text-[--text-primary] group-hover:text-[--accent]">
                    {item.title}
                  </span>
                  <span className="text-xs leading-relaxed text-[--text-muted]">
                    {item.prompt}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ━━━━ MESSAGE LIST (has messages) ━━━━ */
          /**
           * 🎓 THE MESSAGE LIST:
           *    - max-w-3xl mx-auto: centered, max 768px wide
           *    - gap-4: space between messages
           *    - py-6: padding top and bottom
           *
           *    Each message gets a ChatMessage component.
           *    The last AI message gets isStreaming=true during streaming
           *    (so it shows the typing indicator or growing text).
           */
          <div className="mx-auto max-w-3xl px-6 py-6">
            <div className="flex flex-col gap-4">
              {messages.map((msg, index) => {
                /**
                 * 🎓 isLastAiMessage — Which message is streaming?
                 *
                 *    Only the LAST AI message should show the typing
                 *    indicator / streaming state. All previous messages
                 *    are complete and should render normally.
                 *
                 *    We check: is this AI? + is streaming? + is it the last one?
                 */
                const isLastAiMessage =
                  msg.role === "ai" &&
                  isStreaming &&
                  index === messages.length - 1;

                return (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    isStreaming={isLastAiMessage}
                  />
                );
              })}

              {/* ── Tool Status Indicators ── */}
              {/**
               * 🎓 PLACEMENT:
               *    Tool statuses appear AFTER the last message,
               *    before the invisible scroll anchor.
               *    This keeps them at the bottom of the chat,
               *    visible as the agent works.
               */}
              <ToolStatus statuses={toolStatuses} />
            </div>

            {/* ── Invisible scroll anchor ── */}
            {/**
             * 🎓 THE SCROLL TRICK:
             *    This invisible div sits at the very bottom of the
             *    message list. When we call scrollIntoView() on it,
             *    it scrolls the chat to the bottom — showing the
             *    newest message or tool status.
             *
             *    This is simpler than calculating scroll positions
             *    manually. Just "scroll to this hidden element."
             */}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          ⚠️ ERROR BANNER (shown above input when error occurs)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/**
       * 🎓 CONDITIONAL ERROR DISPLAY:
       *    Only rendered when error is non-null.
       *    Shows a red banner with the error message.
       *    Positioned just above the input bar for visibility.
       */}
      {error && (
        <div className="animate-fade-in border-t border-[--error]/30 bg-[--error]/10 px-6 py-3">
          <div className="mx-auto flex max-w-3xl items-center gap-2 text-sm text-[--error]">
            <svg
              className="h-4 w-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            {error}
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          ⌨️ INPUT BAR (fixed at bottom)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/**
       * 🎓 WIRING THE INPUT:
       *    - onSend → useChat.sendMessage (sends to /api/chat/stream)
       *    - onStop → useChat.stopStreaming (aborts the fetch)
       *    - isStreaming → disables input while AI is responding
       */}
      <ChatInput
        onSend={sendMessage}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        disabled={false}
      />
    </div>
  );
}
