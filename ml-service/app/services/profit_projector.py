"""
💰 Profit Projection Engine
════════════════════════════

This file answers the restaurant manager's #1 question:
"How much MONEY will we make in the next 30 days?"

WHAT THIS FILE DOES:
  Takes the demand forecast (from Step 2.3) and multiplies it by
  financial data (from products.json) to project:
    - Revenue  = predicted_units × sell_price
    - Cost     = predicted_units × cost_price (COGS)
    - Profit   = Revenue - Cost

  It does this for EVERY product, EVERY day in the forecast period.

WHAT IS COGS?
  COGS = "Cost of Goods Sold" — the direct cost to make/buy the product.
  For Burgers: ingredients, buns, patties, packaging = $5.50 per unit.
  This does NOT include rent, salaries, electricity (those are "overhead").
  COGS is the minimum cost — if you sell a Burger for $12.99 and COGS
  is $5.50, your GROSS profit is $7.49 per Burger (57% margin).

WHAT IS PROFIT MARGIN?
  Margin = (Sell Price - Cost Price) / Sell Price × 100
  Burgers: (12.99 - 5.50) / 12.99 = 57.7% → for every $1 of Burger revenue,
  you keep $0.58 as gross profit.

  Different products have VERY different margins:
    Beverages: 83% margin (cheapest to make — just syrup + water)
    Fries: 77% margin (potatoes are cheap)
    Burgers: 57% margin (meat is expensive)

  This is why a restaurant might WANT to sell more Beverages even though
  Burgers have a higher price — the PROFIT per dollar is higher on drinks.

WHY IS THIS A SEPARATE MODULE?
  The demand forecaster (Step 2.3) only predicts QUANTITIES — "550 Burgers."
  It doesn't know anything about prices. The profit engine COMBINES:
    1. Quantity predictions (from Prophet)
    2. Financial data (from products.json)
  Into dollar projections. This separation of concerns means:
    - If prices change, you only update products.json (not the ML model)
    - If demand patterns change, only the forecaster retrains
    - Each module has ONE job and does it well

PRODUCT PRICING DATA (from products.json):
  ┌─────────────────────┬───────────┬───────────┬──────────┬─────────┐
  │ Product             │ Sell ($)  │ Cost ($)  │ Profit $ │ Margin  │
  ├─────────────────────┼───────────┼───────────┼──────────┼─────────┤
  │ Burgers             │   12.99   │    5.50   │   7.49   │   57%   │
  │ Chicken Sandwiches  │    9.95   │    4.00   │   5.95   │   60%   │
  │ Fries               │    3.49   │    0.80   │   2.69   │   77%   │
  │ Beverages           │    2.95   │    0.50   │   2.45   │   83%   │
  │ Sides & Other       │    4.99   │    1.50   │   3.49   │   70%   │
  └─────────────────────┴───────────┴───────────┴──────────┴─────────┘
"""

import json
import os
import numpy as np


# ── Load Product Pricing Data ──
# We read this from products.json (the single source of truth for all pricing).
# This is loaded ONCE when the module is imported, not on every request.
_PRODUCTS_JSON_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..",
    "mcp-server", "src", "config", "products.json"
)

_product_pricing = None  # lazy-loaded cache


def _load_product_pricing():
    """
    Load product pricing from products.json.

    WHY LAZY LOADING?
      We don't load at import time because the file path might not exist yet
      during testing. Instead, we load on first use and cache the result.

    WHAT WE EXTRACT:
      From each product in products.json, we need:
        - sellPrice: what the customer pays (e.g., $12.99)
        - costPrice: what it costs us to make (e.g., $5.50)
        - profitPerUnit: sellPrice - costPrice (e.g., $7.49)
        - marginPercent: profit as % of sell price (e.g., 57%)

    RETURNS: dict of { product_name: { sellPrice, costPrice, profitPerUnit, marginPercent } }
    """
    global _product_pricing

    if _product_pricing is not None:
        return _product_pricing

    if not os.path.exists(_PRODUCTS_JSON_PATH):
        raise FileNotFoundError(
            f"products.json not found at {_PRODUCTS_JSON_PATH}. "
            "Make sure the mcp-server/src/config/products.json file exists."
        )

    with open(_PRODUCTS_JSON_PATH, "r") as f:
        data = json.load(f)

    _product_pricing = {}
    for name, info in data["products"].items():
        _product_pricing[name] = {
            "sell_price": info["sellPrice"],
            "cost_price": info["costPrice"],
            "profit_per_unit": info["profitPerUnit"],
            "margin_percent": info["marginPercent"],
            "category": info["category"],
        }

    return _product_pricing


def project_profit_for_product(forecast_result):
    """
    Calculate profit projections for ONE product's forecast.

    Takes the output of forecast_product() from Step 2.3 and adds
    financial data to every day.

    INPUT (from demand_forecaster.forecast_product()):
      {
        "summary": { "product": "Burgers", ... },
        "daily_forecast": [
          { "date": "2026-03-01", "predicted_demand": 700, ... },
          { "date": "2026-03-02", "predicted_demand": 518, ... },
          ...
        ]
      }

    OUTPUT (what we return):
      {
        "product": "Burgers",
        "pricing": { "sell_price": 12.99, "cost_price": 5.50, ... },
        "daily_projections": [
          {
            "date": "2026-03-01",
            "predicted_demand": 700,
            "revenue": 9093.00,    ← 700 × $12.99
            "cost": 3850.00,       ← 700 × $5.50
            "profit": 5243.00,     ← 700 × $7.49
            ...
          },
          ...
        ],
        "totals": {
          "total_units": 19994,
          "total_revenue": 259722.06,
          "total_cost": 109967.00,
          "total_profit": 149755.06,
          "avg_daily_profit": 4991.84,
          ...
        }
      }

    THE CORE MATH (per day):
      revenue = predicted_demand × sell_price
      cost    = predicted_demand × cost_price
      profit  = predicted_demand × profit_per_unit
               (which equals revenue - cost)

    WHY profit_per_unit INSTEAD OF revenue - cost?
      They give the SAME result, but using profit_per_unit is slightly
      more efficient (one multiplication vs. two + a subtraction).
      Also avoids floating point rounding differences.
    """
    pricing = _load_product_pricing()
    product_name = forecast_result["summary"]["product"]

    if product_name not in pricing:
        raise ValueError(
            f"Product '{product_name}' not found in products.json. "
            f"Available: {list(pricing.keys())}"
        )

    product_price = pricing[product_name]
    sell_price = product_price["sell_price"]
    cost_price = product_price["cost_price"]
    profit_per_unit = product_price["profit_per_unit"]

    # ── Calculate daily projections ──
    daily_projections = []

    for day in forecast_result["daily_forecast"]:
        demand = day["predicted_demand"]
        lower = day["lower_bound"]
        upper = day["upper_bound"]

        daily_projections.append({
            # Keep all original forecast fields
            "date": day["date"],
            "day_name": day["day_name"],
            "predicted_demand": demand,
            "lower_bound": lower,
            "upper_bound": upper,
            "is_weekend": day["is_weekend"],
            "is_festival": day["is_festival"],
            "festival_name": day["festival_name"],
            "spike_multiplier": day.get("spike_multiplier"),

            # NEW: Financial projections
            "revenue": round(demand * sell_price, 2),
            "cost": round(demand * cost_price, 2),
            "profit": round(demand * profit_per_unit, 2),

            # Confidence interval for profit (worst case → best case)
            "profit_lower": round(lower * profit_per_unit, 2),
            "profit_upper": round(upper * profit_per_unit, 2),
        })

    # ── Calculate totals and summary ──
    total_units = sum(d["predicted_demand"] for d in daily_projections)
    total_revenue = sum(d["revenue"] for d in daily_projections)
    total_cost = sum(d["cost"] for d in daily_projections)
    total_profit = sum(d["profit"] for d in daily_projections)
    total_profit_lower = sum(d["profit_lower"] for d in daily_projections)
    total_profit_upper = sum(d["profit_upper"] for d in daily_projections)

    days = len(daily_projections)

    # Find best and worst profit days
    profits = [d["profit"] for d in daily_projections]
    best_day_idx = np.argmax(profits)
    worst_day_idx = np.argmin(profits)

    totals = {
        "forecast_days": days,
        "total_units": total_units,
        "total_revenue": round(total_revenue, 2),
        "total_cost": round(total_cost, 2),
        "total_profit": round(total_profit, 2),
        "total_profit_lower": round(total_profit_lower, 2),
        "total_profit_upper": round(total_profit_upper, 2),
        "avg_daily_revenue": round(total_revenue / days, 2),
        "avg_daily_cost": round(total_cost / days, 2),
        "avg_daily_profit": round(total_profit / days, 2),
        "margin_percent": product_price["margin_percent"],
        "best_day": {
            "date": daily_projections[best_day_idx]["date"],
            "day_name": daily_projections[best_day_idx]["day_name"],
            "profit": daily_projections[best_day_idx]["profit"],
            "demand": daily_projections[best_day_idx]["predicted_demand"],
            "festival": daily_projections[best_day_idx]["festival_name"] or None,
        },
        "worst_day": {
            "date": daily_projections[worst_day_idx]["date"],
            "day_name": daily_projections[worst_day_idx]["day_name"],
            "profit": daily_projections[worst_day_idx]["profit"],
            "demand": daily_projections[worst_day_idx]["predicted_demand"],
        },
    }

    return {
        "product": product_name,
        "pricing": product_price,
        "daily_projections": daily_projections,
        "totals": totals,
    }


def project_profit_all_products(all_forecasts):
    """
    Calculate profit projections for ALL products and produce a combined report.

    Takes the output of forecast_all_products() from Step 2.3.

    INPUT: dict of { product_name: forecast_result }
    OUTPUT: {
      "by_product": { product: projection_result },
      "combined": {
        "total_revenue": ...,
        "total_profit": ...,
        "by_product_summary": [ ... sorted by profit contribution ... ],
        "daily_combined": [ { date, total_revenue, total_profit, ... } ],
      }
    }

    THE BIG PICTURE VIEW:
    Instead of "Burgers will profit $4,991/day," the manager wants to know:
    "The WHOLE restaurant will profit $X/day across ALL products."
    This function aggregates individual product projections into ONE view.
    """
    pricing = _load_product_pricing()

    # ── Project each product ──
    by_product = {}
    for product_name, forecast_result in sorted(all_forecasts.items()):
        by_product[product_name] = project_profit_for_product(forecast_result)

    # ── Combine into daily totals across all products ──
    # Build a dict of { date: { total_revenue, total_cost, total_profit } }
    daily_combined_map = {}

    for product_name, projection in by_product.items():
        for day in projection["daily_projections"]:
            date = day["date"]
            if date not in daily_combined_map:
                daily_combined_map[date] = {
                    "date": date,
                    "day_name": day["day_name"],
                    "is_weekend": day["is_weekend"],
                    "is_festival": day["is_festival"],
                    "festival_name": day["festival_name"],
                    "total_revenue": 0,
                    "total_cost": 0,
                    "total_profit": 0,
                    "total_units": 0,
                    "by_product": {},
                }
            daily_combined_map[date]["total_revenue"] += day["revenue"]
            daily_combined_map[date]["total_cost"] += day["cost"]
            daily_combined_map[date]["total_profit"] += day["profit"]
            daily_combined_map[date]["total_units"] += day["predicted_demand"]
            daily_combined_map[date]["by_product"][product_name] = {
                "units": day["predicted_demand"],
                "revenue": day["revenue"],
                "profit": day["profit"],
            }

    # Sort by date and round
    daily_combined = []
    for date in sorted(daily_combined_map.keys()):
        day = daily_combined_map[date]
        day["total_revenue"] = round(day["total_revenue"], 2)
        day["total_cost"] = round(day["total_cost"], 2)
        day["total_profit"] = round(day["total_profit"], 2)
        daily_combined.append(day)

    # ── Grand totals ──
    grand_revenue = sum(d["total_revenue"] for d in daily_combined)
    grand_cost = sum(d["total_cost"] for d in daily_combined)
    grand_profit = sum(d["total_profit"] for d in daily_combined)
    grand_units = sum(d["total_units"] for d in daily_combined)
    days = len(daily_combined)

    # ── Product contribution ranking ──
    # Which product contributes the most profit?
    # This helps the manager know where the money really comes from.
    product_contributions = []
    for product_name, projection in by_product.items():
        t = projection["totals"]
        product_contributions.append({
            "product": product_name,
            "total_profit": t["total_profit"],
            "total_revenue": t["total_revenue"],
            "total_units": t["total_units"],
            "margin_percent": t["margin_percent"],
            "profit_share": round((t["total_profit"] / grand_profit * 100) if grand_profit > 0 else 0, 1),
            "avg_daily_profit": t["avg_daily_profit"],
        })

    # Sort by profit contribution (highest first)
    product_contributions.sort(key=lambda x: x["total_profit"], reverse=True)

    # Find best and worst days overall
    daily_profits = [d["total_profit"] for d in daily_combined]
    best_idx = np.argmax(daily_profits)
    worst_idx = np.argmin(daily_profits)

    # ── Overall blended margin ──
    # This is the WEIGHTED average margin across all products,
    # weighted by their revenue contribution.
    # It tells you: "for every $1 of total revenue, how much is profit?"
    blended_margin = round((grand_profit / grand_revenue * 100) if grand_revenue > 0 else 0, 1)

    combined = {
        "forecast_days": days,
        "grand_total_units": grand_units,
        "grand_total_revenue": round(grand_revenue, 2),
        "grand_total_cost": round(grand_cost, 2),
        "grand_total_profit": round(grand_profit, 2),
        "avg_daily_revenue": round(grand_revenue / days, 2) if days > 0 else 0,
        "avg_daily_profit": round(grand_profit / days, 2) if days > 0 else 0,
        "blended_margin_percent": blended_margin,
        "best_day": {
            "date": daily_combined[best_idx]["date"],
            "day_name": daily_combined[best_idx]["day_name"],
            "total_profit": daily_combined[best_idx]["total_profit"],
            "festival": daily_combined[best_idx]["festival_name"] or None,
        },
        "worst_day": {
            "date": daily_combined[worst_idx]["date"],
            "day_name": daily_combined[worst_idx]["day_name"],
            "total_profit": daily_combined[worst_idx]["total_profit"],
        },
        "product_ranking": product_contributions,
        "daily_combined": daily_combined,
    }

    return {
        "by_product": {name: proj for name, proj in by_product.items()},
        "combined": combined,
    }
