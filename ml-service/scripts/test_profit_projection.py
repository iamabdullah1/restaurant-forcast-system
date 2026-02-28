"""
Test script for the Profit Projection Engine (Step 2.5).

This tests:
  1. Single product profit projection (Burgers, 30 days)
  2. All products combined profit projection
  3. Verifying the math: revenue = units × price, profit = units × profit_per_unit
  4. Product ranking by profit contribution
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from app.database import get_database
from app.services.demand_forecaster import train_all_models, forecast_product, forecast_all_products
from app.services.profit_projector import project_profit_for_product, project_profit_all_products


def main():
    db = get_database()

    # Train models first (includes spike analysis)
    print("🤖 Training models...\n")
    train_all_models(db)

    # ══════════════════════════════════════════════
    # TEST 1: Single Product Projection (Burgers)
    # ══════════════════════════════════════════════
    print("=" * 60)
    print("TEST 1: Profit Projection — Burgers (30 days)")
    print("=" * 60)

    burger_forecast = forecast_product("Burgers", days=30)
    burger_profit = project_profit_for_product(burger_forecast)

    t = burger_profit["totals"]
    p = burger_profit["pricing"]

    print(f"\n   💲 Pricing: Sell ${p['sell_price']} | Cost ${p['cost_price']} | Profit ${p['profit_per_unit']}/unit ({p['margin_percent']}% margin)")
    print(f"\n   📊 30-Day Totals:")
    print(f"      Units:   {t['total_units']:>12,}")
    print(f"      Revenue: ${t['total_revenue']:>12,.2f}")
    print(f"      Cost:    ${t['total_cost']:>12,.2f}")
    print(f"      Profit:  ${t['total_profit']:>12,.2f}")
    print(f"      Profit range: ${t['total_profit_lower']:,.2f} → ${t['total_profit_upper']:,.2f}")
    print(f"\n   📅 Daily Averages:")
    print(f"      Revenue: ${t['avg_daily_revenue']:>10,.2f}/day")
    print(f"      Profit:  ${t['avg_daily_profit']:>10,.2f}/day")
    print(f"\n   🏆 Best day:  {t['best_day']['date']} ({t['best_day']['day_name']}) → ${t['best_day']['profit']:,.2f}")
    print(f"   📉 Worst day: {t['worst_day']['date']} ({t['worst_day']['day_name']}) → ${t['worst_day']['profit']:,.2f}")

    # Show first 5 days
    print(f"\n   📅 First 5 Days:")
    print(f"   {'Date':<12} {'Day':<10} {'Units':>7} {'Revenue':>10} {'Cost':>9} {'Profit':>10}")
    print(f"   {'─'*12} {'─'*10} {'─'*7} {'─'*10} {'─'*9} {'─'*10}")
    for day in burger_profit["daily_projections"][:5]:
        print(f"   {day['date']:<12} {day['day_name']:<10} {day['predicted_demand']:>7,} ${day['revenue']:>9,.2f} ${day['cost']:>8,.2f} ${day['profit']:>9,.2f}")

    # ══════════════════════════════════════════════
    # TEST 2: All Products Combined
    # ══════════════════════════════════════════════
    print(f"\n{'=' * 60}")
    print("TEST 2: Combined Profit Projection — All Products (30 days)")
    print("=" * 60)

    all_forecasts = forecast_all_products(days=30)
    all_profit = project_profit_all_products(all_forecasts)
    c = all_profit["combined"]

    print(f"\n   🏪 RESTAURANT-WIDE 30-DAY PROJECTION:")
    print(f"      Total Units:   {c['grand_total_units']:>12,}")
    print(f"      Total Revenue: ${c['grand_total_revenue']:>12,.2f}")
    print(f"      Total Cost:    ${c['grand_total_cost']:>12,.2f}")
    print(f"      Total Profit:  ${c['grand_total_profit']:>12,.2f}")
    print(f"      Blended Margin: {c['blended_margin_percent']}%")
    print(f"\n   📅 Daily Averages:")
    print(f"      Revenue: ${c['avg_daily_revenue']:>10,.2f}/day")
    print(f"      Profit:  ${c['avg_daily_profit']:>10,.2f}/day")
    print(f"\n   🏆 Best day:  {c['best_day']['date']} ({c['best_day']['day_name']}) → ${c['best_day']['total_profit']:,.2f}")
    print(f"   📉 Worst day: {c['worst_day']['date']} ({c['worst_day']['day_name']}) → ${c['worst_day']['total_profit']:,.2f}")

    # Product ranking
    print(f"\n   📋 Product Profit Ranking:")
    print(f"   {'#':>3} {'Product':<22} {'Profit':>12} {'Share':>7} {'Margin':>8} {'$/Day':>10}")
    print(f"   {'─'*3} {'─'*22} {'─'*12} {'─'*7} {'─'*8} {'─'*10}")
    for i, prod in enumerate(c["product_ranking"], 1):
        print(f"   {i:>3} {prod['product']:<22} ${prod['total_profit']:>11,.2f} {prod['profit_share']:>5.1f}% {prod['margin_percent']:>6}% ${prod['avg_daily_profit']:>9,.2f}")

    # Show best 3 combined days
    print(f"\n   📅 Top 3 Profit Days (all products combined):")
    top_days = sorted(c["daily_combined"], key=lambda x: x["total_profit"], reverse=True)[:3]
    for day in top_days:
        festival_str = f" 🎆 {day['festival_name']}" if day["festival_name"] else ""
        weekend_str = " 🏖️" if day["is_weekend"] else ""
        print(f"      {day['date']} ({day['day_name']}) → ${day['total_profit']:,.2f}{weekend_str}{festival_str}")

    # ══════════════════════════════════════════════
    # VALIDATION
    # ══════════════════════════════════════════════
    print(f"\n{'=' * 60}")
    print("VALIDATION")
    print("=" * 60)

    # Math check: revenue = units × price
    day1 = burger_profit["daily_projections"][0]
    expected_revenue = round(day1["predicted_demand"] * 12.99, 2)
    assert day1["revenue"] == expected_revenue, f"Revenue mismatch: {day1['revenue']} vs {expected_revenue}"
    print(f"   ✅ Revenue math correct: {day1['predicted_demand']} × $12.99 = ${expected_revenue}")

    # Math check: cost = units × cost_price
    expected_cost = round(day1["predicted_demand"] * 5.50, 2)
    assert day1["cost"] == expected_cost, f"Cost mismatch: {day1['cost']} vs {expected_cost}"
    print(f"   ✅ Cost math correct: {day1['predicted_demand']} × $5.50 = ${expected_cost}")

    # Math check: profit = units × profit_per_unit
    expected_profit = round(day1["predicted_demand"] * 7.49, 2)
    assert day1["profit"] == expected_profit, f"Profit mismatch: {day1['profit']} vs {expected_profit}"
    print(f"   ✅ Profit math correct: {day1['predicted_demand']} × $7.49 = ${expected_profit}")

    # All projections have 30 rows
    assert len(burger_profit["daily_projections"]) == 30
    print("   ✅ 30 daily projection rows")

    # Combined has 5 products
    assert len(all_profit["by_product"]) == 5
    print("   ✅ 5 products in combined projection")

    # Profit shares sum to ~100%
    total_share = sum(p["profit_share"] for p in c["product_ranking"])
    assert 99.5 <= total_share <= 100.5, f"Shares sum to {total_share}%"
    print(f"   ✅ Profit shares sum to {total_share}%")

    # Grand totals are positive
    assert c["grand_total_profit"] > 0
    print(f"   ✅ Grand total profit is positive (${c['grand_total_profit']:,.2f})")

    # Blended margin is reasonable (should be between 50% and 90%)
    assert 50 <= c["blended_margin_percent"] <= 90, f"Blended margin {c['blended_margin_percent']}% seems off"
    print(f"   ✅ Blended margin is reasonable ({c['blended_margin_percent']}%)")

    print(f"\n🎉 ALL TESTS PASSED — Profit Projection Engine works!")


if __name__ == "__main__":
    main()
