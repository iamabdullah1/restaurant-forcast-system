"""
Phase 0 — Step 0.2: Clean the original Kaggle CSV
═══════════════════════════════════════════════════

🎓 WHAT THIS SCRIPT DOES:
    Our raw Kaggle CSV has messy data — extra spaces, wrong date format,
    columns we don't need, and even some wrong prices. This script
    "cleans" it so our database gets only valid, consistent data.

    Think of it like washing vegetables before cooking. The raw CSV is
    the dirty vegetable, and this script washes it.

🎓 WHY DATA CLEANING MATTERS:
    - "Garbage in, garbage out" — if you feed messy data to ML models
      or dashboards, you get wrong results
    - Inconsistent dates break time-series queries
    - Extra whitespace causes "Burgers" ≠ "Burgers " (they look same but aren't)
    - Wrong prices corrupt profit calculations

🎓 OPERATIONS PERFORMED:
    1. Remove City & Manager columns (we're a single branch — don't need them)
    2. Fix whitespace in all text columns ("  Tom   Jackson  " → "Tom Jackson")
    3. Standardize dates: DD-MM-YYYY → YYYY-MM-DD (international standard)
    4. Fix price anomalies (e.g., one Fries row had $25.50 instead of $3.49)
    5. Validate everything looks correct
    6. Save the cleaned version
"""

# ─── IMPORTS ─────────────────────────────────────────────
# 🎓 pandas: The #1 Python library for working with tabular data (like Excel).
#    It loads CSVs into a "DataFrame" — basically a super-powered spreadsheet
#    that you can filter, sort, group, and transform with code.
import pandas as pd

# 🎓 os: Built-in Python module for interacting with the file system.
#    We use it to build file paths and create directories.
import os


# ─── FILE PATHS ──────────────────────────────────────────
# 🎓 __file__ is a special Python variable = the path to THIS script file.
#    os.path.abspath() converts it to a full absolute path.
#    os.path.dirname() gets the folder containing a file.
#
#    Example: If this file is at /restaurant/ml-service/scripts/clean_csv.py
#      SCRIPT_DIR = /restaurant/ml-service/scripts
#      ROOT_DIR   = /restaurant  (go up 2 levels: scripts → ml-service → restaurant)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))

# 🎓 os.path.join() builds file paths safely across operating systems.
#    On Mac/Linux: "folder" + "file.csv" → "folder/file.csv"
#    On Windows:   "folder" + "file.csv" → "folder\\file.csv"
#    Always use os.path.join() instead of hardcoding "/" or "\\"!
INPUT_PATH = os.path.join(ROOT_DIR, "9. Sales-Data-Analysis.csv")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "..", "data")
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "sales_cleaned.csv")


# ─── KNOWN CORRECT PRICES ───────────────────────────────
# 🎓 We know each product's real price from the restaurant menu.
#    The raw CSV has a few rows where prices are wrong (data entry errors).
#    We'll compare every row against this "truth table" and fix mismatches.
CORRECT_PRICES = {
    "Burgers": 12.99,
    "Chicken Sandwiches": 9.95,
    "Fries": 3.49,
    "Beverages": 2.95,
    "Sides & Other": 4.99,
}


def clean():
    """
    🎓 Main cleaning function. Runs all 6 cleaning steps in order.
    
    We wrap everything in a function (instead of writing code at the top level)
    because:
      1. It's organized — you can see what the function does from its name
      2. It's reusable — other scripts can import and call clean()
      3. It only runs when we want it to (see __name__ == "__main__" at bottom)
    """
    print("=" * 55)
    print("  Phase 0.2 — Clean Original CSV")
    print("=" * 55)

    # ══════════════════════════════════════════════════════
    # STEP 0: Load the CSV into a pandas DataFrame
    # ══════════════════════════════════════════════════════
    # 🎓 pd.read_csv() reads a CSV file and creates a DataFrame.
    #    A DataFrame is like a table with rows and columns.
    #    Each column is a "Series" (like a list with a name).
    #
    #    After this line, `df` looks like:
    #      | Order ID | Date       | Product  | Price | Quantity | ... | Manager       | City    |
    #      |----------|------------|----------|-------|----------|-----|---------------|---------|
    #      | 10452    | 07-11-2022 | Fries    | 3.49  | 573.07   | ... | Tom Jackson   | London  |
    #      | 10453    | 07-11-2022 | Beverages| 2.95  | 745.76   | ... | Pablo Perez   | Madrid  |
    print(f"\n📂 Reading: {INPUT_PATH}")
    df = pd.read_csv(INPUT_PATH)
    print(f"   {len(df)} rows × {len(df.columns)} columns")
    print(f"   Columns: {list(df.columns)}")

    # ══════════════════════════════════════════════════════
    # STEP 1: Drop columns we don't need
    # ══════════════════════════════════════════════════════
    # 🎓 Our restaurant is a SINGLE branch, so "City" and "Manager" are useless.
    #    Keeping unnecessary columns wastes memory and clutters our data.
    #
    #    [c for c in ["City", "Manager"] if c in df.columns]
    #    ↑ This is a "list comprehension" — it creates a list by filtering.
    #    It says: "Give me each column name, but ONLY if it actually exists."
    #    This prevents a crash if the column was already removed.
    #
    #    df.drop(columns=...) removes columns and returns a NEW DataFrame.
    drop_cols = [c for c in ["City", "Manager"] if c in df.columns]
    df = df.drop(columns=drop_cols)
    print(f"\n🗑️  Dropped: {drop_cols}")
    print(f"   Remaining columns: {list(df.columns)}")

    # ══════════════════════════════════════════════════════
    # STEP 2: Fix whitespace in text columns
    # ══════════════════════════════════════════════════════
    # 🎓 The raw CSV has messy spacing:
    #    "Online " (trailing space), "       Pablo Perez" (leading spaces),
    #    "Tom      Jackson" (multiple spaces in middle)
    #
    #    Why this matters:
    #      "Online" != "Online " — Python treats them as different strings!
    #      So a filter like df[df["Purchase Type"] == "Online"] would MISS
    #      the rows with extra spaces.
    #
    #    df.select_dtypes(include="object") — gets only text columns
    #    (pandas calls text data "object" type)
    #
    #    .str.strip()  — removes spaces from start & end: "  hello  " → "hello"
    #    .str.replace(r"\s+", " ", regex=True) — replaces multiple spaces
    #    in the middle with a single space: "Tom    Jackson" → "Tom Jackson"
    #
    #    🎓 r"\s+" is a REGEX (regular expression):
    #       \s  = any whitespace character (space, tab, etc.)
    #       +   = "one or more of the previous thing"
    #       So \s+ matches "one or more whitespace characters"
    #       We replace that match with a single " "
    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].str.strip()
        df[col] = df[col].str.replace(r"\s+", " ", regex=True)
    print("\n✨ Trimmed whitespace from all text columns")

    # ══════════════════════════════════════════════════════
    # STEP 3: Standardize date format
    # ══════════════════════════════════════════════════════
    # 🎓 The raw CSV has dates like "07-11-2022" (DD-MM-YYYY, European format).
    #    We convert to "2022-11-07" (YYYY-MM-DD, ISO 8601 format).
    #
    #    Why YYYY-MM-DD?
    #      1. It's the international standard (ISO 8601)
    #      2. It sorts correctly as a string: "2022-11-07" < "2022-12-01"
    #         (DD-MM-YYYY doesn't sort correctly as strings!)
    #      3. MongoDB, JavaScript, and most databases expect this format
    #      4. No confusion between DD-MM and MM-DD (US vs Europe problem)
    #
    #    pd.to_datetime() converts string → Python datetime object
    #      format="%d-%m-%Y" tells pandas: "d = day, m = month, Y = 4-digit year"
    #
    #    .dt.strftime() converts datetime object → string in our chosen format
    #      "%Y-%m-%d" = "2022-11-07"
    df["Date"] = pd.to_datetime(df["Date"], format="%d-%m-%Y")
    df["Date"] = df["Date"].dt.strftime("%Y-%m-%d")
    print(f"📅 Dates → YYYY-MM-DD  (range: {df['Date'].min()} to {df['Date'].max()})")

    # ══════════════════════════════════════════════════════
    # STEP 4: Fix price anomalies
    # ══════════════════════════════════════════════════════
    # 🎓 Some rows in the raw CSV have wrong prices (data entry errors).
    #    Example: One "Fries" row has price $25.50 instead of $3.49.
    #    If we don't fix this, profit calculations will be way off.
    #
    #    How it works:
    #    For each product, we create a "mask" — a True/False list.
    #      mask = (df["Product"] == "Fries") & (df["Price"] != 3.49)
    #    This is True for rows where product is Fries AND price is wrong.
    #
    #    mask.sum() counts how many True values (True=1, False=0).
    #
    #    df.loc[mask, "Price"] = correct_price
    #    ↑ .loc[rows, column] lets you SET values for specific rows.
    #    It says: "For all rows where mask is True, set Price to correct_price"
    price_fixes = 0
    for product, correct_price in CORRECT_PRICES.items():
        mask = (df["Product"] == product) & (df["Price"] != correct_price)
        fixes = mask.sum()
        if fixes > 0:
            bad_prices = df.loc[mask, "Price"].unique()
            df.loc[mask, "Price"] = correct_price
            price_fixes += fixes
            print(f"💰 Fixed {fixes} price(s) for {product}: {list(bad_prices)} → ${correct_price}")
    if price_fixes == 0:
        print("💰 No price anomalies found")

    # ══════════════════════════════════════════════════════
    # STEP 5: Validate — check everything looks right
    # ══════════════════════════════════════════════════════
    # 🎓 After cleaning, we print a summary to verify nothing broke.
    #    This is a good habit — always validate after transforming data.
    #
    #    df['Product'].unique() — returns an array of unique values
    #    sorted() — sorts them alphabetically
    #    df.isnull().sum().sum() — counts total null/missing cells
    #      First .sum() counts nulls per column, second .sum() adds them all up
    print(f"\n{'─' * 40}")
    print(f"✅ Cleaned Dataset Summary:")
    print(f"   Rows:       {len(df)}")
    print(f"   Columns:    {list(df.columns)}")
    print(f"   Products:   {sorted(df['Product'].unique())}")
    print(f"   Channels:   {sorted(df['Purchase Type'].unique())}")
    print(f"   Payments:   {sorted(df['Payment Method'].unique())}")
    print(f"   Date range: {df['Date'].min()} → {df['Date'].max()}")
    print(f"   Null cells: {df.isnull().sum().sum()}")

    # ── Quick stats per product ───────────────────────────
    # 🎓 f-string formatting:
    #    {product:25s}  — pad the string to 25 characters (for alignment)
    #    {q.min():8.1f} — format as float, 8 chars wide, 1 decimal place
    print(f"\n📊 Quantity stats per product:")
    for product in sorted(df["Product"].unique()):
        q = df.loc[df["Product"] == product, "Quantity"]
        print(f"   {product:25s}  min={q.min():8.1f}  max={q.max():8.1f}  mean={q.mean():8.1f}")

    # ══════════════════════════════════════════════════════
    # STEP 6: Save the cleaned CSV
    # ══════════════════════════════════════════════════════
    # 🎓 os.makedirs(path, exist_ok=True) — creates the folder if it doesn't exist.
    #    exist_ok=True means "don't crash if folder already exists."
    #
    #    df.to_csv() saves the DataFrame back to a CSV file.
    #    index=False means "don't write the row numbers as a column."
    #    (By default pandas adds 0,1,2,3... as a first column — we don't want that.)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)
    print(f"\n💾 Saved → {OUTPUT_PATH}")
    print("=" * 55)


# 🎓 THE __name__ == "__main__" PATTERN:
#    When you run a Python file directly (python clean_csv.py), Python sets
#    the special variable __name__ to "__main__".
#    When you IMPORT this file from another file, __name__ is set to the module name.
#
#    So this block says: "Only run clean() if this file is executed directly,
#    NOT when it's imported by another script."
#
#    This is standard practice in Python — it makes your code both
#    runnable as a script AND importable as a module.
if __name__ == "__main__":
    clean()
