#!/usr/bin/env python3
"""Simulate exactly what ChartRenderer.parseCreateChart does with the captured SSE data"""
import json

# The exact data from our trace
create_chart_data = '{"_chart_instruction":true,"source_tool":"calculate_profit","chart_type":"bar","title":"💰 Profit by Product","x_field":"product","y_field":"gross_profit","y_label":"Value","data_path":"product_breakdown"}'

calculate_profit_data = '{"period":"Last 30 days","product_filter":"all","totals":{"revenue":590366.21,"cost_of_goods":205956.79,"gross_profit":384409.43,"units_sold":91671.38,"orders":155,"overall_margin_percent":65.1},"insights":{"highest_margin_product":"Beverages (83.1%)","lowest_margin_product":"Burgers (57.7%)","most_profitable_product":"Burgers ($168944.59)","tip":"Great margins!"},"product_breakdown":[{"product":"Burgers","category":"main","revenue":293002.7,"cost_of_goods":124058.11,"gross_profit":168944.59,"margin_percent":57.7,"units_sold":22556.02,"orders":31,"avg_selling_price":12.99,"cost_per_unit":5.5,"profit_per_unit":7.49},{"product":"Chicken Sandwiches","category":"main","revenue":90186,"cost_of_goods":36255.68,"gross_profit":53930.32,"margin_percent":59.8,"units_sold":9063.92,"orders":31,"avg_selling_price":9.95,"cost_per_unit":4,"profit_per_unit":5.95},{"product":"Fries","category":"side","revenue":88872.15,"cost_of_goods":20371.84,"gross_profit":68500.31,"margin_percent":77.1,"units_sold":25464.8,"orders":31,"avg_selling_price":3.49,"cost_per_unit":0.8,"profit_per_unit":2.69},{"product":"Beverages","category":"drink","revenue":78495.99,"cost_of_goods":13304.41,"gross_profit":65191.58,"margin_percent":83.1,"units_sold":26608.81,"orders":31,"avg_selling_price":2.95,"cost_per_unit":0.5,"profit_per_unit":2.45},{"product":"Sides & Other","category":"side","revenue":39809.37,"cost_of_goods":11966.75,"gross_profit":27842.63,"margin_percent":69.9,"units_sold":7977.83,"orders":31,"avg_selling_price":4.99,"cost_per_unit":1.5,"profit_per_unit":3.49}]}'

# This is what toolData looks like in React state
toolData = [
    {"tool": "calculate_profit", "data": calculate_profit_data},
    {"tool": "create_chart", "data": create_chart_data},
]

print("=== Simulating parseCreateChart ===\n")

# Step 1: Parse the chart instruction
config = json.loads(create_chart_data)
print(f"1. Chart config parsed: _chart_instruction={config.get('_chart_instruction')}, source_tool={config.get('source_tool')}")

# Check: does it pass the guard?
if not config.get("_chart_instruction") and not config.get("source_tool"):
    print("   ❌ FAILED: guard check returned null!")
else:
    print("   ✅ Guard check passed")

source_tool = config["source_tool"]
chart_type = config["chart_type"]
title = config["title"]
x_field = config["x_field"]
y_field = config["y_field"]
y_label = config.get("y_label")
data_path = config.get("data_path")

# Step 2: Find source tool data
sourceEntry = None
for td in toolData:
    if td["tool"] == source_tool:
        sourceEntry = td
        break

if not sourceEntry:
    print(f"2. ❌ Source tool '{source_tool}' NOT FOUND in toolData!")
else:
    print(f"2. ✅ Source tool '{source_tool}' found in toolData")

# Step 3: Parse source data
sourceData = json.loads(sourceEntry["data"]) if isinstance(sourceEntry["data"], str) else sourceEntry["data"]
print(f"3. Source data keys: {list(sourceData.keys())}")

# Step 4: Follow data_path
dataArray = None
if data_path:
    parts = data_path.split(".")
    temp = sourceData
    for key in parts:
        if isinstance(temp, dict) and key in temp:
            temp = temp[key]
        else:
            temp = None
            break
    dataArray = temp
    print(f"4. data_path='{data_path}', result type={type(dataArray).__name__}, is_list={isinstance(dataArray, list)}")
    if isinstance(dataArray, list):
        print(f"   ✅ Found {len(dataArray)} items")
    else:
        print(f"   ❌ data_path didn't resolve to an array!")

# Step 5: Map fields
if isinstance(dataArray, list) and len(dataArray) > 0:
    is_time_series = chart_type == "line"
    chartData = []
    for item in dataArray[:5]:
        yVal = item.get(y_field, 0)
        if is_time_series:
            xVal = str(item.get(x_field, ""))
            chartData.append({"date": xVal[5:] if len(xVal) > 5 else xVal, "value": round(yVal)})
        else:
            chartData.append({"name": str(item.get(x_field, "Unknown")), "value": round(yVal)})
    
    print(f"\n5. ✅ Chart data generated ({len(chartData)} points):")
    for point in chartData:
        print(f"   {point}")
    
    result = {"type": chart_type, "title": title, "data": chartData, "valueLabel": y_label or "Value"}
    print(f"\n6. ✅ FINAL CHART CONFIG:")
    print(f"   type: {result['type']}")
    print(f"   title: {result['title']}")
    print(f"   data points: {len(result['data'])}")
    print(f"   valueLabel: {result['valueLabel']}")
else:
    print(f"\n5. ❌ No data array to chart!")
