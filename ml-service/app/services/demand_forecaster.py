"""
🔮 Demand Forecasting Model — Facebook Prophet
════════════════════════════════════════════════

This file is the BRAIN of the entire system.
It uses Facebook Prophet to predict how many units of each product
the restaurant will sell in the future (next 30, 60, or 90 days).

WHAT IS FACEBOOK PROPHET?
  Prophet is a time-series forecasting library made by Facebook (Meta).
  It's designed for business data that has:
    ✅ Daily observations (like our daily sales data)
    ✅ Weekly patterns (weekends sell more)
    ✅ Yearly patterns (summer vs winter)
    ✅ Holiday/event effects (Christmas, Super Bowl, etc.)
    ✅ Missing data and outliers (common in real business data)

  Prophet decomposes a time series into 3 components:
    y(t) = trend(t) + seasonality(t) + holidays(t) + error(t)

    1. TREND       — The overall direction (are sales going up or down over months?)
    2. SEASONALITY — Repeating patterns (weekly: high on weekends, yearly: high in summer)
    3. HOLIDAYS    — Sudden spikes/dips on specific dates (Thanksgiving, Christmas)
    4. ERROR       — Random noise that can't be predicted

HOW PROPHET TRAINS (simplified):
  1. You give it a DataFrame with columns: 'ds' (date) and 'y' (value)
  2. It fits a curve through the data, learning:
     - "Sales grow ~2% per month" (trend)
     - "Saturday sells 40% more than Wednesday" (weekly seasonality)
     - "July sells 15% more than January" (yearly seasonality)
     - "Thanksgiving day sells 80% more" (holiday effect)
  3. It extends this curve into the future for N days = your forecast

WHY SEPARATE MODELS PER PRODUCT?
  Burgers and Beverages have COMPLETELY different patterns:
    - Burgers: ~558/day baseline, 80% spike on Thanksgiving
    - Beverages: ~700/day baseline, 50% spike on July 4th
    - Fries: follows Burgers (people buy combos)

  One model can't learn all these different patterns simultaneously.
  So we train 5 independent models — one per product.

WHAT ARE REGRESSORS?
  Regressors are extra features we add to help Prophet beyond just dates.
  Prophet already knows about weekly/yearly patterns from dates alone.
  But it DOESN'T know:
    - is_weekend (1/0) — explicitly tells it weekends are different
    - is_festival (1/0) — tells it festival days have demand spikes

  We add these using model.add_regressor('is_weekend') BEFORE fitting.
  Then Prophet learns: "when is_festival=1, demand is 1.6× higher"

MODEL CACHING:
  Training Prophet takes 3-10 seconds per product (15-50 sec total).
  We DON'T want to retrain every time someone asks for a forecast.
  So we train ONCE at startup (or on first request) and cache the models
  in memory. The cache stays valid until you restart the server.
"""

import pandas as pd
import numpy as np
from prophet import Prophet
from datetime import datetime, timedelta
import logging
import time

from app.services.data_preprocessor import preprocess_all, FESTIVAL_DATES
from app.services.festival_spike_analyzer import analyze_festival_spikes, get_festival_multiplier

# Suppress Prophet's verbose fitting logs (it prints a LOT of internal stats)
# We only want our own clean output, not Prophet's internal optimization messages
logging.getLogger("prophet").setLevel(logging.WARNING)
logging.getLogger("cmdstanpy").setLevel(logging.WARNING)


# ── Model Cache ──
# Stores trained Prophet models so we don't retrain on every request.
# Key = product name (e.g., "Burgers"), Value = { model, last_trained, metrics }
_model_cache = {}

# Also cache the preprocessed data so we can reuse it
_data_cache = {}

# Cache for festival spike analysis results (calculated once during training)
_spike_cache = None


def train_single_model(product_name, product_df):
    """
    Train a Prophet model for ONE product.

    STEPS:
      1. Create a Prophet instance with our settings
      2. Add regressors (is_weekend, is_festival)
      3. Fit the model on historical data
      4. Calculate training accuracy metrics

    PROPHET SETTINGS EXPLAINED:
      - yearly_seasonality=True: Learn yearly patterns (summer vs winter)
      - weekly_seasonality=True: Learn weekly patterns (weekday vs weekend)
      - daily_seasonality=False: We have daily TOTALS, not hourly data
      - changepoint_prior_scale=0.05: How flexible the trend line is.
        Lower = smoother trend (less likely to overfit to noise)
        Higher = more wiggly trend (follows every bump)
        0.05 is Prophet's default — good balance for business data.
      - seasonality_mode='multiplicative': Seasonal effects MULTIPLY the trend.
        "Additive" means weekend adds +100 units regardless of trend level.
        "Multiplicative" means weekend adds +20% — which scales with the trend.
        Restaurant data is multiplicative: if baseline is 500, weekend adds 100.
        If baseline grows to 1000, weekend should add 200, not still 100.

    RETURNS: dict with { model, metrics, training_rows, last_trained }
    """
    print(f"\n   🏋️ Training Prophet model for: {product_name}")
    start_time = time.time()

    # ── 1. Create Prophet Instance ──
    model = Prophet(
        yearly_seasonality=True,       # learn summer/winter patterns
        weekly_seasonality=True,       # learn weekday/weekend patterns
        daily_seasonality=False,       # we don't have hourly data
        changepoint_prior_scale=0.05,  # trend flexibility (default)
        seasonality_mode="multiplicative",  # seasonal effects scale with trend
    )

    # ── 2. Add Extra Regressors ──
    # These MUST be added BEFORE fitting. They must also be present in future data.
    # mode="multiplicative" means: is_festival multiplies the forecast (not adds to it)
    # e.g., festival causes 1.6× demand, not +300 units regardless of baseline
    model.add_regressor("is_weekend", mode="multiplicative")
    model.add_regressor("is_festival", mode="multiplicative")

    # ── 3. Prepare Training Data ──
    # Prophet needs: ds, y, and any regressor columns
    train_df = product_df[["ds", "y", "is_weekend", "is_festival"]].copy()

    # ── 4. Fit the Model ──
    # This is where the "learning" happens. Prophet runs optimization to find
    # the best trend, seasonality, and regressor coefficients.
    model.fit(train_df)

    elapsed = time.time() - start_time

    # ── 5. Calculate Training Accuracy ──
    # We predict on the SAME data we trained on (in-sample prediction)
    # to get a baseline accuracy. This is NOT the same as test accuracy —
    # it tells us "how well does the model fit the historical data?"
    in_sample = model.predict(train_df)

    # MAE = Mean Absolute Error — average absolute difference between actual and predicted
    # Example: if actual=[100, 200, 300] and predicted=[110, 190, 280],
    #          errors = [10, 10, 20], MAE = 13.3
    mae = np.mean(np.abs(product_df["y"].values - in_sample["yhat"].values))

    # MAPE = Mean Absolute Percentage Error — MAE as a percentage
    # Example: actual=100, predicted=110, error=10% → MAPE gives you "on average X% off"
    # We avoid division by zero with np.where (if actual=0, skip that row)
    actual = product_df["y"].values
    predicted = in_sample["yhat"].values
    non_zero_mask = actual > 0
    if non_zero_mask.sum() > 0:
        mape = np.mean(np.abs((actual[non_zero_mask] - predicted[non_zero_mask]) / actual[non_zero_mask])) * 100
    else:
        mape = 0.0

    metrics = {
        "mae": round(float(mae), 2),          # e.g., 45.2 units off on average
        "mape": round(float(mape), 2),         # e.g., 8.5% off on average
        "training_rows": len(train_df),        # how many days we trained on
        "training_time_sec": round(elapsed, 2), # how long training took
    }

    print(f"      ✅ Trained in {elapsed:.1f}s | MAE: {mae:.1f} units | MAPE: {mape:.1f}%")

    return {
        "model": model,
        "metrics": metrics,
        "last_trained": datetime.now().isoformat(),
    }


def train_all_models(db):
    """
    Train Prophet models for ALL products.

    This is the main training function called at startup or on first request.
    It runs the preprocessing pipeline, then trains one model per product.

    FLOW:
      1. Run the preprocessing pipeline (Step 2.2) to get clean data
      2. Loop through each product
      3. Train a Prophet model for each
      4. Store all models in the global cache

    RETURNS: dict of training metrics per product
    """
    global _model_cache, _data_cache, _spike_cache

    print("\n" + "═" * 60)
    print("🤖 TRAINING ALL DEMAND FORECASTING MODELS")
    print("═" * 60)

    total_start = time.time()

    # Step 1: Preprocess data (loads from MongoDB, cleans, formats)
    product_data = preprocess_all(db)
    _data_cache = product_data  # cache preprocessed data for later use

    # Step 2: Analyze festival spikes from historical data (Step 2.4)
    # This calculates precise multipliers like: Thanksgiving → 1.46× for Burgers
    _spike_cache = analyze_festival_spikes(product_data)

    # Step 3: Train a model for each product
    all_metrics = {}

    for product_name, product_df in sorted(product_data.items()):
        result = train_single_model(product_name, product_df)
        _model_cache[product_name] = result
        all_metrics[product_name] = result["metrics"]

    total_elapsed = time.time() - total_start

    print(f"\n{'═' * 60}")
    print(f"✅ ALL MODELS TRAINED in {total_elapsed:.1f}s")
    print(f"   Products: {list(_model_cache.keys())}")
    print(f"{'═' * 60}\n")

    return all_metrics


def forecast_product(product_name, days=30, db=None):
    """
    Generate a demand forecast for ONE product.

    This is the function that gets called when someone asks:
    "How many Burgers will we sell in the next 30 days?"

    STEPS:
      1. Check if model is cached (trained). If not, train all models first.
      2. Build a "future DataFrame" — a table of the NEXT N days with features.
      3. Ask Prophet to predict demand for each of those days.
      4. Format the results into a clean response.

    WHAT IS A "FUTURE DATAFRAME"?
      Prophet can only predict if you give it a table of future dates WITH
      the same regressor columns used during training.

      We trained with: ds, y, is_weekend, is_festival
      For prediction, we provide: ds, is_weekend, is_festival (no 'y' — that's what we're predicting!)

      Prophet fills in 'y' with its predictions.

    PROPHET OUTPUT COLUMNS:
      - yhat: The predicted value (our forecast)
      - yhat_lower: The lower bound of the prediction (95% confidence)
      - yhat_upper: The upper bound of the prediction (95% confidence)

      Example: yhat=550, yhat_lower=480, yhat_upper=620
      Meaning: "We predict 550 Burgers, but it could reasonably be 480-620"

    PARAMETERS:
      product_name: str — e.g., "Burgers"
      days: int — how many days to forecast (30, 60, or 90)
      db: MongoDB database instance (needed if models aren't trained yet)

    RETURNS: dict with forecast data, summary stats, and model metrics
    """

    # ── 1. Ensure Models Are Trained ──
    if product_name not in _model_cache:
        if db is None:
            raise ValueError(
                f"No trained model found for '{product_name}' and no database provided. "
                "Call train_all_models(db) first, or pass a database connection."
            )
        print(f"⚠️  No cached model for '{product_name}'. Training all models now...")
        train_all_models(db)

    if product_name not in _model_cache:
        raise ValueError(
            f"Product '{product_name}' not found in training data. "
            f"Available products: {list(_model_cache.keys())}"
        )

    cached = _model_cache[product_name]
    model = cached["model"]
    metrics = cached["metrics"]

    # ── 2. Build Future DataFrame ──
    # Start from tomorrow (we don't predict today — we already know today's sales)
    # Create a row for each of the next N days
    tomorrow = datetime.now().date() + timedelta(days=1)
    future_dates = pd.date_range(start=tomorrow, periods=days, freq="D")

    future_df = pd.DataFrame({"ds": future_dates})

    # Add the same regressor columns we used during training
    # is_weekend: Saturday (5) and Sunday (6)
    future_df["is_weekend"] = (future_df["ds"].dt.dayofweek >= 5).astype(int)

    # is_festival: check against known festival dates
    # For future dates, we check FESTIVAL_DATES and also generate future festival dates
    future_festival_dates = _get_future_festival_dates(future_dates)
    future_df["date_str"] = future_df["ds"].dt.strftime("%Y-%m-%d")
    future_df["is_festival"] = future_df["date_str"].isin(future_festival_dates.keys()).astype(int)
    future_df["festival_name"] = future_df["date_str"].map(future_festival_dates).fillna("")
    future_df = future_df.drop(columns=["date_str"])

    # ── 3. Run Prophet Prediction ──
    prediction = model.predict(future_df[["ds", "is_weekend", "is_festival"]])

    # ── 4. Format Results + Apply Festival Spike Multipliers ──
    # Prophet's raw output has many columns. We only need a few.
    # Also ensure predictions are never negative (can't sell -50 burgers)
    #
    # FESTIVAL ADJUSTMENT (Step 2.4):
    # Prophet learns a GENERIC "festival effect" (one number for all festivals).
    # But Super Bowl (1.50×) and MLK Day (1.10×) are very different!
    # So we use our historical spike analysis to apply a PRECISE multiplier
    # for each specific festival on top of Prophet's base prediction.
    forecast_rows = []

    for i in range(len(prediction)):
        date = prediction.iloc[i]["ds"]
        yhat_raw = prediction.iloc[i]["yhat"]
        yhat_lower_raw = prediction.iloc[i]["yhat_lower"]
        yhat_upper_raw = prediction.iloc[i]["yhat_upper"]

        # Get festival info for this date
        date_str = date.strftime("%Y-%m-%d")
        festival = future_festival_dates.get(date_str, "")

        # Apply festival-specific spike multiplier if this is a festival day
        # and we have historical spike data available
        spike_multiplier = 1.0
        if festival and _spike_cache:
            spike_multiplier = get_festival_multiplier(_spike_cache, product_name, festival)
            # Prophet already partially accounts for festivals via is_festival regressor.
            # To avoid double-counting, we apply the RATIO between our precise multiplier
            # and Prophet's generic one. But since Prophet's internal effect is baked into
            # yhat already, we use a blended approach:
            #   - If spike_multiplier > 1.0, we boost the prediction proportionally
            #   - The boost is: (spike_multiplier - 1.0) * 0.5 as an additive adjustment
            #     to avoid over-amplifying what Prophet already captured.
            # This "half-boost" strategy avoids double-counting while still differentiating
            # between high-impact (Super Bowl) and low-impact (MLK Day) festivals.
            if spike_multiplier > 1.0:
                adjustment = 1.0 + (spike_multiplier - 1.0) * 0.5
                yhat_raw *= adjustment
                yhat_lower_raw *= adjustment
                yhat_upper_raw *= adjustment

        yhat = max(0, round(yhat_raw))
        yhat_lower = max(0, round(yhat_lower_raw))
        yhat_upper = max(0, round(yhat_upper_raw))

        forecast_rows.append({
            "date": date_str,
            "day_name": date.strftime("%A"),       # "Monday", "Tuesday", etc.
            "predicted_demand": int(yhat),
            "lower_bound": int(yhat_lower),
            "upper_bound": int(yhat_upper),
            "is_weekend": int(date.dayofweek >= 5),
            "is_festival": 1 if festival else 0,
            "festival_name": festival,
            "spike_multiplier": round(spike_multiplier, 3) if festival else None,
        })

    # ── 5. Calculate Summary Statistics ──
    demands = [row["predicted_demand"] for row in forecast_rows]

    summary = {
        "product": product_name,
        "forecast_days": days,
        "start_date": forecast_rows[0]["date"],
        "end_date": forecast_rows[-1]["date"],
        "total_predicted": sum(demands),
        "avg_daily_demand": round(np.mean(demands), 1),
        "min_daily_demand": min(demands),
        "max_daily_demand": max(demands),
        "peak_day": forecast_rows[np.argmax(demands)]["date"],
        "peak_day_name": forecast_rows[np.argmax(demands)]["day_name"],
        "weekend_avg": round(np.mean([d for i, d in enumerate(demands) if forecast_rows[i]["is_weekend"]]) if any(r["is_weekend"] for r in forecast_rows) else 0, 1),
        "weekday_avg": round(np.mean([d for i, d in enumerate(demands) if not forecast_rows[i]["is_weekend"]]) if any(not r["is_weekend"] for r in forecast_rows) else 0, 1),
        "festival_days_count": sum(1 for r in forecast_rows if r["is_festival"]),
    }

    # Include festival spike info for transparency
    festival_spikes_used = {}
    if _spike_cache:
        for row in forecast_rows:
            if row["festival_name"] and row["spike_multiplier"]:
                festival_spikes_used[row["festival_name"]] = row["spike_multiplier"]

    return {
        "summary": summary,
        "daily_forecast": forecast_rows,
        "model_metrics": metrics,
        "last_trained": cached["last_trained"],
        "festival_adjustments": festival_spikes_used,
    }


def forecast_all_products(days=30, db=None):
    """
    Generate forecasts for ALL products at once.

    Useful for the daily briefing prompt — get a complete picture of
    what the restaurant will need for the next N days.

    RETURNS: dict of { product_name: forecast_result }
    """
    # Ensure models are trained
    if not _model_cache:
        if db is None:
            raise ValueError("Models not trained. Provide a database connection.")
        train_all_models(db)

    results = {}
    for product_name in sorted(_model_cache.keys()):
        results[product_name] = forecast_product(product_name, days, db)

    return results


def get_model_status():
    """
    Get the current status of all trained models.

    Returns info about each model: when it was trained, accuracy metrics, etc.
    Useful for the /health endpoint or debugging.
    """
    if not _model_cache:
        return {"status": "not_trained", "models": {}}

    models_info = {}
    for product_name, cached in _model_cache.items():
        models_info[product_name] = {
            "last_trained": cached["last_trained"],
            "metrics": cached["metrics"],
        }

    return {
        "status": "trained",
        "model_count": len(_model_cache),
        "models": models_info,
        "festival_spike_analysis": "loaded" if _spike_cache else "not_loaded",
    }


def _get_future_festival_dates(date_range):
    """
    Build a dict of festival dates that fall within the given date range.

    For PAST festivals, we use the hardcoded FESTIVAL_DATES from the preprocessor.
    For FUTURE festivals, we generate likely dates based on known patterns.

    US holidays follow two patterns:
      1. FIXED DATE — Same day every year (July 4th, Christmas, Halloween, etc.)
      2. FLOATING DATE — Depends on the calendar (Thanksgiving = 4th Thursday of Nov)

    This function handles both by generating festival dates for the forecast years.

    NOTE: In Step 2.4, we'll enhance this with Nager.Date API for more accuracy.
    For now, we use simple rules that cover the major holidays.
    """
    result = {}

    # Include any hardcoded dates that fall in range
    start = date_range[0].date() if hasattr(date_range[0], 'date') else date_range[0]
    end = date_range[-1].date() if hasattr(date_range[-1], 'date') else date_range[-1]

    # Add hardcoded historical dates if they fall in range
    for date_str, name in FESTIVAL_DATES.items():
        date = pd.to_datetime(date_str).date()
        if start <= date <= end:
            result[date_str] = name

    # Generate future festival dates for years in the forecast range
    years = set()
    for d in date_range:
        year = d.year if hasattr(d, 'year') else pd.to_datetime(d).year
        years.add(year)

    for year in years:
        # ── Fixed-date holidays ──
        fixed_holidays = {
            f"{year}-01-01": f"New Year {year}",
            f"{year}-02-14": f"Valentine's Day {year}",
            f"{year}-07-04": f"Independence Day {year}",
            f"{year}-10-31": f"Halloween {year}",
            f"{year}-12-25": f"Christmas {year}",
            f"{year}-12-31": f"New Year's Eve {year}",
        }

        # ── Floating holidays (calculated) ──
        # MLK Jr. Day = 3rd Monday of January
        mlk = _nth_weekday(year, 1, 0, 3)  # month=1, weekday=0 (Mon), nth=3
        fixed_holidays[mlk.strftime("%Y-%m-%d")] = f"MLK Jr. Day {year}"

        # Presidents' Day = 3rd Monday of February
        pres = _nth_weekday(year, 2, 0, 3)
        fixed_holidays[pres.strftime("%Y-%m-%d")] = f"Presidents' Day {year}"

        # Mother's Day = 2nd Sunday of May
        mothers = _nth_weekday(year, 5, 6, 2)  # weekday=6 (Sun), nth=2
        fixed_holidays[mothers.strftime("%Y-%m-%d")] = f"Mother's Day {year}"

        # Memorial Day = Last Monday of May
        memorial = _last_weekday(year, 5, 0)  # month=5, weekday=0 (Mon)
        fixed_holidays[memorial.strftime("%Y-%m-%d")] = f"Memorial Day {year}"

        # Father's Day = 3rd Sunday of June
        fathers = _nth_weekday(year, 6, 6, 3)
        fixed_holidays[fathers.strftime("%Y-%m-%d")] = f"Father's Day {year}"

        # Labor Day = 1st Monday of September
        labor = _nth_weekday(year, 9, 0, 1)
        fixed_holidays[labor.strftime("%Y-%m-%d")] = f"Labor Day {year}"

        # Thanksgiving = 4th Thursday of November
        thanksgiving = _nth_weekday(year, 11, 3, 4)  # weekday=3 (Thu), nth=4
        fixed_holidays[thanksgiving.strftime("%Y-%m-%d")] = f"Thanksgiving {year}"

        # Black Friday = Day after Thanksgiving
        black_friday = thanksgiving + timedelta(days=1)
        fixed_holidays[black_friday.strftime("%Y-%m-%d")] = f"Black Friday {year}"

        # Super Bowl = 2nd Sunday of February (approximate)
        super_bowl = _nth_weekday(year, 2, 6, 2)
        fixed_holidays[super_bowl.strftime("%Y-%m-%d")] = f"Super Bowl {year}"

        # Add all that fall within our forecast range
        for date_str, name in fixed_holidays.items():
            date = pd.to_datetime(date_str).date()
            if start <= date <= end:
                result[date_str] = name

    return result


def _nth_weekday(year, month, weekday, n):
    """
    Find the nth occurrence of a weekday in a given month/year.

    Example: _nth_weekday(2025, 11, 3, 4) → 4th Thursday of November 2025
      - weekday: 0=Monday, 1=Tuesday, ... 6=Sunday
      - n: 1st, 2nd, 3rd, or 4th occurrence

    HOW IT WORKS:
      1. Start at the 1st of the month
      2. Find how many days until the target weekday
      3. Jump to the 1st occurrence, then add (n-1) weeks
    """
    from datetime import date
    first_day = date(year, month, 1)
    # Days until the target weekday from the 1st of the month
    days_ahead = weekday - first_day.weekday()
    if days_ahead < 0:
        days_ahead += 7
    # Jump to the nth occurrence
    return first_day + timedelta(days=days_ahead + (n - 1) * 7)


def _last_weekday(year, month, weekday):
    """
    Find the LAST occurrence of a weekday in a given month/year.

    Example: _last_weekday(2025, 5, 0) → Last Monday of May 2025

    HOW IT WORKS:
      1. Start at the last day of the month
      2. Walk backwards until we hit the target weekday
    """
    from datetime import date
    import calendar
    last_day = date(year, month, calendar.monthrange(year, month)[1])
    days_back = (last_day.weekday() - weekday) % 7
    return last_day - timedelta(days=days_back)
