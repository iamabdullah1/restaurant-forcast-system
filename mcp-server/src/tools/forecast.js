/**
 * 🔮 Tool #1: forecast_demand — NOW POWERED BY REAL ML!
 * ═══════════════════════════════════════════════════════
 *
 * 🎓 WHAT CHANGED (Phase 2 Upgrade):
 *    Previously, this tool used a moving-average stub — a basic
 *    statistical approach that averaged recent sales.
 *
 *    NOW, it calls the Python ML Service (FastAPI + Facebook Prophet),
 *    which provides:
 *      ✅ Time-series ML model (Prophet) trained on ALL historical data
 *      ✅ Confidence intervals (yhat_lower / yhat_upper)
 *      ✅ Festival spike multipliers calculated from REAL data
 *      ✅ Proper trend + seasonality decomposition
 *      ✅ Profit projections tied to forecasts
 *
 * 🎓 HOW IT WORKS NOW:
 *    1. MCP Server receives forecast_demand tool call from Claude
 *    2. This function makes an HTTP request to FastAPI (localhost:8000)
 *    3. FastAPI runs Prophet prediction + spike analysis + profit projection
 *    4. Results come back as JSON → formatted for the AI to read
 *
 * 🎓 FALLBACK STRATEGY:
 *    If the ML service is down (not running, crashed, network error),
 *    we fall back to the old moving-average stub so the MCP tool
 *    STILL WORKS — just with less accurate predictions.
 *    This is called "graceful degradation" — a key production pattern.
 *
 * 🎓 WHAT IS fetch()?
 *    fetch() is a built-in browser/Node.js function for making HTTP requests.
 *    It's like curl or Postman but in code.
 *    fetch(url) returns a Promise → we await it → parse JSON response.
 *    Node.js 18+ has fetch() built in (no need for node-fetch package).
 */

import Sale from "../models/Sale.js";

// ── Configuration ───────────────────────────────────────
// The ML service URL. In production, this would come from environment variables.
// For local development, FastAPI runs on port 8000.
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

// Timeout for ML service requests (30 seconds).
// If Prophet is still training, this gives it time to respond.
const ML_TIMEOUT_MS = 30000;


// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════
/**
 * 🎓 handleForecastDemand({ product, days_ahead }):
 *    Called by MCP Server when AI invokes "forecast_demand".
 *
 *    Strategy:
 *      1. TRY calling the real ML service (Prophet-powered)
 *      2. IF ML service fails → FALL BACK to moving-average stub
 *      3. Format results for MCP protocol (must return { content: [...] })
 *
 * @param {object} params
 * @param {string} params.product - product to forecast (or "all")
 * @param {number} params.days_ahead - how many days to predict (1-90)
 */
export async function handleForecastDemand({ product = "all", days_ahead = 30 }) {
  try {
    // ── Attempt 1: Call the real ML service ───────────
    console.error(`🔮 forecast_demand: Calling ML service for ${product}, ${days_ahead} days...`);

    const mlResult = await callMLService(product, days_ahead);

    if (mlResult) {
      console.error(`✅ ML service responded successfully`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(mlResult, null, 2),
          },
        ],
      };
    }

    // ── Attempt 2: Fallback to moving-average stub ───
    console.error(`⚠️  ML service unavailable, using moving-average fallback`);
    const fallbackResult = await movingAverageFallback(product, days_ahead);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(fallbackResult, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error("❌ forecast_demand error:", error.message);
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


// ═══════════════════════════════════════════════════════════
// ML SERVICE CALLER
// ═══════════════════════════════════════════════════════════
/**
 * 🎓 callMLService(product, days):
 *    Makes HTTP requests to the Python FastAPI service.
 *
 *    If product is "all", we call two endpoints:
 *      - GET /forecast/?days=30   → demand for all products
 *      - GET /profit/?days=30     → profit for all products
 *
 *    If product is specific (e.g. "Burgers"), we call:
 *      - GET /forecast/Burgers?days=30
 *      - GET /profit/Burgers?days=30
 *
 *    We combine both into one rich response.
 *
 * 🎓 AbortController + setTimeout:
 *    This is how you add a TIMEOUT to fetch().
 *    If the server doesn't respond in time, the request is aborted.
 *    Without this, a hung server would block the MCP tool forever.
 *
 * @returns {object|null} Combined forecast+profit data, or null if service is down
 */
async function callMLService(product, days) {
  try {
    // ── Build URLs ──────────────────────────────────
    /**
     * 🎓 encodeURIComponent:
     *    Some product names have special characters ("Sides & Other").
     *    URL-encoding converts "&" to "%26" so the URL doesn't break.
     *    "Sides & Other" → "Sides%20%26%20Other"
     */
    const encodedProduct = encodeURIComponent(product);

    let forecastUrl, profitUrl;

    if (product === "all") {
      forecastUrl = `${ML_SERVICE_URL}/forecast/?days=${days}`;
      profitUrl = `${ML_SERVICE_URL}/profit/?days=${days}`;
    } else {
      forecastUrl = `${ML_SERVICE_URL}/forecast/${encodedProduct}?days=${days}`;
      profitUrl = `${ML_SERVICE_URL}/profit/${encodedProduct}?days=${days}`;
    }

    // ── Make both requests in parallel ──────────────
    /**
     * 🎓 Promise.all:
     *    Runs multiple async operations simultaneously.
     *    Instead of waiting for forecast, THEN waiting for profit (slow),
     *    we fire both at once and wait for both to finish (fast).
     *
     * 🎓 AbortController:
     *    Creates a "cancel signal" that we pass to fetch.
     *    If setTimeout fires first, the signal cancels the request.
     *    This prevents the tool from hanging if ML service is down.
     */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);

    const [forecastRes, profitRes] = await Promise.all([
      fetch(forecastUrl, { signal: controller.signal }),
      fetch(profitUrl, { signal: controller.signal }),
    ]);

    clearTimeout(timeout);

    // ── Check responses ─────────────────────────────
    if (!forecastRes.ok || !profitRes.ok) {
      console.error(
        `ML service returned error: forecast=${forecastRes.status}, profit=${profitRes.status}`
      );
      return null; // Will trigger fallback
    }

    const forecastData = await forecastRes.json();
    const profitData = await profitRes.json();

    // ── Combine into unified response ───────────────
    /**
     * 🎓 Why combine forecast + profit?
     *    The AI gets one rich response with everything it needs:
     *    "You'll sell 1,250 Burgers next month ($16,237 revenue, $9,362 profit)"
     *    instead of needing two separate tool calls.
     */
    return formatMLResponse(product, days, forecastData, profitData);
  } catch (error) {
    // fetch throws on network errors, timeout (AbortError), etc.
    if (error.name === "AbortError") {
      console.error(`⏱️  ML service timed out after ${ML_TIMEOUT_MS}ms`);
    } else {
      console.error(`🔌 ML service connection error: ${error.message}`);
    }
    return null; // Will trigger fallback
  }
}


// ═══════════════════════════════════════════════════════════
// FORMAT ML RESPONSE
// ═══════════════════════════════════════════════════════════
/**
 * 🎓 formatMLResponse:
 *    Takes the raw FastAPI responses and reformats them into a
 *    structure that the AI can easily read and explain to users.
 *
 *    We keep a consistent structure so the AI's prompts
 *    and response patterns work reliably.
 */
function formatMLResponse(product, days, forecastData, profitData) {
  // ── Single product response ───────────────────────
  // Python returns: predicted_demand, lower_bound, upper_bound, spike_multiplier
  // Profit returns: totals.total_revenue, totals.total_profit, daily_projections[].revenue/cost/profit
  if (product !== "all") {
    const forecast = forecastData;
    const profit = profitData;

    return {
      metadata: {
        product: product,
        forecast_days: days,
        model: "prophet_ml",
        confidence: "high",
        ml_service: "connected",
        note: "🤖 ML-powered forecast using Facebook Prophet time-series model with festival spike analysis.",
      },
      summary: {
        total_predicted_quantity: forecast.summary?.total_predicted || Math.round(
          forecast.daily_forecast?.reduce((sum, d) => sum + d.predicted_demand, 0) || 0
        ),
        avg_daily_predicted: forecast.summary?.avg_daily_demand || Math.round(
          forecast.daily_forecast?.reduce((sum, d) => sum + d.predicted_demand, 0) / days || 0
        ),
        peak_day: findPeakDay(forecast.daily_forecast || []),
        festival_days: (forecast.daily_forecast || []).filter(
          (d) => d.spike_multiplier && d.spike_multiplier > 1.0
        ).length,
      },
      profit_projection: {
        total_revenue: profit.totals?.total_revenue || 0,
        total_cost: profit.totals?.total_cost || 0,
        total_profit: profit.totals?.total_profit || 0,
        margin_percent: profit.totals?.margin_percent || 0,
        avg_daily_profit: profit.totals?.avg_daily_profit || 0,
      },
      daily_forecast: (forecast.daily_forecast || []).map((day, i) => ({
        date: day.date,
        day_name: day.day_name,
        predicted_quantity: day.predicted_demand,
        confidence_low: day.lower_bound,
        confidence_high: day.upper_bound,
        festival_multiplier: day.spike_multiplier,
        festival_name: day.festival_name || null,
        ...(profit.daily_projections?.[i]
          ? {
              projected_revenue: profit.daily_projections[i].revenue,
              projected_cost: profit.daily_projections[i].cost,
              projected_profit: profit.daily_projections[i].profit,
            }
          : {}),
      })),
    };
  }

  // ── All products response ─────────────────────────
  /**
   * 🎓 When product="all":
   *    forecastData = { "Burgers": { summary, daily_forecast }, ... }
   *    profitData = { "by_product": { "Burgers": { totals, daily_projections }, ... }, "combined": { ... } }
   */
  const productSummaries = {};

  for (const [prodName, prodForecast] of Object.entries(forecastData)) {
    const prodProfit = profitData.by_product?.[prodName] || {};

    productSummaries[prodName] = {
      total_predicted_quantity: prodForecast.summary?.total_predicted || Math.round(
        prodForecast.daily_forecast?.reduce((sum, d) => sum + d.predicted_demand, 0) || 0
      ),
      avg_daily: prodForecast.summary?.avg_daily_demand || Math.round(
        prodForecast.daily_forecast?.reduce((sum, d) => sum + d.predicted_demand, 0) / days || 0
      ),
      total_profit: prodProfit.totals?.total_profit || 0,
      margin_percent: prodProfit.totals?.margin_percent || 0,
    };
  }

  return {
    metadata: {
      product: "all",
      forecast_days: days,
      model: "prophet_ml",
      confidence: "high",
      ml_service: "connected",
      product_count: Object.keys(productSummaries).length,
      note: "🤖 ML-powered forecast for all products using Facebook Prophet.",
    },
    product_summaries: productSummaries,
    combined_profit: {
      total_revenue: profitData.combined?.grand_total_revenue || 0,
      total_cost: profitData.combined?.grand_total_cost || 0,
      total_profit: profitData.combined?.grand_total_profit || 0,
      blended_margin: profitData.combined?.blended_margin_percent || 0,
      avg_daily_profit: profitData.combined?.avg_daily_profit || 0,
    },
  };
}


/**
 * 🎓 Helper: find the day with highest predicted quantity
 */
function findPeakDay(dailyForecast) {
  if (!dailyForecast.length) return null;

  const peak = dailyForecast.reduce(
    (max, d) => (d.predicted_demand > max.predicted_demand ? d : max),
    dailyForecast[0]
  );

  return {
    date: peak.date,
    day_name: peak.day_name,
    quantity: peak.predicted_demand,
    ...(peak.festival_name ? { reason: `Festival: ${peak.festival_name}` } : {}),
  };
}


// ═══════════════════════════════════════════════════════════
// MOVING AVERAGE FALLBACK (old stub logic)
// ═══════════════════════════════════════════════════════════
/**
 * 🎓 movingAverageFallback:
 *    This is the OLD stub logic from Phase 1, kept as a safety net.
 *    If the Python ML service is down, the MCP tool still works
 *    with this basic statistical approach.
 *
 *    Uses: historical average + day-of-week patterns + random variance.
 *    Accuracy: ★★☆☆☆ (medium-low)
 *    The real Prophet model is much better: ★★★★☆ (high)
 */
async function movingAverageFallback(product, daysAhead) {
  const lookbackDays = 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  const matchFilter = { date: { $gte: startDate } };
  if (product && product !== "all") matchFilter.product = product;

  const dailyData = await Sale.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          dayOfWeek: { $subtract: [{ $dayOfWeek: "$date" }, 1] },
        },
        dailyQty: { $sum: "$quantity" },
        dailyRevenue: { $sum: { $multiply: ["$price", "$quantity"] } },
      },
    },
    { $sort: { "_id.date": 1 } },
  ]);

  if (!dailyData.length) {
    return {
      error: `No historical sales data found for "${product}". Cannot generate forecast.`,
      suggestion: "Try running the seed script first, or check the product name.",
    };
  }

  const totalQty = dailyData.reduce((sum, d) => sum + d.dailyQty, 0);
  const totalRevenue = dailyData.reduce((sum, d) => sum + d.dailyRevenue, 0);
  const avgDaily = totalQty / dailyData.length;
  const avgRevenue = totalRevenue / dailyData.length;

  // Day-of-week multipliers
  const dayBuckets = {};
  for (const d of dailyData) {
    const dow = d._id.dayOfWeek;
    if (!dayBuckets[dow]) dayBuckets[dow] = [];
    dayBuckets[dow].push(d.dailyQty);
  }

  const dowMultipliers = {};
  for (const [dow, quantities] of Object.entries(dayBuckets)) {
    const dayAvg = quantities.reduce((s, q) => s + q, 0) / quantities.length;
    dowMultipliers[dow] = avgDaily > 0 ? Math.round((dayAvg / avgDaily) * 100) / 100 : 1;
  }

  // Generate predictions
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const predictions = [];

  for (let i = 1; i <= daysAhead; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split("T")[0];
    const dayOfWeek = date.getDay();

    const dowMult = dowMultipliers[dayOfWeek] || 1.0;
    const variance = 0.9 + Math.random() * 0.2;

    predictions.push({
      date: dateStr,
      day_name: dayNames[dayOfWeek],
      predicted_quantity: Math.max(0, Math.round(avgDaily * dowMult * variance)),
      predicted_revenue: Math.max(0, Math.round(avgRevenue * dowMult * variance * 100) / 100),
      confidence: "low",
    });
  }

  const totalPredQty = predictions.reduce((s, p) => s + p.predicted_quantity, 0);
  const peak = predictions.reduce(
    (max, p) => (p.predicted_quantity > max.predicted_quantity ? p : max),
    predictions[0]
  );

  return {
    metadata: {
      product,
      forecast_days: daysAhead,
      model: "moving_average_fallback",
      confidence: "low",
      ml_service: "disconnected",
      note: "⚠️ ML service unavailable. Using moving-average fallback. Start the ML service for better predictions.",
    },
    summary: {
      total_predicted_quantity: totalPredQty,
      avg_daily_predicted: Math.round(totalPredQty / daysAhead),
      peak_day: {
        date: peak.date,
        day_name: peak.day_name,
        quantity: peak.predicted_quantity,
      },
    },
    daily_forecast: predictions,
  };
}
