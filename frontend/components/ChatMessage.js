/**
 * 💬 ChatMessage — A Single Chat Bubble
 * ═══════════════════════════════════════
 *
 * 🎓 WHAT IS THIS COMPONENT?
 *    This renders ONE message in the chat — either from the user
 *    or from the AI (ChefBot). It handles:
 *
 *    ┌──────────────────────────────────────────────┐
 *    │ User message (right-aligned, blue):           │
 *    │                                               │
 *    │                    ┌─────────────────────┐ 👤 │
 *    │                    │ How many burgers     │    │
 *    │                    │ do I need next week? │    │
 *    │                    └─────────────────────┘    │
 *    │                               2:30 PM         │
 *    │                                               │
 *    │ AI message (left-aligned, dark):              │
 *    │                                               │
 *    │ 🧑‍🍳 ┌─────────────────────────────────┐      │
 *    │    │ Based on the forecast, you'll    │      │
 *    │    │ need approximately **342 burgers** │      │
 *    │    │                                   │      │
 *    │    │ | Day | Predicted |               │      │
 *    │    │ |-----|-----------|               │      │
 *    │    │ | Mon | 48        |               │      │
 *    │    └─────────────────────────────────┘      │
 *    │    2:31 PM                                    │
 *    └──────────────────────────────────────────────┘
 *
 * 🎓 KEY CONCEPTS IN THIS COMPONENT:
 *
 *    1. CONDITIONAL STYLING — Different layout for user vs AI
 *    2. MARKDOWN RENDERING — AI responses contain **bold**, tables, lists
 *    3. TIMESTAMP FORMATTING — "2:30 PM" from Date objects
 *    4. MEMO — Performance optimization for re-renders
 *
 * 🎓 WHY react-markdown?
 *    Our AI returns plain text with markdown formatting:
 *      "You need **342 burgers** for next week."
 *
 *    react-markdown converts this to actual HTML:
 *      "You need <strong>342 burgers</strong> for next week."
 *
 *    Combined with our .chat-markdown CSS from globals.css,
 *    the output is beautifully styled.
 *
 * @param {Object} props
 * @param {Object} props.message - { id, role, content, timestamp }
 * @param {boolean} props.isStreaming - Is this message still being streamed?
 */

"use client";

import { memo, useMemo, useRef, useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ChartRenderer from "./ChartRenderer";
import { exportMessageAsPdf } from "@/lib/pdf-report";

/**
 * 🎓 FORMAT TIMESTAMP
 *
 *    Converts a Date object to a readable time string:
 *      new Date() → "2:30 PM"
 *
 *    We show just the time (not the date) because chat messages
 *    are all from the current session — date would be redundant.
 */
function formatTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * 🎓 React.memo — PERFORMANCE OPTIMIZATION
 *
 *    By default, when ANY state changes in the parent component
 *    (like a new token arriving), ALL child components re-render.
 *
 *    In a chat with 50 messages, that means re-rendering 50
 *    ChatMessage components every time one word arrives!
 *
 *    memo() wraps the component so it ONLY re-renders when its
 *    own props actually change. Old messages won't re-render
 *    when a new token arrives for the latest message.
 *
 *    Without memo:  50 messages × 200 tokens = 10,000 re-renders 😱
 *    With memo:     1 message × 200 tokens = 200 re-renders ✅
 */
const ChatMessage = memo(function ChatMessage({ message, isStreaming }) {
  const isUser = message.role === "user";
  const isAI = message.role === "ai";
  const reportRef = useRef(null);
  const [isExporting, setIsExporting] = useState(false);
  const [didAutoExport, setDidAutoExport] = useState(false);

  const safeTitle = useMemo(() => {
    const plain = (message.content || "ChefBot Report").replace(/[#*_`>\[\]\(\)]/g, "").trim();
    return plain.length > 70 ? `${plain.slice(0, 70)}...` : plain || "ChefBot Report";
  }, [message.content]);

  const handleExportPdf = useCallback(async () => {
    if (!reportRef.current || isExporting) return;

    try {
      setIsExporting(true);
      const stamp = new Date().toISOString().slice(0, 10);
      const name = `chefbot-report-${stamp}.pdf`;
      await exportMessageAsPdf({
        element: reportRef.current,
        fileName: name,
        title: safeTitle,
      });
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, safeTitle]);

  useEffect(() => {
    if (!isAI || isStreaming) return;
    if (!message.autoPdfPending || didAutoExport) return;
    setDidAutoExport(true);
    handleExportPdf();
  }, [isAI, isStreaming, message.autoPdfPending, didAutoExport, handleExportPdf]);

  return (
    /**
     * 🎓 THE OUTER WRAPPER:
     *    - animate-slide-up: message slides up when it appears
     *    - flex: horizontal layout for avatar + bubble
     *    - justify-end: user messages align RIGHT
     *    - (default): AI messages align LEFT
     */
    <div
      className={`animate-slide-up flex gap-3 ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      {/* ── AI AVATAR (left side) ── */}
      {/**
       * 🎓 CONDITIONAL RENDERING:
       *    {isAI && <div>...</div>}
       *    This is a React pattern: if isAI is true, render the div.
       *    If false, render nothing. Clean alternative to if/else.
       */}
      {isAI && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-orange-500 to-amber-600 text-sm">
          🧑‍🍳
        </div>
      )}

      {/* ── MESSAGE BUBBLE ── */}
      <div
        ref={reportRef}
        className={`group relative max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? /**
               * 🎓 USER BUBBLE STYLES:
               *    - bg-[--bubble-user]: blue-tinted background
               *    - rounded-br-sm: small bottom-right radius (chat bubble tail)
               *    - text-[--text-primary]: bright text on dark background
               */
              "rounded-br-sm bg-[--bubble-user] text-[--text-primary]"
            : /**
               * 🎓 AI BUBBLE STYLES:
               *    - bg-[--bubble-ai]: neutral dark background
               *    - rounded-bl-sm: small bottom-left radius (tail points left)
               *    - border: subtle border to separate from background
               */
              "rounded-bl-sm border border-[--border] bg-[--bubble-ai] text-[--text-primary]"
        }`}
      >
        {/* ── MESSAGE CONTENT ── */}
        {isUser ? (
          /**
           * 🎓 USER MESSAGES — Plain text
           *    Users type plain text, no need for markdown.
           *    We use whitespace-pre-wrap to preserve line breaks
           *    if they press Enter in the input.
           */
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
        ) : (
          /**
           * 🎓 AI MESSAGES — Markdown rendering + Charts
           *
           *    ReactMarkdown takes a string like:
           *      "You need **342 burgers**\n\n| Day | Count |\n|---|---|\n| Mon | 48 |"
           *
           *    And renders it as actual HTML:
           *      <p>You need <strong>342 burgers</strong></p>
           *      <table>...</table>
           *
           *    The className="chat-markdown" applies all our
           *    custom styles from globals.css (dark tables, etc.)
           *
           *    remarkGfm plugin adds support for:
           *    - Tables (critical for our data reports!)
           *    - Strikethrough
           *    - Task lists
           *    - Autolinks
           *
           *    ChartRenderer automatically detects and visualizes
           *    chart-worthy data in the message (trends, comparisons).
           */
          <div className="chat-markdown text-sm leading-relaxed">
            {message.content ? (
              <>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
                <ChartRenderer toolData={message.toolData} />
              </>
            ) : isStreaming ? (
              /**
               * 🎓 TYPING INDICATOR:
               *    When the AI message is empty AND we're streaming,
               *    it means the agent is still thinking/calling tools.
               *    Show the pulsing dots animation (defined in globals.css).
               *
               *    ●  ○  ○  →  ○  ●  ○  →  ○  ○  ●
               */
              <div className="flex items-center gap-1.5 py-1">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            ) : null}
          </div>
        )}

        {/* ── TIMESTAMP ── */}
        {/**
         * 🎓 CONDITIONAL TIMESTAMP:
         *    Show the timestamp only when:
         *    - The message has content (not empty placeholder)
         *    - AND it's not currently being streamed
         *
         *    During streaming, showing a timestamp would be
         *    distracting — it keeps changing as time passes.
         *    We show it once the message is complete.
         */}
        {message.content && !isStreaming && (
          <div className="mt-2 flex items-center justify-between gap-3">
            <div
              className={`text-[10px] ${
                isUser ? "text-right text-blue-300/50" : "text-[--text-muted]"
              }`}
            >
              {formatTime(message.timestamp)}
            </div>

            {isAI && (
              <button
                onClick={handleExportPdf}
                disabled={isExporting}
                className="rounded-md border border-[--border] px-2 py-1 text-[10px] text-[--text-secondary] hover:border-[--accent] hover:text-[--accent] disabled:cursor-not-allowed disabled:opacity-50"
                title="Download this response as PDF"
              >
                {isExporting ? "Generating PDF..." : "Download PDF"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── USER AVATAR (right side) ── */}
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-500 to-indigo-600 text-sm">
          👤
        </div>
      )}
    </div>
  );
});

export default ChatMessage;
