/**
 * 🌱 Seed Script — Load all data into MongoDB
 * ═════════════════════════════════════════════
 *
 * 🎓 WHAT IS "SEEDING"?
 *    "Seeding" means filling a database with initial data so you have
 *    something to work with during development. Without seeding, your
 *    database would be empty and nothing would show on the dashboard.
 *
 *    Think of it like planting seeds in a garden — you plant data now
 *    so you can harvest results later.
 *
 * 🎓 WHAT THIS SCRIPT DOES:
 *    1. Reads both CSV files (cleaned original + synthetic)
 *    2. Merges them into one big dataset (254 + 3,510 = 3,764 rows)
 *    3. Inserts all sales records into MongoDB "sales" collection
 *    4. Reads products.json and inserts 5 products into "products" collection
 *    5. SIMULATES daily inventory from sales data → "inventories" collection
 *    6. Prints verification stats
 *
 * 🎓 WHEN TO RUN THIS:
 *    - Once, when setting up the project for the first time
 *    - Again if you regenerate synthetic data
 *    - After changing product config
 *    Note: It DELETES existing data first (deleteMany), so it's safe to re-run.
 *
 * Usage:  cd mcp-server && npm run seed
 * Needs:  .env file with MONGODB_URI in project root
 */

// ─── IMPORTS ────────────────────────────────────────────

/**
 * 🎓 Node.js built-in modules:
 *    fs   = "file system" — read/write files on disk
 *    path = build file paths safely (handles / vs \ across OS)
 *    url  = utilities for working with URLs and file paths
 *
 *    In Node.js ES Modules (type: "module" in package.json), we use
 *    `import` instead of `require`. The syntax is different from
 *    CommonJS but does the same thing.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Our own modules — the DB connection and Mongoose models
import { connectDB, disconnectDB } from "../utils/mongodb.js";
import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import Inventory from "../models/Inventory.js";

/**
 * 🎓 __filename and __dirname IN ES MODULES:
 *    In CommonJS (require), Node.js gives you __filename and __dirname
 *    for free. In ES Modules (import), they DON'T EXIST!
 *
 *    So we recreate them manually:
 *      import.meta.url = "file:///Users/apple/.../seed.js" (URL format)
 *      fileURLToPath() converts URL → normal file path
 *      path.dirname() gets the folder from a file path
 *
 *    This is a common pattern you'll see in every Node.js ES Module project.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 🎓 path.resolve() builds an absolute path from segments.
 *    path.resolve(__dirname, "..", "..", "..")
 *    = go up 3 folders from scripts/ → src/ → mcp-server/ → restaurant/
 *    This gives us the project root, regardless of where we run the command from.
 */
const ROOT = path.resolve(__dirname, "..", "..", "..");


// ─── FILE PATHS ─────────────────────────────────────────
const CLEANED_CSV = path.join(ROOT, "ml-service", "data", "sales_cleaned.csv");
const SYNTHETIC_CSV = path.join(
  ROOT,
  "ml-service",
  "data",
  "sales_synthetic.csv"
);
const PRODUCT_CONFIG = path.join(
  __dirname,
  "..",
  "config",
  "products.json"
);


// ═════════════════════════════════════════════════════════
// CSV PARSER (No external dependency)
// ═════════════════════════════════════════════════════════
/**
 * 🎓 WHY BUILD OUR OWN CSV PARSER?
 *    We could install a library like "csv-parse" from npm, but our CSV
 *    is simple (no quoted commas, no multiline values). So a 10-line
 *    parser is enough and saves a dependency.
 *
 *    For complex CSVs (values containing commas, quotes, newlines),
 *    you'd want a proper library. But for clean data like ours, this works.
 *
 * @param {string} filePath - Path to the CSV file
 * @returns {Object[]} Array of objects, one per row
 *
 * 🎓 HOW IT WORKS:
 *    Input CSV:
 *      Order ID,Date,Product
 *      10452,2022-11-07,Fries
 *      10453,2022-11-07,Beverages
 *
 *    Step 1: Read file as one big string
 *    Step 2: Split by newlines → ["Order ID,Date,Product", "10452,2022-11-07,Fries", ...]
 *    Step 3: First line = headers = ["Order ID", "Date", "Product"]
 *    Step 4: Each remaining line → split by comma → zip with headers → object
 *            "10452,2022-11-07,Fries" → { "Order ID": "10452", "Date": "2022-11-07", "Product": "Fries" }
 */
function parseCSV(filePath) {
  // 🎓 fs.readFileSync reads the ENTIRE file into memory as a string.
  //    "utf-8" means "treat the bytes as text" (not binary).
  //    "Sync" means it BLOCKS until the file is read (fine for scripts,
  //    bad for servers — servers should use async fs.readFile instead).
  const text = fs.readFileSync(filePath, "utf-8");

  // 🎓 .trim() removes whitespace from start/end (prevents empty last line)
  //    .split("\n") splits the string into an array of lines
  const lines = text.trim().split("\n");

  // 🎓 lines[0] is the header row. We split by comma and trim each header.
  //    .map((h) => h.trim()) removes any whitespace around each header name.
  const headers = lines[0].split(",").map((h) => h.trim());

  // 🎓 lines.slice(1) skips the header row, giving us data rows only.
  //    .map() transforms each line string into an object.
  //    headers.forEach() zips each value with its corresponding header name.
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i];
    });
    return row;
  });
}


// ═════════════════════════════════════════════════════════
// SEED SALES — Insert all sales records
// ═════════════════════════════════════════════════════════
async function seedSales() {
  console.log("\n📦 Seeding Sales...");

  // 🎓 Parse both CSV files into arrays of objects
  const cleaned = parseCSV(CLEANED_CSV);
  const synthetic = parseCSV(SYNTHETIC_CSV);

  // 🎓 SPREAD OPERATOR (...):
  //    [...cleaned, ...synthetic] merges two arrays into one.
  //    It "spreads" each array's elements into a new array.
  //    Example: [...[1,2], ...[3,4]] → [1, 2, 3, 4]
  const allRows = [...cleaned, ...synthetic];

  console.log(
    `   Cleaned: ${cleaned.length} rows | Synthetic: ${synthetic.length} rows | Total: ${allRows.length}`
  );

  // 🎓 TRANSFORM CSV ROWS → MONGOOSE DOCUMENTS:
  //    CSV values are ALL strings. But our schema expects Numbers and Dates.
  //    We must convert:
  //      Number("12.99")      → 12.99
  //      new Date("2023-06-15") → Date object
  //
  //    .map() creates a NEW array by transforming each element.
  //    It doesn't modify the original array.
  const docs = allRows.map((row) => ({
    orderId: Number(row["Order ID"]),          // String → Number
    date: new Date(row["Date"]),               // String → Date object
    product: row["Product"],                    // Already a string
    price: Number(row["Price"]),               // String → Number
    quantity: Number(row["Quantity"]),          // String → Number
    purchaseType: row["Purchase Type"],         // Already a string
    paymentMethod: row["Payment Method"],       // Already a string
  }));

  // 🎓 deleteMany({}) deletes ALL documents in the collection.
  //    The empty {} means "match everything" (no filter).
  //    We do this so re-running the script doesn't create duplicates.
  await Sale.deleteMany({});

  // 🎓 insertMany() inserts an array of documents in ONE batch operation.
  //    Much faster than inserting one at a time in a loop!
  //    { ordered: false } means "don't stop on errors, try all of them."
  //    If one document fails validation, the rest still get inserted.
  await Sale.insertMany(docs, { ordered: false });
  console.log(`   ✅ Inserted ${docs.length} sales records`);
}


// ═════════════════════════════════════════════════════════
// SEED PRODUCTS — Insert product config
// ═════════════════════════════════════════════════════════
async function seedProducts() {
  console.log("\n📦 Seeding Products...");

  // 🎓 JSON.parse() converts a JSON string → JavaScript object.
  //    fs.readFileSync reads the file as a string,
  //    then JSON.parse turns it into a usable object.
  const config = JSON.parse(fs.readFileSync(PRODUCT_CONFIG, "utf-8"));

  // 🎓 Object.entries() converts an object into an array of [key, value] pairs.
  //    Example: Object.entries({ Burgers: {...}, Fries: {...} })
  //    → [["Burgers", {...}], ["Fries", {...}]]
  //
  //    We destructure each pair: [name, data]
  //      name = "Burgers"
  //      data = { sellPrice: 12.99, costPrice: 5.50, ... }
  //
  //    Then we merge them: { name: "Burgers", sellPrice: 12.99, costPrice: 5.50, ... }
  //    The ...data SPREAD OPERATOR copies all fields from data into the new object.
  const docs = Object.entries(config.products).map(([name, data]) => ({
    name,       // shorthand for name: name
    ...data,    // spread all other fields
  }));

  await Product.deleteMany({});
  await Product.insertMany(docs);
  console.log(`   ✅ Inserted ${docs.length} products`);
}


// ═════════════════════════════════════════════════════════
// SEED INVENTORY — Simulate daily stock levels from sales
// ═════════════════════════════════════════════════════════
/**
 * 🎓 THIS IS THE MOST COMPLEX SEEDING FUNCTION. Here's the logic:
 *
 *    We don't have real inventory data (the CSV only has sales).
 *    So we SIMULATE it: "If we sold X burgers today, and started with
 *    Y in stock, we must have Y-X left at end of day."
 *
 *    Steps:
 *    1. Use MongoDB Aggregation to group sales by (product + date)
 *    2. For each product, walk through days chronologically
 *    3. Start at max stock, subtract daily consumption
 *    4. If stock drops below reorder point → auto-restock to max
 *    5. Assign status (green/yellow/red) based on thresholds
 *    6. Save each day's snapshot to the Inventory collection
 */
async function seedInventory() {
  console.log("\n📦 Seeding Inventory...");

  const config = JSON.parse(fs.readFileSync(PRODUCT_CONFIG, "utf-8"));

  // ───────────────────────────────────────────────────────
  // 🎓 MongoDB AGGREGATION PIPELINE:
  //    Aggregation is MongoDB's way of doing complex data processing.
  //    It's like a conveyor belt — data flows through "stages,"
  //    and each stage transforms it.
  //
  //    Our pipeline has 2 stages:
  //
  //    Stage 1: $group — Like SQL's GROUP BY.
  //      Groups all sales by (product + date), sums up quantities.
  //      Input:  3,764 individual sale documents
  //      Output: ~3,510 groups (one per product-day combination)
  //      Each group has: { _id: { product: "Burgers", date: "2023-06-15" },
  //                        totalQuantity: 650 }
  //
  //    Stage 2: $sort — Sort by date ascending (oldest first).
  //      We need chronological order to simulate stock changes over time.
  //
  //    🎓 $dateToString: Converts Date object → "YYYY-MM-DD" string.
  //       Without this, dates include time (2023-06-15T00:00:00Z)
  //       which makes grouping inconsistent.
  // ───────────────────────────────────────────────────────
  const salesByDay = await Sale.aggregate([
    {
      $group: {
        _id: {
          product: "$product",    // 🎓 "$product" = reference to the "product" field
          date: {
            $dateToString: { format: "%Y-%m-%d", date: "$date" },
          },
        },
        totalQuantity: { $sum: "$quantity" },  // Sum all quantities for this group
      },
    },
    { $sort: { "_id.date": 1 } },  // Sort by date, oldest first
  ]);

  // ───────────────────────────────────────────────────────
  // 🎓 Reorganize: group the aggregation results by product name.
  //    salesByDay is a flat array. We want:
  //      { "Burgers": [{date, consumed}, {date, consumed}, ...],
  //        "Fries":   [{date, consumed}, ...] }
  //
  //    This makes it easy to walk through each product's timeline.
  // ───────────────────────────────────────────────────────
  const productDays = {};
  for (const entry of salesByDay) {
    const key = entry._id.product;
    if (!productDays[key]) productDays[key] = [];  // Initialize array if first time
    productDays[key].push({
      date: entry._id.date,
      consumed: entry.totalQuantity,
    });
  }

  const inventoryDocs = [];

  // ───────────────────────────────────────────────────────
  // 🎓 INVENTORY SIMULATION LOOP:
  //    For each product, walk through every day and simulate stock.
  //
  //    Object.entries() gives us [productName, daysArray] pairs.
  //
  //    The algorithm:
  //      stock starts at maxStockDaily (e.g., 1200 for Burgers)
  //      each day: stock -= consumed (what we sold)
  //      if stock < reorderPoint: auto-restock to max
  //      save the day's snapshot
  // ───────────────────────────────────────────────────────
  for (const [productName, days] of Object.entries(productDays)) {
    const pConfig = config.products[productName];
    if (!pConfig) continue;  // Skip if product not in config (shouldn't happen)

    // 🎓 DESTRUCTURING: Extract specific properties from an object.
    //    Instead of: const min = pConfig.inventory.minStockDaily;
    //    We write:   const { minStockDaily, reorderPoint, maxStockDaily } = pConfig.inventory;
    //    Same result, less code!
    const { minStockDaily, reorderPoint, maxStockDaily } = pConfig.inventory;

    // Start with a full stock (day 0 = fully stocked)
    let stock = maxStockDaily;

    for (const day of days) {
      // Subtract today's consumption
      stock -= day.consumed;

      // 🎓 AUTO-RESTOCK LOGIC:
      //    If stock drops below the reorder point, we simulate a supplier
      //    delivery that brings us back to max capacity.
      //    In reality, there'd be a 1-day lead time, but for seeding
      //    we keep it simple — instant restock.
      let restocked = 0;
      if (stock < reorderPoint) {
        restocked = maxStockDaily - stock;  // How much we need to reach max
        stock = maxStockDaily;               // Back to full
      }

      // 🎓 TRAFFIC LIGHT STATUS:
      //    Based on the stock level, assign a color:
      //    🟢 green  = comfortable (above reorder point)
      //    🟡 yellow = warning (between min and reorder)
      //    🔴 red    = danger (below minimum — might run out!)
      let status = "green";
      if (stock < minStockDaily) {
        status = "red";
      } else if (stock < reorderPoint) {
        status = "yellow";
      }

      // 🎓 Math.round(x * 100) / 100 = round to 2 decimal places.
      //    JavaScript doesn't have a built-in round-to-N-decimals function,
      //    so this trick is standard: multiply, round, divide.
      //    Example: Math.round(3.14159 * 100) / 100 → 3.14
      inventoryDocs.push({
        product: productName,
        date: new Date(day.date),
        stockLevel: Math.round(stock * 100) / 100,
        consumed: Math.round(day.consumed * 100) / 100,
        restocked: Math.round(restocked * 100) / 100,
        status,  // shorthand for status: status
      });
    }
  }

  await Inventory.deleteMany({});
  await Inventory.insertMany(inventoryDocs, { ordered: false });
  console.log(`   ✅ Inserted ${inventoryDocs.length} inventory records`);

  // ───────────────────────────────────────────────────────
  // 🎓 .reduce() — the Swiss Army knife of array methods.
  //    It "reduces" an array to a single value by processing each element.
  //
  //    Here we count how many inventory records have each status:
  //      acc = accumulator (starts as {}), builds up over iterations
  //      d   = current document
  //
  //    First iteration:  acc = {},                   d.status = "green"  → { green: 1 }
  //    Second iteration: acc = { green: 1 },         d.status = "green"  → { green: 2 }
  //    Third iteration:  acc = { green: 2 },         d.status = "yellow" → { green: 2, yellow: 1 }
  //    ... and so on for all documents.
  //
  //    (acc[d.status] || 0) means "use the current count, or 0 if it doesn't exist yet"
  // ───────────────────────────────────────────────────────
  const statusCounts = inventoryDocs.reduce((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1;
    return acc;
  }, {});
  console.log(
    `   Status breakdown: 🟢 ${statusCounts.green || 0} | 🟡 ${statusCounts.yellow || 0} | 🔴 ${statusCounts.red || 0}`
  );
}


// ═════════════════════════════════════════════════════════
// MAIN — Orchestrate all seeding steps
// ═════════════════════════════════════════════════════════
/**
 * 🎓 ASYNC MAIN FUNCTION PATTERN:
 *    In Node.js, you can't use `await` at the top level of a file
 *    (well, you CAN in ES modules, but wrapping in a function is cleaner).
 *
 *    We define an async main(), then call it at the bottom.
 *    The try/catch/finally ensures:
 *      try     → run all seeding steps
 *      catch   → if anything fails, log the error and exit with code 1
 *      finally → ALWAYS disconnect from MongoDB, even if there was an error
 *
 * 🎓 process.exit(1):
 *    Exits the Node.js process with code 1 (= error).
 *    Code 0 = success, Code 1+ = various errors.
 *    CI/CD systems check exit codes — code 1 marks the build as failed.
 */
async function main() {
  console.log("=".repeat(55));
  console.log("  Phase 0 — Seed MongoDB");
  console.log("=".repeat(55));

  try {
    await connectDB();
    await seedSales();
    await seedProducts();
    await seedInventory();

    // ── Quick verification — query the DB to confirm ────
    console.log("\n" + "─".repeat(40));
    console.log("🔍 Verification:");

    // 🎓 .countDocuments() returns the number of documents in a collection.
    //    It's a fast operation that uses the collection's metadata.
    const salesCount = await Sale.countDocuments();
    const productsCount = await Product.countDocuments();
    const inventoryCount = await Inventory.countDocuments();

    // 🎓 Another aggregation: find the earliest and latest dates.
    //    $group with _id: null means "group ALL documents together"
    //    $min/$max find the minimum/maximum values of a field
    const dateRange = await Sale.aggregate([
      {
        $group: {
          _id: null,
          minDate: { $min: "$date" },
          maxDate: { $max: "$date" },
        },
      },
    ]);

    console.log(`   Sales:     ${salesCount} records`);
    console.log(`   Products:  ${productsCount} records`);
    console.log(`   Inventory: ${inventoryCount} records`);
    if (dateRange.length > 0) {
      // 🎓 .toISOString() returns "2023-06-15T00:00:00.000Z"
      //    .split("T")[0] takes only the date part: "2023-06-15"
      console.log(
        `   Date range: ${dateRange[0].minDate.toISOString().split("T")[0]} → ${dateRange[0].maxDate.toISOString().split("T")[0]}`
      );
    }

    console.log("\n" + "=".repeat(55));
    console.log("  ✅ Database seeded successfully!");
    console.log("=".repeat(55));
  } catch (err) {
    console.error("\n❌ Seeding failed:", err.message);
    process.exit(1);
  } finally {
    // 🎓 "finally" ALWAYS runs — whether try succeeded or catch caught an error.
    //    Perfect for cleanup tasks like closing database connections.
    await disconnectDB();
  }
}

// 🎓 Call the main function. Since it's async, it returns a Promise.
//    Node.js will keep running until the Promise resolves (and we disconnect).
main();
