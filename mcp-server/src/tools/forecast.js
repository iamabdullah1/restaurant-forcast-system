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
import { cacheGet, cacheSet } from "../utils/cache.js";

// ── Configuration ───────────────────────────────────────
// The ML service URL. In production, this would come from environment variables.
// For local development, FastAPI runs on port 8000.
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

// Timeout for ML service requests (30 seconds).
// If Prophet is still training, this gives it time to respond.
const ML_TIMEOUT_MS = 30000;

// ── Short-lived in-memory cache (fast follow-up optimization) ──
const FORECAST_CACHE_TTL_MS = Number(process.env.FORECAST_CACHE_TTL_MS || 60_000); // 60s default
const forecastCache = new Map();

function getForecastCacheKey(product, daysAhead) {
  return `forecast_demand|product=${String(product).toLowerCase()}|days=${Number(daysAhead)}`;
}

async function readForecastCache(key) {
  const shared = await cacheGet(key);
  if (shared) return shared;

  const entry = forecastCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    forecastCache.delete(key);
    return null;
  }
  return entry.value;
}

async function writeForecastCache(key, value) {
  await cacheSet(key, value, FORECAST_CACHE_TTL_MS);
  forecastCache.set(key, {
    value,
    expiresAt: Date.now() + FORECAST_CACHE_TTL_MS,
  });
}


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
export async function handleForecastDemand({
  product = "all",
  days_ahead = 30,
  start_date = undefined,
  end_date = undefined,
}) {
  try {
    const cacheKey = getForecastCacheKey(product, `${days_ahead}|${start_date || ""}|${end_date || ""}`);
    const cached = await readForecastCache(cacheKey);
    if (cached) {
      console.error(`⚡ forecast_demand cache hit: ${product}, ${days_ahead} days`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(cached, null, 2),
          },
        ],
      };
    }

    // ── Attempt 1: Call the real ML service ───────────
    console.error(`🔮 forecast_demand: Calling ML service for ${product}, ${days_ahead} days...`);

    const mlResult = await callMLService(product, days_ahead);

    if (mlResult) {
      console.error(`✅ ML service responded successfully`);
      const windowed = applyForecastWindow(mlResult, start_date, end_date);
      await writeForecastCache(cacheKey, windowed);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(windowed, null, 2),
          },
        ],
      };
    }

    // ── Attempt 2: Fallback to moving-average stub ───
    console.error(`⚠️  ML service unavailable, using moving-average fallback`);
    const fallbackResult = await movingAverageFallback(product, days_ahead);
    const fallbackWindowed = applyForecastWindow(fallbackResult, start_date, end_date);
    await writeForecastCache(cacheKey, fallbackWindowed);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(fallbackWindowed, null, 2),
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
 * @returns {Promise<object|null>} Combined forecast+profit data, or null if service is down
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

    let combinedUrl;

    if (product === "all") {
      combinedUrl = `${ML_SERVICE_URL}/forecast-with-profit/?days=${days}`;
    } else {
      combinedUrl = `${ML_SERVICE_URL}/forecast-with-profit/${encodedProduct}?days=${days}`;
    }

    // ── Single combined request ──────────────
    /**
     * 🎓 Single-call optimization:
     *    Forecast + profit are computed in one ML request.
     *    This avoids a second HTTP round-trip and reduces latency.
     *
     * 🎓 AbortController:
     *    Creates a "cancel signal" that we pass to fetch.
     *    If setTimeout fires first, the signal cancels the request.
     *    This prevents the tool from hanging if ML service is down.
     */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);

    const combinedRes = await fetch(combinedUrl, { signal: controller.signal });

    clearTimeout(timeout);

    // ── Check responses ─────────────────────────────
    if (!combinedRes.ok) {
      console.error(`ML service returned error: combined=${combinedRes.status}`);
      return null; // Will trigger fallback
    }

    const combinedData = await combinedRes.json();
    const forecastData = combinedData?.forecast || combinedData?.forecast_data || combinedData;
    const profitData = combinedData?.profit || combinedData?.profit_data || {};

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

// ═══════════════════════════════════════════════════════════
// FORECAST WINDOW FILTERING
// ═══════════════════════════════════════════════════════════
function parseIsoDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function applyForecastWindow(result, startDateStr, endDateStr) {
  if (!result || (!startDateStr && !endDateStr)) return result;

  const start = parseIsoDate(startDateStr);
  const end = parseIsoDate(endDateStr);
  if (!start && !end) return result;

  const windowLabel = {
    start_date: startDateStr || null,
    end_date: endDateStr || null,
  };

  if (result.product_summaries) {
    return {
      ...result,
      forecast_window: windowLabel,
    };
  }

  if (!Array.isArray(result.daily_forecast)) {
    return {
      ...result,
      forecast_window: windowLabel,
    };
  }

  const inWindow = result.daily_forecast.filter((row) => {
    const rowDate = parseIsoDate(row.date);
    if (!rowDate) return false;
    if (start && rowDate < start) return false;
    if (end && rowDate > end) return false;
    return true;
  });

  const total = inWindow.reduce((sum, row) => sum + (row.predicted_quantity || 0), 0);
  const avg = inWindow.length ? Math.round(total / inWindow.length) : 0;

  return {
    ...result,
    forecast_window: windowLabel,
    summary_window: {
      total_predicted_quantity: total,
      avg_daily_predicted: avg,
      days: inWindow.length,
    },
    daily_forecast_window: inWindow,
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
  const { getEffectiveNow } = await import("./dateHelper.js");
  const effectiveNow = await getEffectiveNow();
  const startDate = new Date(effectiveNow);
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
