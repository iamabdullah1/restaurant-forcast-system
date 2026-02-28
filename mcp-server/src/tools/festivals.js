/**
 * 🎄 Tool #4: get_upcoming_festivals
 * ═══════════════════════════════════
 *
 * 🎓 WHAT THIS TOOL DOES:
 *    Fetches upcoming US public holidays/festivals and tells the restaurant
 *    manager what's coming up and how it might affect demand.
 *
 *    Data source: Nager.Date API (free, no API key needed)
 *    URL: https://date.nager.at/api/v3/PublicHolidays/{year}/{countryCode}
 *
 * 🎓 CACHING STRATEGY:
 *    Calling an external API every time is slow and wasteful.
 *    Instead, we use a "cache" pattern:
 *      1. First call → fetch from Nager.Date API → save to MongoDB
 *      2. Next calls → read from MongoDB (fast!)
 *      3. If cached data is older than 24 hours → refresh from API
 *
 *    The Festival model has a "fetchedAt" field that tracks when we
 *    last fetched each festival. We compare it to Date.now() to decide
 *    if the cache is stale.
 *
 * 🎓 DEMAND IMPACT CLASSIFICATION:
 *    Not all holidays affect restaurants equally. We classify them:
 *      HIGH   = Thanksgiving, Super Bowl, Christmas, July 4th
 *               (1.35x-1.50x demand spike — everyone orders food!)
 *      MEDIUM = Mother's Day, Memorial Day, Labor Day, Valentine's Day
 *               (1.20x-1.35x — families go out, people celebrate)
 *      LOW    = MLK Day, Presidents' Day, Columbus Day
 *               (1.05x-1.15x — day off work, slight increase)
 *
 * 🎓 WHY IS THIS THE FIRST TOOL WE BUILD?
 *    It's the simplest — just an API call + MongoDB cache.
 *    No ML models, no complex aggregation. Gets us running fast
 *    so we can test the full MCP Server → Claude Desktop flow.
 */

import Festival from "../models/Festival.js";

// ─── CONFIG ─────────────────────────────────────────────
/**
 * 🎓 NAGER_API_BASE: Base URL for the Nager.Date public holidays API.
 *    We'll append: /PublicHolidays/{year}/{countryCode}
 *
 * 🎓 CACHE_MAX_AGE_MS: How long cached festivals are "fresh."
 *    24 * 60 * 60 * 1000 = 86,400,000 milliseconds = 24 hours.
 *    After 24 hours, we re-fetch from the API.
 *    Why 24 hours? Holidays don't change often, but we want
 *    to pick up corrections (date changes, new holidays) reasonably fast.
 */
const NAGER_API_BASE = "https://date.nager.at/api/v3";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * 🎓 HIGH_IMPACT_HOLIDAYS: Holidays that cause the BIGGEST demand spikes.
 *    We match by partial name (case-insensitive) using .some() + .includes().
 *    These are based on US restaurant industry data — Thanksgiving is THE
 *    biggest food day, Super Bowl is the biggest delivery day, etc.
 *
 * 🎓 MEDIUM_IMPACT_HOLIDAYS: Moderate demand spikes.
 *    Family-oriented holidays (Mother's Day = busiest restaurant day
 *    of the year in many places!) and 3-day weekends.
 */
const HIGH_IMPACT_HOLIDAYS = [
  "thanksgiving",
  "super bowl",
  "christmas",
  "independence day",
  "new year",
];

const MEDIUM_IMPACT_HOLIDAYS = [
  "memorial",
  "labor day",
  "mother",
  "father",
  "valentine",
  "halloween",
  "black friday",
];

// ─── HELPER: Classify demand impact ─────────────────────
/**
 * 🎓 classifyImpact(holidayName):
 *    Takes a holiday name and returns { level, multiplier, emoji }.
 *
 *    How it works:
 *      1. Convert name to lowercase for case-insensitive matching
 *      2. Check if any HIGH keyword is found in the name
 *      3. If not, check MEDIUM keywords
 *      4. If neither, it's LOW
 *
 *    .some() returns true if ANY element in the array passes the test.
 *    .includes() checks if a string contains a substring.
 *
 *    Example: classifyImpact("Thanksgiving Day")
 *      → "thanksgiving day".includes("thanksgiving") → true → HIGH
 */
function classifyImpact(holidayName) {
  const lower = holidayName.toLowerCase();

  if (HIGH_IMPACT_HOLIDAYS.some((keyword) => lower.includes(keyword))) {
    return { level: "HIGH", multiplier: 1.45, emoji: "🔴" };
  }
  if (MEDIUM_IMPACT_HOLIDAYS.some((keyword) => lower.includes(keyword))) {
    return { level: "MEDIUM", multiplier: 1.25, emoji: "🟡" };
  }
  return { level: "LOW", multiplier: 1.10, emoji: "🟢" };
}

// ─── HELPER: Fetch from Nager.Date API ──────────────────
/**
 * 🎓 fetchFromNagerAPI(year, countryCode):
 *    Makes an HTTP GET request to the Nager.Date API.
 *
 *    Returns an array of holiday objects like:
 *    [{ date: "2026-11-26", name: "Thanksgiving Day", localName: "..." }, ...]
 *
 * 🎓 fetch() is built into Node.js 18+ (no library needed!).
 *    It's the same fetch() you use in browser JavaScript.
 *
 * 🎓 response.ok: true if status is 200-299, false otherwise.
 *    We check this because the API might return 404 (bad country code)
 *    or 500 (server error).
 *
 * 🎓 response.json(): Parses the JSON response body into a JS object.
 *    This is async because the body might arrive in chunks.
 */
async function fetchFromNagerAPI(year, countryCode) {
  const url = `${NAGER_API_BASE}/PublicHolidays/${year}/${countryCode}`;
  console.error(`📡 Fetching festivals: ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Nager API returned ${response.status}: ${response.statusText}`
    );
  }

  return response.json();
}

// ─── HELPER: Sync festivals to MongoDB ──────────────────
/**
 * 🎓 syncFestivalsToCache(year, countryCode):
 *    Fetches holidays from the API and saves them to MongoDB.
 *
 *    Uses "upsert" (update + insert):
 *      - If the festival already exists → update it
 *      - If it doesn't exist → insert it
 *    This prevents duplicates while keeping data fresh.
 *
 * 🎓 updateOne() with { upsert: true }:
 *    Mongoose's updateOne() updates ONE document matching the filter.
 *    With upsert: true, if NO document matches, it CREATES one.
 *    This is safer than deleteMany() + insertMany() because it
 *    preserves any custom fields (like demandMultiplier) we may
 *    have manually set on existing festivals.
 *
 * 🎓 $set operator:
 *    Tells MongoDB "set these specific fields" without touching others.
 *    Example: $set: { name: "Christmas", fetchedAt: new Date() }
 *    Only updates name and fetchedAt, leaves everything else untouched.
 */
async function syncFestivalsToCache(year, countryCode) {
  const holidays = await fetchFromNagerAPI(year, countryCode);
  let synced = 0;

  for (const holiday of holidays) {
    const impact = classifyImpact(holiday.name);

    await Festival.updateOne(
      // Filter: find by name + date (unique compound index)
      { name: holiday.name, date: new Date(holiday.date) },
      // Update: set these fields
      {
        $set: {
          localName: holiday.localName,
          countryCode: countryCode,
          source: "nager-api",
          demandMultiplier: impact.multiplier,
          fetchedAt: new Date(),
        },
      },
      // Options: create if not found
      { upsert: true }
    );
    synced++;
  }

  console.error(`   ✅ Synced ${synced} holidays for ${year}/${countryCode}`);
  return synced;
}

// ─── HELPER: Check if cache is fresh ────────────────────
/**
 * 🎓 isCacheFresh(countryCode):
 *    Checks if we have festival data that was fetched within the last 24 hours.
 *
 *    How it works:
 *      1. Find the most recently fetched festival for this country
 *      2. If fetchedAt is within CACHE_MAX_AGE_MS → cache is fresh
 *      3. If not → cache is stale, we need to re-fetch
 *
 * 🎓 .findOne().sort({ fetchedAt: -1 }):
 *    Find one document, sorted by fetchedAt descending (-1).
 *    This gives us the MOST RECENTLY fetched festival.
 *    If it's fresh, ALL festivals are likely fresh (they were
 *    all fetched at approximately the same time).
 */
async function isCacheFresh(countryCode) {
  const latest = await Festival.findOne({ countryCode })
    .sort({ fetchedAt: -1 })
    .lean();

  if (!latest || !latest.fetchedAt) return false;

  const age = Date.now() - new Date(latest.fetchedAt).getTime();
  return age < CACHE_MAX_AGE_MS;
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER — Called by MCP Server when tool is invoked
// ═══════════════════════════════════════════════════════════
/**
 * 🎓 handleGetUpcomingFestivals({ days_ahead, country_code }):
 *    This is the function that runs when an AI client calls
 *    the "get_upcoming_festivals" tool.
 *
 *    Algorithm:
 *      1. Check if MongoDB cache is fresh
 *      2. If stale → fetch from Nager.Date API → save to MongoDB
 *      3. Query MongoDB for festivals in the next N days
 *      4. Classify each by impact level
 *      5. Return formatted response
 *
 * 🎓 MCP HANDLER RETURN FORMAT:
 *    Every MCP tool handler MUST return:
 *    {
 *      content: [{ type: "text", text: "..." }]
 *    }
 *    The text is what the AI model receives as the tool's output.
 *    We JSON.stringify our data so the AI can parse it.
 *    If something goes wrong, we add isError: true.
 *
 * @param {object} args - Validated by Zod schema in index.js
 * @param {number} args.days_ahead - How many days ahead to look
 * @param {string} args.country_code - ISO country code
 */
export async function handleGetUpcomingFestivals({ days_ahead, country_code }) {
  try {
    // ── Step 1: Ensure cache is fresh ──────────────────
    const cacheFresh = await isCacheFresh(country_code);

    if (!cacheFresh) {
      console.error("🔄 Festival cache is stale, refreshing...");
      // Fetch current year and next year (to cover upcoming festivals
      // that span the year boundary, e.g., New Year's)
      const now = new Date();
      const currentYear = now.getFullYear();
      await syncFestivalsToCache(currentYear, country_code);
      // Also fetch next year if we're in the last 3 months
      if (now.getMonth() >= 9) {
        await syncFestivalsToCache(currentYear + 1, country_code);
      }
    } else {
      console.error("✅ Festival cache is fresh, using cached data");
    }

    // ── Step 2: Query upcoming festivals from MongoDB ──
    /**
     * 🎓 Date math:
     *    today = start of today (midnight)
     *    futureDate = today + days_ahead days
     *    We query: date >= today AND date <= futureDate
     *
     * 🎓 .setHours(0, 0, 0, 0): Sets time to midnight (00:00:00.000).
     *    We want to include today's festivals, so we start from midnight.
     *
     * 🎓 .lean(): Returns plain JS objects instead of Mongoose documents.
     *    Plain objects are faster and use less memory. We don't need
     *    Mongoose methods (.save(), .remove()) — we're just reading.
     */
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + days_ahead);

    const festivals = await Festival.find({
      countryCode: country_code,
      date: { $gte: today, $lte: futureDate },
    })
      .sort({ date: 1 }) // Soonest first
      .lean();

    // ── Step 3: Format response ────────────────────────
    /**
     * 🎓 .map() transforms each festival into a formatted object.
     *    We calculate "days_until" by subtracting today from the
     *    festival date, then dividing by milliseconds-per-day.
     *
     * 🎓 Math.ceil(): Rounds UP to the nearest integer.
     *    If a festival is 2.3 days away, we say "3 days" (not 2).
     */
    const formatted = festivals.map((f) => {
      const festivalDate = new Date(f.date);
      const daysUntil = Math.ceil(
        (festivalDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      const impact = classifyImpact(f.name);

      return {
        name: f.name,
        date: festivalDate.toISOString().split("T")[0], // "2026-11-26"
        local_name: f.localName || f.name,
        days_until: daysUntil,
        impact: impact.level,
        demand_multiplier: f.demandMultiplier || impact.multiplier,
        emoji: impact.emoji,
      };
    });

    // ── Step 4: Build summary ──────────────────────────
    const highImpact = formatted.filter((f) => f.impact === "HIGH");
    const summary = {
      total_upcoming: formatted.length,
      high_impact_count: highImpact.length,
      next_festival: formatted[0] || null,
      country: country_code,
      days_searched: days_ahead,
      cache_status: cacheFresh ? "fresh" : "refreshed",
    };

    // ── Return MCP-formatted response ──────────────────
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ festivals: formatted, summary }, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error("❌ get_upcoming_festivals error:", error.message);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: error.message,
            hint: "Check if the Nager.Date API is accessible and the country code is valid.",
          }),
        },
      ],
      isError: true,
    };
  }
}
