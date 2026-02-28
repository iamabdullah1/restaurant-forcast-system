/**
 * 💰 Tool #3: calculate_profit
 * ═════════════════════════════
 *
 * 🎓 WHAT THIS TOOL DOES:
 *    Calculates profit margins for restaurant products.
 *    Every restaurant needs to answer: "Am I actually making money?"
 *
 *    Revenue is NOT profit. If you sell $10,000 worth of burgers
 *    but it costs $8,000 in ingredients, labor, and overhead,
 *    your actual profit is only $2,000 (20% margin).
 *
 * 🎓 KEY FORMULAS:
 *    Revenue     = price × quantity (what customer pays)
 *    COGS        = costPrice × quantity (Cost Of Goods Sold)
 *    Gross Profit = Revenue - COGS
 *    Margin %    = (Gross Profit / Revenue) × 100
 *
 * 🎓 WHAT IS COGS?
 *    "Cost Of Goods Sold" — the direct cost to produce the item.
 *    For Burgers: bun + patty + lettuce + sauce + cooking energy
 *    We store this as costPrice in our products.json config.
 *    This is GROSS profit — it doesn't include rent, salaries, etc.
 *
 * 🎓 WHY THIS MATTERS:
 *    Some products have HIGH revenue but LOW margin (cheap markup).
 *    Some products have LOW revenue but HIGH margin (big markup).
 *    Smart inventory management focuses on high-margin products.
 *    This tool helps the AI chatbot give financial advice.
 */

import Sale from "../models/Sale.js";
import Product from "../models/Product.js";

// ─── HELPER: Get cost map ───────────────────────────────
/**
 * 🎓 getCostMap():
 *    Creates a lookup object { productName: costPrice } from the
 *    Products collection. This lets us quickly find the cost of
 *    any product without repeated DB queries.
 *
 * 🎓 .reduce() Pattern:
 *    Array.reduce() transforms an array into a single value.
 *    Here we transform an array of product objects into ONE
 *    object mapping names to costs:
 *
 *    [{ name: "Burgers", costPrice: 5.50 }, { name: "Fries", costPrice: 0.80 }]
 *    →
 *    { "Burgers": 5.50, "Fries": 0.80 }
 */
async function getCostMap() {
  const products = await Product.find().lean();
  return products.reduce((map, p) => {
    map[p.name] = {
      costPrice: p.costPrice,
      sellPrice: p.sellPrice,
      marginPercent: p.marginPercent,
      category: p.category,
    };
    return map;
  }, {});
}

// ─── Analysis: Per-product profit breakdown ─────────────
/**
 * 🎓 getProductProfitBreakdown(dateFilter, costMap):
 *    Calculates revenue, COGS, gross profit, and margin for each product.
 *
 *    Uses MongoDB aggregation to sum up revenue and quantity per product,
 *    then applies cost data in JavaScript to compute profits.
 *
 * 🎓 WHY NOT CALCULATE COGS IN MONGODB?
 *    Because the cost data lives in a DIFFERENT collection (Products),
 *    not in Sales. We COULD use $lookup (MongoDB join), but it's
 *    simpler and more readable to do the join in JS code.
 *    For a small dataset (5 products), this is perfectly fine.
 */
async function getProductProfitBreakdown(dateFilter, costMap) {
  const salesByProduct = await Sale.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: "$product",
        revenue: { $sum: { $multiply: ["$price", "$quantity"] } },
        totalQuantity: { $sum: "$quantity" },
        orderCount: { $sum: 1 },
        avgPrice: { $avg: "$price" },
      },
    },
    { $sort: { revenue: -1 } },
  ]);

  return salesByProduct.map((item) => {
    const cost = costMap[item._id] || { costPrice: 0 };
    const cogs = cost.costPrice * item.totalQuantity;
    const grossProfit = item.revenue - cogs;
    const marginPct = item.revenue > 0
      ? (grossProfit / item.revenue) * 100
      : 0;

    return {
      product: item._id,
      category: cost.category || "unknown",
      revenue: Math.round(item.revenue * 100) / 100,
      cost_of_goods: Math.round(cogs * 100) / 100,
      gross_profit: Math.round(grossProfit * 100) / 100,
      margin_percent: Math.round(marginPct * 10) / 10,
      units_sold: item.totalQuantity,
      orders: item.orderCount,
      avg_selling_price: Math.round(item.avgPrice * 100) / 100,
      cost_per_unit: cost.costPrice,
      profit_per_unit:
        Math.round((item.avgPrice - cost.costPrice) * 100) / 100,
    };
  });
}

// ─── Analysis: Profit trend over time ───────────────────
/**
 * 🎓 getProfitTrend(dateFilter, costMap, groupBy):
 *    Shows how profit changes over time — is it growing or shrinking?
 *
 *    Groups by day/week/month and calculates total profit per period.
 *    The tricky part: we need BOTH the revenue AND the cost for each
 *    period. Revenue comes from sales data; cost requires looking up
 *    each product's cost and multiplying by quantity.
 *
 * 🎓 MongoDB $cond:
 *    Conditional expression — like a ternary (condition ? true : false).
 *    We use it to assign cost_price based on which product was sold.
 *    But since $cond gets messy with 5 products, we instead:
 *    1. Group by (period + product) to get quantity per product per period
 *    2. Apply cost in JavaScript
 *    3. Re-group by period to get totals
 *    This is cleaner and more maintainable.
 */
async function getProfitTrend(dateFilter, costMap, groupBy = "day") {
  const dateFormats = {
    day: "%Y-%m-%d",
    week: "%Y-W%V",
    month: "%Y-%m",
  };
  const format = dateFormats[groupBy] || dateFormats.day;

  // Step 1: Get revenue + quantity per period per product
  const rawData = await Sale.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: {
          period: { $dateToString: { format, date: "$date" } },
          product: "$product",
        },
        revenue: { $sum: { $multiply: ["$price", "$quantity"] } },
        quantity: { $sum: "$quantity" },
      },
    },
    { $sort: { "_id.period": 1 } },
  ]);

  // Step 2: Apply costs and re-group by period
  /**
   * 🎓 Grouping Strategy:
   *    We use a Map to accumulate totals per period.
   *    For each (period, product) combo from MongoDB, we look up the
   *    cost in our costMap, calculate COGS, and add to the period total.
   */
  const periodMap = new Map();

  for (const item of rawData) {
    const period = item._id.period;
    const cost = costMap[item._id.product] || { costPrice: 0 };
    const cogs = cost.costPrice * item.quantity;
    const profit = item.revenue - cogs;

    if (!periodMap.has(period)) {
      periodMap.set(period, { period, revenue: 0, cogs: 0, profit: 0, orders: 0 });
    }

    const entry = periodMap.get(period);
    entry.revenue += item.revenue;
    entry.cogs += cogs;
    entry.profit += profit;
  }

  return Array.from(periodMap.values()).map((e) => ({
    period: e.period,
    revenue: Math.round(e.revenue * 100) / 100,
    cost_of_goods: Math.round(e.cogs * 100) / 100,
    gross_profit: Math.round(e.profit * 100) / 100,
    margin_percent:
      e.revenue > 0
        ? Math.round((e.profit / e.revenue) * 100 * 10) / 10
        : 0,
  }));
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════
/**
 * 🎓 handleCalculateProfit({ product, days, include_trend, group_by }):
 *    Called by MCP Server when AI invokes "calculate_profit".
 *
 *    Combines:
 *      1. Per-product profit breakdown (always included)
 *      2. Overall totals (always included)
 *      3. Profit trend over time (optional, if include_trend is true)
 *
 * @param {object} params
 * @param {string} params.product - specific product or "all"
 * @param {number} params.days - lookback period (0 = all time)
 * @param {boolean} params.include_trend - whether to include time trend
 * @param {string} params.group_by - for trend: day/week/month
 */
export async function handleCalculateProfit({
  product = "all",
  days = 30,
  include_trend = false,
  group_by = "day",
}) {
  try {
    // ── Build date filter ──────────────────────────────
    const dateFilter =
      days && days > 0
        ? { date: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } }
        : {};

    // Add product filter if specific product requested
    if (product && product !== "all") {
      dateFilter.product = product;
    }

    // ── Get cost data ──────────────────────────────────
    const costMap = await getCostMap();

    // ── Run analysis ───────────────────────────────────
    const breakdown = await getProductProfitBreakdown(dateFilter, costMap);

    // ── Calculate overall totals ───────────────────────
    /**
     * 🎓 Array.reduce() for Totals:
     *    We sum up all product breakdowns to get the grand total.
     *    Starting value (acc) is an object with all zeros.
     *    Each iteration adds one product's numbers to the accumulator.
     */
    const totals = breakdown.reduce(
      (acc, item) => {
        acc.revenue += item.revenue;
        acc.cost_of_goods += item.cost_of_goods;
        acc.gross_profit += item.gross_profit;
        acc.units_sold += item.units_sold;
        acc.orders += item.orders;
        return acc;
      },
      { revenue: 0, cost_of_goods: 0, gross_profit: 0, units_sold: 0, orders: 0 }
    );

    totals.revenue = Math.round(totals.revenue * 100) / 100;
    totals.cost_of_goods = Math.round(totals.cost_of_goods * 100) / 100;
    totals.gross_profit = Math.round(totals.gross_profit * 100) / 100;
    totals.overall_margin_percent =
      totals.revenue > 0
        ? Math.round((totals.gross_profit / totals.revenue) * 100 * 10) / 10
        : 0;

    // ── Insights (mini analysis) ───────────────────────
    /**
     * 🎓 INSIGHTS:
     *    We auto-generate useful insights from the data.
     *    The AI chatbot can use these to give smart recommendations.
     *    For example: "Fries have the highest margin at 77%!"
     */
    const sortedByMargin = [...breakdown].sort(
      (a, b) => b.margin_percent - a.margin_percent
    );
    const sortedByProfit = [...breakdown].sort(
      (a, b) => b.gross_profit - a.gross_profit
    );

    const insights = {
      highest_margin_product: sortedByMargin[0]
        ? `${sortedByMargin[0].product} (${sortedByMargin[0].margin_percent}%)`
        : "N/A",
      lowest_margin_product: sortedByMargin[sortedByMargin.length - 1]
        ? `${sortedByMargin[sortedByMargin.length - 1].product} (${sortedByMargin[sortedByMargin.length - 1].margin_percent}%)`
        : "N/A",
      most_profitable_product: sortedByProfit[0]
        ? `${sortedByProfit[0].product} ($${sortedByProfit[0].gross_profit})`
        : "N/A",
      tip:
        totals.overall_margin_percent >= 60
          ? "💪 Great margins! Your pricing strategy is solid."
          : totals.overall_margin_percent >= 40
            ? "👍 Decent margins. Consider optimizing high-volume, low-margin items."
            : "⚠️ Low margins. Review your cost structure and pricing.",
    };

    // ── Build response ─────────────────────────────────
    const response = {
      period: days > 0 ? `Last ${days} days` : "All time",
      product_filter: product,
      totals,
      insights,
      product_breakdown: breakdown,
    };

    // Optionally include profit trend
    if (include_trend) {
      /**
       * 🎓 We only compute the trend if requested (include_trend: true).
       *    Trend analysis requires extra DB queries, so we skip it
       *    when the caller just wants a quick summary. This is a
       *    performance optimization — don't compute what you don't need.
       */
      response.profit_trend = await getProfitTrend(dateFilter, costMap, group_by);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error("❌ calculate_profit error:", error.message);
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
