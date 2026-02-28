"""
Test script for the Festival Spike Analyzer (Step 2.4).

This tests:
  1. Analyzing all historical festival spikes
  2. Looking up multipliers for specific product+festival combos
  3. Verifying the integration with the forecaster (spike-adjusted predictions)
  4. Checking that future festival days get multiplier-boosted forecasts
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from app.database import get_database
from app.services.data_preprocessor import preprocess_all
from app.services.festival_spike_analyzer import (
    analyze_festival_spikes,
    get_festival_multiplier,
    get_all_multipliers_for_product,
)
from app.services.demand_forecaster import (
    train_all_models,
    forecast_product,
    get_model_status,
)


def main():
    db = get_database()

    # ── Test 1: Run the spike analysis standalone ──
    print("=" * 60)
    print("TEST 1: Festival Spike Analysis (standalone)")
    print("=" * 60)
    product_data = preprocess_all(db)
    spikes = analyze_festival_spikes(product_data)

    # Show by_product detail for Burgers
    print("\n📦 Burgers — Festival Multipliers:")
    burgers = spikes["by_product"].get("Burgers", {})
    for festival, info in sorted(burgers.items(), key=lambda x: x[1]["multiplier"], reverse=True):
        print(f"   {festival:<20s} → {info['multiplier']:.2f}× ({info['impact']}) [{info['occurrences']} year(s)]")

    # ── Test 2: Look up specific multipliers ──
    print("\n" + "=" * 60)
    print("TEST 2: Multiplier Lookups")
    print("=" * 60)

    # These should return actual multipliers from the analysis
    thanksgiving_burgers = get_festival_multiplier(spikes, "Burgers", "Thanksgiving 2026")
    superbowl_fries = get_festival_multiplier(spikes, "Fries", "Super Bowl 2027")
    christmas_beverages = get_festival_multiplier(spikes, "Beverages", "Christmas 2025")
    unknown = get_festival_multiplier(spikes, "Burgers", "Random Event 2026")

    print(f"   Thanksgiving → Burgers:  {thanksgiving_burgers:.3f}×")
    print(f"   Super Bowl → Fries:      {superbowl_fries:.3f}×")
    print(f"   Christmas → Beverages:   {christmas_beverages:.3f}×")
    print(f"   Unknown Event → Burgers: {unknown:.3f}× (should be 1.0)")

    # ── Test 3: Get all multipliers for one product ──
    print("\n" + "=" * 60)
    print("TEST 3: All Multipliers for Beverages")
    print("=" * 60)
    bev_mults = get_all_multipliers_for_product(spikes, "Beverages")
    for festival, mult in sorted(bev_mults.items(), key=lambda x: x[1], reverse=True):
        print(f"   {festival:<20s} → {mult:.3f}×")

    # ── Test 4: Integration with forecaster ──
    print("\n" + "=" * 60)
    print("TEST 4: Forecaster with Spike Integration")
    print("=" * 60)
    print("   Training models (this also runs spike analysis)...")
    train_all_models(db)

    # Check model status includes spike analysis
    status = get_model_status()
    print(f"   Model status: {status['status']}")
    print(f"   Spike analysis: {status['festival_spike_analysis']}")

    # Run a 90-day forecast to hopefully catch some festivals
    result = forecast_product("Burgers", days=90)

    # Show any festival days in the forecast
    festival_days = [r for r in result["daily_forecast"] if r["is_festival"]]
    if festival_days:
        print(f"\n   🎆 Festival days in 90-day Burgers forecast:")
        for row in festival_days:
            mult_str = f" (spike: {row['spike_multiplier']:.2f}×)" if row["spike_multiplier"] else ""
            print(f"      {row['date']} {row['day_name']:<10} → {row['predicted_demand']:,} units | {row['festival_name']}{mult_str}")
    else:
        print(f"\n   ℹ️  No festival days in the next 90 days from today")

    # Show festival adjustments used
    if result.get("festival_adjustments"):
        print(f"\n   📊 Festival adjustments applied:")
        for name, mult in result["festival_adjustments"].items():
            print(f"      {name}: {mult:.3f}×")

    # ── Validation ──
    print("\n" + "=" * 60)
    print("VALIDATION")
    print("=" * 60)

    assert len(spikes["by_product"]) == 5, f"Expected 5 products, got {len(spikes['by_product'])}"
    print("   ✅ 5 products analyzed")

    assert len(spikes["by_festival"]) > 0, "Should have at least 1 festival type"
    print(f"   ✅ {len(spikes['by_festival'])} festival types found")

    assert all(info["multiplier"] > 0 for info in burgers.values()), "Multipliers should be positive"
    high_impact = [f for f, info in burgers.items() if info["multiplier"] >= 1.3]
    print(f"   ✅ All Burger multipliers are positive ({len(high_impact)} are HIGH impact ≥ 1.3×)")

    assert thanksgiving_burgers > 1.0, "Thanksgiving should have a positive spike"
    print(f"   ✅ Thanksgiving Burgers multiplier is {thanksgiving_burgers:.2f}× (> 1.0)")

    assert unknown == 1.0, "Unknown festival should return 1.0 (no adjustment)"
    print("   ✅ Unknown festival returns 1.0 (no data = no adjustment)")

    assert status["festival_spike_analysis"] == "loaded", "Spike cache should be loaded"
    print("   ✅ Spike analysis is loaded in model cache")

    assert "spike_multiplier" in result["daily_forecast"][0], "Forecast rows should include spike_multiplier"
    print("   ✅ Forecast rows include spike_multiplier field")

    print("\n🎉 ALL TESTS PASSED — Festival Spike Analyzer works!")


if __name__ == "__main__":
    main()
