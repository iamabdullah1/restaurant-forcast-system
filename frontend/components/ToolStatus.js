/**
 * 🔧 ToolStatus — Live Tool Execution Indicators
 * ════════════════════════════════════════════════
 *
 * 🎓 WHAT IS THIS COMPONENT?
 *    When the AI agent calls tools (forecast, inventory, etc.),
 *    the user would otherwise see NOTHING — just an empty bubble
 *    with typing dots for 5-30 seconds. That's terrible UX.
 *
 *    This component shows LIVE indicators of what's happening:
 *
 *    ┌──────────────────────────────────────────┐
 *    │  ⟳ 📈 Forecasting demand...              │  ← spinning, in progress
 *    │  ✅ 📦 Checking inventory ✅              │  ← done, green check
 *    │  ⟳ 🧠 Processing results...              │  ← thinking status
 *    └──────────────────────────────────────────┘
 *
 *    This directly connects to the SSE events from Step 3.6:
 *    - "tool_start" → adds a new status line (spinning)
 *    - "tool_end"   → marks it as done (✅)
 *    - "status"     → shows "Thinking..." or "Processing..."
 *
 * 🎓 WHY IS THIS IMPORTANT FOR UX?
 *
 *    Without ToolStatus:              With ToolStatus:
 *    ┌──────────────────┐            ┌──────────────────────────┐
 *    │ User: "Am I      │            │ User: "Am I ready for    │
 *    │  ready for       │            │  Thanksgiving?"          │
 *    │  Thanksgiving?"  │            │                          │
 *    │                  │            │ 🧑‍🍳 ⟳ 🎉 Checking         │
 *    │ 🧑‍🍳 ● ● ●         │            │      festivals...        │
 *    │   (15 seconds    │            │   ✅ 📦 Inventory checked │
 *    │   of nothing)    │            │   ⟳ 📈 Forecasting...    │
 *    │                  │            │                          │
 *    │ "Did it crash?"  │            │ "Cool, it's working on   │
 *    │                  │            │  multiple things!"       │
 *    └──────────────────┘            └──────────────────────────┘
 *
 * @param {Object} props
 * @param {Array} props.statuses - Array from useChat's toolStatuses
 *   [{ tool: "check_inventory", message: "📦 Checking...", done?: boolean }]
 */

"use client";

import { memo } from "react";

/**
 * 🎓 INDIVIDUAL STATUS LINE
 *
 *    Renders one tool status with an icon:
 *    - Spinner (⟳) when in progress
 *    - Checkmark (✅) when done
 *
 *    Each line fades in with the animate-fade-in class.
 */
function StatusLine({ status }) {
  const isDone = status.done;
  const isThinking = status.tool === "__status";

  return (
    <div className="animate-fade-in flex items-center gap-2.5 text-sm">
      {/* ── STATUS ICON ── */}
      {/**
       * 🎓 THE SPINNER:
       *    We use a simple CSS-animated spinner for in-progress tools.
       *
       *    The spinner is a <div> with:
       *    - A circular shape (rounded-full)
       *    - A border on 3 sides (border-t is transparent → creates the gap)
       *    - CSS animation: spin (defined in globals.css)
       *
       *    When done, we show a green checkmark instead.
       *
       *    isThinking (status events like "🧠 Thinking...") get
       *    a pulsing dot instead of a spinner — visually distinct
       *    from tool executions.
       */}
      {isDone ? (
        /* ── Green checkmark ── */
        <div className="flex h-5 w-5 items-center justify-center">
          <svg
            className="h-4 w-4 text-[--success]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      ) : isThinking ? (
        /* ── Pulsing dot for "Thinking..." status ── */
        <div className="flex h-5 w-5 items-center justify-center">
          <div
            className="h-2.5 w-2.5 rounded-full bg-[--accent]"
            style={{ animation: "pulse-dot 1.4s ease-in-out infinite" }}
          />
        </div>
      ) : (
        /* ── Spinning loader for tool execution ── */
        /**
         * 🎓 HOW THE SPINNER WORKS:
         *
         *    border-2 border-[--accent]/30  → full circle, faint orange
         *    border-t-[--accent]            → top segment, bright orange
         *    animate-spin                   → rotates 360° infinitely
         *
         *    Result: a spinning arc — the classic loading indicator.
         *    The /30 means 30% opacity for the base circle.
         */
        <div className="flex h-5 w-5 items-center justify-center">
          <div className="h-4 w-4 rounded-full border-2 border-[--accent]/30 border-t-[--accent]"
            style={{ animation: "spin 0.8s linear infinite" }}
          />
        </div>
      )}

      {/* ── STATUS TEXT ── */}
      {/**
       * 🎓 TEXT STYLING:
       *    - Done items: muted text (de-emphasized, task complete)
       *    - In-progress: secondary text (visible but not jarring)
       *    - line-through on done items: visual cue that step is complete
       */}
      <span
        className={`${
          isDone
            ? "text-[--text-muted] line-through decoration-[--text-muted]/30"
            : "text-[--text-secondary]"
        }`}
      >
        {status.message}
      </span>
    </div>
  );
}

/**
 * 🎓 THE MAIN COMPONENT — ToolStatus
 *
 *    Renders all active tool statuses in a vertical list.
 *    If there are no statuses, renders nothing (returns null).
 *
 *    memo() prevents re-renders when other parts of the chat
 *    update (same optimization pattern as ChatMessage).
 */
const ToolStatus = memo(function ToolStatus({ statuses }) {
  // Don't render anything if there are no tool statuses
  if (!statuses || statuses.length === 0) return null;

  return (
    /**
     * 🎓 THE CONTAINER:
     *    - Positioned at the bottom of the chat, above the input
     *    - Left-aligned (same side as AI messages)
     *    - Indented to align with the AI bubble (ml-11 = past avatar)
     *    - Small gap between status lines
     *    - Rounded card with subtle background
     */
    <div className="animate-fade-in ml-11 mb-2">
      <div className="inline-flex flex-col gap-2 rounded-xl border border-[--border] bg-[--bg-secondary] px-4 py-3">
        {statuses.map((status, index) => (
          /**
           * 🎓 KEY PROP:
           *    React needs a unique key for list items.
           *    We combine tool name + index because the same tool
           *    could theoretically appear twice (unlikely but safe).
           */
          <StatusLine key={`${status.tool}-${index}`} status={status} />
        ))}
      </div>
    </div>
  );
});

export default ToolStatus;
