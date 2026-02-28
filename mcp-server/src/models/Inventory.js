/**
 * 📦 Inventory Model — Mongoose Schema for Daily Inventory Tracking
 * ══════════════════════════════════════════════════════════════════
 *
 * 🎓 WHAT THIS COLLECTION STORES:
 *    One record per product per day, tracking how much stock we had,
 *    how much was consumed (sold), and how much was restocked.
 *
 *    Example: On June 15, 2023:
 *      { product: "Burgers", date: 2023-06-15,
 *        stockLevel: 1200, consumed: 650, restocked: 0, status: "yellow" }
 *
 *    This means: We started with some stock, sold 650 burgers that day,
 *    and ended up with 1200 left. That's in the "yellow" zone
 *    (below reorder point but above minimum).
 *
 * 🎓 HOW IS INVENTORY DATA GENERATED?
 *    During seeding (seed.js), we SIMULATE inventory:
 *      1. Start each product at max stock (e.g., 1200 for Burgers)
 *      2. Each day, subtract what was sold (from Sales data)
 *      3. If stock drops below reorder point, auto-restock to max
 *      4. Record the day's status (green/yellow/red)
 *
 *    In a real restaurant, this would come from an actual POS system.
 *    For our project, we simulate it from sales data.
 *
 * 🎓 STATUS MEANINGS:
 *    🟢 green  = stock >= reorderPoint (we're good, no action needed)
 *    🟡 yellow = minStock <= stock < reorderPoint (order soon!)
 *    🔴 red    = stock < minStock (DANGER — might run out today!)
 */

import mongoose from "mongoose";

const inventorySchema = new mongoose.Schema(
  {
    product: {
      type: String,
      required: true,
      enum: [
        "Burgers",
        "Chicken Sandwiches",
        "Fries",
        "Beverages",
        "Sides & Other",
      ],
      index: true,
    },
    date: { type: Date, required: true, index: true },
    stockLevel: { type: Number, required: true },  // Units remaining at end of day
    consumed: { type: Number, default: 0 },         // Units sold that day
    restocked: { type: Number, default: 0 },        // Units added by supplier
    status: {
      type: String,
      enum: ["green", "yellow", "red"],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * 🎓 UNIQUE COMPOUND INDEX: { product: 1, date: 1 }, { unique: true }
 *
 *    This means: the COMBINATION of (product + date) must be unique.
 *    So you can have:
 *      { product: "Burgers", date: "2023-06-15" }  ✅
 *      { product: "Fries",   date: "2023-06-15" }  ✅ (different product)
 *      { product: "Burgers", date: "2023-06-16" }  ✅ (different date)
 *      { product: "Burgers", date: "2023-06-15" }  ❌ DUPLICATE! Error!
 *
 *    This prevents accidentally inserting two inventory records
 *    for the same product on the same day.
 */
inventorySchema.index({ product: 1, date: 1 }, { unique: true });

const Inventory = mongoose.model("Inventory", inventorySchema);
export default Inventory;
