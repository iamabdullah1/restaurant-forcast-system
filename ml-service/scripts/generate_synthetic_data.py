"""
Phase 0 — Step 0.3: Generate 2-Year Synthetic Sales Data
═════════════════════════════════════════════════════════

🎓 WHAT IS "SYNTHETIC DATA"?
    Our original Kaggle CSV only has 254 rows covering ~2 months (Nov-Dec 2022).
    That's NOT enough to train an ML model — Prophet needs at least 1-2 years
    of data to learn seasonal patterns (summer vs winter, weekday vs weekend).

    So we "generate" fake but REALISTIC data that mimics real restaurant patterns.
    This is called "synthetic data" — it's artificial but statistically plausible.

🎓 WHY NOT JUST DUPLICATE THE ORIGINAL DATA?
    Because copied data has no seasonal variety! Our original data is only
    Nov-Dec, so it doesn't know what summer sales look like, or how
    Thanksgiving affects demand. Synthetic data lets us BAKE IN realistic patterns:
      • Weekends sell more (families eat out)
      • Summer = more beverages (people want cold drinks)
      • Festivals = demand spikes (Thanksgiving, Super Bowl, July 4th)
      • Business grows gradually over time

🎓 HOW THE MATH WORKS — THE MULTIPLIER APPROACH:
    For each day × each product, we calculate:

      final_quantity = base_qty × noise × dow × season × product_season
                       × festival × holiday_season × growth

    Where:
      base_qty        = average daily quantity from original data (e.g., 558 for Burgers)
      noise           = random variation (normal distribution) so it's not too perfect
      dow             = day-of-week factor (Sat = 1.30x, Mon = 0.92x)
      season          = month factor (July = 1.14x, Jan = 0.85x)
      product_season  = product-specific monthly tweak (Beverages in July = 1.22x)
      festival        = spike if it's a holiday/event (Super Bowl = 1.50x!)
      holiday_season  = slight boost during Thanksgiving→New Year period
      growth          = 0.5% increase per month (business is growing)

    All multipliers are layered ON TOP of each other. So a Saturday during
    Thanksgiving weekend could be: 558 × 1.30 × 1.14 × 1.45 = ~1,204 burgers!

Generates: Dec 30, 2022 → Nov 30, 2024 (702 days × 5 products = ~3,510 rows)
"""

# ─── IMPORTS ─────────────────────────────────────────────
import pandas as pd      # For creating and saving the DataFrame
import numpy as np       # For random number generation (normal distribution)
import random            # For random choices (picking channels, payments)
import os                # For file path operations
from datetime import datetime, timedelta  # For date math (adding days)


# ─── CONFIG ──────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "..", "data", "sales_synthetic.csv")

START_DATE = datetime(2022, 12, 30)  # Day after original data ends
END_DATE = datetime(2024, 11, 30)    # ~2 years from original start
ORDER_ID_START = 20001               # Start from 20001 so IDs don't clash with original

# 🎓 SEED: Setting a random seed makes random numbers REPRODUCIBLE.
#    np.random.seed(42) means every time you run this script, you get
#    the EXACT same "random" numbers. This is crucial for:
#      1. Debugging — you get the same output every run
#      2. Collaboration — your teammate gets the same data
#      3. Testing — tests produce consistent results
#    42 is a tradition from "Hitchhiker's Guide to the Galaxy" — the
#    "answer to everything." Any number works, 42 is just the convention.
SEED = 42


# ─── PRODUCT DEFINITIONS ─────────────────────────────────
# 🎓 Each product has:
#    - price: the selling price (must match our products.json)
#    - base_qty: average daily quantity (learned from original 254-row data)
#    - std: standard deviation — how much daily quantity varies
#      (higher std = more volatile sales)
#    - month_mod: product-specific seasonal modifier per month
#      1.0 = no change, 1.22 = 22% MORE, 0.88 = 12% LESS
#
# 🎓 WHAT IS STANDARD DEVIATION (std)?
#    Imagine Burgers sell ~558/day on average. But some days it's 500,
#    other days 620. The std (55) tells us "most days will be within
#    ±55 of 558" — so between ~503 and ~613.
#    np.random.normal(558, 55) generates a random number from this range,
#    following a bell curve (most values near 558, fewer at extremes).
PRODUCTS = {
    "Burgers": {
        "price": 12.99,
        "base_qty": 558,      # Mean from original data
        "std": 55,             # ~10% variation
        # Burgers sell slightly more in summer (BBQ season)
        "month_mod": {1: 0.97, 2: 0.97, 3: 1.0, 4: 1.0, 5: 1.02,
                      6: 1.05, 7: 1.06, 8: 1.05, 9: 1.02, 10: 1.0,
                      11: 1.0, 12: 1.0},
    },
    "Chicken Sandwiches": {
        "price": 9.95,
        "base_qty": 214,
        "std": 22,
        # Comfort food — slight winter boost (people crave warm food)
        "month_mod": {1: 1.03, 2: 1.02, 3: 1.0, 4: 1.0, 5: 1.0,
                      6: 0.98, 7: 0.97, 8: 0.98, 9: 1.0, 10: 1.0,
                      11: 1.04, 12: 1.05},
    },
    "Fries": {
        "price": 3.49,
        "base_qty": 628,
        "std": 38,
        # 🎓 Dictionary comprehension: {m: 1.0 for m in range(1, 13)}
        #    creates {1: 1.0, 2: 1.0, ..., 12: 1.0} — stable all year
        "month_mod": {m: 1.0 for m in range(1, 13)},
    },
    "Beverages": {
        "price": 2.95,
        "base_qty": 700,
        "std": 30,
        # BIG summer spike — people want cold drinks when it's hot!
        # Jan=88% of normal, July=122% of normal
        "month_mod": {1: 0.88, 2: 0.90, 3: 0.95, 4: 1.0, 5: 1.08,
                      6: 1.18, 7: 1.22, 8: 1.18, 9: 1.08, 10: 1.0,
                      11: 0.93, 12: 0.90},
    },
    "Sides & Other": {
        "price": 4.99,
        "base_qty": 200,
        "std": 28,
        "month_mod": {m: 1.0 for m in range(1, 13)},
    },
}


# ─── DAY-OF-WEEK MULTIPLIERS ────────────────────────────
# 🎓 0 = Monday, 6 = Sunday (Python's weekday() convention).
#    Restaurants are busiest on weekends:
#      Saturday (1.30) = 30% MORE than a normal day
#      Monday (0.92)   = 8% LESS than a normal day
#    These are realistic patterns from the food service industry.
DOW_FACTORS = {
    0: 0.92,  # Mon — slowest (people cook at home after weekend)
    1: 0.95,  # Tue
    2: 1.00,  # Wed — baseline (we treat this as "normal")
    3: 1.00,  # Thu
    4: 1.15,  # Fri — weekend starts, people go out
    5: 1.30,  # Sat — peak day (families, no work/school)
    6: 1.18,  # Sun — strong but slightly less (some rest at home)
}


# ─── MONTHLY SEASONAL FACTORS (Global — affects ALL products) ────
# 🎓 Restaurants have seasonal patterns:
#    January (0.85) = 15% LESS — post-holiday slump, people dieting
#    July (1.14) = 14% MORE — peak summer, vacations, more eating out
#    December (1.15) = 15% MORE — holiday celebrations, parties
#
#    These are GLOBAL — they affect every product. Then each product has
#    its OWN monthly modifier on top of this (defined above).
MONTH_FACTORS = {
    1: 0.85,   # Jan — post-holiday slump, New Year diets
    2: 0.88,
    3: 0.93,
    4: 0.97,
    5: 1.02,
    6: 1.10,   # Summer starts
    7: 1.14,   # Peak summer
    8: 1.10,
    9: 1.03,
    10: 0.98,
    11: 1.05,  # Holiday season begins
    12: 1.15,  # Holiday peak (Christmas, New Year prep)
}


# ─── GROWTH TREND ────────────────────────────────────────
# 🎓 A real business typically grows over time (marketing, reputation, etc.)
#    0.005 = 0.5% growth per month ≈ 6% per year.
#    After 24 months: 1.0 + (24 × 0.005) = 1.12 → 12% more sales than start.
#    This makes our data more realistic than flat sales.
MONTHLY_GROWTH_RATE = 0.005


# ─── FESTIVAL DATES WITH SPIKE MULTIPLIERS ───────────────
# 🎓 Festivals/holidays cause DEMAND SPIKES — people celebrate, order more food.
#    Each festival has:
#      start/end: date range (some festivals span multiple days)
#      mult: the spike multiplier (1.50 = 50% MORE than normal — Super Bowl!)
#      name: for logging
#
#    We hardcode these because the synthetic data generator needs to know
#    EXACTLY when festivals fall. Later, the MCP Server will fetch FUTURE
#    festivals from the Nager.Date API dynamically.
#
#    🎓 WHY STRING DATES ("2023-04-22") INSTEAD OF datetime OBJECTS?
#       Because string comparison works for YYYY-MM-DD format!
#       "2023-04-22" <= "2023-04-23" <= "2023-04-24" → True
#       This is a handy trick that only works with YYYY-MM-DD
#       (wouldn't work with DD-MM-YYYY!)
FESTIVALS = [
    # ── 2022 (tail end) ──
    {"start": "2022-12-31", "end": "2023-01-01", "mult": 1.40, "name": "New Year 2023"},

    # ── 2023 ──
    {"start": "2023-01-16", "end": "2023-01-16", "mult": 1.10, "name": "MLK Jr. Day 2023"},
    {"start": "2023-02-12", "end": "2023-02-12", "mult": 1.50, "name": "Super Bowl Sunday 2023"},
    {"start": "2023-02-14", "end": "2023-02-14", "mult": 1.30, "name": "Valentine's Day 2023"},
    {"start": "2023-02-20", "end": "2023-02-20", "mult": 1.10, "name": "Presidents' Day 2023"},
    {"start": "2023-05-14", "end": "2023-05-14", "mult": 1.35, "name": "Mother's Day 2023"},
    {"start": "2023-05-29", "end": "2023-05-29", "mult": 1.25, "name": "Memorial Day 2023"},
    {"start": "2023-06-18", "end": "2023-06-18", "mult": 1.20, "name": "Father's Day 2023"},
    {"start": "2023-07-04", "end": "2023-07-04", "mult": 1.35, "name": "Independence Day 2023"},
    {"start": "2023-09-04", "end": "2023-09-04", "mult": 1.25, "name": "Labor Day 2023"},
    {"start": "2023-10-31", "end": "2023-10-31", "mult": 1.15, "name": "Halloween 2023"},
    {"start": "2023-11-23", "end": "2023-11-23", "mult": 1.45, "name": "Thanksgiving 2023"},
    {"start": "2023-11-24", "end": "2023-11-24", "mult": 1.25, "name": "Black Friday 2023"},
    {"start": "2023-12-25", "end": "2023-12-25", "mult": 1.40, "name": "Christmas 2023"},
    {"start": "2023-12-31", "end": "2024-01-01", "mult": 1.40, "name": "New Year 2024"},

    # ── 2024 ──
    {"start": "2024-01-15", "end": "2024-01-15", "mult": 1.10, "name": "MLK Jr. Day 2024"},
    {"start": "2024-02-11", "end": "2024-02-11", "mult": 1.50, "name": "Super Bowl Sunday 2024"},
    {"start": "2024-02-14", "end": "2024-02-14", "mult": 1.30, "name": "Valentine's Day 2024"},
    {"start": "2024-02-19", "end": "2024-02-19", "mult": 1.10, "name": "Presidents' Day 2024"},
    {"start": "2024-05-12", "end": "2024-05-12", "mult": 1.35, "name": "Mother's Day 2024"},
    {"start": "2024-05-27", "end": "2024-05-27", "mult": 1.25, "name": "Memorial Day 2024"},
    {"start": "2024-06-16", "end": "2024-06-16", "mult": 1.20, "name": "Father's Day 2024"},
    {"start": "2024-07-04", "end": "2024-07-04", "mult": 1.35, "name": "Independence Day 2024"},
    {"start": "2024-09-02", "end": "2024-09-02", "mult": 1.25, "name": "Labor Day 2024"},
    {"start": "2024-10-31", "end": "2024-10-31", "mult": 1.15, "name": "Halloween 2024"},
    {"start": "2024-11-28", "end": "2024-11-28", "mult": 1.45, "name": "Thanksgiving 2024"},
    {"start": "2024-11-29", "end": "2024-11-29", "mult": 1.25, "name": "Black Friday 2024"},
]

# ── Holiday Season periods ────────────────────────────────
# 🎓 In the US, the "Holiday Season" (Thanksgiving → New Year) is a huge
#    period for restaurants. People host parties, families dine out,
#    office holiday lunches, etc. Net effect: a steady 10% boost (1.10x)
#    across the entire period — on top of individual holiday spikes.
HOLIDAY_SEASON_PERIODS = [
    {"start": "2023-11-23", "end": "2024-01-01", "mult": 1.10, "name": "Holiday Season 2023"},
    {"start": "2024-11-28", "end": "2024-12-31", "mult": 1.10, "name": "Holiday Season 2024"},
]


# ─── CHANNELS & PAYMENT METHODS ─────────────────────────
CHANNELS = ["In-store", "Drive-thru", "Online"]
PAYMENTS = ["Credit Card", "Cash", "Gift Card"]

# 🎓 WEIGHTS for random.choices():
#    These control the PROBABILITY of each option being picked.
#    [0.50, 0.35, 0.15] means:
#      Credit Card = 50% chance, Cash = 35%, Gift Card = 15%
#    They must sum to 1.0 (100%).
PAYMENT_WEIGHTS = [0.50, 0.35, 0.15]


def get_channel_weights(months_elapsed):
    """
    🎓 Simulates the real-world trend: Online ordering grows over time.
    
    In 2022, maybe 20% of orders were online. By 2024, it's 30%.
    Meanwhile, in-store shrinks more, drive-thru shrinks a little.
    
    How it works:
      months_elapsed = how many months since start
      online_growth  = grows by 0.4% per month, capped at 10%
    
    Example at month 12:
      online_growth = min(0.10, 12 × 0.004) = min(0.10, 0.048) = 0.048
      In-store:   0.50 - (0.048 × 0.6) = 0.50 - 0.029 = 0.471 (47.1%)
      Drive-thru: 0.30 - (0.048 × 0.4) = 0.30 - 0.019 = 0.281 (28.1%)
      Online:     0.20 + 0.048                          = 0.248 (24.8%)
    """
    online_growth = min(0.10, months_elapsed * 0.004)
    return [
        0.50 - (online_growth * 0.6),  # In-store shrinks the most
        0.30 - (online_growth * 0.4),  # Drive-thru shrinks slightly
        0.20 + online_growth,           # Online grows
    ]


def get_festival_multiplier(date_str):
    """
    🎓 Check if a date falls on a festival. Returns the highest multiplier.
    
    Why "highest"? Because festivals can overlap (e.g., Black Friday is
    the day after Thanksgiving). We want the biggest spike, not to multiply
    them together (that would make numbers unrealistically huge).
    """
    best_mult = 1.0   # 1.0 = no change (default — not a festival)
    best_name = None
    for f in FESTIVALS:
        # 🎓 String comparison works for YYYY-MM-DD format!
        #    "2023-04-22" <= "2023-04-23" <= "2023-04-24" → True
        if f["start"] <= date_str <= f["end"]:
            if f["mult"] > best_mult:
                best_mult = f["mult"]
                best_name = f["name"]
    return best_mult, best_name


def get_holiday_season_multiplier(date_str):
    """Check if date falls in the Holiday Season (Thanksgiving→New Year). Returns 1.10 if yes, 1.0 if no."""
    for r in HOLIDAY_SEASON_PERIODS:
        if r["start"] <= date_str <= r["end"]:
            return r["mult"]
    return 1.0  # Not holiday season — no change


def generate():
    """
    🎓 MAIN GENERATOR FUNCTION
    
    Algorithm:
      1. Loop through every day from START_DATE to END_DATE
      2. For each day, calculate all the multipliers (dow, season, festival, etc.)
      3. For each day × each product, calculate quantity using multipliers
      4. Pick a random channel and payment method
      5. Store the row
      6. Move to next day
    
    The result is ~3,510 rows (702 days × 5 products/day).
    """
    # 🎓 Set random seeds for BOTH numpy and Python's random module.
    #    We use both: numpy for normal distribution, random for choices.
    np.random.seed(SEED)
    random.seed(SEED)

    print("=" * 55)
    print("  Phase 0.3 — Generate Synthetic Sales Data")
    print("=" * 55)

    rows = []              # Will hold all generated row dictionaries
    order_id = ORDER_ID_START
    current = START_DATE   # Current date — we'll add 1 day each loop iteration

    # 🎓 ref_month: a reference point to calculate "months elapsed."
    #    We convert year+month to a single number for easy subtraction.
    #    2022-12 → (2022×12 + 12) = 24276
    #    2023-06 → (2023×12 + 6)  = 24282
    #    months_elapsed = 24282 - 24276 = 6 months
    ref_month = START_DATE.year * 12 + START_DATE.month
    festivals_hit = set()  # Track which festivals we applied (for logging)

    # ═══════════════════════════════════════════════════════
    # MAIN LOOP: One iteration per day
    # ═══════════════════════════════════════════════════════
    while current <= END_DATE:
        date_str = current.strftime("%Y-%m-%d")  # "2023-06-15"
        months_elapsed = (current.year * 12 + current.month) - ref_month

        # ── Calculate all multipliers for this day ────────
        # 🎓 growth: increases over time (month 0 = 1.0, month 12 = 1.06)
        growth = 1.0 + (months_elapsed * MONTHLY_GROWTH_RATE)

        # 🎓 current.weekday() returns 0=Mon, 1=Tue, ..., 6=Sun
        dow_factor = DOW_FACTORS[current.weekday()]

        # 🎓 current.month returns 1-12
        seasonal = MONTH_FACTORS[current.month]

        # 🎓 Check if today is a festival or during the Holiday Season
        festival_mult, festival_name = get_festival_multiplier(date_str)
        holiday_mult = get_holiday_season_multiplier(date_str)

        if festival_name:
            festivals_hit.add(festival_name)

        # 🎓 Channel weights shift as months pass (Online grows)
        ch_weights = get_channel_weights(months_elapsed)

        # ── Generate one row per product ──────────────────
        for product, cfg in PRODUCTS.items():
            # 🎓 np.random.normal(mean, std) generates a random number
            #    from a NORMAL DISTRIBUTION (bell curve).
            #    Example: normal(558, 55) → most values between 448-668
            #    This gives natural variation (not every day is exactly 558)
            base = np.random.normal(cfg["base_qty"], cfg["std"])

            # Product-specific monthly modifier (e.g., Beverages +22% in July)
            prod_seasonal = cfg["month_mod"][current.month]

            # ── THE BIG MULTIPLICATION ────────────────────
            # 🎓 All multipliers are layered:
            #    base     = 558 (with noise, maybe 540 this time)
            #    × dow    = 1.30 (Saturday) → 702
            #    × season = 1.14 (July)     → 800
            #    × prod   = 1.06 (Burgers in July) → 848
            #    × fest   = 1.0 (not a festival)   → 848
            #    × hol    = 1.0 (not holiday season)→ 848
            #    × growth = 1.06 (month 12)        → 899
            quantity = base * dow_factor * seasonal * prod_seasonal
            quantity *= festival_mult * holiday_mult * growth

            # 🎓 max(50, ...) ensures we never go below 50 units
            #    (a restaurant always sells SOMETHING, even on the worst day)
            quantity = max(50, round(quantity, 2))

            # 🎓 random.choices(population, weights) picks one item randomly
            #    according to the given probability weights.
            #    It returns a LIST, so [0] gets the single item.
            channel = random.choices(CHANNELS, weights=ch_weights)[0]
            payment = random.choices(PAYMENTS, weights=PAYMENT_WEIGHTS)[0]

            # 🎓 Append a dictionary representing one row of the CSV.
            #    Later we'll convert the list of dicts into a DataFrame.
            rows.append({
                "Order ID": order_id,
                "Date": date_str,
                "Product": product,
                "Price": cfg["price"],
                "Quantity": quantity,
                "Purchase Type": channel,
                "Payment Method": payment,
            })
            order_id += 1

        # 🎓 timedelta(days=1) = "1 day". Adding it moves to the next day.
        current += timedelta(days=1)

    # ═══════════════════════════════════════════════════════
    # Convert list of dicts → pandas DataFrame
    # ═══════════════════════════════════════════════════════
    # 🎓 pd.DataFrame(list_of_dicts) automatically creates columns from
    #    the dictionary keys. Each dict becomes one row.
    df = pd.DataFrame(rows)

    # ─── Print stats to verify ────────────────────────────
    print(f"\n📊 Generated {len(df)} rows")
    print(f"   Date range: {df['Date'].min()} → {df['Date'].max()}")
    total_days = df["Date"].nunique()
    print(f"   Unique days: {total_days}")
    print(f"   Products: {sorted(df['Product'].unique())}")

    print(f"\n🎉 Festivals applied ({len(festivals_hit)}):")
    for f in sorted(festivals_hit):
        print(f"   • {f}")

    # 🎓 value_counts(normalize=True) gives percentages instead of raw counts
    print(f"\n📈 Channel distribution:")
    ch_dist = df["Purchase Type"].value_counts(normalize=True)
    for ch, pct in ch_dist.items():
        print(f"   {ch:15s} {pct:.1%}")

    print(f"\n📊 Quantity stats per product:")
    for product in sorted(df["Product"].unique()):
        q = df.loc[df["Product"] == product, "Quantity"]
        print(f"   {product:25s}  min={q.min():8.1f}  max={q.max():8.1f}  mean={q.mean():8.1f}")

    # ─── Save ─────────────────────────────────────────────
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)
    print(f"\n💾 Saved → {OUTPUT_PATH}")
    print("=" * 55)

    return df


if __name__ == "__main__":
    generate()
