/**
 * 🏠 Home Page — The Entry Point
 * ════════════════════════════════
 *
 * 🎓 WHAT IS page.js?
 *    In Next.js App Router, page.js is the component rendered
 *    when a user visits a URL. This file = the "/" (root) route.
 *
 *    When someone opens http://localhost:3000, they see THIS page.
 *
 *    Our entire app IS the chat, so this page just renders
 *    the ChatWindow component. Simple.
 *
 * 🎓 WHY SO SIMPLE?
 *    All the logic lives in:
 *    - useChat hook     → data management
 *    - ChatWindow       → layout & assembly
 *    - ChatMessage      → message rendering
 *    - ToolStatus       → tool indicators
 *    - ChatInput        → user input
 *
 *    This page just mounts the ChatWindow. If we later add more
 *    pages (settings, analytics dashboard, etc.), each would be
 *    a separate page.js in its own folder.
 */

import ChatWindow from "@/components/ChatWindow";

export default function Home() {
  return <ChatWindow />;
}

