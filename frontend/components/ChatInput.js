/**
 * ⌨️ ChatInput — The Message Input Bar
 * ═════════════════════════════════════
 *
 * 🎓 WHAT IS THIS COMPONENT?
 *    The input area at the bottom of the chat where the user
 *    types their message and hits Send (or presses Enter).
 *
 *    ┌──────────────────────────────────────────────────────┐
 *    │                                                      │
 *    │  ┌──────────────────────────────────────────┐  ┌──┐  │
 *    │  │ Ask ChefBot anything...                  │  │ ➤│  │
 *    │  └──────────────────────────────────────────┘  └──┘  │
 *    │         textarea (auto-grows)              send btn   │
 *    └──────────────────────────────────────────────────────┘
 *
 * 🎓 KEY BEHAVIORS:
 *
 *    1. ENTER TO SEND — Press Enter to send message
 *       Shift+Enter for a new line (multi-line support)
 *
 *    2. AUTO-RESIZE — Textarea grows taller as you type more lines
 *       (up to a max height, then scrolls)
 *
 *    3. DISABLED WHILE STREAMING — Can't send a second message
 *       while the AI is still responding to the first one.
 *       Shows "Stop" button instead of "Send" button.
 *
 *    4. AUTO-FOCUS — Input is focused when the component mounts
 *       so the user can start typing immediately.
 *
 * @param {Object} props
 * @param {Function} props.onSend - Called with the message text
 * @param {Function} props.onStop - Called when user clicks Stop
 * @param {boolean} props.isStreaming - Is the AI currently responding?
 * @param {boolean} props.disabled - Disable input entirely
 */

"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export default function ChatInput({ onSend, onStop, isStreaming, disabled }) {
  /**
   * 🎓 LOCAL STATE vs HOOK STATE:
   *
   *    The input text lives HERE (local state), not in useChat.
   *    Why? Because the input field is a "controlled component" —
   *    React controls its value via state.
   *
   *    The input text is TEMPORARY — it gets cleared after sending.
   *    It doesn't belong in the chat hook (which tracks permanent data
   *    like messages and session). This is separation of concerns.
   */
  const [input, setInput] = useState("");

  /**
   * 🎓 useRef FOR THE TEXTAREA:
   *
   *    We need a reference to the actual DOM element for two things:
   *    1. Auto-focus on mount (textareaRef.current.focus())
   *    2. Auto-resize height (textareaRef.current.scrollHeight)
   *
   *    useState is for data React renders.
   *    useRef is for accessing actual DOM elements.
   */
  const textareaRef = useRef(null);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  📐 AUTO-RESIZE — Textarea grows with content
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 🎓 HOW AUTO-RESIZE WORKS:
   *
   *    By default, <textarea> has a fixed height. When text overflows,
   *    it just scrolls. We want it to GROW instead:
   *
   *    1 line:   ┌─────────────────────┐
   *              │ Hello               │
   *              └─────────────────────┘
   *
   *    3 lines:  ┌─────────────────────┐
   *              │ Hello               │
   *              │ I need to plan for  │
   *              │ next week's orders  │
   *              └─────────────────────┘
   *
   *    The trick:
   *    1. Set height to "auto" (collapse to minimum)
   *    2. Read scrollHeight (the actual content height)
   *    3. Set height to scrollHeight (expand to fit content)
   *
   *    This runs every time the input text changes.
   *    Max height is capped at 150px (then it scrolls).
   */
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Step 1: Reset to auto (so scrollHeight is recalculated)
    textarea.style.height = "auto";

    // Step 2: Set to content height, capped at 150px
    const newHeight = Math.min(textarea.scrollHeight, 150);
    textarea.style.height = `${newHeight}px`;
  }, []);

  // Adjust height whenever input changes
  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  🎯 AUTO-FOCUS — Ready to type immediately
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 🎓 useEffect WITH EMPTY DEPS []:
   *
   *    useEffect(() => { ... }, []) runs ONCE after the first render.
   *    This is the React equivalent of "on component mount."
   *
   *    We focus the textarea so the user can start typing
   *    without clicking on the input first.
   */
  useEffect(() => {
    if (textareaRef.current && !disabled) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  📤 HANDLE SUBMIT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 🎓 FORM SUBMISSION:
   *
   *    Called when the user clicks Send or presses Enter.
   *
   *    1. Trim whitespace
   *    2. Check it's not empty
   *    3. Call onSend (which triggers useChat.sendMessage)
   *    4. Clear the input
   *    5. Reset textarea height
   *    6. Re-focus for next message
   */
  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();

      const trimmed = input.trim();
      if (!trimmed || isStreaming || disabled) return;

      onSend(trimmed);
      setInput("");

      // Reset textarea height after clearing
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      // Re-focus for next message (slight delay for state to update)
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    },
    [input, isStreaming, disabled, onSend]
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  ⌨️ KEYBOARD HANDLING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 🎓 ENTER vs SHIFT+ENTER:
   *
   *    Every chat app uses this convention:
   *    - Enter        → send the message
   *    - Shift+Enter  → new line (don't send)
   *
   *    We intercept the keydown event and check:
   *    - If Enter is pressed WITHOUT Shift → submit the form
   *    - If Enter is pressed WITH Shift → let the browser add a newline
   *
   *    e.preventDefault() stops the default Enter behavior
   *    (which would add a newline). Then we call handleSubmit
   *    to send the message instead.
   */
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit]
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  🎨 RENDER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  return (
    /**
     * 🎓 THE FORM WRAPPER:
     *
     *    We use a <form> so the submit event works natively.
     *    The glass class gives a frosted-glass backdrop effect.
     *    border-t creates a visual separator from the chat area.
     */
    <form
      onSubmit={handleSubmit}
      className="border-t border-[--border] bg-[--bg-primary] p-4"
    >
      <div className="mx-auto flex max-w-3xl items-end gap-3">
        {/* ── TEXTAREA ── */}
        {/**
         * 🎓 WHY <textarea> INSTEAD OF <input>?
         *
         *    <input type="text"> is single-line only.
         *    <textarea> supports multiple lines — important because
         *    users might want to write longer questions:
         *
         *    "Can you compare the profit margins for all products
         *     over the last 90 days and tell me which one is
         *     trending upward?"
         *
         *    The auto-resize behavior makes it START as one line
         *    and GROW as needed — best of both worlds.
         */}
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming
                ? "ChefBot is responding..."
                : "Ask ChefBot anything about your restaurant..."
            }
            disabled={disabled || isStreaming}
            rows={1}
            className={`
              w-full resize-none rounded-xl border bg-[--bg-secondary]
              px-4 py-3 text-sm text-[--text-primary]
              placeholder-[--text-muted] outline-none transition-all
              ${
                isStreaming || disabled
                  ? "cursor-not-allowed border-[--border] opacity-50"
                  : "border-[--border] focus:border-[--accent] focus:ring-1 focus:ring-[--accent]/30"
              }
            `}
            style={{
              minHeight: "44px",
              maxHeight: "150px",
            }}
          />
        </div>

        {/* ── SEND / STOP BUTTON ── */}
        {/**
         * 🎓 DYNAMIC BUTTON — Send vs Stop:
         *
         *    When NOT streaming: Orange "Send" arrow button
         *      → Calls handleSubmit → sends the message
         *
         *    When streaming: Red "Stop" square button
         *      → Calls onStop → aborts the SSE connection
         *      → This triggers AbortController.abort() in useChat
         *
         *    The button changes both its icon and color:
         *    - Send: orange background, arrow icon (➤)
         *    - Stop: red background, square icon (⬜)
         */}
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[--error] text-white transition-all hover:brightness-110 active:scale-95"
            title="Stop generating"
          >
            {/* ── Stop icon (square) ── */}
            <svg
              className="h-4 w-4"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim() || disabled}
            className={`
              flex h-11 w-11 shrink-0 items-center justify-center
              rounded-xl transition-all active:scale-95
              ${
                input.trim() && !disabled
                  ? "bg-[--accent] text-white shadow-lg shadow-[--accent-glow] hover:brightness-110"
                  : "bg-[--bg-tertiary] text-[--text-muted] cursor-not-allowed"
              }
            `}
            title="Send message"
          >
            {/* ── Send icon (arrow) ── */}
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
              />
            </svg>
          </button>
        )}
      </div>

      {/* ── HINT TEXT ── */}
      {/**
       * 🎓 SUBTLE HINTS:
       *    A tiny text below the input showing keyboard shortcuts.
       *    This helps new users discover Shift+Enter for multi-line.
       *    The text is very muted so it doesn't distract.
       */}
      <div className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-[--text-muted]">
        Press Enter to send · Shift+Enter for new line
      </div>
    </form>
  );
}
