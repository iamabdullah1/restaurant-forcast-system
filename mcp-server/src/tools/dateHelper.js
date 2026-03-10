/**
 * 📅 Date Helper — Smart Date Range Resolution
 * ══════════════════════════════════════════════
 *
 * 🎓 THE PROBLEM:
 *    Our sales data runs from Nov 7, 2022 → Nov 30, 2024.
 *    But today's date is March 2026. When a tool asks for "last 30 days,"
 *    it would normally calculate: March 2026 - 30 days = Feb 2026.
 *    There are ZERO sales records in Feb-Mar 2026, so every query returns $0!
 *
 * 🎓 THE FIX:
 *    Instead of using Date.now() as the reference point, we find the
 *    MAXIMUM date in the sales collection and use THAT as "today."
 *    So "last 30 days" becomes: Nov 30 2024 - 30 days = Nov 1 2024.
 *    Now the query finds real data!
 *
 * 🎓 WHY A SHARED MODULE?
 *    4 tools need this fix (profit, analytics, inventory, forecast fallback).
 *    Rather than duplicating the logic, we centralize it here.
 *    If the data gets updated with newer dates, this automatically adapts.
 *
 * 🎓 CACHING:
 *    We cache the max date for 60 seconds so we don't hit MongoDB
 *    on every single tool call. The max date won't change during a session.
 */

import Sale from "../models/Sale.js";

let _cachedMaxDate = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Get the most recent date in the sales collection.
 * This serves as our "effective today" for date range queries.
 *
 * @returns {Promise<Date>} The max date in the sales collection, or new Date() as fallback
 */
export async function getMaxSalesDate() {
  const now = Date.now();

  // Return cached value if still fresh
  if (_cachedMaxDate && now - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedMaxDate;
  }

  try {
    // Find the most recent sale date using a descending sort + limit 1
    const result = await Sale.findOne({}, { date: 1 })
      .sort({ date: -1 })
      .lean();

    if (result && result.date) {
      _cachedMaxDate = new Date(result.date);
      _cacheTimestamp = now;
      return _cachedMaxDate;
    }
  } catch (err) {
    console.error("⚠️ Failed to get max sales date:", err.message);
  }

  // Fallback to current date if no data found
  return new Date();
}

/**
 * Build a MongoDB date filter using the max sales date as reference.
 *
 * @param {number} days - Number of days to look back. 0 or falsy = all time.
 * @returns {Promise<object>} MongoDB filter object, e.g., { date: { $gte: Date } }
 */
export async function buildSmartDateFilter(days) {
  if (!days || days <= 0) return {};

  const maxDate = await getMaxSalesDate();
  const startDate = new Date(maxDate.getTime() - days * 24 * 60 * 60 * 1000);

  return { date: { $gte: startDate } };
}

/**
 * Get a reference "now" date for computing future dates or consumption rates.
 * Returns the max sales date instead of Date.now().
 *
 * @returns {Promise<Date>}
 */
export async function getEffectiveNow() {
  return await getMaxSalesDate();
}
