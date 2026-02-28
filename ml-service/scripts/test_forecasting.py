"""
Test script for the Demand Forecasting Model (Step 2.3).

This tests:
  1. Training all 5 Prophet models
  2. Generating a 30-day forecast for one product
  3. Generating forecasts for all products
  4. Checking model status
  5. Verifying forecast output structure
"""

import sys
import os

# Add parent dir to path so we can import app modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from app.database import get_database
from app.services.demand_forecaster import (
    train_all_models,
    forecast_product,
    forecast_all_products,
    get_model_status,
)


def main():
    db = get_database()

    # ── Test 1: Train all models ──
    print("=" * 60)
    print("TEST 1: Training all Prophet models")
    print("=" * 60)
    metrics = train_all_models(db)

    print("\n📊 Training Metrics Summary:")
    for product, m in metrics.items():
        print(f"   {product:25s} | MAE: {m['mae']:>8.1f} | MAPE: {m['mape']:>5.1f}% | Rows: {m['training_rows']} | Time: {m['training_time_sec']}s")

    # ── Test 2: Forecast one product (30 days) ──
    print("\n" + "=" * 60)
    print("TEST 2: 30-day forecast for Burgers")
    print("=" * 60)
    result = forecast_product("Burgers", days=30)

    summary = result["summary"]
    print(f"\n📈 Forecast Summary:")
    print(f"   Product: {summary['product']}")
    print(f"   Period: {summary['start_date']} → {summary['end_date']}")
    print(f"   Total predicted: {summary['total_predicted']:,} units")
    print(f"   Avg daily: {summary['avg_daily_demand']:.0f} units")
    print(f"   Min/Max: {summary['min_daily_demand']} / {summary['max_daily_demand']}")
    print(f"   Peak day: {summary['peak_day']} ({summary['peak_day_name']})")
    print(f"   Weekend avg: {summary['weekend_avg']:.0f} | Weekday avg: {summary['weekday_avg']:.0f}")
    print(f"   Festival days: {summary['festival_days_count']}")

    # Show first 7 days
    print(f"\n📅 First 7 Days:")
    print(f"   {'Date':<12} {'Day':<10} {'Predicted':>9} {'Lower':>7} {'Upper':>7} {'Festival'}")
    print(f"   {'─'*12} {'─'*10} {'─'*9} {'─'*7} {'─'*7} {'─'*15}")
    for row in result["daily_forecast"][:7]:
        festival = f" 🎉 {row['festival_name']}" if row["festival_name"] else ""
        weekend = " 🏖️" if row["is_weekend"] else ""
        print(f"   {row['date']:<12} {row['day_name']:<10} {row['predicted_demand']:>9,} {row['lower_bound']:>7,} {row['upper_bound']:>7,}{weekend}{festival}")

    # ── Test 3: Model status ──
    print("\n" + "=" * 60)
    print("TEST 3: Model Status Check")
    print("=" * 60)
    status = get_model_status()
    print(f"   Status: {status['status']}")
    print(f"   Models: {status['model_count']}")

    # ── Test 4: Forecast all products (7 days, quick check) ──
    print("\n" + "=" * 60)
    print("TEST 4: 7-day forecast for ALL products")
    print("=" * 60)
    all_results = forecast_all_products(days=7)

    print(f"\n{'Product':<25} {'Total 7d':>10} {'Avg/Day':>10} {'Peak':>10}")
    print(f"{'─'*25} {'─'*10} {'─'*10} {'─'*10}")
    for product, res in all_results.items():
        s = res["summary"]
        print(f"{product:<25} {s['total_predicted']:>10,} {s['avg_daily_demand']:>10.0f} {s['max_daily_demand']:>10,}")

    # ── Validation ──
    print("\n" + "=" * 60)
    print("VALIDATION")
    print("=" * 60)

    assert len(metrics) == 5, f"Expected 5 products, got {len(metrics)}"
    print("   ✅ 5 products trained")

    assert all(m["mae"] > 0 for m in metrics.values()), "MAE should be positive"
    print("   ✅ All MAE values are positive")

    assert len(result["daily_forecast"]) == 30, f"Expected 30 days, got {len(result['daily_forecast'])}"
    print("   ✅ 30-day forecast has 30 rows")

    assert all(row["predicted_demand"] >= 0 for row in result["daily_forecast"]), "Demands should be non-negative"
    print("   ✅ All predictions are non-negative")

    assert result["summary"]["total_predicted"] > 0, "Total should be positive"
    print("   ✅ Total predicted is positive")

    assert status["status"] == "trained", "Status should be 'trained'"
    print("   ✅ Model status is 'trained'")

    assert len(all_results) == 5, f"Expected 5 products, got {len(all_results)}"
    print("   ✅ All 5 products forecasted")

    print("\n🎉 ALL TESTS PASSED — Demand Forecasting Model works!")


if __name__ == "__main__":
    main()
