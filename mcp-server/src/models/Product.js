/**
 * 📦 Product Model — Mongoose Schema for Product Configuration
 * ═════════════════════════════════════════════════════════════
 *
 * 🎓 WHAT THIS COLLECTION STORES:
 *    The 5 products our restaurant sells, along with their pricing,
 *    cost, and inventory threshold settings. Only 5 documents total.
 *
 *    This is our "source of truth" for product data. Instead of
 *    hardcoding prices in multiple files, we store them in the DB
 *    and read from here. If a price changes, update ONE document.
 *
 * 🎓 DIFFERENCE FROM SALES:
 *    Sales = thousands of records (one per transaction)
 *    Products = only 5 records (one per menu item)
 *    Products is a CONFIG collection, Sales is a DATA collection.
 *
 * 🎓 WHERE THE DATA COMES FROM:
 *    Loaded from products.json during seeding (seed.js).
 *    The JSON file is the "initial config," but once in MongoDB,
 *    you could update prices via an admin panel without redeploying.
 */

import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      // 🎓 unique: true creates a UNIQUE INDEX.
      //    This means no two products can have the same name.
      //    If you try to insert a duplicate, MongoDB throws error E11000.
      //    This is how we enforce "only one Burgers product exists."
      unique: true,
      enum: [
        "Burgers",
        "Chicken Sandwiches",
        "Fries",
        "Beverages",
        "Sides & Other",
      ],
    },
    sellPrice: { type: Number, required: true },    // What we charge the customer ($12.99)
    costPrice: { type: Number, required: true },     // What ingredients cost us ($5.50)
    profitPerUnit: { type: Number, required: true }, // sellPrice - costPrice ($7.49)
    marginPercent: { type: Number, required: true }, // (profit / sellPrice) × 100 (57%)
    // 🎓 category groups products for reporting:
    //    "main"  = Burgers, Chicken Sandwiches (entrees)
    //    "side"  = Fries, Sides & Other
    //    "drink" = Beverages
    category: {
      type: String,
      required: true,
      enum: ["main", "side", "drink"],
    },
    // 🎓 NESTED OBJECT: Mongoose lets you define objects within objects.
    //    "inventory" is a sub-document with its own fields.
    //    In MongoDB, this is stored as a nested JSON object:
    //    { name: "Burgers", inventory: { minStockDaily: 400, ... } }
    inventory: {
      unit: { type: String, default: "units" },
      // 🎓 INVENTORY THRESHOLDS (explained in products.json):
      //    minStockDaily: DANGER ZONE — below this = 🔴 RED alert
      //    reorderPoint:  WARNING — below this = 🟡 YELLOW, time to reorder
      //    maxStockDaily: Full capacity after restocking = 🟢 GREEN
      //    leadTimeDays:  How many days until supplier delivers (1 = next day)
      minStockDaily: { type: Number, required: true },
      reorderPoint: { type: Number, required: true },
      maxStockDaily: { type: Number, required: true },
      leadTimeDays: { type: Number, default: 1 },
    },
  },
  {
    timestamps: true,
  }
);

const Product = mongoose.model("Product", productSchema);
export default Product;
