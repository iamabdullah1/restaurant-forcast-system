/**
 * 🧠 MCP Server — Entry Point
 *
 * Creates the MCP Server, registers all tools/resources/prompts,
 * connects to MongoDB, and starts listening on STDIO transport.
 *
 * ⚠️ Use console.error() for logging — stdout is reserved for MCP protocol.
 */

// McpServer: creates server + provides .tool(), .resource(), .prompt()
// StdioServerTransport: communicates via stdin/stdout (JSON-RPC protocol)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Zod: runtime input validation — MCP validates tool args against these schemas
import { z } from "zod";

// MongoDB connection singleton (shared across all tool handlers)
import { connectDB, disconnectDB } from "./utils/mongodb.js";

// Each tool lives in its own file — we import just the handler function
import { handleGetUpcomingFestivals } from "./tools/festivals.js";
import { handleCheckInventory } from "./tools/inventory.js";
import { handleGetSalesAnalytics } from "./tools/analytics.js";
import { handleCalculateProfit } from "./tools/profit.js";
import { handleForecastDemand } from "./tools/forecast.js";

// ─── CREATE SERVER ──────────────────────────────────────
// name + version are sent to AI clients during the MCP handshake
const server = new McpServer({
  name: "restaurant-forecast",
  version: "1.0.0",
});

// ═══════════════════════════════════════════════════════════
// REGISTER TOOLS
// ═══════════════════════════════════════════════════════════
// server.tool(name, description, zodSchema, handler)
// - description: AI reads this to decide WHEN to use the tool
// - zodSchema: validates inputs BEFORE handler runs
// - handler must return: { content: [{ type: "text", text: "..." }] }

// Tool #1: Predict future demand (stub now → calls Prophet ML in Phase 2)
server.tool(
  "forecast_demand",
  "Predict demand for a product over the next N days. Returns daily forecasted quantities, " +
    "total predicted units, average daily demand, and peak day. " +
    "Use this when the user asks about future demand, how much to order, or what to expect.",
  {
    product: z
      .enum(["Burgers", "Chicken Sandwiches", "Fries", "Beverages", "Sides & Other", "all"])
      .describe("Product name or 'all' for every product"),
    days_ahead: z
      .number()
      .min(1)
      .max(90)
      .default(30)
      .describe("Number of days to forecast (1-90, default 30)"),
  },
  handleForecastDemand
);

// Tool #2: Check stock levels → traffic light status + days until stockout
server.tool(
  "check_inventory",
  "Check current stock levels for products. Returns quantity in stock, status indicator " +
    "(🟢 green = OK, 🟡 yellow = low, 🔴 red = critical), average daily consumption, " +
    "and estimated days until stockout. Use when user asks about stock, inventory, or restocking.",
  {
    product: z
      .enum(["Burgers", "Chicken Sandwiches", "Fries", "Beverages", "Sides & Other", "all"])
      .optional()
      .describe("Product name or omit for all products"),
  },
  handleCheckInventory
);

// Tool #3: Revenue - COGS = Gross Profit per product + margin insights
server.tool(
  "calculate_profit",
  "Calculate profit margins and financial breakdown. Returns revenue, COGS (cost of goods sold), " +
    "gross profit, and margin percentage per product with insights on highest/lowest margin items. " +
    "Optionally includes profit trend over time. Use when user asks about profit, margins, revenue, or costs.",
  {
    product: z
      .enum(["Burgers", "Chicken Sandwiches", "Fries", "Beverages", "Sides & Other", "all"])
      .default("all")
      .describe("Product name or 'all' for every product"),
    days: z
      .number()
      .min(0)
      .max(365)
      .default(30)
      .describe("Lookback period in days (0 = all time, default 30)"),
    include_trend: z
      .boolean()
      .default(false)
      .describe("Whether to include profit trend over time (default false)"),
    group_by: z
      .enum(["day", "week", "month"])
      .default("day")
      .describe("Time grouping for trend data (default 'day')"),
  },
  handleCalculateProfit
);

// Tool #4: Fetch US holidays from Nager.Date API + cache in MongoDB
server.tool(
  "get_upcoming_festivals",
  "Get upcoming US public holidays and festivals. Returns holiday name, date, days until, " +
    "and expected demand impact (HIGH/MEDIUM/LOW). Data is auto-fetched from Nager.Date API " +
    "and cached in MongoDB. Use when user asks about holidays, festivals, or event preparation.",
  {
    days_ahead: z
      .number()
      .min(1)
      .max(365)
      .default(90)
      .describe("How many days ahead to look (1-365, default 90)"),
    country_code: z
      .string()
      .default("US")
      .describe("ISO country code (default 'US')"),
  },
  handleGetUpcomingFestivals
);

// Tool #5: Sales analytics with 5 analysis modes
server.tool(
  "get_sales_analytics",
  "Analyze historical sales data with multiple analysis types. 'overview' = total summary, " +
    "'by_product' = breakdown per product, 'by_channel' = breakdown per channel (Dine-in/Takeaway/Online), " +
    "'trend' = sales over time (day/week/month), 'top_sellers' = top products by volume/revenue. " +
    "Use when user asks about sales trends, performance, comparisons, or analytics.",
  {
    analysis_type: z
      .enum(["overview", "by_product", "by_channel", "trend", "top_sellers"])
      .default("overview")
      .describe("Type of analysis to run (default 'overview')"),
    days: z
      .number()
      .min(0)
      .max(365)
      .default(30)
      .describe("Lookback period in days (0 = all time, default 30)"),
    group_by: z
      .enum(["day", "week", "month"])
      .default("day")
      .describe("Time grouping for trend analysis (default 'day')"),
  },
  handleGetSalesAnalytics
);

// ═══════════════════════════════════════════════════════════
// REGISTER RESOURCES (read-only data AI clients can browse)
// ═══════════════════════════════════════════════════════════
// Resources = static data (like a menu board on the wall)
// Tools     = logic execution (like the kitchen cooking food)

// All 5 products with prices, costs, margins, inventory thresholds
server.resource(
  "product-catalog",
  "menu://products",
  async () => {
    const Product = (await import("./models/Product.js")).default;
    const products = await Product.find().lean();

    const catalog = products.map((p) => ({
      name: p.name,
      category: p.category,
      sell_price: `$${p.sellPrice.toFixed(2)}`,
      cost_price: `$${p.costPrice.toFixed(2)}`,
      profit_per_unit: `$${p.profitPerUnit.toFixed(2)}`,
      margin: `${p.marginPercent}%`,
      inventory_thresholds: {
        min_stock: p.inventory?.minStockDaily || "N/A",
        reorder_point: p.inventory?.reorderPoint || "N/A",
        max_stock: p.inventory?.maxStockDaily || "N/A",
      },
    }));

    return {
      contents: [
        {
          uri: "menu://products",
          text: JSON.stringify(catalog, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  }
);

// Latest stock level per product (raw numbers, no calculations)
server.resource(
  "inventory-snapshot",
  "inventory://current",
  async () => {
    const Inventory = (await import("./models/Inventory.js")).default;

    // Aggregation: sort by date DESC → group by product → take $first (latest)
    const latest = await Inventory.aggregate([
      { $sort: { date: -1 } },
      {
        $group: {
          _id: "$product",
          stock: { $first: "$stockLevel" },
          status: { $first: "$status" },
          date: { $first: "$date" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const snapshot = latest.map((i) => ({
      product: i._id,
      stock_level: i.stock,
      status: i.status === "red" ? "🔴" : i.status === "yellow" ? "🟡" : "🟢",
      as_of: new Date(i.date).toISOString().split("T")[0],
    }));

    return {
      contents: [
        {
          uri: "inventory://current",
          text: JSON.stringify(snapshot, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  }
);

// Cached festivals from MongoDB (no external API call)
server.resource(
  "upcoming-festivals",
  "festivals://upcoming",
  async () => {
    const Festival = (await import("./models/Festival.js")).default;
    const now = new Date();

    const festivals = await Festival.find({ date: { $gte: now } })
      .sort({ date: 1 })
      .limit(10)
      .lean();

    const data = festivals.map((f) => {
      const daysUntil = Math.ceil((new Date(f.date) - now) / (1000 * 60 * 60 * 24));
      return {
        name: f.name,
        date: new Date(f.date).toISOString().split("T")[0],
        days_until: daysUntil,
        demand_multiplier: f.demandMultiplier || 1.0,
      };
    });

    return {
      contents: [
        {
          uri: "festivals://upcoming",
          text: JSON.stringify(data, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// REGISTER PROMPTS (pre-built conversation starters for AI)
// ═══════════════════════════════════════════════════════════
// Prompts = shortcuts that tell the AI which tools to call
// The AI reads the prompt message and then executes tools itself

// Morning briefing: inventory + sales + festivals + recommendations
server.prompt(
  "daily-briefing",
  "Get a comprehensive daily overview of restaurant operations",
  {},
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            "Please give me today's restaurant briefing. I need:\n\n" +
            "1. **Inventory Check** — Run check_inventory for all products. Flag any 🟡 or 🔴 items.\n" +
            "2. **Sales Summary** — Use get_sales_analytics with 'overview' for the last 7 days.\n" +
            "3. **Top Sellers** — Use get_sales_analytics with 'top_sellers' for the last 7 days.\n" +
            "4. **Upcoming Festivals** — Check get_upcoming_festivals for the next 30 days.\n" +
            "5. **Recommendations** — Based on all the above, what should I order or prepare?\n\n" +
            "Format the response as a clean briefing with emojis and clear sections.",
        },
      },
    ],
  })
);

// Festival prep: forecast demand spikes + stock gap analysis
server.prompt(
  "festival-prep",
  "Prepare for an upcoming festival — forecast demand spikes and stock up",
  {
    days_ahead: z
      .number()
      .default(14)
      .describe("How many days ahead to prepare for"),
  },
  ({ days_ahead = 14 }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `I need to prepare for upcoming festivals in the next ${days_ahead} days.\n\n` +
            "Please:\n" +
            `1. **Upcoming Festivals** — Check get_upcoming_festivals for the next ${days_ahead} days.\n` +
            `2. **Demand Forecast** — Run forecast_demand for 'all' products over ${days_ahead} days.\n` +
            "3. **Current Stock** — Check check_inventory for all products.\n" +
            "4. **Gap Analysis** — Compare forecasted demand vs current stock.\n" +
            "5. **Order Recommendations** — How much extra should I order for each product?\n\n" +
            "Focus on products that might run out during the festival period.",
        },
      },
    ],
  })
);

// Weekly review: sales trends, profit analysis, best/worst performers
server.prompt(
  "weekly-review",
  "Analyze last week's performance — sales, profits, and trends",
  {},
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            "Give me a weekly performance review. I need:\n\n" +
            "1. **Sales Overview** — Use get_sales_analytics 'overview' for the last 7 days.\n" +
            "2. **Product Performance** — Use get_sales_analytics 'by_product' for the last 7 days.\n" +
            "3. **Channel Performance** — Use get_sales_analytics 'by_channel' for the last 7 days.\n" +
            "4. **Daily Trend** — Use get_sales_analytics 'trend' grouped by 'day' for 7 days.\n" +
            "5. **Profit Margins** — Use calculate_profit for the last 7 days.\n" +
            "6. **Key Insights** — What went well? What needs attention?\n\n" +
            "Present this as a clean weekly report with tables and highlights.",
        },
      },
    ],
  })
);

// ═══════════════════════════════════════════════════════════
// MAIN — Connect and Start
// ═══════════════════════════════════════════════════════════
async function main() {
  await connectDB();
  console.error("✅ MongoDB connected");

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("🧠 Restaurant Forecast MCP Server running on STDIO");
  console.error("   Tools:     forecast_demand, check_inventory, calculate_profit,");
  console.error("              get_upcoming_festivals, get_sales_analytics");
  console.error("   Resources: menu://products, inventory://current, festivals://upcoming");
  console.error("   Prompts:   daily-briefing, festival-prep, weekly-review");
}

// Graceful shutdown — close MCP server + disconnect MongoDB cleanly
process.on("SIGINT", async () => {
  console.error("\n🛑 Shutting down MCP Server...");
  await server.close();
  await disconnectDB();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.close();
  await disconnectDB();
  process.exit(0);
});

main().catch((error) => {
  console.error("❌ Fatal error starting MCP Server:", error);
  process.exit(1);
});
