"""
🚀 ML Service — FastAPI Entry Point
════════════════════════════════════

This is the main entry point for the Python ML (Machine Learning) service.
When you run `uvicorn app.main:app`, Python executes THIS file.

WHAT THIS SERVICE DOES:
  It's a REST API that provides ML-powered predictions:
    - /forecast/{product}    → Predict future demand using Facebook Prophet
    - /profit-projection     → Forecasted profit based on predicted demand
    - /health                → Health check (is the server running?)

HOW IT CONNECTS TO THE SYSTEM:
  MCP Server (Node.js) → HTTP request → This FastAPI service → Prophet ML model → prediction
  
  The MCP Server's forecast_demand tool (forecast.js) will call this service
  instead of using the moving-average stub. This gives us REAL ML predictions.

WHY FASTAPI?
  - It's the fastest Python web framework (async support)
  - Auto-generates API docs at /docs (Swagger UI)
  - Built-in request validation with Pydantic (like Zod for Python)
  - Perfect for ML APIs because data scientists already use Python
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import os

# Load .env from project root (one level up from ml-service/)
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from app.database import get_database
from app.services.demand_forecaster import train_all_models, get_model_status
from app.routers.forecast_router import forecast_router, profit_router, model_router


# ── Lifespan Event ───────────────────────────────────────
# This runs ONCE when the server starts and ONCE when it shuts down.
# We use it to train ML models at startup so the first request is fast.
#
# WHAT IS asynccontextmanager?
#   It's a Python pattern for "do something at start, do something at end."
#   The code BEFORE `yield` runs at startup, AFTER `yield` runs at shutdown.
@asynccontextmanager
async def lifespan(app):
    # ── STARTUP ──
    print("\n🚀 ML Service starting up...")
    try:
        db = get_database()
        print("🤖 Training ML models on startup (this takes ~3 seconds)...")
        train_all_models(db)
        print("✅ Models ready! Server is accepting requests.\n")
    except Exception as e:
        print(f"⚠️  Model training failed at startup: {e}")
        print("   Models will train on first request instead.\n")
    yield
    # ── SHUTDOWN ──
    print("\n👋 ML Service shutting down...")


# ── Create the FastAPI app ───────────────────────────────
app = FastAPI(
    title="Restaurant Forecast ML Service",
    description="ML-powered demand forecasting, profit projections, and inventory insights",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS Middleware ──────────────────────────────────────
# CORS = Cross-Origin Resource Sharing
# By default, browsers block requests from one domain to another.
# Our Next.js frontend (localhost:3000) needs to call this API (localhost:8000).
# This middleware says "allow requests from these origins."
# "*" means "allow ALL origins" — fine for development, restrict in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health Check Endpoint ────────────────────────────────
# Enhanced with model status
@app.get("/health")
async def health_check():
    model_info = get_model_status()
    return {
        "status": "healthy",
        "service": "restaurant-forecast-ml",
        "version": "1.0.0",
        "models": model_info["status"],
        "model_count": model_info.get("model_count", 0),
    }


# ── Root Endpoint ────────────────────────────────────────
@app.get("/")
async def root():
    return {
        "message": "🍔 Restaurant Forecast ML Service",
        "docs": "/docs",
        "endpoints": [
            "GET  /health",
            "GET  /forecast/{product}?days=30",
            "GET  /forecast/?days=30",
            "GET  /profit/{product}?days=30",
            "GET  /profit/?days=30",
            "GET  /model/status",
            "POST /model/train",
        ],
    }


# ── Register Routers ────────────────────────────────────
# Each router adds its endpoints to the app.
# forecast_router → /forecast/*
# profit_router → /profit/*
# model_router → /model/*
app.include_router(forecast_router)
app.include_router(profit_router)
app.include_router(model_router)
