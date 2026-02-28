/**
 * 🔌 MongoDB Connection Utility
 * ═════════════════════════════
 *
 * 🎓 WHAT THIS FILE DOES:
 *    Provides two functions — connectDB() and disconnectDB() — that
 *    ALL other files use to talk to MongoDB Atlas.
 *
 *    Instead of writing connection logic in every file, we write it
 *    ONCE here and import it everywhere. This is called the
 *    "Single Responsibility Principle" — one file, one job.
 *
 * 🎓 WHAT IS MongoDB Atlas?
 *    MongoDB Atlas is MongoDB's cloud service. Instead of installing
 *    MongoDB on your computer, Atlas hosts it on their servers.
 *    You get a connection URL like:
 *      mongodb+srv://user:pass@cluster0.abc123.mongodb.net/restaurant-forecast
 *
 *    Free tier (M0) gives you 512MB — more than enough for our project.
 *
 * 🎓 WHY A CONNECTION UTILITY?
 *    Opening a database connection is expensive (takes time + resources).
 *    We don't want to open a NEW connection every time we need data.
 *    Instead, we open ONE connection and REUSE it. The `isConnected`
 *    flag tracks whether we already have an open connection.
 */

import mongoose from "mongoose";

/**
 * 🎓 "dotenv/config" IMPORT:
 *    This is a special import that EXECUTES code immediately.
 *    It reads the .env file and loads all variables into process.env.
 *
 *    Your .env file:
 *      MONGODB_URI=mongodb+srv://user:pass@cluster0.mongodb.net/restaurant-forecast
 *
 *    After this import:
 *      process.env.MONGODB_URI === "mongodb+srv://user:pass@..."
 *
 *    🎓 WHY .env FILES?
 *       You NEVER hardcode passwords/API keys in code (they'd be visible
 *       on GitHub!). Instead, store them in .env, add .env to .gitignore,
 *       and read them via process.env. Each developer has their own .env.
 *
 *    🎓 WHY path.resolve + dotenv.config()?
 *       By default, dotenv looks for .env in the CURRENT WORKING DIRECTORY
 *       (process.cwd()). But our .env is in the project ROOT (one level up
 *       from mcp-server/). If we run `cd mcp-server && npm run seed`,
 *       the cwd is mcp-server/ — dotenv wouldn't find ../env.
 *
 *       Solution: We use path.resolve + fileURLToPath to build the
 *       ABSOLUTE path to the root .env file, regardless of where we
 *       run the command from.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// 🎓 Recreate __dirname (not available in ES Modules) — see seed.js for details
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🎓 Go up from utils/ → src/ → mcp-server/ → restaurant/ (project root)
dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

const MONGODB_URI = process.env.MONGODB_URI;

// 🎓 Module-level variable to track connection state.
//    This variable persists as long as the Node.js process is running.
//    It's shared across all files that import this module.
let isConnected = false;

/**
 * Connect to MongoDB Atlas.
 * Reuses existing connection if already connected (prevents duplicate connections).
 *
 * 🎓 async/await PATTERN:
 *    Connecting to a database takes time (network call). JavaScript uses
 *    "async/await" to handle this without blocking other code.
 *
 *    "async" before a function means "this function returns a Promise."
 *    "await" before an async operation means "pause HERE until it finishes."
 *
 *    Without await:
 *      mongoose.connect(...)  → returns a Promise (connection not ready yet!)
 *      Sale.find()            → CRASH! Connection isn't established yet!
 *
 *    With await:
 *      await mongoose.connect(...)  → pauses until connection is ready
 *      Sale.find()                   → works! Connection is established.
 *
 * @returns {mongoose.Connection} The active Mongoose connection
 */
export async function connectDB() {
  // 🎓 If already connected, just return the existing connection.
  //    This is called "connection pooling" / "singleton pattern."
  //    No matter how many files call connectDB(), only ONE connection opens.
  if (isConnected) {
    return mongoose.connection;
  }

  // 🎓 Guard clause: fail early with a helpful message.
  //    "throw new Error()" stops execution and shows the error message.
  //    This is better than getting a cryptic MongoDB error later.
  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI is not defined. Create a .env file with your connection string."
    );
  }

  // 🎓 try/catch: Error handling for async operations.
  //    "try" = attempt this code
  //    "catch" = if it fails, run this code instead of crashing
  try {
    await mongoose.connect(MONGODB_URI, {
      // 🎓 dbName: Specifies which database to use.
      //    One MongoDB cluster can have multiple databases.
      //    We use "restaurant-forecast" as our database name.
      dbName: "restaurant-forecast",
    });
    isConnected = true;
    console.log("✅ Connected to MongoDB Atlas");
    return mongoose.connection;
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    // 🎓 Re-throwing the error lets the CALLER decide what to do.
    //    The seed script might exit the process.
    //    The MCP server might retry the connection.
    throw err;
  }
}

/**
 * Disconnect from MongoDB.
 * Call this when your script is done (especially in seed scripts).
 *
 * 🎓 WHY DISCONNECT?
 *    For long-running servers (MCP server), you usually DON'T disconnect.
 *    But for one-time scripts (seeding, testing), you MUST disconnect
 *    or the Node.js process hangs forever (it waits for the open connection).
 */
export async function disconnectDB() {
  if (isConnected) {
    await mongoose.disconnect();
    isConnected = false;
    console.log("🔌 Disconnected from MongoDB");
  }
}
