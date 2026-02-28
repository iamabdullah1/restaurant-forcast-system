/**
 * 📊 Tool #5: get_sales_analytics
 * ════════════════════════════════
 *
 * 🎓 WHAT THIS TOOL DOES:
 *    Provides sales analytics using MongoDB aggregation pipelines.
 *    Think of it as a mini "Business Intelligence" engine — it answers
 *    questions like:
 *      - "How much did we sell last week?"
 *      - "Which product is the bestseller?"
 *      - "What are our sales trends over time?"
 *      - "Which sales channel (Dine-in, Takeaway, Online) brings the most revenue?"
 *
 * 🎓 AGGREGATION PIPELINES:
 *    MongoDB aggregation pipelines are the #1 superpower for analytics.
 *    They process data in stages (like a factory assembly line):
 *
 *    Raw Docs → $match → $group → $sort → $project → Final Result
 *
 *    Each stage transforms the data and passes it to the next stage.
 *    This all happens INSIDE MongoDB (server-side), so it's FAST —
 *    you don't pull all records into Node.js to process them.
 *
 * 🎓 SUPPORTED ANALYSIS TYPES:
 *    - "overview"  → Total sales summary (revenue, quantity, avg order)
 *    - "by_product" → Breakdown per product
 *    - "by_channel" → Breakdown per sales channel (Dine-in/Takeaway/Online)
 *    - "trend"     → Sales over time (grouped by day/week/month)
 *    - "top_sellers" → Top N products by quantity or revenue
 */

import Sale from "../models/Sale.js";

// ─── HELPER: Build the date filter ──────────────────────
/**
 * 🎓 buildDateFilter(days):
 *    Creates a MongoDB $match condition that filters sales
 *    to the last N days.
 *
 *    Example: days=7 → only sales from the past week
 *    If days is null/0, returns empty object (no date filter = all time)
 *
 * 🎓 $gte means "greater than or equal to" — a MongoDB comparison operator.
 *    So { date: { $gte: someDate } } means "date >= someDate"
 */
function buildDateFilter(days) {
  if (!days || days <= 0) return {};

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  return { date: { $gte: startDate } };
}

// ─── Analysis: Overview (Total summary) ─────────────────
/**
 * 🎓 getOverview(dateFilter):
 *    The big picture — total revenue, total units sold, total orders,
 *    and average order value across all products.
 *
 *    Pipeline stages:
 *      $match  → filter by date range
 *      $group  → calculate totals (revenue, quantity, order count)
 *      $project → compute average order value (revenue ÷ orders)
 *
 * 🎓 $multiply: ["$price", "$quantity"]:
 *    MongoDB expression operator — calculates revenue per document.
 *    Since each sale record has a price and quantity, their product
 *    gives us the revenue for that particular order line.
 */
async function getOverview(dateFilter) {
  const result = await Sale.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: { $multiply: ["$price", "$quantity"] } },
        totalQuantity: { $sum: "$quantity" },
        totalOrders: { $sum: 1 },
        avgPrice: { $avg: "$price" },
        uniqueProducts: { $addToSet: "$product" },
        uniqueChannels: { $addToSet: "$purchaseType" },
      },
    },
    {
      $project: {
        _id: 0,
        total_revenue: { $round: ["$totalRevenue", 2] },
        total_quantity: "$totalQuantity",
        total_orders: "$totalOrders",
        avg_order_value: {
          $round: [{ $divide: ["$totalRevenue", "$totalOrders"] }, 2],
        },
        avg_price: { $round: ["$avgPrice", 2] },
        product_count: { $size: "$uniqueProducts" },
        channel_count: { $size: "$uniqueChannels" },
      },
    },
  ]);

  return result[0] || {
    total_revenue: 0,
    total_quantity: 0,
    total_orders: 0,
    avg_order_value: 0,
  };
}

// ─── Analysis: By Product ───────────────────────────────
/**
 * 🎓 getByProduct(dateFilter):
 *    Groups sales by product name and calculates each product's
 *    revenue, quantity, order count, and percentage of total.
 *
 *    This helps answer: "Which product brings the most money?"
 *
 * 🎓 $sort: { revenue: -1 }:
 *    Sort by revenue DESCENDING (highest first).
 *    -1 = descending, 1 = ascending (in MongoDB sort)
 */
async function getByProduct(dateFilter) {
  const results = await Sale.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: "$product",
        revenue: { $sum: { $multiply: ["$price", "$quantity"] } },
        quantity: { $sum: "$quantity" },
        orders: { $sum: 1 },
        avg_price: { $avg: "$price" },
      },
    },
    { $sort: { revenue: -1 } },
    {
      $project: {
        _id: 0,
        product: "$_id",
        revenue: { $round: ["$revenue", 2] },
        quantity: "$quantity",
        orders: "$orders",
        avg_price: { $round: ["$avg_price", 2] },
      },
    },
  ]);

  // Calculate percentage of total revenue
  const totalRevenue = results.reduce((sum, r) => sum + r.revenue, 0);
  return results.map((r) => ({
    ...r,
    revenue_pct: totalRevenue > 0
      ? Math.round((r.revenue / totalRevenue) * 100 * 10) / 10
      : 0,
  }));
}

// ─── Analysis: By Channel ───────────────────────────────
/**
 * 🎓 getByChannel(dateFilter):
 *    Groups by purchaseType (Dine-in, Takeaway, Online).
 *    Shows which sales channel performs best.
 *
 *    Great for questions like: "Should we invest more in online ordering?"
 */
async function getByChannel(dateFilter) {
  const results = await Sale.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: "$purchaseType",
        revenue: { $sum: { $multiply: ["$price", "$quantity"] } },
        quantity: { $sum: "$quantity" },
        orders: { $sum: 1 },
      },
    },
    { $sort: { revenue: -1 } },
    {
      $project: {
        _id: 0,
        channel: "$_id",
        revenue: { $round: ["$revenue", 2] },
        quantity: "$quantity",
        orders: "$orders",
      },
    },
  ]);

  const totalRevenue = results.reduce((sum, r) => sum + r.revenue, 0);
  return results.map((r) => ({
    ...r,
    revenue_pct: totalRevenue > 0
      ? Math.round((r.revenue / totalRevenue) * 100 * 10) / 10
      : 0,
  }));
}

// ─── Analysis: Trend (over time) ────────────────────────
/**
 * 🎓 getTrend(dateFilter, groupBy):
 *    Groups sales by TIME PERIOD and shows trends.
 *
 *    groupBy can be:
 *      "day"   → one data point per day
 *      "week"  → one data point per week (ISO week number)
 *      "month" → one data point per month
 *
 * 🎓 Date Grouping in MongoDB:
 *    $dateToString formats a date into a string pattern:
 *      "%Y-%m-%d" → "2024-01-15" (day)
 *      "%Y-W%V"   → "2024-W03" (ISO week)
 *      "%Y-%m"    → "2024-01" (month)
 *
 * 🎓 WHY TRENDS MATTER:
 *    Trends show if sales are going UP ↑ or DOWN ↓ over time.
 *    For forecasting, this is essential — you need to know if
 *    the restaurant is growing, stable, or declining.
 */
async function getTrend(dateFilter, groupBy = "day") {
  /**
   * 🎓 Date format mapping:
   *    Each groupBy option maps to a different $dateToString format.
   *    ISO week (%V) is the international standard week numbering
   *    (Week 01 = first week with Thursday in the new year).
   */
  const dateFormats = {
    day: "%Y-%m-%d",
    week: "%Y-W%V",
    month: "%Y-%m",
  };
  const format = dateFormats[groupBy] || dateFormats.day;

  const results = await Sale.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: { $dateToString: { format, date: "$date" } },
        revenue: { $sum: { $multiply: ["$price", "$quantity"] } },
        quantity: { $sum: "$quantity" },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } }, // Chronological order
    {
      $project: {
        _id: 0,
        period: "$_id",
        revenue: { $round: ["$revenue", 2] },
        quantity: "$quantity",
        orders: "$orders",
      },
    },
  ]);

  return results;
}

// ─── Analysis: Top Sellers ──────────────────────────────
/**
 * 🎓 getTopSellers(dateFilter, limit):
 *    Returns the top N products by both quantity sold AND revenue.
 *    Useful for identifying bestsellers and cash cows.
 *
 * 🎓 $limit: Caps the number of documents returned by the pipeline.
 *    Combined with $sort, it gives you "top N" results efficiently.
 *    MongoDB does this INSIDE the database engine — it doesn't
 *    return all docs and then slice them.
 */
async function getTopSellers(dateFilter, limit = 5) {
  const byQuantity = await Sale.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: "$product",
        total_quantity: { $sum: "$quantity" },
        revenue: { $sum: { $multiply: ["$price", "$quantity"] } },
      },
    },
    { $sort: { total_quantity: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        product: "$_id",
        total_quantity: "$total_quantity",
        revenue: { $round: ["$revenue", 2] },
      },
    },
  ]);

  const byRevenue = await Sale.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: "$product",
        total_quantity: { $sum: "$quantity" },
        revenue: { $sum: { $multiply: ["$price", "$quantity"] } },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        product: "$_id",
        total_quantity: "$total_quantity",
        revenue: { $round: ["$revenue", 2] },
      },
    },
  ]);

  return {
    by_quantity: byQuantity,
    by_revenue: byRevenue,
  };
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════
/**
 * 🎓 handleGetSalesAnalytics({ analysis_type, days, group_by }):
 *    Called by MCP Server when AI invokes "get_sales_analytics".
 *
 *    Dispatches to the appropriate sub-function based on analysis_type.
 *    This "dispatcher" pattern keeps the handler clean and each
 *    analysis type modular and testable.
 *
 * @param {object} params
 * @param {string} params.analysis_type - one of: overview, by_product, by_channel, trend, top_sellers
 * @param {number} params.days - lookback period (optional, 0 = all time)
 * @param {string} params.group_by - for trend: day, week, or month
 */
export async function handleGetSalesAnalytics({
  analysis_type = "overview",
  days = 30,
  group_by = "day",
}) {
  try {
    const dateFilter = buildDateFilter(days);

    /**
     * 🎓 Dispatcher Pattern:
     *    Instead of a long if/else chain, we use an object map.
     *    Each key is an analysis_type, each value is the function
     *    that handles it. This is cleaner and more extensible —
     *    to add a new analysis type, just add a new key-value pair.
     */
    const analysisMap = {
      overview: () => getOverview(dateFilter),
      by_product: () => getByProduct(dateFilter),
      by_channel: () => getByChannel(dateFilter),
      trend: () => getTrend(dateFilter, group_by),
      top_sellers: () => getTopSellers(dateFilter),
    };

    const analysisFn = analysisMap[analysis_type];
    if (!analysisFn) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Unknown analysis type: "${analysis_type}"`,
              available_types: Object.keys(analysisMap),
            }),
          },
        ],
        isError: true,
      };
    }

    const data = await analysisFn();

    // Build response with metadata
    const response = {
      analysis_type,
      period: days > 0 ? `Last ${days} days` : "All time",
      ...(group_by && analysis_type === "trend" ? { grouped_by: group_by } : {}),
      data,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error("❌ get_sales_analytics error:", error.message);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: error.message }),
        },
      ],
      isError: true,
    };
  }
}
