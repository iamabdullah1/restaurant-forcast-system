/**
 * 📦 Tool #2: check_inventory
 * ════════════════════════════
 *
 * 🎓 WHAT THIS TOOL DOES:
 *    Checks current stock levels for restaurant products and returns
 *    a traffic-light status system:
 *      🟢 Green  = stock >= reorderPoint (healthy, no action needed)
 *      🟡 Yellow = minStock <= stock < reorderPoint (low, order soon!)
 *      🔴 Red    = stock < minStock (critical — you might run out!)
 *
 *    Also calculates:
 *      - Average daily consumption (from recent sales data)
 *      - Estimated days until stockout (stock ÷ avg consumption)
 *      - Restock recommendation (how much to order)
 *
 * 🎓 DATA SOURCES:
 *    - Inventory collection: current stock levels per product per day
 *    - Sales collection: historical consumption (to calculate averages)
 *    - Products collection: threshold config (minStock, reorderPoint, maxStock)
 *
 * 🎓 WHY "LATEST" INVENTORY?
 *    We store daily snapshots in the inventory collection. The "current"
 *    stock is the MOST RECENT entry for each product. We use
 *    MongoDB's aggregation pipeline to find the latest date per product.
 */

import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import Inventory from "../models/Inventory.js";

// ─── HELPER: Calculate average daily consumption ────────
/**
 * 🎓 getAvgDailyConsumption(product, lookbackDays):
 *    Calculates how much of a product is consumed per day on average,
 *    looking at the last N days of sales data.
 *
 *    Uses MongoDB aggregation pipeline:
 *      $match  → filter to recent sales of this product
 *      $group  → sum total quantity sold
 *      Then divide by lookbackDays to get daily average.
 *
 * 🎓 WHY 30 DAYS?
 *    30 days is a good balance — recent enough to reflect current trends,
 *    but long enough to smooth out one-off spikes (like a festival).
 *    You could use 7 days for more reactive inventory management.
 *
 * @param {string} productName - e.g., "Burgers"
 * @param {number} lookbackDays - how many days to average over (default 30)
 * @returns {number} average units consumed per day
 */
async function getAvgDailyConsumption(productName, lookbackDays = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  /**
   * 🎓 MongoDB Aggregation Pipeline:
   *    An aggregation pipeline is a series of "stages" that process
   *    documents one stage at a time, like an assembly line.
   *
   *    $match: Filter documents (like SQL WHERE)
   *    $group: Group documents and compute aggregates (like SQL GROUP BY)
   *
   *    _id: null means "group ALL matching documents into one group"
   *    $sum: "$quantity" means "add up all the quantity fields"
   */
  const result = await Sale.aggregate([
    {
      $match: {
        product: productName,
        date: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        totalQty: { $sum: "$quantity" },
        dayCount: { $addToSet: "$date" }, // Unique days with sales
      },
    },
  ]);

  if (!result.length || !result[0].dayCount.length) return 0;

  /**
   * 🎓 We divide by actual days with sales (not lookbackDays).
   *    This handles gaps — if the restaurant was closed some days,
   *    we don't count those as zero-consumption days.
   */
  return Math.round(result[0].totalQty / result[0].dayCount.length);
}

// ─── HELPER: Get latest inventory snapshot ──────────────
/**
 * 🎓 getLatestInventory(productFilter):
 *    Finds the most recent inventory record for each product.
 *
 *    If productFilter is provided, only returns that product.
 *    If null/undefined, returns all products.
 *
 * 🎓 .sort({ date: -1 }):
 *    Sort by date descending → most recent first.
 *    Combined with .limit(1) or aggregation $first, gives us
 *    the latest snapshot.
 *
 * 🎓 Why aggregate instead of find?
 *    Because we need the latest record PER PRODUCT. With find(),
 *    we'd need separate queries for each product. With aggregate(),
 *    we do it in ONE query using $sort + $group + $first.
 */
async function getLatestInventory(productFilter) {
  const matchStage = productFilter
    ? { $match: { product: productFilter } }
    : { $match: {} };

  const results = await Inventory.aggregate([
    matchStage,
    { $sort: { date: -1 } }, // Most recent first
    {
      $group: {
        _id: "$product",
        latestDate: { $first: "$date" },
        stockLevel: { $first: "$stockLevel" },
        consumed: { $first: "$consumed" },
        restocked: { $first: "$restocked" },
        status: { $first: "$status" },
      },
    },
    { $sort: { _id: 1 } }, // Sort products alphabetically
  ]);

  return results;
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════
/**
 * 🎓 handleCheckInventory({ product }):
 *    Called by MCP Server when AI client invokes "check_inventory".
 *
 *    Algorithm:
 *      1. Get product thresholds from Products collection
 *      2. Get latest inventory snapshot(s)
 *      3. Calculate avg daily consumption for each product
 *      4. Compute days until stockout
 *      5. Classify status (🟢🟡🔴)
 *      6. Return formatted response
 */
export async function handleCheckInventory({ product }) {
  try {
    // ── Step 1: Get product configs (thresholds) ───────
    /**
     * 🎓 If product is "all" or undefined, get ALL products.
     *    Otherwise, filter to the specific product.
     *
     * 🎓 .lean(): Returns plain JS objects (faster than Mongoose docs).
     */
    const productFilter = product && product !== "all" ? product : null;
    const productDocs = productFilter
      ? await Product.find({ name: productFilter }).lean()
      : await Product.find().lean();

    if (!productDocs.length) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Product "${product}" not found`,
              available: ["Burgers", "Chicken Sandwiches", "Fries", "Beverages", "Sides & Other"],
            }),
          },
        ],
        isError: true,
      };
    }

    // ── Step 2: Get latest inventory ───────────────────
    const latestInventory = await getLatestInventory(productFilter);

    // ── Step 3: Build result for each product ──────────
    /**
     * 🎓 Promise.all() runs multiple async operations IN PARALLEL.
     *    Instead of awaiting each product one by one (sequential, slow),
     *    we start ALL of them at once and wait for all to finish.
     *    5 products × 1 DB query each = 5 queries in parallel = fast!
     */
    const results = await Promise.all(
      productDocs.map(async (prod) => {
        // Find this product's inventory record
        const inv = latestInventory.find((i) => i._id === prod.name);
        const stockLevel = inv ? inv.stockLevel : 0;
        const lastDate = inv ? inv.latestDate : null;

        // Calculate average daily consumption
        const avgDaily = await getAvgDailyConsumption(prod.name);

        // Days until stockout
        /**
         * 🎓 Infinity means "will never run out" (if avgDaily is 0,
         *    the product isn't being sold, so stock won't deplete).
         *    We cap at 999 for display purposes.
         */
        const daysUntilStockout =
          avgDaily > 0
            ? Math.round(stockLevel / avgDaily)
            : 999;

        // Determine status based on thresholds
        const thresholds = prod.inventory || {};
        let status, emoji, action;

        if (stockLevel < (thresholds.minStockDaily || 0)) {
          status = "red";
          emoji = "🔴";
          action = "CRITICAL — Order immediately!";
        } else if (stockLevel < (thresholds.reorderPoint || 0)) {
          status = "yellow";
          emoji = "🟡";
          action = "LOW — Place order soon";
        } else {
          status = "green";
          emoji = "🟢";
          action = "OK — Stock is healthy";
        }

        // How much to restock?
        const maxStock = thresholds.maxStockDaily || stockLevel * 2;
        const restockQty = Math.max(0, maxStock - stockLevel);

        return {
          product: prod.name,
          category: prod.category,
          stock_level: stockLevel,
          status,
          emoji,
          action,
          avg_daily_consumption: avgDaily,
          days_until_stockout: Math.min(daysUntilStockout, 999),
          thresholds: {
            min_stock: thresholds.minStockDaily || 0,
            reorder_point: thresholds.reorderPoint || 0,
            max_stock: maxStock,
          },
          restock_recommendation: restockQty,
          last_updated: lastDate
            ? new Date(lastDate).toISOString().split("T")[0]
            : "N/A",
        };
      })
    );

    // ── Step 4: Build summary & alerts ─────────────────
    const alerts = results
      .filter((r) => r.status !== "green")
      .map((r) => `${r.emoji} ${r.product}: ${r.action} (${r.stock_level} units, ~${r.days_until_stockout} days left)`);

    const summary = {
      total_products: results.length,
      green: results.filter((r) => r.status === "green").length,
      yellow: results.filter((r) => r.status === "yellow").length,
      red: results.filter((r) => r.status === "red").length,
      alerts: alerts.length > 0 ? alerts : ["✅ All products are well-stocked"],
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ products: results, summary }, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error("❌ check_inventory error:", error.message);
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
