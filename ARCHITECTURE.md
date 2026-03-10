# 🍔 Restaurant Forecast System — Complete Architecture Guide

> **Purpose:** This document explains the ENTIRE system — how data flows, how models train, how tools work, and how everything connects. Use this to understand and debug any part.

---

## 📋 Table of Contents

1. [System Overview (Bird's Eye View)](#1-system-overview)
2. [Data Layer — Where the Data Lives](#2-data-layer)
3. [ML Service — How Models Train & Predict](#3-ml-service)
4. [MCP Server — The Tool Bridge](#4-mcp-server)
5. [Frontend — LangChain Agent + Chat UI](#5-frontend)
6. [Complete Request Flow — End to End](#6-complete-request-flow)
7. [Known Issues & Debug Guide](#7-known-issues)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        RESTAURANT FORECAST SYSTEM                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   👤 User (Browser)                                                     │
│    │                                                                    │
│    ▼                                                                    │
│   ┌──────────────────────────────────────────────────────────┐          │
│   │  FRONTEND (Next.js :3000)                                │          │
│   │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐     │          │
│   │  │ Chat UI     │  │ LangChain   │  │ SSE Stream   │     │          │
│   │  │ (React)     │→ │ Agent       │→ │ /api/chat/   │     │          │
│   │  │             │  │ (Groq LLM)  │  │ stream       │     │          │
│   │  └─────────────┘  └──────┬──────┘  └──────────────┘     │          │
│   │                          │                                │          │
│   │              MCP Client (STDIO JSON-RPC)                  │          │
│   └──────────────────────────┼────────────────────────────────┘          │
│                              │                                           │
│                              ▼                                           │
│   ┌──────────────────────────────────────────────────────────┐          │
│   │  MCP SERVER (Node.js child process)                      │          │
│   │  5 Tools:                                                │          │
│   │   ├── forecast_demand ───→ calls ML Service (HTTP)       │          │
│   │   ├── check_inventory ──→ queries MongoDB directly       │          │
│   │   ├── calculate_profit ─→ queries MongoDB directly       │          │
│   │   ├── get_sales_analytics→ queries MongoDB directly      │          │
│   │   └── get_upcoming_festivals → Nager API + MongoDB cache │          │
│   └──────────────────────────┼────────────────────────────────┘          │
│                              │                                           │
│              ┌───────────────┼──────────────────┐                        │
│              ▼                                  ▼                        │
│   ┌────────────────────┐          ┌────────────────────────┐            │
│   │  ML SERVICE         │          │  MONGODB ATLAS          │            │
│   │  (FastAPI :8000)    │          │  (Cloud Database)       │            │
│   │                     │          │                         │            │
│   │  Facebook Prophet   │◄────────│  3,764 sales records    │            │
│   │  5 trained models   │  reads  │  5 inventory records    │            │
│   │  Festival spikes    │         │  5 product configs      │            │
│   │  Profit projections │         │  Festival cache         │            │
│   └────────────────────┘          └────────────────────────┘            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### The 4 Services

| Service | Location | Port | Language | Purpose |
|---------|----------|------|----------|---------|
| **Frontend** | `frontend/` | 3000 | JavaScript (Next.js) | Chat UI + LangChain Agent |
| **MCP Server** | `mcp-server/` | STDIO (child process) | JavaScript (Node.js) | Tool definitions + data queries |
| **ML Service** | `ml-service/` | 8000 | Python (FastAPI) | Prophet model training + forecasting |
| **MongoDB Atlas** | Cloud | 27017 (SRV) | — | Data storage |

---

## 2. Data Layer

### 2.1 MongoDB Atlas

```
Connection: mongodb+srv://iamabdullahakram1:baig03092597570@invest-x.a3lod1o.mongodb.net/restaurant-forecast
Database:   restaurant-forecast
```

### 2.2 Collections

```
restaurant-forecast (database)
├── sales           → 3,764 records (Nov 2022 → Nov 2024)
├── products        → 5 records (product catalog with pricing)
├── inventories     → ~3,800 records (daily stock snapshots)
└── festivals       → ~15 records (cached from Nager API)
```

#### `sales` Collection Schema
```
File: mcp-server/src/models/Sale.js

{
  transactionId:  Number    (required, indexed)
  date:           Date      (required, indexed)
  product:        String    (required, indexed)
                            enum: ["Burgers", "Chicken Sandwiches", "Fries",
                                   "Beverages", "Sides & Other"]
  quantity:       Number    (required)
  price:          Number    (required)
  salesChannel:   String    (required) — enum: ["In-store", "Drive-thru", "Online"]
  paymentMethod:  String    (required) — enum: ["Credit Card", "Cash", "Gift Card"]
}

Example:
{
  transactionId: 1001,
  date: 2024-03-15,
  product: "Burgers",
  quantity: 3,
  price: 38.97,
  salesChannel: "In-store",
  paymentMethod: "Credit Card"
}
```

#### `products` Collection Schema
```
File: mcp-server/src/models/Product.js

{
  product:       String  (unique)  — "Burgers"
  sellPrice:     Number            — 12.99
  costPrice:     Number            — 5.50
  profitPerUnit: Number            — 7.49
  marginPercent: Number            — 57.7
  category:      String            — "main" | "side" | "drink"
  unit:          String            — "units"
  minStock:      Number            — 400
  reorderPoint:  Number            — 500
  maxStock:      Number            — 1200
  leadTimeDays:  Number            — 1
}
```

**Product Pricing Table:**

| Product | Sell | Cost | Profit | Margin | Category |
|---------|------|------|--------|--------|----------|
| Burgers | $12.99 | $5.50 | $7.49 | 57% | main |
| Chicken Sandwiches | $9.95 | $4.00 | $5.95 | 60% | main |
| Fries | $3.49 | $0.80 | $2.69 | 77% | side |
| Beverages | $2.95 | $0.50 | $2.45 | 83% | drink |
| Sides & Other | $4.99 | $1.50 | $3.49 | 70% | side |

#### `inventories` Collection Schema
```
File: mcp-server/src/models/Inventory.js

{
  product:     String  (indexed)  — "Burgers"
  date:        Date    (indexed)  — 2024-03-15
  quantity:    Number             — 850
  consumed:    Number             — 45
  restocked:   Number             — 0
  status:      String             — "green" | "yellow" | "red"
}
```

#### `festivals` Collection Schema
```
File: mcp-server/src/models/Festival.js

{
  name:          String  — "Independence Day"
  date:          Date    — 2026-07-04
  type:          String  — "Public"
  countryCode:   String  — "US"
  source:        String  — "nager-api"
  spikeFactor:   Number  — 1.0
}
```

### 2.3 How Data Was Seeded

```
File: mcp-server/src/scripts/seed.js
Run:  cd mcp-server && npm run seed
```

```
Data Sources:
├── 9. Sales-Data-Analysis.csv    → 254 original records
└── synthetic-sales.csv           → 3,510 generated records
                                    ─────
                            Total:  3,764 sales records
                            Range:  Nov 7, 2022 → Nov 30, 2024
                            Products: 5
                            Channels: 3 (In-store, Drive-thru, Online)

Seed Process:
┌──────────────────────────────────────────────────────┐
│  1. seedSales()                                       │
│     - Reads both CSVs with csv-parse                  │
│     - Transforms: Number(quantity), new Date(date)    │
│     - db.sales.deleteMany() → db.sales.insertMany()  │
│                                                       │
│  2. seedProducts()                                    │
│     - Reads products.json (5 products with pricing)   │
│     - db.products.deleteMany() → db.products.insertMany()│
│                                                       │
│  3. seedInventory()                                   │
│     - Aggregates sales by date via MongoDB pipeline   │
│     - Simulates stock: starts at maxStock             │
│     - Subtracts daily consumption                     │
│     - Auto-restocks when below reorderPoint           │
│     - Assigns green/yellow/red status                 │
└──────────────────────────────────────────────────────┘
```

### 2.4 Data Date Range Problem ⚠️

```
IMPORTANT: Sales data ends at November 30, 2024.
Today's date is March 8, 2026.

This means:
- "Last 30 days" queries → Nov 2024 data (1+ year old!)
- calculate_profit with days=30 → likely returns $0 revenue
  because there are NO sales records in Feb-Mar 2026.
- check_inventory shows stock from Nov 2024 snapshot.

This is a KEY BUG: Most tools query "last N days from today"
but the data stops in Nov 2024.
```

---

## 3. ML Service — Model Training & Prediction

### 3.1 Startup Flow

```
File: ml-service/app/main.py
Run:  cd ml-service && uvicorn app.main:app --host 0.0.0.0 --port 8000

Startup Sequence:
┌─────────────────────────────────────────────┐
│  1. FastAPI app created                      │
│  2. Lifespan event fires on startup          │
│  3. get_database() → connects to MongoDB     │
│  4. train_all_models(db) called              │
│     │                                        │
│     ├── preprocess_all(db)                   │
│     │   ├── load_sales_from_mongodb(db)      │
│     │   │   → db.sales.find() → 3,764 rows  │
│     │   ├── aggregate_daily_sales()          │
│     │   │   → groupby [date, product] → sum  │
│     │   ├── fill_missing_days()              │
│     │   │   → 755 days × 5 products = 3,775 │
│     │   └── add_features()                   │
│     │       → day_of_week, is_weekend,       │
│     │         is_festival, month, etc.        │
│     │                                        │
│     ├── analyze_festival_spikes()            │
│     │   → For each festival in data:         │
│     │     spike = festival_day / baseline_avg │
│     │     (baseline = ±14 days, no weekends)  │
│     │                                        │
│     └── For EACH of 5 products:              │
│         train_single_model(name, df)         │
│         → Prophet(                           │
│             yearly_seasonality=True,          │
│             weekly_seasonality=True,          │
│             changepoint_prior_scale=0.05,     │
│             seasonality_mode="multiplicative" │
│           )                                  │
│         → model.add_regressor("is_weekend")  │
│         → model.add_regressor("is_festival") │
│         → model.fit(df)  ← ~0.2s per model  │
│         → Calculate MAE, MAPE accuracy       │
│                                              │
│  5. Models cached in _model_cache dict       │
│  6. Server ready on port 8000                │
│     Total startup: ~3 seconds                │
└─────────────────────────────────────────────┘
```

### 3.2 Data Preprocessing Pipeline

```
File: ml-service/app/services/data_preprocessor.py
Function: preprocess_all(db) → { "Burgers": DataFrame, ... }

Step 1: load_sales_from_mongodb(db)
  ┌─────────────────────────────────┐
  │ db.sales.find() → 3,764 records │
  │ Keep: date, product, quantity,   │
  │       price                      │
  │ Output: pandas DataFrame         │
  └─────────────────────────────────┘
         │
         ▼
Step 2: aggregate_daily_sales(df)
  ┌─────────────────────────────────┐
  │ GROUP BY (date, product)         │
  │ SUM quantity → daily total       │
  │ SUM price → daily revenue        │
  │ Output: 3,764 daily records      │
  └─────────────────────────────────┘
         │
         ▼
Step 3: fill_missing_days(daily_df)
  ┌─────────────────────────────────┐
  │ Generate full date range:        │
  │   2022-11-07 → 2024-11-30       │
  │   = 755 days                     │
  │ Cross-join with 5 products       │
  │   = 755 × 5 = 3,775 rows        │
  │ Left-merge → fill NaN with 0    │
  │ (Days with no sales get qty=0)   │
  └─────────────────────────────────┘
         │
         ▼
Step 4: add_features(df)
  ┌─────────────────────────────────┐
  │ Added columns:                   │
  │   day_of_week  (0=Mon, 6=Sun)   │
  │   day_name     ("Monday", ...)   │
  │   month        (1-12)            │
  │   is_weekend   (0 or 1)          │
  │   is_festival  (0 or 1)          │
  │   festival_name (str or "")      │
  │   week_of_year (1-52)            │
  │   day_of_month (1-31)            │
  │                                  │
  │ Festival dates: hardcoded dict   │
  │   FESTIVAL_DATES = {             │
  │     "2024-07-04": "Independence",│
  │     "2024-11-28": "Thanksgiving",│
  │     ...28 entries (2022-2024)    │
  │   }                              │
  └─────────────────────────────────┘
         │
         ▼
Step 5: prepare_prophet_format(df, product_name)
  ┌─────────────────────────────────┐
  │ Filter to one product            │
  │ Rename: date → ds, quantity → y  │
  │ (Prophet requires ds/y columns)  │
  │ Output: per-product DataFrame    │
  └─────────────────────────────────┘
```

### 3.3 Prophet Model Training

```
File: ml-service/app/services/demand_forecaster.py
Function: train_single_model(product_name, product_df)

Prophet Configuration:
┌─────────────────────────────────────────────┐
│ model = Prophet(                             │
│   yearly_seasonality  = True,    ← annual   │
│   weekly_seasonality  = True,    ← day-of-  │
│   daily_seasonality   = False,     week      │
│   changepoint_prior_scale = 0.05, ← smooth  │
│   seasonality_mode = "multiplicative"        │
│ )                                            │
│                                              │
│ model.add_regressor("is_weekend",            │
│   mode="multiplicative")                     │
│ model.add_regressor("is_festival",           │
│   mode="multiplicative")                     │
│                                              │
│ model.fit(df)  ← trains on 755 days of data │
│                                              │
│ Accuracy (last 30 days holdout):             │
│   Beverages:          MAE 47.5, MAPE 5.5%   │
│   Burgers:            MAE 61.0, MAPE 9.3%   │
│   Chicken Sandwiches: MAE 23.5, MAPE 9.7%   │
│   Fries:              MAE 45.4, MAPE 6.0%   │
│   Sides & Other:      MAE 27.9, MAPE 11.9%  │
└─────────────────────────────────────────────┘
```

### 3.4 Forecasting (Prediction)

```
File: ml-service/app/services/demand_forecaster.py
Function: forecast_product(product_name, days, db)

Prediction Flow:
┌──────────────────────────────────────────────────┐
│  1. Build future DataFrame                        │
│     → tomorrow + N days                           │
│     → Add is_weekend, is_festival columns          │
│     → Future festivals via _get_future_festival_dates() │
│                                                    │
│  2. model.predict(future_df)                       │
│     → Prophet outputs: yhat, yhat_lower, yhat_upper│
│     → yhat = predicted daily demand                │
│                                                    │
│  3. Apply festival spike multipliers               │
│     → If day is a festival AND spike > 1.0:        │
│       adjusted = yhat × (1 + (spike-1)/2)          │
│       (Half-boost to avoid double-counting with     │
│        Prophet's internal festival effect)           │
│                                                    │
│  4. Return:                                        │
│     {                                              │
│       product: "Burgers",                          │
│       summary: {                                   │
│         total_predicted: 1234,                     │
│         avg_daily: 41,                             │
│         peak_day: { date, value },                 │
│         lowest_day: { date, value },               │
│         confidence: "87.5%"                        │
│       },                                           │
│       daily_forecast: [                            │
│         { date, predicted, lower, upper,           │
│           is_weekend, is_festival, festival_name } │
│       ],                                           │
│       model_metrics: { mae, mape, training_rows }, │
│       festival_adjustments: [...]                  │
│     }                                              │
└──────────────────────────────────────────────────┘
```

### 3.5 Festival Spike Analysis

```
File: ml-service/app/services/festival_spike_analyzer.py
Function: analyze_festival_spikes(product_data_dict)

Algorithm:
┌─────────────────────────────────────────────┐
│  For each festival day in historical data:   │
│                                              │
│    1. Get sales on festival day              │
│    2. Get baseline = avg sales ±14 days      │
│       (excluding other festivals + weekends) │
│    3. spike_multiplier = festival / baseline │
│                                              │
│  Example:                                    │
│    Thanksgiving Burgers avg = 75 units       │
│    Normal day avg = 45 units                 │
│    Spike = 75/45 = 1.67×                     │
│                                              │
│  Top Festival Impacts:                       │
│    1. New Year's Eve     → 1.87× (HIGH)      │
│    2. Black Friday       → 1.59× (HIGH)      │
│    3. Thanksgiving       → 1.58× (HIGH)      │
│    4. Super Bowl         → 1.40× (HIGH)      │
│    5. Mother's Day       → 1.35× (MEDIUM)    │
└─────────────────────────────────────────────┘
```

### 3.6 ML Service API Endpoints

```
Base URL: http://localhost:8000

GET  /                          → Endpoint listing
GET  /health                    → Health check + model status
GET  /forecast/{product}?days=N → Single product forecast
GET  /forecast/?days=N          → All products forecast
GET  /profit/{product}?days=N   → Single product profit projection
GET  /profit/?days=N            → All products profit projection
GET  /model/status              → Training status + accuracy
POST /model/train               → Force retrain all models
```

---

## 4. MCP Server — The Tool Bridge

### 4.1 What is MCP?

```
MCP = Model Context Protocol
It's a standard way for AI models to USE TOOLS.

Instead of the AI guessing answers, it can:
  1. See a list of available tools
  2. Decide which tool to call
  3. Call the tool with parameters
  4. Read the result
  5. Use the result to answer the user

Think of it as a "USB standard for AI tools."
```

### 4.2 Server Setup

```
File: mcp-server/src/index.js
Transport: STDIO (stdin/stdout JSON-RPC)

The MCP Server is NOT a web server — it runs as a child process
spawned by the frontend's MCP Client. Communication happens via
stdin/stdout using JSON-RPC messages.

Startup:
  1. Connect to MongoDB (connectDB)
  2. Register 5 tools + 3 resources + 3 prompts
  3. Start STDIO transport
  4. Wait for JSON-RPC requests from MCP Client
```

### 4.3 The 5 Tools

```
┌────────────────────────────────────────────────────────────────┐
│                         5 MCP TOOLS                            │
├────────────────────┬──────────────────┬────────────────────────┤
│ Tool               │ Data Source       │ What It Returns        │
├────────────────────┼──────────────────┼────────────────────────┤
│ forecast_demand    │ ML Service (HTTP) │ Prophet predictions,   │
│                    │ :8000/forecast/   │ festival spikes,       │
│                    │ Fallback: MongoDB │ profit projections     │
│                    │ moving-average    │                        │
├────────────────────┼──────────────────┼────────────────────────┤
│ check_inventory    │ MongoDB directly  │ Stock levels, status   │
│                    │ (inventories +    │ (green/yellow/red),    │
│                    │  products +sales) │ days until stockout    │
├────────────────────┼──────────────────┼────────────────────────┤
│ calculate_profit   │ MongoDB directly  │ Revenue, COGS, gross   │
│                    │ (sales + products)│ profit, margin %,      │
│                    │                   │ per product breakdown  │
├────────────────────┼──────────────────┼────────────────────────┤
│ get_sales_analytics│ MongoDB directly  │ Overview, by_product,  │
│                    │ (sales collection)│ by_channel, trend,     │
│                    │                   │ top_sellers            │
├────────────────────┼──────────────────┼────────────────────────┤
│ get_upcoming_      │ Nager.Date API    │ Holiday names, dates,  │
│ festivals          │ + MongoDB cache   │ days until, expected   │
│                    │                   │ demand impact          │
└────────────────────┴──────────────────┴────────────────────────┘
```

### 4.4 Tool: forecast_demand (Detail)

```
File: mcp-server/src/tools/forecast.js

Parameters:
  product:    "Burgers" | "Chicken Sandwiches" | "Fries" |
              "Beverages" | "Sides & Other" | "all"
  days_ahead: 1-90 (default 30)

Flow:
  1. TRY: Call ML Service
     ├── GET http://localhost:8000/forecast/{product}?days=N
     └── GET http://localhost:8000/profit/{product}?days=N
     (Both in parallel via Promise.all)
     Timeout: 30 seconds

  2. IF ML Service fails: FALLBACK to moving-average
     ├── Query last 30 days of sales from MongoDB
     ├── Calculate day-of-week multipliers
     ├── Apply random variance (±10%)
     └── Mark response with model: "moving_average_fallback"

  3. Return JSON to MCP Client
```

### 4.5 Tool: calculate_profit (Detail) ⚠️ THE BUGGY ONE

```
File: mcp-server/src/tools/profit.js

Parameters:
  product:       "Burgers" | ... | "all"
  days:          0-365 (default 30)
  include_trend: boolean
  group_by:      "day" | "week" | "month"

Flow:
  1. Calculate date range: startDate = today - N days
  2. MongoDB aggregation on sales collection:
     $match: { date >= startDate }        ← ⚠️ PROBLEM!
     $lookup: join with products collection
     $group: sum revenue, calculate COGS, count units
  3. Return per-product breakdown

  ⚠️ WHY IT RETURNS $0:
  The sales data ends at 2024-11-30.
  Today is 2026-03-08.
  "Last 30 days" = 2026-02-06 → 2026-03-08
  There are ZERO sales records in this range!
  So revenue = $0, profit = $0, margin = 0%.

  FIX NEEDED: Either:
  (a) Use the ACTUAL last 30 days of data (relative to max date in DB)
  (b) Re-seed with recent data
  (c) Add a date offset calculation
```

### 4.6 Tool: get_sales_analytics (Detail) ⚠️ SAME BUG

```
File: mcp-server/src/tools/analytics.js

Same date range problem as calculate_profit.
Queries "last N days from today" but data ends in Nov 2024.
```

---

## 5. Frontend — LangChain Agent + Chat UI

### 5.1 Architecture

```
frontend/
├── app/
│   ├── page.js              → Renders <ChatWindow />
│   ├── layout.js            → Dark theme, metadata
│   ├── globals.css           → Restaurant dark theme + chart styles
│   └── api/
│       └── chat/
│           ├── route.js      → POST /api/chat (non-streaming)
│           └── stream/
│               └── route.js  → POST /api/chat/stream (SSE)
├── components/
│   ├── ChatWindow.js         → Main assembler (welcome + messages)
│   ├── ChatMessage.js        → Single chat bubble (user/AI)
│   ├── ChatInput.js          → Input bar + send/stop
│   ├── ToolStatus.js         → Tool execution indicators
│   └── ChartRenderer.js      → Auto-generates charts from tool data
├── hooks/
│   └── useChat.js            → State management + SSE streaming
└── lib/
    ├── mcp-client.js         → Spawns MCP Server, discovers tools
    ├── agent.js              → LLM + agent loop + streaming
    ├── prompts.js            → System prompt (ChefBot personality)
    └── memory.js             → In-memory chat history
```

### 5.2 MCP Client Connection

```
File: frontend/lib/mcp-client.js

How the frontend talks to the MCP Server:

  1. getMCPTools() called (lazy singleton)
  2. StdioClientTransport spawns child process:
     command: "node"
     args: ["mcp-server/src/index.js"]
     cwd: project root
  3. MCP Client connects via STDIO (stdin/stdout)
  4. client.listTools() → discovers 5 tool definitions
  5. Each tool's JSON Schema → converted to Zod schema
  6. Wrapped as LangChain DynamicStructuredTool
  7. tool.invoke(args) → client.callTool() → MCP Server → handler

  ┌─────────────┐  stdin/stdout  ┌─────────────┐
  │ MCP Client  │ ◄─────────────► │ MCP Server  │
  │ (frontend)  │   JSON-RPC     │ (child proc)│
  └─────────────┘                └─────────────┘
```

### 5.3 LangChain Agent

```
File: frontend/lib/agent.js

LLM: ChatGroq
  model:       "llama-3.1-8b-instant"
  apiKey:      GROQ_API_KEY (from .env.local)
  temperature: 0.3

Agent Loop (max 5 iterations):
┌─────────────────────────────────────────────┐
│                                              │
│  ① Format prompt (system + history + input)  │
│     │                                        │
│     ▼                                        │
│  ② Send messages to LLM (Groq)              │
│     │                                        │
│     ├── Has tool_calls? ──YES──┐              │
│     │                          │              │
│     │   ③ Execute each tool    │              │
│     │      via MCP Server      │              │
│     │          │                │              │
│     │   ④ Add ToolMessage      │              │
│     │      to history          │              │
│     │          │                │              │
│     │   ⑤ Check for duplicate  │              │
│     │      tool calls          │              │
│     │      (same signature?)   │              │
│     │          │                │              │
│     │   [If dup] → Force text  │              │
│     │   [If new] → Back to ②  ◄┘              │
│     │                                        │
│     └── No tool_calls? ──► ⑥ Return text     │
│                               (final answer)  │
│                                              │
└─────────────────────────────────────────────┘
```

### 5.4 SSE Streaming

```
File: frontend/lib/agent.js → runAgentStreaming()
File: frontend/app/api/chat/stream/route.js

SSE Events sent to browser:
┌──────────────┬──────────────────────────────────┐
│ Event Type   │ Payload                          │
├──────────────┼──────────────────────────────────┤
│ status       │ { message: "🧠 Thinking..." }    │
│ tool_start   │ { tool, message }                │
│ tool_end     │ { tool, message, data }          │
│              │         ↑ raw tool result JSON    │
│ token        │ { content: " word" }             │
│ done         │ { fullText: "complete response" }│
│ error        │ { message, details }             │
└──────────────┴──────────────────────────────────┘

Browser-side (useChat hook):
  token     → append to AI message content
  tool_start → add to toolStatuses array
  tool_end   → mark done + store data for ChartRenderer
  done       → set final text, clear statuses
  error      → show error banner
```

### 5.5 Chart Rendering

```
File: frontend/components/ChartRenderer.js

When a tool_end event arrives with data:
  1. useChat stores raw JSON on message.toolData[]
  2. ChatMessage passes toolData to ChartRenderer
  3. ChartRenderer matches tool name → parser function:

  ┌────────────────────────┬────────────────────────┐
  │ Tool                   │ Chart Type             │
  ├────────────────────────┼────────────────────────┤
  │ check_inventory        │ Bar (stock levels)     │
  │ get_sales_analytics    │ Bar/Pie/Line           │
  │ forecast_demand        │ Line (time series)     │
  │ calculate_profit       │ Bar (profit/product)   │
  └────────────────────────┴────────────────────────┘

  4. Parser extracts { name, value } or { date, value }
  5. Recharts renders the chart in the chat bubble
```

---

## 6. Complete Request Flow — End to End

```
Example: User asks "How profitable are burgers?"

┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  👤 User types "How profitable are burgers?" → clicks Send           │
│     │                                                                │
│     ▼                                                                │
│  [useChat.js] sendMessage()                                          │
│     ├── Add user message to messages[] (optimistic UI)               │
│     ├── Create empty AI message placeholder                          │
│     ├── POST /api/chat/stream { message, sessionId }                 │
│     │                                                                │
│     ▼                                                                │
│  [stream/route.js] POST handler                                      │
│     ├── Extract message + sessionId from body                        │
│     ├── Call runAgentStreaming(message, sessionId)                    │
│     │                                                                │
│     ▼                                                                │
│  [agent.js] runAgentStreaming()                                      │
│     ├── getMCPTools() → 5 LangChain tools (cached singleton)         │
│     ├── getLLM() → ChatGroq llama-3.1-8b-instant                     │
│     ├── llm.bindTools(tools)                                         │
│     ├── getChatHistory(sessionId) → past messages                    │
│     ├── chatPrompt.formatMessages({ input, chat_history })           │
│     │                                                                │
│     ├── SSE: { type: "status", message: "🧠 Thinking..." }           │
│     │                                                                │
│     ├── AGENT LOOP iteration 1:                                      │
│     │   ├── llmWithTools.invoke(messages) → Groq API call            │
│     │   ├── LLM responds: tool_calls: [{ name: "calculate_profit",  │
│     │   │     args: { product: "Burgers", days: 30 } }]              │
│     │   │                                                            │
│     │   ├── SSE: { type: "tool_start", tool: "calculate_profit" }    │
│     │   │                                                            │
│     │   ├── tool.invoke({ product: "Burgers", days: 30 })            │
│     │   │   └── MCP Client → JSON-RPC → MCP Server                  │
│     │   │       └── handleCalculateProfit()                          │
│     │   │           └── MongoDB aggregation pipeline                 │
│     │   │               └── ⚠️ Returns $0 (no data in date range!)   │
│     │   │                                                            │
│     │   ├── SSE: { type: "tool_end", tool: ..., data: "{...}" }      │
│     │   ├── Add ToolMessage to messages                              │
│     │   │                                                            │
│     │   ├── SSE: { type: "status", message: "🧠 Processing..." }     │
│     │   │                                                            │
│     │                                                                │
│     ├── AGENT LOOP iteration 2:                                      │
│     │   ├── llmWithTools.invoke(messages)                            │
│     │   ├── LLM sees tool result ($0), no more tool calls            │
│     │   ├── LLM generates final text                                 │
│     │   │                                                            │
│     │   ├── SSE: tokens sent word-by-word                            │
│     │   │   { type: "token", content: "Based" }                      │
│     │   │   { type: "token", content: " on" }                        │
│     │   │   { type: "token", content: " the" }                       │
│     │   │   ...                                                      │
│     │   │                                                            │
│     │   ├── SSE: { type: "done", fullText: "Based on..." }           │
│     │   └── addToMemory(sessionId, userMsg, aiMsg)                   │
│     │                                                                │
│     ▼                                                                │
│  [useChat.js] SSE event handler                                      │
│     ├── token → append to AI message content (typing effect)         │
│     ├── tool_end → store data on message.toolData[]                  │
│     ├── done → set final text, clear statuses                        │
│     │                                                                │
│     ▼                                                                │
│  [ChatMessage.js] renders AI message                                 │
│     ├── ReactMarkdown renders text (tables, bold, emojis)            │
│     └── ChartRenderer checks toolData → renders chart                │
│                                                                      │
│  👤 User sees: text response + interactive chart                      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 7. Known Issues & Debug Guide

### ⚠️ Issue #1: DATE RANGE MISMATCH (ROOT CAUSE OF MOST BUGS)

```
PROBLEM:
  Sales data: Nov 7, 2022 → Nov 30, 2024
  Today:      Mar 8, 2026
  Gap:        15+ months with NO data

AFFECTED TOOLS:
  - calculate_profit(days=30) → queries Feb-Mar 2026 → $0 revenue
  - get_sales_analytics(days=30) → same issue → empty results
  - check_inventory → shows Nov 2024 snapshot as "current"

NOT AFFECTED:
  - forecast_demand → Prophet was TRAINED on 2022-2024 data,
    predicts FUTURE dates correctly (model knows patterns)
  - get_upcoming_festivals → fetches live from Nager API

FIX OPTIONS:
  (a) Change tools to query relative to MAX date in DB
      (e.g., "last 30 days" = last 30 days of ACTUAL data)
  (b) Re-seed database with data through 2026
  (c) Add date offset: today_for_queries = max(sales.date)
```

### ⚠️ Issue #2: Groq Token Limits

```
PROBLEM:
  llama-3.3-70b-versatile: 100K tokens/day (exhausted quickly)
  llama-3.1-8b-instant: 500K tokens/day (current model)

SYMPTOM: 429 Too Many Requests

The 8B model is less capable but has 5× more daily tokens.
Tool result JSONs are LARGE (thousands of tokens each),
which burns through quota fast.
```

### ⚠️ Issue #3: Duplicate Tool Calls

```
PROBLEM:
  Llama 3.1 8B sometimes calls the same tool repeatedly
  instead of using the result to generate a text answer.

CURRENT FIX:
  Duplicate signature detection in agent.js.
  If same tool+args called twice → force text response
  via llm.invoke() without tools bound.
```

### 🔍 Debug Commands

```bash
# Check if ML Service is running
curl http://localhost:8000/health

# Check if Frontend is running
curl http://localhost:3000

# Test a specific MCP tool (via chat endpoint)
curl -s -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"Check all inventory","sessionId":"debug-1"}' \
  --max-time 60

# Check MongoDB data date range
# (via ML service or mongo shell)
curl http://localhost:8000/model/status

# View server logs
tail -f /tmp/next-server.log

# Test ML Service directly
curl "http://localhost:8000/forecast/Burgers?days=7"
curl "http://localhost:8000/profit/Burgers?days=7"
```

---

## 📁 File Reference

| File | Purpose |
|------|---------|
| `mcp-server/src/index.js` | MCP Server entry point, tool registration |
| `mcp-server/src/tools/forecast.js` | forecast_demand tool (calls ML Service) |
| `mcp-server/src/tools/inventory.js` | check_inventory tool (queries MongoDB) |
| `mcp-server/src/tools/profit.js` | calculate_profit tool (queries MongoDB) |
| `mcp-server/src/tools/analytics.js` | get_sales_analytics tool (queries MongoDB) |
| `mcp-server/src/tools/festivals.js` | get_upcoming_festivals tool (Nager API) |
| `mcp-server/src/utils/mongodb.js` | MongoDB connection (Node.js) |
| `mcp-server/src/models/*.js` | Mongoose schemas (Sale, Product, Inventory, Festival) |
| `mcp-server/src/scripts/seed.js` | Database seeder |
| `ml-service/app/main.py` | FastAPI entry, trains models on startup |
| `ml-service/app/database.py` | MongoDB connection (Python) |
| `ml-service/app/services/data_preprocessor.py` | Data loading + feature engineering |
| `ml-service/app/services/demand_forecaster.py` | Prophet training + prediction |
| `ml-service/app/services/festival_spike_analyzer.py` | Festival impact analysis |
| `ml-service/app/services/profit_projector.py` | Profit projection from forecasts |
| `ml-service/app/routers/forecast_router.py` | /forecast/ endpoints |
| `ml-service/app/routers/profit_router.py` | /profit/ endpoints |
| `frontend/lib/mcp-client.js` | Spawns MCP Server, discovers tools |
| `frontend/lib/agent.js` | LLM config + agent loop + streaming |
| `frontend/lib/prompts.js` | System prompt (ChefBot persona) |
| `frontend/lib/memory.js` | In-memory chat history |
| `frontend/app/api/chat/stream/route.js` | SSE streaming endpoint |
| `frontend/hooks/useChat.js` | Chat state + SSE event handling |
| `frontend/components/ChatWindow.js` | Main chat assembly |
| `frontend/components/ChatMessage.js` | Chat bubble rendering |
| `frontend/components/ChartRenderer.js` | Auto chart generation |
| `.env` | MongoDB URI, API keys (root) |
| `frontend/.env.local` | GROQ_API_KEY |
