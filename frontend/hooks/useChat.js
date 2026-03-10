/**
 * 🧠 useChat — The Brain of the Chat UI
 * ═══════════════════════════════════════
 *
 * 🎓 WHAT IS A CUSTOM HOOK?
 *    React hooks let you reuse STATEFUL LOGIC across components.
 *    A "custom hook" is just a function that starts with "use"
 *    and calls other React hooks (useState, useRef, etc.) inside.
 *
 *    Why a hook instead of putting this logic in a component?
 *    ┌──────────────────────────────────────────────────┐
 *    │ SEPARATION OF CONCERNS:                          │
 *    │                                                  │
 *    │ useChat.js    → manages DATA & LOGIC             │
 *    │   - messages array                               │
 *    │   - streaming connection                         │
 *    │   - session ID                                   │
 *    │   - tool status tracking                         │
 *    │                                                  │
 *    │ Components    → manage VISUAL DISPLAY            │
 *    │   - chat bubbles                                 │
 *    │   - input field                                  │
 *    │   - animations                                   │
 *    │                                                  │
 *    │ Result: Clean code. Hook handles the messy       │
 *    │ streaming logic, components just render data.    │
 *    └──────────────────────────────────────────────────┘
 *
 * 🎓 WHAT THIS HOOK MANAGES:
 *
 *    1. MESSAGES — Array of all user/AI messages
 *       [{ role: "user", content: "..." }, { role: "ai", content: "..." }]
 *
 *    2. STREAMING — SSE connection to /api/chat/stream
 *       Reads events one by one, updates messages in real time
 *
 *    3. TOOL STATUS — What tools are currently running
 *       [{ tool: "check_inventory", message: "📦 Checking..." }]
 *
 *    4. SESSION — Unique ID for conversation memory
 *       Generated once, reused across all messages
 *
 * 🎓 HOW COMPONENTS WILL USE THIS:
 *
 *    function ChatWindow() {
 *      const {
 *        messages,        ← render these as chat bubbles
 *        toolStatuses,    ← show tool execution indicators
 *        isStreaming,     ← disable input while AI is responding
 *        sendMessage,     ← called when user hits Enter
 *        clearChat,       ← reset conversation
 *      } = useChat();
 *
 *      return <div>...</div>;
 *    }
 */

"use client";

import { useState, useRef, useCallback } from "react";

/**
 * 🎓 GENERATE A UNIQUE SESSION ID
 *
 *    Each conversation needs a unique ID so the server
 *    can keep separate memory for different users/tabs.
 *
 *    crypto.randomUUID() generates something like:
 *      "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *
 *    We call this ONCE when the hook first runs.
 *    Opening a new tab = new session = fresh conversation.
 */
function generateSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return "session-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
}

/**
 * 🎓 THE HOOK — useChat()
 *
 *    Returns everything a chat UI needs:
 *    - messages[]       → what to render
 *    - toolStatuses[]   → tool execution indicators
 *    - isStreaming       → is the AI currently responding?
 *    - error            → any error message to display
 *    - sendMessage(text) → send a new message
 *    - clearChat()      → reset everything
 */
export function useChat() {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  📦 STATE — All the data our UI needs
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 🎓 messages — The conversation history
   *
   *    Array of objects, each with:
   *    {
   *      id:        unique ID for React's key prop
   *      role:      "user" | "ai"
   *      content:   the text to display
   *      timestamp: when the message was created
   *    }
   *
   *    User messages are added instantly (optimistic UI).
   *    AI messages start empty and grow word-by-word (streaming).
   */
  const [messages, setMessages] = useState([]);

  /**
   * 🎓 toolStatuses — Which tools are currently running
   *
   *    When the agent calls tools, we show live indicators:
   *      "📦 Checking inventory..."
   *      "📈 Forecasting demand..."
   *
   *    Array of objects:
   *    { tool: "check_inventory", message: "📦 Checking inventory..." }
   *
   *    Populated by "tool_start" events, cleared by "tool_end" events.
   *    When this array is non-empty, the UI shows tool indicators.
   */
  const [toolStatuses, setToolStatuses] = useState([]);

  /**
   * 🎓 isStreaming — Is the AI currently responding?
   *
   *    true  = SSE connection is open, receiving events
   *    false = idle, waiting for user input
   *
   *    Used to:
   *    - Disable the input field (prevent double-sending)
   *    - Show typing indicator
   *    - Change the send button to a "stop" button
   */
  const [isStreaming, setIsStreaming] = useState(false);

  /**
   * 🎓 error — Any error to display to the user
   *
   *    null  = no error
   *    "..." = error message string
   *
   *    Set when the SSE stream sends an "error" event
   *    or when the fetch() itself fails (network error).
   */
  const [error, setError] = useState(null);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  🔗 REFS — Values that persist without re-renders
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 🎓 useRef vs useState — When to use which?
   *
   *    useState  → triggers re-render when value changes
   *               Use for data the UI displays (messages, etc.)
   *
   *    useRef    → does NOT trigger re-render
   *               Use for internal tracking values the UI doesn't show
   *
   *    sessionId doesn't need re-renders — it's just an ID we send
   *    to the server. Same for abortController (internal streaming control).
   */

  /** Session ID — generated once, reused for all messages */
  const sessionIdRef = useRef(generateSessionId());

  /**
   * 🎓 AbortController — How to CANCEL a streaming request
   *
   *    When you call fetch(), the request runs until complete.
   *    But what if the user wants to stop the AI mid-response?
   *
   *    AbortController lets us cancel the fetch:
   *      const controller = new AbortController();
   *      fetch(url, { signal: controller.signal });
   *      controller.abort();  ← cancels the request!
   *
   *    We store it in a ref so we can abort from the stop button.
   */
  const abortControllerRef = useRef(null);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  📤 sendMessage — The Main Function
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 🎓 useCallback — Why wrap in useCallback?
   *
   *    Without useCallback, this function is re-created on every render.
   *    Components that receive it as a prop would re-render unnecessarily.
   *
   *    useCallback says: "only re-create this function if dependencies change"
   *    Since our dependencies array is empty [], it's created once.
   *
   *    This is a performance optimization — not critical for small apps,
   *    but good practice and important in larger ones.
   */
  const sendMessage = useCallback(async (userMessage) => {
    // ── GUARD: Don't send empty messages or while already streaming ──
    if (!userMessage.trim() || isStreaming) return;

    setError(null);

    // ── STEP 1: Add user message to the messages array ──
    /**
     * 🎓 OPTIMISTIC UI:
     *    We add the user's message IMMEDIATELY (before the API call).
     *    This makes the UI feel instant — the message appears right away.
     *
     *    If the API call fails, we show an error, but the user's
     *    message stays visible (they can see what they typed).
     */
    const userMsg = {
      id: Date.now().toString(),
      role: "user",
      content: userMessage.trim(),
      timestamp: new Date(),
    };

    // ── STEP 2: Create an empty AI message (will be filled by streaming) ──
    /**
     * 🎓 WHY CREATE AN EMPTY AI MESSAGE NOW?
     *    We need a placeholder in the messages array that we'll
     *    update word-by-word as tokens arrive from SSE.
     *
     *    The aiMessageId lets us find this specific message later
     *    when we need to append tokens to it.
     */
    const aiMessageId = (Date.now() + 1).toString();
    const aiMsg = {
      id: aiMessageId,
      role: "ai",
      content: "",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setIsStreaming(true);
    setToolStatuses([]);

    // ── STEP 3: Create AbortController for this request ──
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // ── STEP 4: Start the SSE connection ──
      /**
       * 🎓 WHY fetch() INSTEAD OF EventSource?
       *
       *    There are two ways to read SSE in the browser:
       *
       *    1. EventSource — Simple, built-in, but:
       *       ❌ Only supports GET (we need POST to send the message)
       *       ❌ Can't set custom headers
       *       ❌ Can't cancel mid-stream easily
       *
       *    2. fetch() + ReadableStream — More control:
       *       ✅ Supports POST with JSON body
       *       ✅ Can cancel with AbortController
       *       ✅ Can read the stream chunk by chunk
       *       ✅ Used by ChatGPT, Claude, and all modern AI chat UIs
       *
       *    We use fetch() because we need to POST the message body.
       */
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.trim(),
          sessionId: sessionIdRef.current,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      // ── STEP 5: Read the stream chunk by chunk ──
      /**
       * 🎓 HOW WE READ AN SSE STREAM WITH fetch():
       *
       *    response.body is a ReadableStream of raw bytes.
       *    We get a "reader" from it and read chunks in a loop:
       *
       *    while (true) {
       *      const { done, value } = await reader.read();
       *      if (done) break;
       *      // value is a Uint8Array of bytes
       *      // decode it to a string, parse the SSE events
       *    }
       *
       *    This is the STANDARD pattern for reading streams in JS.
       *    Every AI chat client uses this exact approach.
       */
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      /**
       * 🎓 THE BUFFER — Why do we need it?
       *
       *    Network data arrives in ARBITRARY chunks. One chunk might
       *    contain half an event, or two events, or 1.5 events:
       *
       *    Chunk 1: 'data: {"type":"tok'        ← incomplete!
       *    Chunk 2: 'en","content":"Hi"}\n\n'   ← rest of event
       *    Chunk 3: 'data: {"type":"token","content":" there"}\n\ndata: {"type' ← 1.5 events!
       *
       *    The buffer collects text until we see a complete event
       *    (marked by "\n\n"), then we process it.
       */
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Decode bytes to string and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // ── STEP 6: Parse SSE events from the buffer ──
        /**
         * 🎓 SSE PARSING LOGIC:
         *
         *    SSE events are separated by "\n\n" (double newline).
         *    Each event starts with "data: " followed by JSON.
         *
         *    We split by "\n\n" to get individual events:
         *      "data: {...}\n\ndata: {...}\n\n"
         *        ↓ split("\n\n")
         *      ["data: {...}", "data: {...}", ""]
         *
         *    The LAST element might be incomplete (no trailing \n\n yet),
         *    so we keep it in the buffer for the next chunk.
         */
        const events = buffer.split("\n\n");

        // Keep the last (potentially incomplete) piece in the buffer
        buffer = events.pop() || "";

        for (const event of events) {
          // Skip empty events
          if (!event.trim()) continue;

          // Extract JSON from "data: {...}"
          const dataLine = event
            .split("\n")
            .find((line) => line.startsWith("data: "));

          if (!dataLine) continue;

          try {
            const data = JSON.parse(dataLine.slice(6)); // Remove "data: " prefix

            // ── STEP 7: Handle each event type ──
            /**
             * 🎓 EVENT DISPATCH:
             *    Each event type updates a different piece of state.
             *    This is where the SSE events from Step 3.6 connect
             *    to the React state that drives the UI.
             *
             *    Server sends:                    Hook updates:
             *    { type: "token" }         →    messages (append text)
             *    { type: "tool_start" }    →    toolStatuses (add)
             *    { type: "tool_end" }      →    toolStatuses (remove)
             *    { type: "done" }          →    isStreaming = false
             *    { type: "error" }         →    error state
             */
            switch (data.type) {
              case "token":
                /**
                 * 🎓 TOKEN EVENT — Append one word to the AI message
                 *
                 *    The server sends tokens one at a time:
                 *      { type: "token", content: "Based" }
                 *      { type: "token", content: " on" }
                 *      { type: "token", content: " the" }
                 *
                 *    We find the AI message by its ID and append the word.
                 *    This creates the typing effect in the UI.
                 *
                 *    Note: We use the FUNCTIONAL form of setState:
                 *      setMessages(prev => ...)
                 *    instead of:
                 *      setMessages([...messages, ...])
                 *
                 *    Because tokens arrive FAST (every few ms), and the
                 *    closure might have a stale 'messages' reference.
                 *    The functional form always gets the latest state.
                 */
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiMessageId
                      ? { ...msg, content: msg.content + data.content }
                      : msg
                  )
                );
                break;

              case "tool_start":
                /**
                 * 🎓 TOOL_START — A tool began executing
                 *    Add to the toolStatuses array.
                 *    The UI will show: "📦 Checking inventory..."
                 */
                setToolStatuses((prev) => [
                  ...prev,
                  { tool: data.tool, message: data.message },
                ]);
                break;

              case "tool_end":
                /**
                 * 🎓 TOOL_END — A tool finished executing
                 *    Update the tool's status to show ✅
                 *    Also capture tool result data for chart rendering.
                 */
                setToolStatuses((prev) =>
                  prev.map((ts) =>
                    ts.tool === data.tool
                      ? { ...ts, message: data.message, done: true }
                      : ts
                  )
                );
                // Store tool result data on the AI message for chart rendering
                if (data.data) {
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === aiMessageId
                        ? {
                            ...msg,
                            toolData: [
                              ...(msg.toolData || []),
                              { tool: data.tool, data: data.data },
                            ],
                          }
                        : msg
                    )
                  );
                }
                break;

              case "status":
                /**
                 * 🎓 STATUS — General progress update
                 *    "🧠 Thinking...", "🧠 Processing results..."
                 *    We add these as a special tool status entry.
                 */
                setToolStatuses((prev) => {
                  // Replace existing "thinking" status or add new one
                  const withoutThinking = prev.filter(
                    (ts) => ts.tool !== "__status"
                  );
                  return [
                    ...withoutThinking,
                    { tool: "__status", message: data.message },
                  ];
                });
                break;

              case "done":
                /**
                 * 🎓 DONE — Streaming complete
                 *    The server sends the full text as a safety net.
                 *    We set the AI message to the final full text
                 *    (in case any tokens were missed due to network).
                 *    Then clear tool statuses and stop streaming.
                 */
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === aiMessageId
                      ? { ...msg, content: data.fullText }
                      : msg
                  )
                );
                setToolStatuses([]);
                setIsStreaming(false);
                break;

              case "error":
                /**
                 * 🎓 ERROR — Something went wrong on the server
                 *    Display the error and stop streaming.
                 */
                setError(data.message || "Something went wrong.");
                setToolStatuses([]);
                setIsStreaming(false);
                break;

              default:
                console.warn("Unknown SSE event type:", data.type);
            }
          } catch (parseError) {
            // Skip malformed events (shouldn't happen, but be safe)
            console.warn("Failed to parse SSE event:", dataLine, parseError);
          }
        }
      }

      // Stream ended naturally (reader returned done: true)
      setIsStreaming(false);
      setToolStatuses([]);
    } catch (err) {
      // ── HANDLE ERRORS ──
      /**
       * 🎓 AbortError — Not a real error!
       *    When we call controller.abort(), the fetch throws
       *    an AbortError. This is EXPECTED (user clicked stop).
       *    We don't show it as an error — just stop streaming.
       *
       *    Real errors (network failure, server crash) get shown
       *    to the user in the error state.
       */
      if (err.name === "AbortError") {
        console.log("🛑 Stream aborted by user");
      } else {
        console.error("❌ Chat error:", err);
        setError(err.message || "Failed to send message. Please try again.");
      }

      setIsStreaming(false);
      setToolStatuses([]);
    } finally {
      abortControllerRef.current = null;
    }
  }, [isStreaming]);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  🛑 stopStreaming — Cancel the current response
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 🎓 STOP BUTTON:
   *    If the AI is giving a long response the user doesn't want,
   *    they can click "Stop" to cancel the stream mid-response.
   *
   *    This calls AbortController.abort(), which:
   *    1. Cancels the fetch() request
   *    2. Throws an AbortError (caught above)
   *    3. The UI shows whatever text was received so far
   */
  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setToolStatuses([]);
  }, []);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  🗑️ clearChat — Reset the conversation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 🎓 CLEAR CHAT:
   *    Resets everything — messages, errors, tool statuses.
   *    Also calls the DELETE endpoint to clear server-side memory.
   *    Generates a new session ID for the fresh conversation.
   */
  const clearChat = useCallback(async () => {
    // Cancel any ongoing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Clear server-side memory
    try {
      await fetch(`/api/chat?sessionId=${sessionIdRef.current}`, {
        method: "DELETE",
      });
    } catch {
      // Silently fail — not critical if server memory isn't cleared
    }

    // Reset all local state
    setMessages([]);
    setToolStatuses([]);
    setIsStreaming(false);
    setError(null);

    // New session = fresh conversation
    sessionIdRef.current = generateSessionId();
  }, []);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  📤 RETURN — Everything the components need
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 🎓 WHAT WE RETURN:
   *
   *    The hook returns an object with all the data and functions
   *    that chat components need. Components just destructure:
   *
   *    const { messages, sendMessage, isStreaming } = useChat();
   *
   *    ┌───────────────────┬──────────────────────────────────┐
   *    │ Return value      │ Used by component for...         │
   *    ├───────────────────┼──────────────────────────────────┤
   *    │ messages          │ Rendering chat bubbles           │
   *    │ toolStatuses      │ Showing tool execution status    │
   *    │ isStreaming       │ Disabling input, showing dots    │
   *    │ error             │ Displaying error banner          │
   *    │ sendMessage(text) │ Handling form submit             │
   *    │ stopStreaming()   │ Stop button                      │
   *    │ clearChat()       │ "New Chat" button                │
   *    └───────────────────┴──────────────────────────────────┘
   */
  return {
    messages,
    toolStatuses,
    isStreaming,
    error,
    sendMessage,
    stopStreaming,
    clearChat,
  };
}
