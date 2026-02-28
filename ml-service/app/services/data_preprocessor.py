"""
📊 Data Preprocessing Pipeline
═══════════════════════════════

This is the MOST IMPORTANT step before any ML model can work.
"Garbage in = garbage out" — if we feed bad data to Prophet, we get bad predictions.

WHAT THIS FILE DOES (in order):
  1. LOAD     — Pull raw sales data from MongoDB into a pandas DataFrame
  2. AGGREGATE — Combine multiple orders per day into daily totals per product
  3. FILL GAPS — Add rows for missing days (days the restaurant was closed)
  4. FEATURES  — Add columns that help Prophet understand patterns:
                 day_of_week, month, is_weekend, is_festival, etc.
  5. FORMAT    — Convert to Prophet's required format: columns 'ds' (date) and 'y' (value)

WHY EACH STEP MATTERS:
  - Raw data has MULTIPLE rows per day per product (each order is a row).
    Prophet needs ONE row per day per product (daily total).
  - If the restaurant was closed on a Tuesday, that day is simply MISSING.
    Prophet would think "Monday → Wednesday" is a 1-day gap. We fix this by
    adding a row with quantity=0 for missing days.
  - Prophet can use "regressors" (extra features) like is_weekend and is_festival
    to learn patterns. Without these, it only knows dates — not WHY demand changes.

WHAT IS pandas?
  pandas is Python's #1 data manipulation library. It gives you "DataFrames" —
  think of them as Excel spreadsheets in code. You can filter, group, sort,
  merge, pivot, and aggregate data with one-liners.

  DataFrame = table with rows and named columns
  Series = one column from a DataFrame
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta


# ── Known US festival dates in our data range (2022-2024) ──
# These are the same festivals from generate_synthetic_data.py.
# We store them here so the preprocessor can tag sales on festival days.
# In production, you'd query the festivals collection from MongoDB instead.
FESTIVAL_DATES = {
    # 2022
    "2022-12-25": "Christmas 2022",
    "2022-12-31": "New Year's Eve 2022",
    # 2023
    "2023-01-01": "New Year 2023",
    "2023-01-16": "MLK Jr. Day 2023",
    "2023-02-12": "Super Bowl 2023",
    "2023-02-14": "Valentine's Day 2023",
    "2023-02-20": "Presidents' Day 2023",
    "2023-05-14": "Mother's Day 2023",
    "2023-05-29": "Memorial Day 2023",
    "2023-06-18": "Father's Day 2023",
    "2023-07-04": "Independence Day 2023",
    "2023-09-04": "Labor Day 2023",
    "2023-10-31": "Halloween 2023",
    "2023-11-23": "Thanksgiving 2023",
    "2023-11-24": "Black Friday 2023",
    "2023-12-25": "Christmas 2023",
    "2023-12-31": "New Year's Eve 2023",
    # 2024
    "2024-01-01": "New Year 2024",
    "2024-01-15": "MLK Jr. Day 2024",
    "2024-02-11": "Super Bowl 2024",
    "2024-02-14": "Valentine's Day 2024",
    "2024-02-19": "Presidents' Day 2024",
    "2024-05-12": "Mother's Day 2024",
    "2024-05-27": "Memorial Day 2024",
    "2024-06-16": "Father's Day 2024",
    "2024-07-04": "Independence Day 2024",
    "2024-09-02": "Labor Day 2024",
    "2024-10-31": "Halloween 2024",
    "2024-11-28": "Thanksgiving 2024",
    "2024-11-29": "Black Friday 2024",
}


def load_sales_from_mongodb(db):
    """
    Step 1: LOAD — Pull all sales records from MongoDB into a pandas DataFrame.
    
    db.sales.find() returns a cursor (lazy iterator) of all documents.
    pd.DataFrame(list(...)) converts it into a table.
    
    We only keep the columns we need: date, product, quantity, price.
    The rest (orderId, paymentMethod, etc.) aren't needed for forecasting.
    """
    print("📥 Loading sales data from MongoDB...")
    
    cursor = db.sales.find(
        {},  # empty filter = get ALL documents
        {    # projection = which fields to include (1) or exclude (0)
            "_id": 0,
            "date": 1,
            "product": 1,
            "quantity": 1,
            "price": 1,
        }
    )
    
    df = pd.DataFrame(list(cursor))
    
    if df.empty:
        raise ValueError("No sales data found in MongoDB! Run the seed script first.")
    
    # Ensure 'date' column is proper datetime type (not string)
    df["date"] = pd.to_datetime(df["date"])
    
    print(f"   Loaded {len(df)} raw sales records")
    print(f"   Date range: {df['date'].min().date()} to {df['date'].max().date()}")
    print(f"   Products: {sorted(df['product'].unique())}")
    
    return df


def aggregate_daily_sales(df):
    """
    Step 2: AGGREGATE — Combine multiple rows into one row per day per product.
    
    Raw data looks like:
      2023-12-25 | Burgers | 50 | 12.99
      2023-12-25 | Burgers | 30 | 12.99   ← same product, same day!
      2023-12-25 | Fries   | 80 | 3.49
    
    After aggregation:
      2023-12-25 | Burgers | 80  | 1039.20   ← quantities summed, revenue calculated
      2023-12-25 | Fries   | 80  | 279.20
    
    .groupby() groups rows by (date, product), then .agg() calculates totals.
    This is like SQL: SELECT date, product, SUM(quantity), SUM(price*quantity) GROUP BY date, product
    """
    print("📊 Aggregating to daily totals per product...")
    
    # Calculate revenue per row first (price × quantity)
    df["revenue"] = df["price"] * df["quantity"]
    
    daily = df.groupby(
        [df["date"].dt.date, "product"]  # Group by date (no time) + product
    ).agg(
        quantity=("quantity", "sum"),     # Sum all quantities for that day+product
        revenue=("revenue", "sum"),      # Sum all revenue for that day+product
        avg_price=("price", "mean"),     # Average selling price
        order_count=("quantity", "count"),  # How many separate orders
    ).reset_index()
    
    # .reset_index() converts the groupby keys back into regular columns
    # Without it, date and product would be stuck as the index (not columns)
    
    daily.columns = ["date", "product", "quantity", "revenue", "avg_price", "order_count"]
    daily["date"] = pd.to_datetime(daily["date"])
    
    print(f"   Aggregated to {len(daily)} daily records")
    
    return daily


def fill_missing_days(daily_df):
    """
    Step 3: FILL GAPS — Add rows with quantity=0 for days with no sales.
    
    WHY? If the restaurant closed on Jan 3, there's no row for that day.
    Prophet would see: Jan 2 → Jan 4 and think it's a 1-day gap.
    The actual gap is 2 days with 0 sales on Jan 3.
    
    HOW?
    1. Create a complete date range (every day from first to last sale)
    2. Create every combination of date × product (called a "cross join")
    3. Merge with actual data — days without sales get NaN → fill with 0
    
    pd.date_range() creates a list of every date between start and end.
    pd.MultiIndex.from_product() creates every possible combination.
    """
    print("📅 Filling missing days with zeros...")
    
    # Complete date range — every single day
    all_dates = pd.date_range(
        start=daily_df["date"].min(),
        end=daily_df["date"].max(),
        freq="D"  # "D" = daily frequency
    )
    
    all_products = daily_df["product"].unique()
    
    # Create every combination: (date1, product1), (date1, product2), ...
    # This is called a "Cartesian product" or "cross join"
    full_index = pd.MultiIndex.from_product(
        [all_dates, all_products],
        names=["date", "product"]
    )
    full_df = pd.DataFrame(index=full_index).reset_index()
    
    # Merge actual data with the complete grid
    # "left join" keeps ALL rows from full_df, adds matching data from daily_df
    # Days without sales get NaN (Not a Number) — we fill those with 0
    merged = full_df.merge(daily_df, on=["date", "product"], how="left")
    merged["quantity"] = merged["quantity"].fillna(0)
    merged["revenue"] = merged["revenue"].fillna(0)
    merged["avg_price"] = merged["avg_price"].fillna(0)
    merged["order_count"] = merged["order_count"].fillna(0)
    
    total_days = len(all_dates)
    actual_days = daily_df["date"].nunique()  # nunique = number of unique values
    filled_days = total_days - actual_days
    
    print(f"   Total date range: {total_days} days")
    print(f"   Days with sales: {actual_days}")
    print(f"   Days filled with 0: {filled_days}")
    print(f"   Final records: {len(merged)} ({total_days} days × {len(all_products)} products)")
    
    return merged


def add_features(df):
    """
    Step 4: FEATURE ENGINEERING — Add columns that help Prophet understand patterns.
    
    WHAT IS FEATURE ENGINEERING?
    Raw data just has (date, product, quantity). But demand depends on:
      - Is it a weekend? (Sat/Sun sell more)
      - What month is it? (Summer sells more beverages)
      - Is there a festival? (Christmas = huge spike)
    
    We ADD these as new columns so Prophet can learn these relationships.
    
    Prophet has TWO ways to use extra info:
      1. Built-in seasonalities (weekly, yearly) — it handles automatically
      2. Extra regressors — WE add columns like 'is_festival', 'is_weekend'
         and tell Prophet to use them via add_regressor()
    
    Even if Prophet handles seasonality internally, having these features
    makes the data useful for OTHER models too (like scikit-learn).
    """
    print("🔧 Adding features...")
    
    # Day of week: 0=Monday ... 6=Sunday (Python convention)
    df["day_of_week"] = df["date"].dt.dayofweek
    
    # Day name for readability
    df["day_name"] = df["date"].dt.day_name()
    
    # Month number (1-12)
    df["month"] = df["date"].dt.month
    
    # Is it a weekend? (Saturday=5 or Sunday=6)
    # .astype(int) converts True/False to 1/0 — Prophet needs numbers, not booleans
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)
    
    # Is it a festival?
    # Convert date to string "YYYY-MM-DD" and check if it's in our festival dict
    df["date_str"] = df["date"].dt.strftime("%Y-%m-%d")
    df["is_festival"] = df["date_str"].isin(FESTIVAL_DATES.keys()).astype(int)
    df["festival_name"] = df["date_str"].map(FESTIVAL_DATES).fillna("")
    
    # Week number in the year (1-52)
    df["week_of_year"] = df["date"].dt.isocalendar().week.astype(int)
    
    # Day of month (1-31) — useful for detecting "end of month" patterns
    df["day_of_month"] = df["date"].dt.day
    
    # Drop the temporary string column
    df = df.drop(columns=["date_str"])
    
    festival_days = df[df["is_festival"] == 1]["date"].nunique()
    weekend_days = df[df["is_weekend"] == 1]["date"].nunique()
    print(f"   Features added: day_of_week, month, is_weekend, is_festival, week_of_year, day_of_month")
    print(f"   Festival days in data: {festival_days}")
    print(f"   Weekend days in data: {weekend_days}")
    
    return df


def prepare_prophet_format(df, product_name):
    """
    Step 5: FORMAT for Prophet — Create the exact structure Prophet expects.
    
    Facebook Prophet REQUIRES exactly these column names:
      'ds' — the date column (datetime)
      'y'  — the value to predict (number — in our case, daily quantity)
    
    Any extra columns we want Prophet to consider are called "regressors"
    and must also be included. We'll add them in the forecasting step.
    
    This function filters the data to ONE product and renames columns.
    
    WHY ONE PRODUCT AT A TIME?
    Each product has different demand patterns:
      - Burgers baseline: ~558/day
      - Beverages baseline: ~700/day
      - Sides: ~200/day
    
    If we trained ONE model on all products mixed together, it would average
    everything and predict badly for all of them. Instead, we train a
    SEPARATE Prophet model per product = 5 models total.
    """
    # Filter to just this product
    product_df = df[df["product"] == product_name].copy()
    
    # Rename to Prophet's required format
    product_df = product_df.rename(columns={
        "date": "ds",       # ds = "datestamp" (Prophet's convention)
        "quantity": "y",    # y = the target variable (what we're predicting)
    })
    
    # Sort by date (Prophet requires chronological order)
    product_df = product_df.sort_values("ds").reset_index(drop=True)
    
    return product_df


def preprocess_all(db):
    """
    MASTER FUNCTION — Runs the entire pipeline end to end.
    
    Returns a dict: { "Burgers": DataFrame, "Fries": DataFrame, ... }
    Each DataFrame is in Prophet-ready format with features.
    
    This is the function that the forecasting model (Step 2.3) will call.
    """
    print("\n" + "=" * 60)
    print("🔄 STARTING DATA PREPROCESSING PIPELINE")
    print("=" * 60)
    
    # Step 1: Load from MongoDB
    raw_df = load_sales_from_mongodb(db)
    
    # Step 2: Aggregate to daily totals
    daily_df = aggregate_daily_sales(raw_df)
    
    # Step 3: Fill missing days
    complete_df = fill_missing_days(daily_df)
    
    # Step 4: Add features
    featured_df = add_features(complete_df)
    
    # Step 5: Split by product and format for Prophet
    products = featured_df["product"].unique()
    result = {}
    
    for product in sorted(products):
        prophet_df = prepare_prophet_format(featured_df, product)
        result[product] = prophet_df
        print(f"   ✅ {product}: {len(prophet_df)} rows ready for Prophet")
    
    print("\n" + "=" * 60)
    print("✅ PREPROCESSING COMPLETE")
    print(f"   {len(products)} products × {featured_df['date'].nunique()} days")
    print("=" * 60 + "\n")
    
    return result
