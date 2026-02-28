/**
 * 📦 Sale Model — Mongoose Schema for Sales Records
 * ═══════════════════════════════════════════════════
 *
 * 🎓 WHAT IS A "MODEL" / "SCHEMA"?
 *    In MongoDB, data is stored as JSON-like "documents" inside "collections."
 *    A "schema" is a BLUEPRINT that defines what shape each document should have.
 *    A "model" is a JavaScript class built from a schema that lets you
 *    create, read, update, delete (CRUD) documents in a collection.
 *
 *    Think of it like:
 *      Schema = the form template (name must be text, price must be number)
 *      Model  = the receptionist who validates and files the forms
 *      Document = one filled-out form (one sale record)
 *      Collection = the filing cabinet (all sale records)
 *
 * 🎓 WHY USE MONGOOSE INSTEAD OF RAW MONGODB?
 *    Raw MongoDB accepts ANY shape of data — you could accidentally insert
 *    { name: 123, price: "hello" }. Mongoose adds:
 *      • Validation (price MUST be a Number)
 *      • Type casting (string "12.99" auto-converts to number 12.99)
 *      • Defaults (timestamps auto-added)
 *      • Indexes (makes queries fast)
 *      • Cleaner API (Sale.find() instead of db.collection('sales').find())
 *
 * 🎓 THIS COLLECTION STORES:
 *    Every sale that happened at our restaurant — both the 254 cleaned
 *    original records and the 3,510 synthetic records = 3,764 total.
 *    Each row from our CSV becomes one document in this collection.
 */

import mongoose from "mongoose";

/**
 * 🎓 mongoose.Schema({...}, options) creates a schema definition.
 *
 *    Each key is a field name, and its value defines the rules:
 *      type:     What data type (String, Number, Date, Boolean, etc.)
 *      required: If true, inserting without this field throws an error
 *      enum:     A whitelist — only these values are allowed
 *      index:    If true, MongoDB creates an INDEX on this field
 *      default:  Value used if the field is missing
 *
 * 🎓 WHAT IS AN INDEX?
 *    Without an index, MongoDB reads EVERY document to find what you want
 *    (called a "collection scan" — like reading every page of a book).
 *    With an index, MongoDB jumps directly to matching documents
 *    (like using the index at the back of a book).
 *    Rule: Index fields you FILTER or SORT by frequently.
 *
 *    We index: orderId (lookup by ID), date (filter by date range),
 *    product (filter by product name)
 */
const saleSchema = new mongoose.Schema(
  {
    orderId: { type: Number, required: true, index: true },
    date: { type: Date, required: true, index: true },
    product: {
      type: String,
      required: true,
      // 🎓 enum = "enumeration" — only these 5 values are allowed.
      //    If you try to insert product: "Pizza", Mongoose throws a
      //    ValidationError. This prevents typos and bad data.
      enum: [
        "Burgers",
        "Chicken Sandwiches",
        "Fries",
        "Beverages",
        "Sides & Other",
      ],
      index: true,
    },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    purchaseType: {
      type: String,
      required: true,
      enum: ["In-store", "Drive-thru", "Online"],
    },
    paymentMethod: {
      type: String,
      required: true,
      enum: ["Credit Card", "Cash", "Gift Card"],
    },
  },
  {
    // 🎓 timestamps: true automatically adds two fields to every document:
    //    createdAt: Date — when this document was first inserted
    //    updatedAt: Date — when this document was last modified
    //    You don't need to manage these yourself — Mongoose handles it.
    timestamps: true,
  }
);

/**
 * 🎓 COMPOUND INDEX: An index on MULTIPLE fields together.
 *
 *    saleSchema.index({ date: 1, product: 1 })
 *    This creates one index that covers queries like:
 *      Sale.find({ date: "2023-06-15", product: "Burgers" })  — FAST
 *      Sale.find({ date: "2023-06-15" })                      — FAST (date is first)
 *      Sale.find({ product: "Burgers" })                      — NOT helped (date is first)
 *
 *    That's why we ALSO create { product: 1, date: 1 } — the reverse order.
 *    Now queries filtered by product-first are ALSO fast.
 *
 *    The "1" means ascending order. "-1" would mean descending.
 *    For most queries, the direction doesn't matter much.
 */
saleSchema.index({ date: 1, product: 1 });
saleSchema.index({ product: 1, date: 1 });

/**
 * 🎓 mongoose.model("Sale", saleSchema) does two things:
 *    1. Creates a model class called "Sale" with methods like
 *       .find(), .insertMany(), .aggregate(), .countDocuments()
 *    2. Maps it to a MongoDB collection called "sales"
 *       (Mongoose auto-lowercases and pluralizes: "Sale" → "sales")
 */
const Sale = mongoose.model("Sale", saleSchema);
export default Sale;
