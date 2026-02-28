# 📦 products.json — Explained
 
This file is the **single source of truth** for all product configuration.
Since JSON doesn't support comments, here's a breakdown of every field.

## Structure

```
products.json
├── products              → Each product's config
│   ├── sellPrice         → What we charge the customer ($12.99 for Burgers)
│   ├── costPrice         → What ingredients cost us ($5.50 for Burgers)  
│   ├── profitPerUnit     → sellPrice - costPrice ($7.49 for Burgers)
│   ├── marginPercent     → (profitPerUnit / sellPrice) × 100 (57% for Burgers)
│   ├── category          → "main" | "side" | "drink" (for grouping in reports)
│   └── inventory
│       ├── unit          → "units" (what we count in)
│       ├── minStockDaily → 🔴 DANGER ZONE — below this = RED alert
│       ├── reorderPoint  → 🟡 WARNING — below this = YELLOW, order NOW
│       ├── maxStockDaily → 🟢 Full capacity after restocking
│       └── leadTimeDays  → How many days until supplier delivers
│
├── statusThresholds      → Rules for traffic light colors
│   ├── green             → stock >= reorderPoint (comfortable)
│   ├── yellow            → minStockDaily <= stock < reorderPoint (order soon)
│   └── red               → stock < minStockDaily (DANGER!)
│
└── restaurantInfo        → Basic restaurant metadata
    ├── name              → "Forecast Bites" (our restaurant name)
    ├── branch            → "Main Branch" (single branch project)
    ├── country           → "PK" (Pakistan — for Nager.Date festival API)
    ├── currency          → "USD" (all prices in US dollars)
    └── timezone          → "Asia/Karachi" (Pakistan Standard Time)
```

## Inventory Thresholds — Visual Example (Burgers)

```
Stock Level
1200 ─── maxStockDaily ─── 🟢 Full after restock
 ...
 500 ─── reorderPoint ──── 🟡 Time to call the supplier!
 ...
 400 ─── minStockDaily ─── 🔴 DANGER! Might run out today!
 ...
   0 ─── OUT OF STOCK ──── 😱 Lost sales, angry customers
```

## How Inventory Status Works in the App

The MCP tool `check_inventory` queries the latest inventory record 
for each product and returns status using these thresholds:

```
if (stock >= reorderPoint)           → 🟢 GREEN  → "We're good"
if (stock >= minStock && < reorder)  → 🟡 YELLOW → "Order soon"  
if (stock < minStock)                → 🔴 RED    → "Critical! Restock NOW"
```

## Why These Specific Numbers?

| Product | Min | Reorder | Max | Logic |
|---------|-----|---------|-----|-------|
| Burgers | 400 | 500 | 1200 | High seller (~558/day avg), need big buffer |
| Chicken Sandwiches | 150 | 200 | 500 | Lower volume (~214/day avg) |
| Fries | 450 | 550 | 1400 | Very high seller (~628/day avg) |
| Beverages | 500 | 600 | 1500 | Highest seller (~700/day avg) |
| Sides & Other | 150 | 200 | 500 | Lowest seller (~200/day avg) |

The min/reorder/max are set relative to average daily sales:
- **minStockDaily** ≈ 70-75% of average daily sales
- **reorderPoint** ≈ 85-90% of average daily sales  
- **maxStockDaily** ≈ 200% of average daily sales (2 days' worth)
