"""
🎆 Festival Spike Analyzer
═══════════════════════════

This file answers the question: "HOW MUCH do sales spike during festivals?"

Instead of guessing "Thanksgiving is probably busy," we MEASURE it from
actual historical data. This gives us precise numbers like:
  "Thanksgiving causes a 46% spike for Burgers (1.46× normal demand)"

WHY IS THIS A SEPARATE STEP FROM PROPHET?
  Prophet already knows about festivals via the is_festival regressor.
  But Prophet treats ALL festivals the same — it learns ONE average
  "festival effect" across all holidays.

  In reality, festivals have VERY different impacts:
    - Super Bowl:    50% spike (everyone orders food for watch parties)
    - Thanksgiving:  45% spike (family gatherings)
    - Halloween:     15% spike (mild — not a big eating-out holiday)
    - MLK Jr. Day:   10% spike (day off, but not food-focused)

  This analyzer calculates a SPECIFIC multiplier per festival per product,
  so we can adjust Prophet's baseline forecast with precise festival effects.

HOW THE MULTIPLIER IS CALCULATED:
  For each festival day in our historical data:

    1. FESTIVAL SALES = actual quantity sold on the festival day
    2. BASELINE SALES = average daily sales in the surrounding ±14 days
       (excluding other festival days and weekends — to get a "normal" day baseline)
    3. SPIKE MULTIPLIER = festival_sales / baseline_sales

  Example for Thanksgiving 2024, Burgers:
    - Festival day sales: 812 units
    - Average "normal day" in nearby 2 weeks: 558 units
    - Multiplier = 812 / 558 = 1.46 → "46% spike"

  If we have data for the same festival across multiple years (e.g., Christmas 2023
  and Christmas 2024), we AVERAGE the multipliers for a more robust estimate.

HOW THIS INTEGRATES WITH FORECASTING:
  The demand_forecaster (Step 2.3) produces a base prediction per day.
  If a future day is a festival, we look up the multiplier for that
  specific festival and apply it:

    adjusted_forecast = base_forecast × festival_multiplier

  This replaces Prophet's generic "festival effect" with our precise
  per-festival, per-product multiplier.

WHAT IS "BASELINE" AND WHY ±14 DAYS?
  The baseline is "what sales would have been WITHOUT the festival."
  We look at the 14 days before and 14 days after the festival,
  excluding weekends and other festivals, to get a clean "normal"
  average. Why 14 days?
    - Too short (3 days): might catch another anomaly (a rainy day, a promotion)
    - Too long (60 days): seasonal trends would shift (summer → fall)
    - 14 days: ~10 usable weekdays, large enough to smooth out noise
"""

import pandas as pd
import numpy as np
from datetime import timedelta

from app.services.data_preprocessor import FESTIVAL_DATES


# ── Festival Category Mapping ──
# Multiple dates map to the SAME festival "type."
# e.g., "Christmas 2023" and "Christmas 2024" are both "Christmas"
# We strip the year to group them together for averaging.
def _get_festival_type(festival_name):
    """
    Extract the generic festival type from a year-specific name.
    
    "Thanksgiving 2023" → "Thanksgiving"
    "Super Bowl 2024"   → "Super Bowl"
    "New Year's Eve 2022" → "New Year's Eve"
    
    WHY? So we can average Thanksgiving 2023 and Thanksgiving 2024
    into one "Thanksgiving" multiplier for future predictions.
    """
    # Remove the year (last 4-5 characters like " 2023" or " 2024")
    # We split on spaces and check if the last token is a 4-digit year
    parts = festival_name.strip().split()
    if parts and parts[-1].isdigit() and len(parts[-1]) == 4:
        return " ".join(parts[:-1])
    return festival_name


# ── Impact Classification ──
# Classify how "impactful" a festival is based on its multiplier
def _classify_impact(multiplier):
    """
    Classify a festival's demand impact into a human-readable category.
    
    This helps the restaurant manager quickly understand:
      🔴 HIGH (≥1.35): Major event — need heavy stocking & extra staff
      🟡 MEDIUM (1.15–1.35): Notable bump — stock up a bit
      🟢 LOW (<1.15): Mild — minimal adjustment needed
    """
    if multiplier >= 1.35:
        return "HIGH"
    elif multiplier >= 1.15:
        return "MEDIUM"
    else:
        return "LOW"


def analyze_festival_spikes(product_data_dict):
    """
    MAIN FUNCTION — Analyze all historical festivals and calculate spike multipliers.
    
    PARAMETERS:
      product_data_dict: dict from preprocess_all() → { "Burgers": DataFrame, ... }
        Each DataFrame has columns: ds, product, y, is_festival, festival_name, is_weekend, ...
    
    RETURNS:
      {
        "by_product": {
          "Burgers": {
            "Thanksgiving": { "multiplier": 1.46, "impact": "HIGH", ... },
            "Super Bowl":   { "multiplier": 1.52, "impact": "HIGH", ... },
            ...
          },
          "Beverages": { ... },
          ...
        },
        "by_festival": {
          "Thanksgiving": {
            "avg_multiplier": 1.43,
            "impact": "HIGH",
            "products": { "Burgers": 1.46, "Fries": 1.44, ... }
          },
          ...
        },
        "overall_stats": {
          "festivals_analyzed": 13,
          "highest_impact": { "festival": "Super Bowl", "multiplier": 1.52, "product": "Burgers" },
          "lowest_impact": { "festival": "MLK Jr. Day", "multiplier": 1.08, "product": "Sides & Other" },
        }
      }
    """
    print("\n" + "═" * 60)
    print("🎆 ANALYZING FESTIVAL SPIKE MULTIPLIERS")
    print("═" * 60)
    
    by_product = {}     # { product: { festival_type: { multiplier, ... } } }
    all_spikes = []     # flat list of every (product, festival, multiplier) for stats
    
    for product_name, df in sorted(product_data_dict.items()):
        print(f"\n   📦 Analyzing: {product_name}")
        product_spikes = _analyze_product_festivals(df, product_name)
        by_product[product_name] = product_spikes
        
        for festival_type, info in product_spikes.items():
            all_spikes.append({
                "product": product_name,
                "festival": festival_type,
                "multiplier": info["multiplier"],
            })
    
    # ── Group by festival (across all products) ──
    by_festival = _group_by_festival(by_product)
    
    # ── Overall statistics ──
    overall_stats = _calculate_overall_stats(all_spikes)
    
    result = {
        "by_product": by_product,
        "by_festival": by_festival,
        "overall_stats": overall_stats,
    }
    
    _print_summary(result)
    
    return result


def _analyze_product_festivals(df, product_name):
    """
    Calculate spike multipliers for every festival for ONE product.
    
    For each festival date in the data:
      1. Get the festival day's actual sales
      2. Calculate the baseline (avg non-festival, non-weekend day in ±14 days)
      3. Compute multiplier = festival_sales / baseline
      4. Group by festival TYPE and average across years
    
    RETURNS: dict of { festival_type: { multiplier, impact, occurrences, details } }
    """
    # Get all festival days for this product
    festival_rows = df[df["is_festival"] == 1].copy()
    
    if festival_rows.empty:
        return {}
    
    # Collect raw spike data for each festival occurrence
    raw_spikes = []  # list of { festival_type, date, festival_sales, baseline, multiplier }
    
    for _, row in festival_rows.iterrows():
        festival_date = row["ds"]
        festival_name = row["festival_name"]
        festival_sales = row["y"]
        festival_type = _get_festival_type(festival_name)
        
        # Calculate baseline: average sales in ±14 days, excluding festivals & weekends
        baseline = _calculate_baseline(df, festival_date)
        
        if baseline > 0:
            multiplier = festival_sales / baseline
        else:
            # Edge case: baseline is 0 (unlikely but defensive)
            multiplier = 1.0
        
        raw_spikes.append({
            "festival_type": festival_type,
            "date": festival_date.strftime("%Y-%m-%d") if hasattr(festival_date, 'strftime') else str(festival_date),
            "festival_sales": float(festival_sales),
            "baseline": round(float(baseline), 1),
            "multiplier": round(float(multiplier), 3),
        })
    
    # Group by festival type and average multipliers across years
    # e.g., Christmas 2023 (1.42×) + Christmas 2024 (1.38×) → Christmas avg = 1.40×
    grouped = {}
    for spike in raw_spikes:
        ft = spike["festival_type"]
        if ft not in grouped:
            grouped[ft] = []
        grouped[ft].append(spike)
    
    result = {}
    for festival_type, occurrences in sorted(grouped.items()):
        multipliers = [o["multiplier"] for o in occurrences]
        avg_mult = round(np.mean(multipliers), 3)
        
        result[festival_type] = {
            "multiplier": avg_mult,
            "impact": _classify_impact(avg_mult),
            "occurrences": len(occurrences),
            "min_multiplier": round(min(multipliers), 3),
            "max_multiplier": round(max(multipliers), 3),
            "details": occurrences,  # keep raw data for transparency
        }
        
        impact_emoji = {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "🟢"}[result[festival_type]["impact"]]
        print(f"      {impact_emoji} {festival_type:<20s} → {avg_mult:.2f}× ({len(occurrences)} occurrences)")
    
    return result


def _calculate_baseline(df, festival_date, window_days=14):
    """
    Calculate the "normal day" baseline sales around a festival date.
    
    LOGIC:
      1. Define a window: [festival_date - 14 days, festival_date + 14 days]
      2. Filter the data to this window
      3. EXCLUDE:
         - The festival day itself (that's what we're comparing TO)
         - Other festival days (they're also abnormal)
         - Weekends (Sat/Sun have naturally higher sales — we want the
           TRUE "normal day" baseline so the multiplier reflects ONLY
           the festival effect, not a weekend boost on top of it)
      4. Return the mean of the remaining "normal weekdays"
    
    WHY EXCLUDE WEEKENDS?
      If a festival falls on a Saturday (like Super Bowl), comparing it
      to a baseline that INCLUDES Saturdays would undercount the spike.
      Saturday already has 30% higher sales. We want to know:
      "How much more than a NORMAL weekday did this festival cause?"
      
      Then when we apply the multiplier to a forecast, Prophet's own
      weekend seasonality handles the weekend part, and our multiplier
      handles the festival part — no double-counting.
    
    EDGE CASE: If the festival IS on a weekend, we compare to normal
    weekdays anyway. The multiplier will be higher (capturing both the
    weekend + festival effect), but that's correct because when we
    apply it to a future forecast, we'll apply it to the BASE forecast
    (which is the weekday-level prediction), not the weekend prediction.
    
    WAIT — actually, that WOULD double-count. So instead:
      - If festival is on a weekday → baseline = avg of nearby weekdays
      - If festival is on a weekend → baseline = avg of nearby weekends
    This way the multiplier always compares apples to apples.
    """
    window_start = festival_date - timedelta(days=window_days)
    window_end = festival_date + timedelta(days=window_days)
    
    # Filter to the window
    mask = (df["ds"] >= window_start) & (df["ds"] <= window_end)
    window_df = mask.copy()
    window_data = df[mask].copy()
    
    # Is the festival day itself on a weekend?
    festival_day_of_week = festival_date.dayofweek if hasattr(festival_date, 'dayofweek') else pd.to_datetime(festival_date).dayofweek
    festival_is_weekend = festival_day_of_week >= 5
    
    # Exclude the festival day itself and other festival days
    baseline_data = window_data[
        (window_data["ds"] != festival_date) &  # not the festival day
        (window_data["is_festival"] == 0)        # not any other festival
    ]
    
    # Compare to same type of day (weekday vs weekend) to avoid double-counting
    if festival_is_weekend:
        baseline_data = baseline_data[baseline_data["is_weekend"] == 1]
    else:
        baseline_data = baseline_data[baseline_data["is_weekend"] == 0]
    
    if baseline_data.empty or baseline_data["y"].sum() == 0:
        # Fallback: use ALL non-festival days in the window if filtered set is empty
        baseline_data = window_data[
            (window_data["ds"] != festival_date) &
            (window_data["is_festival"] == 0)
        ]
    
    if baseline_data.empty:
        return 0.0
    
    return float(baseline_data["y"].mean())


def _group_by_festival(by_product):
    """
    Reorganize the data to show each festival's impact ACROSS all products.
    
    Input is organized by product:
      Burgers → { Thanksgiving: 1.46×, ... }
      Fries   → { Thanksgiving: 1.44×, ... }
    
    Output is organized by festival:
      Thanksgiving → { avg: 1.43×, products: { Burgers: 1.46, Fries: 1.44, ... } }
    
    This view is useful for answering: "How big of a deal is Thanksgiving
    across the ENTIRE restaurant?" (vs. the by_product view which answers
    "How does Thanksgiving affect Burgers specifically?")
    """
    festival_map = {}  # { festival_type: { product: multiplier } }
    
    for product_name, festivals in by_product.items():
        for festival_type, info in festivals.items():
            if festival_type not in festival_map:
                festival_map[festival_type] = {}
            festival_map[festival_type][product_name] = info["multiplier"]
    
    result = {}
    for festival_type, product_mults in sorted(festival_map.items()):
        mults = list(product_mults.values())
        avg_mult = round(np.mean(mults), 3)
        
        result[festival_type] = {
            "avg_multiplier": avg_mult,
            "impact": _classify_impact(avg_mult),
            "products": product_mults,
            "product_count": len(product_mults),
        }
    
    return result


def _calculate_overall_stats(all_spikes):
    """
    Calculate summary statistics across ALL festivals and products.
    
    Finds the highest and lowest impact festival-product combos,
    and provides counts for the summary report.
    """
    if not all_spikes:
        return {"festivals_analyzed": 0}
    
    # Find highest and lowest impact
    sorted_spikes = sorted(all_spikes, key=lambda x: x["multiplier"], reverse=True)
    highest = sorted_spikes[0]
    lowest = sorted_spikes[-1]
    
    # Count unique festival types
    unique_festivals = set(s["festival"] for s in all_spikes)
    
    # Average multiplier across everything
    avg_overall = round(np.mean([s["multiplier"] for s in all_spikes]), 3)
    
    return {
        "festivals_analyzed": len(unique_festivals),
        "total_data_points": len(all_spikes),
        "avg_multiplier_overall": avg_overall,
        "highest_impact": {
            "festival": highest["festival"],
            "product": highest["product"],
            "multiplier": highest["multiplier"],
        },
        "lowest_impact": {
            "festival": lowest["festival"],
            "product": lowest["product"],
            "multiplier": lowest["multiplier"],
        },
    }


def get_festival_multiplier(spike_analysis, product_name, festival_name):
    """
    Look up the spike multiplier for a specific product + festival combo.
    
    This is the function that the forecaster calls when it encounters
    a festival day in the future forecast.
    
    PARAMETERS:
      spike_analysis: the full result dict from analyze_festival_spikes()
      product_name: e.g., "Burgers"
      festival_name: e.g., "Thanksgiving 2026" — will be normalized to "Thanksgiving"
    
    RETURNS: float multiplier (e.g., 1.46) or 1.0 if no data
    
    EXAMPLE:
      mult = get_festival_multiplier(spikes, "Burgers", "Thanksgiving 2026")
      # Returns 1.46 (based on historical Thanksgiving average)
      adjusted = base_forecast * mult
    """
    festival_type = _get_festival_type(festival_name)
    
    by_product = spike_analysis.get("by_product", {})
    product_data = by_product.get(product_name, {})
    festival_data = product_data.get(festival_type, {})
    
    # Return the product-specific multiplier if available
    if festival_data:
        return festival_data["multiplier"]
    
    # Fallback: check the by_festival view for an average across products
    by_festival = spike_analysis.get("by_festival", {})
    festival_avg = by_festival.get(festival_type, {})
    if festival_avg:
        return festival_avg["avg_multiplier"]
    
    # No data for this festival — return 1.0 (no adjustment)
    return 1.0


def get_all_multipliers_for_product(spike_analysis, product_name):
    """
    Get ALL festival multipliers for a specific product.
    
    Useful for building a quick reference table:
      Burgers: Thanksgiving=1.46, Super Bowl=1.52, Christmas=1.40, ...
    
    RETURNS: dict of { festival_type: multiplier }
    """
    by_product = spike_analysis.get("by_product", {})
    product_data = by_product.get(product_name, {})
    
    return {
        festival_type: info["multiplier"]
        for festival_type, info in product_data.items()
    }


def _print_summary(result):
    """Pretty-print the analysis results."""
    stats = result["overall_stats"]
    by_festival = result["by_festival"]
    
    print(f"\n{'═' * 60}")
    print(f"📊 FESTIVAL SPIKE ANALYSIS COMPLETE")
    print(f"{'═' * 60}")
    print(f"   Festivals analyzed: {stats['festivals_analyzed']}")
    print(f"   Data points: {stats['total_data_points']} (festival × product combos)")
    print(f"   Avg multiplier overall: {stats['avg_multiplier_overall']:.2f}×")
    print(f"\n   🏆 Highest impact: {stats['highest_impact']['festival']} on {stats['highest_impact']['product']} ({stats['highest_impact']['multiplier']:.2f}×)")
    print(f"   📉 Lowest impact:  {stats['lowest_impact']['festival']} on {stats['lowest_impact']['product']} ({stats['lowest_impact']['multiplier']:.2f}×)")
    
    print(f"\n   📋 Festival Rankings (avg across all products):")
    ranked = sorted(by_festival.items(), key=lambda x: x[1]["avg_multiplier"], reverse=True)
    for i, (name, info) in enumerate(ranked, 1):
        impact_emoji = {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "🟢"}[info["impact"]]
        print(f"      {i:2d}. {impact_emoji} {name:<20s} {info['avg_multiplier']:.2f}× ({info['impact']})")
    
    print(f"{'═' * 60}\n")
