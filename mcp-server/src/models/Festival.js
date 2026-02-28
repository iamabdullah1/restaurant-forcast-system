/**
 * 📦 Festival Model — Mongoose Schema for Public Holidays & Festivals
 * ════════════════════════════════════════════════════════════════════
 *
 * 🎓 WHAT THIS COLLECTION STORES:
 *    Public holidays and festivals fetched from the Nager.Date API.
 *    Used by our MCP tool "get_upcoming_festivals" to tell the restaurant
 *    manager what festivals are coming up and how much extra stock to order.
 *
 * 🎓 WHY STORE FESTIVALS IN MONGODB?
 *    We COULD call the Nager.Date API every time someone asks about festivals.
 *    But that's slow and wasteful — the API data rarely changes.
 *    Instead, we use a CACHING STRATEGY:
 *      1. First call → fetch from Nager.Date API → save to MongoDB
 *      2. Next calls → read from MongoDB (fast! no API call needed)
 *      3. If data is older than X days → refresh from API
 *    The "fetchedAt" field tracks when we last updated each festival.
 *
 * 🎓 WHAT IS Nager.Date API?
 *    A free public API that returns public holidays for any country.
 *    URL: https://date.nager.at/api/v3/PublicHolidays/2024/US
 *    Returns: [{ date: "2024-11-28", name: "Thanksgiving Day", ... }, ...]
 *    We use country code "US" (United States) as our default.
 *
 * 🎓 demandMultiplier:
 *    Over time, we learn from historical data how much each festival
 *    affects demand. For example, Thanksgiving might have a 1.45x multiplier
 *    (45% more sales). This is initially 1.0 and gets updated as we
 *    collect more data across festivals.
 */

import mongoose from "mongoose";

const festivalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },            // "Thanksgiving Day"
    date: { type: Date, required: true, index: true }, // 2024-11-28
    localName: { type: String },                       // Native language name
    countryCode: { type: String, default: "US" },      // ISO country code
    source: {
      // 🎓 Where did this festival data come from?
      //    "nager-api" = auto-fetched from the internet
      //    "manual"    = someone added it by hand (e.g., local events)
      type: String,
      enum: ["nager-api", "manual"],
      default: "nager-api",
    },
    demandMultiplier: { type: Number, default: 1.0 },  // Learned from history
    // 🎓 Date.now is a FUNCTION REFERENCE (no parentheses).
    //    Mongoose calls it at insert time to get the current timestamp.
    //    If we wrote Date.now() WITH parentheses, it would be called
    //    once when the schema is defined — giving every document the
    //    SAME timestamp (the time the server started). Bug!
    fetchedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

/**
 * 🎓 Unique compound index: prevents duplicate festivals.
 *    Same festival name + same date = duplicate → error.
 *    This protects against fetching the same API data twice.
 */
festivalSchema.index({ name: 1, date: 1 }, { unique: true });

const Festival = mongoose.model("Festival", festivalSchema);
export default Festival;
