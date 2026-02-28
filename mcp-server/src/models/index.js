/**
 * 📦 Barrel Export — Re-exports all models from a single file
 * ═══════════════════════════════════════════════════════════
 *
 * 🎓 WHAT IS A "BARREL EXPORT"?
 *    Instead of importing from each file individually:
 *      import Sale from "./models/Sale.js";
 *      import Product from "./models/Product.js";
 *      import Inventory from "./models/Inventory.js";
 *
 *    You can import everything from ONE file:
 *      import { Sale, Product, Inventory, Festival } from "./models/index.js";
 *
 *    This is called a "barrel" because it collects many exports
 *    into one barrel and re-exports them. It keeps imports clean
 *    and means you don't need to remember individual file paths.
 *
 * 🎓 SYNTAX: export { default as Sale } from "./Sale.js"
 *    This says: "Take the default export from Sale.js and
 *    re-export it as a NAMED export called Sale."
 */
export { default as Sale } from "./Sale.js";
export { default as Product } from "./Product.js";
export { default as Inventory } from "./Inventory.js";
export { default as Festival } from "./Festival.js";
