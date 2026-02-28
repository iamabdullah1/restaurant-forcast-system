"""
🌐 Forecast & Profit API Router
═════════════════════════════════

These are the HTTP endpoints that the MCP Server calls.
They expose our ML services (Prophet forecasting, spike analysis,
profit projection) as a REST API.

THE REQUEST FLOW:
  1. User asks Claude: "How many Burgers will we sell next month?"
  2. Claude calls MCP tool: forecast_demand(product="Burgers", days=30)
  3. MCP Server (Node.js) makes HTTP request → GET /forecast/Burgers?days=30
  4. This FastAPI router receives the request
  5. Calls demand_forecaster.forecast_product("Burgers", 30)
  6. Prophet predicts → spike multipliers applied → profit calculated
  7. JSON response sent back → MCP Server → Claude → user

WHAT IS A ROUTER?
  In FastAPI, a "router" groups related endpoints together.
  Instead of putting all endpoints in main.py (messy), we organize:
    - forecast_router → /forecast/* endpoints
    - (future) inventory_router → /inventory/* endpoints
  Then register them in main.py with app.include_router()

WHAT IS A QUERY PARAMETER?
  In the URL: GET /forecast/Burgers?days=30
    - "Burgers" = PATH parameter (part of the URL path)
    - "days=30" = QUERY parameter (after the ? mark)
  
  FastAPI automatically extracts these from the URL and validates them.
"""

from fastapi import APIRouter, HTTPException, Query
from app.database import get_database
from app.services.demand_forecaster import (
    forecast_product,
    forecast_all_products,
    train_all_models,
    get_model_status,
)
from app.services.profit_projector import (
    project_profit_for_product,
    project_profit_all_products,
)

# ── Create the Router ──
# prefix="/forecast" means all routes here start with /forecast
# tags=["Forecasting"] groups them together in the /docs UI
forecast_router = APIRouter(prefix="/forecast", tags=["Forecasting"])
profit_router = APIRouter(prefix="/profit", tags=["Profit Projection"])
model_router = APIRouter(prefix="/model", tags=["Model Management"])


# ═══════════════════════════════════════════════════════════
# FORECAST ENDPOINTS
# ═══════════════════════════════════════════════════════════

@forecast_router.get(
    "/{product}",
    summary="Forecast demand for one product",
    description="Predict daily demand for a specific product using Prophet ML model. "
    "Returns daily predictions with confidence intervals, festival adjustments, and summary stats.",
)
async def get_product_forecast(
    product: str,
    days: int = Query(default=30, ge=1, le=90, description="Number of days to forecast (1-90)"),
):
    """
    GET /forecast/{product}?days=30

    Example: GET /forecast/Burgers?days=30
    Returns: 30 days of predicted Burger demand with confidence intervals

    The 'product' parameter comes from the URL path.
    The 'days' parameter is optional (default=30), validated to be 1-90.

    Query() is FastAPI's way to add validation + description to query params.
    ge=1 means "greater than or equal to 1", le=90 means "less than or equal to 90".
    """
    # Validate product name
    valid_products = ["Burgers", "Chicken Sandwiches", "Fries", "Beverages", "Sides & Other"]
    if product not in valid_products:
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"Unknown product: '{product}'",
                "valid_products": valid_products,
            },
        )

    try:
        db = get_database()
        result = forecast_product(product, days=days, db=db)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})


@forecast_router.get(
    "/",
    summary="Forecast demand for all products",
    description="Predict daily demand for all 5 products at once. "
    "Useful for daily briefings and inventory planning.",
)
async def get_all_forecasts(
    days: int = Query(default=30, ge=1, le=90, description="Number of days to forecast (1-90)"),
):
    """
    GET /forecast/?days=30

    Returns forecasts for all 5 products in one response.
    This is what the MCP tool calls when product="all".
    """
    try:
        db = get_database()
        results = forecast_all_products(days=days, db=db)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})


# ═══════════════════════════════════════════════════════════
# PROFIT PROJECTION ENDPOINTS
# ═══════════════════════════════════════════════════════════

@profit_router.get(
    "/{product}",
    summary="Profit projection for one product",
    description="Predict revenue, cost, and profit for a specific product. "
    "Combines Prophet demand forecasts with product pricing data.",
)
async def get_product_profit(
    product: str,
    days: int = Query(default=30, ge=1, le=90, description="Number of days to project (1-90)"),
):
    """
    GET /profit/{product}?days=30

    Example: GET /profit/Burgers?days=30
    Returns: 30 days of revenue, cost, and profit projections for Burgers

    Flow: forecast demand → multiply by pricing → return dollar projections
    """
    valid_products = ["Burgers", "Chicken Sandwiches", "Fries", "Beverages", "Sides & Other"]
    if product not in valid_products:
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"Unknown product: '{product}'",
                "valid_products": valid_products,
            },
        )

    try:
        db = get_database()
        forecast = forecast_product(product, days=days, db=db)
        projection = project_profit_for_product(forecast)
        return projection
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})


@profit_router.get(
    "/",
    summary="Profit projection for all products combined",
    description="Restaurant-wide profit projection with per-product breakdown, "
    "product ranking by profit contribution, and blended margin.",
)
async def get_all_profit(
    days: int = Query(default=30, ge=1, le=90, description="Number of days to project (1-90)"),
):
    """
    GET /profit/?days=30

    Returns combined profit projections for all products:
    - Per-product breakdown
    - Daily combined totals
    - Product profit ranking
    - Blended margin
    """
    try:
        db = get_database()
        all_forecasts = forecast_all_products(days=days, db=db)
        projection = project_profit_all_products(all_forecasts)
        return projection
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})


# ═══════════════════════════════════════════════════════════
# MODEL MANAGEMENT ENDPOINTS
# ═══════════════════════════════════════════════════════════

@model_router.get(
    "/status",
    summary="Check ML model status",
    description="Returns whether models are trained, accuracy metrics, and last training time.",
)
async def model_status():
    """
    GET /model/status

    Returns model status for each product:
    - Whether trained or not
    - MAE and MAPE accuracy metrics
    - Last training timestamp
    - Festival spike analysis status
    """
    return get_model_status()


@model_router.post(
    "/train",
    summary="Retrain all ML models",
    description="Force retrain all Prophet models from current MongoDB data. "
    "Use this after importing new sales data.",
)
async def retrain_models():
    """
    POST /model/train

    Forces a full retrain of all 5 Prophet models.
    This also re-runs the festival spike analysis.

    Use when:
    - New sales data has been imported
    - You want to refresh the models with the latest data
    """
    try:
        db = get_database()
        metrics = train_all_models(db)
        status = get_model_status()
        return {
            "message": "All models retrained successfully",
            "training_metrics": metrics,
            "model_status": status,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})
