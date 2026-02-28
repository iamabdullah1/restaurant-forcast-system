# 🍔 Restaurant Forecast — Inventory Management & Profit Margins

## 📌 Final Decisions

| Decision | Choice |
|----------|--------|
| Scope | Single branch restaurant |
| Database | **MongoDB** (Atlas) |
| AI Layer | **Both** — Chatbot in dashboard + MCP Server |
| Festivals | **Auto-fetch** via MCP tool (public holidays API — Thanksgiving, Christmas, July 4th, etc.) |
| Auth | None (portfolio project) |
| Deployment | Yes, with CI/CD |
| Frontend | Next.js (React, JavaScript) |
| Backend | Next.js API Routes + Python FastAPI (ML service) |
| ML Model | Facebook Prophet (time-series forecasting) |

---

## 🏗️ System Architecture (MCP-Centric)

```
┌──────────────────────────────────────────────────────────────────────┐
│                    NEXT.JS FRONTEND (React)                         │
│  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌───────────┐             │
│  │Dashboard │  │Inventory │  │Forecast│  │ AI Chat   │             │
│  │Overview  │  │Alerts    │  │& Profit│  │ Window    │             │
│  └──────────┘  └──────────┘  └────────┘  └─────┬─────┘             │
└────────────────────┬───────────────────────────┼────────────────────┘
                     │                           │
┌────────────────────▼──────────┐  ┌─────────────▼──────────────────┐
│  NEXT.JS API ROUTES           │  │  /api/chat                    │
│  /api/sales  /api/inventory   │  │  LangChain (Orchestrator Only)│
│  /api/forecast  /api/dashboard│  │  • System prompt              │
│                               │  │  • Chat memory                │
│  (Thin proxy — calls MCP      │  │  • LLM decision loop          │
│   Server for all data)        │  │  • MCP Client inside          │
└────────────────┬──────────────┘  └─────────────┬─────────────────┘
                 │                               │
                 └───────────────┬────────────────┘
                                 │
          ┌──────────────────────▼──────────────────────┐
          │                                             │
          │          🧠 MCP SERVER (Node.js)             │
          │        ★ SINGLE SOURCE OF TRUTH ★           │
          │                                             │
          │  ┌────────────────────────────────────────┐ │
          │  │  TOOLS (defined ONCE, used by ALL):    │ │
          │  │  1. forecast_demand                    │ │
          │  │  2. check_inventory                    │ │
          │  │  3. calculate_profit                   │ │
          │  │  4. get_upcoming_festivals             │ │
          │  │  5. get_sales_analytics                │ │
          │  └──────────┬─────────────────────────────┘ │
          │             │                               │
          │  ┌──────────▼─────────────────────────────┐ │
          │  │  RESOURCES (read-only data):            │ │
          │  │  • inventory://current                  │ │
          │  │  • sales://today                        │ │
          │  │  • festivals://upcoming                 │ │
          │  └────────────────────────────────────────┘ │
          │             │                               │
          └─────────────┼───────────────────────────────┘
                        │
          ┌─────────────┼─────────────────┐
          │             │                 │
   ┌──────▼──────┐ ┌────▼─────┐ ┌─────────▼────────┐
   │  MongoDB    │ │ Python   │ │ 🌐 Nager.Date    │
   │  (Atlas)    │ │ ML Svc   │ │ API (festivals)  │
   │             │ │ (FastAPI)│ │                  │
   │ • sales     │ │ • Prophet│ └──────────────────┘
   │ • inventory │ │ • Train  │
   │ • products  │ │ • Predict│
   │ • festivals │ └──────────┘
   └─────────────┘

  Also connects from:
  ┌──────────────┐  ┌──────────┐  ┌──────────┐
  │Claude Desktop│  │ Cursor   │  │ Any MCP  │
  │  (MCP Client)│  │(MCP Cli) │  │ Client   │
  └──────────────┘  └──────────┘  └──────────┘
```

---

## 📊 Data Summary (Source: Kaggle CSV)

- **254 records** | Date range: **Nov 7 – Dec 29, 2022** (~2 months)
- **5 Products:** Burgers, Chicken Sandwiches, Fries, Beverages, Sides & Other
- **3 Channels:** In-store, Drive-thru, Online
- **Columns Used:** Order ID, Date, Product, Price, Quantity, Purchase Type, Payment Method
- **Removed Columns:** City, Manager (single branch — not needed)

---

## 💰 Product Cost & Margin Table

| Product | Sell Price | COGS (Cost) | Profit/Unit | Margin % |
|---------|-----------|-------------|-------------|----------|
| Burgers | $12.99 | $5.50 | $7.49 | **57%** |
| Chicken Sandwiches | $9.95 | $4.00 | $5.95 | **60%** |
| Fries | $3.49 | $0.80 | $2.69 | **77%** |
| Beverages | $2.95 | $0.50 | $2.45 | **83%** |
| Sides & Other | $4.99 | $1.50 | $3.49 | **70%** |

---

## 🔵 MACRO PLAN (6 Phases) — Heart-First Approach

| Phase | Name | What It Delivers | Why This Order |
|-------|------|-----------------|----------------|
| **0** | Data Engineering & Setup | Clean/synthetic dataset (2 years), MongoDB seeded, project scaffold | Foundation — everything needs data |
| **1** | 🧠 MCP Server (THE HEART) | MCP Server with 5 tools — inventory, forecast, profit, festivals, analytics | **Build the core first.** If this works, everything else is just plugins |
| **2** | ML Forecasting Service | Python FastAPI with Prophet models — demand forecast, profit projections | MCP's forecast tool needs this engine behind it |
| **3** | LangChain Chat Layer | LangChain orchestrator as MCP Client + chat memory + system prompt | Plugs INTO the heart — adds chatbot capability |
| **4** | Backend API + Frontend | Next.js API routes (thin proxies to MCP) + Full React dashboard UI | Plugs INTO the heart — adds visual layer |
| **5** | Integration & Deploy | Docker, CI/CD (GitHub Actions), deploy to Vercel + Railway | Ship it |

---

## 🔬 MICRO PLAN (Every Step) — Heart-First Order

### Phase 0 — Data Engineering & Setup

| Step | Task | Details |
|------|------|---------|
| 0.1 | **Project scaffold** | Create monorepo: `/mcp-server` (Node.js), `/ml-service` (Python FastAPI), `/frontend` (Next.js) |
| 0.2 | **Clean existing CSV** | Remove City/Manager columns, fix whitespace, standardize dates to `YYYY-MM-DD` |
| 0.3 | **Generate 2-year synthetic data** | Python script to generate realistic sales data (Nov 2022 → Nov 2024) with seasonal patterns, weekend spikes, festival spikes, realistic quantity ranges |
| 0.4 | **Define product cost table** | Assign COGS per product (see table above) |
| 0.5 | **Define inventory thresholds** | Min stock levels per product (e.g., Burgers: min 200 units/week) |
| 0.6 | **Set up MongoDB Atlas** | Create cluster, define schemas (Sales, Products, Inventory, Festivals) |
| 0.7 | **Seed database** | Script to load cleaned CSV + synthetic data into MongoDB |

### Phase 1 — 🧠 MCP Server (THE HEART)

| Step | Task | Details |
|------|------|---------|
| 1.1 | **MCP Server scaffold** | Node.js + JavaScript + `@modelcontextprotocol/sdk` + Mongoose |
| 1.2 | **MongoDB connection util** | Shared DB connection used by all tools |
| 1.3 | **Tool #4: get_upcoming_festivals** | Nager.Date API + MongoDB cache — easiest tool, gets us running fast |
| 1.4 | **Tool #2: check_inventory** | Query MongoDB inventory + calculate status (🟢🟡🔴) + days until stockout |
| 1.5 | **Tool #5: get_sales_analytics** | MongoDB aggregation pipelines — sales trends, patterns, insights |
| 1.6 | **Tool #3: calculate_profit** | Revenue - COGS per product, margin calculations |
| 1.7 | **Tool #1: forecast_demand** | HTTP client to Python ML Service (stub/mock at first, real after Phase 2) |
| 1.8 | **MCP Resources** | Read-only: `inventory://current`, `sales://today`, `festivals://upcoming` |
| 1.9 | **MCP Prompts** | Templates: `daily-briefing`, `festival-prep`, `weekly-review` |
| 1.10 | **Test with Claude Desktop** | Connect MCP Server locally → verify all 5 tools work via Claude Desktop |

### Phase 2 — ML Forecasting Service (Python)

| Step | Task | Details |
|------|------|---------|
| 2.1 | **FastAPI project setup** | Python env, FastAPI, Prophet, pandas, scikit-learn |
| 2.2 | **Data preprocessing pipeline** | Load from MongoDB, aggregate daily sales per product, handle missing days, feature engineering (day-of-week, month, is_weekend, is_festival) |
| 2.3 | **Demand forecasting model** | Facebook Prophet model per product — train on historical, predict next 30/60/90 days |
| 2.4 | **Festival spike multiplier** | Historical analysis: how much did sales spike during past festivals? Apply multiplier to base forecast |
| 2.5 | **Profit projection engine** | Forecasted quantity × (Price - COGS) per product per day |
| 2.6 | **API endpoints** | `GET /forecast/{product}`, `GET /inventory-status`, `GET /profit-projection` |
| 2.7 | **Connect MCP Tool #1** | Replace forecast_demand stub with real ML Service calls — now all 5 MCP tools are fully live |

### Phase 3 — LangChain Chat Layer (Plugs Into The Heart)

| Step | Task | Details |
|------|------|---------|
| 3.1 | **LangChain as MCP Client** | LangChain.js connects to MCP Server, discovers tools automatically |
| 3.2 | **System prompt** | "You are a restaurant inventory assistant..." with personality and rules |
| 3.3 | **Chat memory** | BufferMemory for conversation context (in-session) |
| 3.4 | **Agent executor** | LLM decides → tool_call → LangChain forwards to MCP → MCP executes → loop |
| 3.5 | **Chat API endpoint** | `POST /api/chat` in Next.js — receives message, runs agent, returns response |
| 3.6 | **Streaming** | SSE streaming for typing effect in chat UI |

### Phase 4 — Backend API + Frontend Dashboard (Plugins)

| Step | Task | Details |
|------|------|---------|
| 4.1 | **Next.js project init** | JavaScript, App Router, Tailwind CSS, shadcn/ui |
| 4.2 | **API routes as thin proxies** | `/api/sales`, `/api/inventory`, `/api/forecast`, `/api/dashboard` — all just call MCP Server tools |
| 4.3 | **Layout & navigation** | Sidebar: Dashboard, Inventory, Forecasts, Profit, Chat. Top bar: restaurant name, date |
| 4.4 | **Dashboard overview page** | KPI cards + Revenue trend chart (Recharts) + Top selling product donut chart |
| 4.5 | **Inventory management page** | Table with status indicators (🟢🟡🔴), days until stockout, restock button |
| 4.6 | **Forecast page** | Line chart: predicted demand per product. Festival markers on chart |
| 4.7 | **Profit analysis page** | Bar chart: profit per product. Margin table. Trend lines |
| 4.8 | **AI Chat window** | Floating chat button → chat panel. Markdown rendering. Streaming responses |
| 4.9 | **Festival calendar view** | Calendar component showing upcoming festivals + demand impact |

### Phase 5 — Integration & Deployment

| Step | Task | Details |
|------|------|---------|
| 5.1 | **End-to-end testing** | Test full flow: data → MCP → forecast → alert → chat question |
| 5.2 | **Docker setup** | Dockerfile for Next.js, Python ML service, MCP Server. docker-compose.yml |
| 5.3 | **CI/CD pipeline** | GitHub Actions: lint → test → build → deploy on push to main |
| 5.4 | **Deploy MCP Server** | Railway — the heart must be live first |
| 5.5 | **Deploy ML service** | Railway or Render (free tier) — Python FastAPI |
| 5.6 | **Deploy frontend** | Vercel (free tier) — Next.js |
| 5.7 | **Claude Desktop config** | Published MCP Server URL for external AI clients |
| 5.8 | **README & portfolio docs** | Architecture diagram, setup instructions, screenshots, demo video link |

---

## 📁 Final Folder Structure

```
restaurant-forecast/
├── mcp-server/                # ★ THE BRAIN — Single Source of Truth
│   ├── src/
│   │   ├── index.js           # MCP Server entry — registers all tools
│   │   ├── tools/
│   │   │   ├── forecast.js    # Calls Python ML Service
│   │   │   ├── inventory.js   # Queries MongoDB inventory
│   │   │   ├── profit.js      # Calculates margins from MongoDB
│   │   │   ├── festivals.js   # Calls Nager.Date API + MongoDB cache
│   │   │   └── analytics.js   # Runs MongoDB aggregation pipelines
│   │   ├── resources/         # MCP Resources (read-only data)
│   │   ├── prompts/           # MCP Prompt templates
│   │   └── utils/
│   │       ├── mongodb.js     # DB connection (used by all tools)
│   │       ├── ml-client.js   # HTTP client for Python ML service
│   │       └── nager-client.js# HTTP client for festival API
│   ├── package.json
│   └── jsconfig.json
│
├── frontend/                  # Next.js App
│   ├── app/
│   │   ├── page.jsx           # Dashboard
│   │   ├── inventory/
│   │   ├── forecast/
│   │   ├── profit/
│   │   ├── api/
│   │   │   ├── sales/         # Thin proxy → MCP Server
│   │   │   ├── inventory/     # Thin proxy → MCP Server
│   │   │   ├── forecast/      # Thin proxy → MCP Server
│   │   │   ├── chat/          # LangChain orchestrator → MCP Client
│   │   │   └── dashboard/     # Aggregates multiple MCP tool calls
│   │   └── layout.jsx
│   ├── components/
│   ├── lib/
│   │   ├── mcp-client.js      # MCP Client — connects to MCP Server
│   │   └── langchain.js       # LangChain agent (orchestrator + memory ONLY)
│   └── package.json
│
├── ml-service/                # Python FastAPI
│   ├── app/
│   │   ├── main.py
│   │   ├── models/
│   │   │   ├── forecaster.py
│   │   │   └── profit.py
│   │   ├── routers/
│   │   └── utils/
│   ├── data/
│   │   └── sales_cleaned.csv
│   ├── scripts/
│   │   ├── generate_synthetic_data.py
│   │   └── seed_mongodb.py
│   └── requirements.txt
│
├── docker-compose.yml
├── .github/workflows/ci.yml
└── README.md
```

---

## 🚦 Build Order — Heart First

```
  Phase 0: DATA           → Prepare the fuel
      │
      ▼
  Phase 1: MCP SERVER     → ★ Build the HEART ★
      │
      ├──▶ Phase 2: ML SERVICE    → Plug in the forecasting engine
      │
      ├──▶ Phase 3: LANGCHAIN     → Plug in the chatbot brain
      │
      └──▶ Phase 4: API + UI      → Plug in the visual layer
              │
              ▼
        Phase 5: DEPLOY       → Ship it
```

> **Logic:** If the heart (MCP Server) works and returns correct data,
> everything else is just a client that plugs into it.
> Backend API? Thin proxy to MCP. Frontend? Displays MCP data.
> Chatbot? LangChain forwards to MCP. All plugins.

---

## 🛠️ Tech Stack Summary

| Layer | Technology | Role |
|-------|-----------|------|
| Frontend | Next.js 14+, React, JavaScript, Tailwind CSS, Recharts, shadcn/ui | UI + thin API proxy |
| MCP Server | Node.js, @modelcontextprotocol/sdk | ★ **Single tool layer** — ALL tools defined here |
| LangChain | LangChain.js + MCP Client SDK | Orchestrator only — memory, system prompt, LLM loop. Connects TO MCP Server |
| LLM | Grok (xAI) API | Decision-making brain — picks tools, synthesizes responses |
| Database | MongoDB Atlas + Mongoose ODM | Data persistence |
| ML Service | Python, FastAPI, Facebook Prophet, pandas, scikit-learn | Forecasting engine (called by MCP tools) |
| Festival API | Nager.Date (https://date.nager.at/) | Public holiday data (called by MCP tools) |
| Containerization | Docker, docker-compose | Local dev + deployment |
| CI/CD | GitHub Actions | Automated pipeline |
| Deployment | Vercel (frontend), Railway (ML + MCP) | Hosting |
