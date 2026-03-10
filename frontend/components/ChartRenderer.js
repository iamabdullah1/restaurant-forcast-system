/**
 * 📊 ChartRenderer — Visualize MCP Tool Data in Chat
 * ═══════════════════════════════════════════════════════════
 *
 * 🎓 WHAT THIS DOES:
 *    The MCP Server tools return JSON data (sales, forecasts,
 *    profit, inventory). This component:
 *    1. Receives raw tool result data captured during streaming
 *    2. Detects the tool type and data structure
 *    3. Renders the appropriate chart (Bar, Line, Pie)
 *
 * 🎓 HOW IT WORKS:
 *    During SSE streaming, "tool_end" events include tool result data.
 *    The useChat hook stores it as `toolData` on the AI message.
 *    This component reads that data and auto-generates charts.
 *
 *    This is MORE RELIABLE than asking the LLM to output JSON because:
 *    - We get the EXACT data the tool returned
 *    - No dependency on LLM formatting skills
 *    - Works with any model size
 */

"use client";
import React, { useMemo } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// Restaurant-themed color palette
const COLORS = [
  "#f97316", // orange
  "#3b82f6", // blue
  "#22c55e", // green
  "#eab308", // yellow
  "#a855f7", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
];

const tooltipStyle = {
  backgroundColor: "#1a1a2e",
  border: "1px solid #f97316",
  borderRadius: "8px",
  fontSize: "12px",
};

// ─── DATA PARSERS ────────────────────────────────────────
// Each MCP tool returns different JSON. These parsers normalize
// the data into chart-friendly { name, value } or { date, value }.

function parseSalesAnalytics(raw) {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const analysisType = data.analysis_type || "";

    // The actual tool returns { analysis_type, period, data: [...] }
    // where data is the array of results. We need to handle this wrapper.
    const innerData = data.data;

    // trend → Line chart (data is array of { period, revenue, quantity, orders })
    if (analysisType === "trend" && Array.isArray(innerData)) {
      return {
        type: "line",
        title: "📈 Sales Trend",
        data: innerData.map((t) => ({
          date: (t.period || t.date || "").slice(5),
          value: Math.round(t.revenue || t.total_revenue || 0),
        })),
        valueLabel: "Revenue ($)",
      };
    }

    // by_product → Bar chart (data is array of { product, revenue, quantity })
    if (analysisType === "by_product" && Array.isArray(innerData)) {
      return {
        type: "bar",
        title: "📊 Sales by Product",
        data: innerData.map((p) => ({
          name: p.product || p.name || p._id,
          value: Math.round(p.revenue || p.total_revenue || 0),
        })),
        valueLabel: "Revenue ($)",
      };
    }

    // by_channel → Pie chart (data is array of { channel, revenue })
    if (analysisType === "by_channel" && Array.isArray(innerData)) {
      return {
        type: "pie",
        title: "📊 Sales by Channel",
        data: innerData.map((c) => ({
          name: c.channel || c.name || c._id,
          value: Math.round(c.revenue || c.total_revenue || 0),
        })),
      };
    }

    // top_sellers → Bar chart (data is { by_quantity, by_revenue })
    if (analysisType === "top_sellers" && innerData) {
      const sellers = innerData.by_revenue || innerData.by_quantity;
      if (Array.isArray(sellers)) {
        return {
          type: "bar",
          title: "🏆 Top Sellers",
          data: sellers.map((s) => ({
            name: s.product || s.name || s._id,
            value: Math.round(s.revenue || s.total_quantity || 0),
          })),
          valueLabel: "Revenue ($)",
        };
      }
    }

    // overview → Bar chart from overview totals (not very chartable, skip)
    // Fallback: if data is an array of items with product + revenue
    if (Array.isArray(innerData) && innerData.length > 0 && innerData[0].product) {
      return {
        type: "bar",
        title: "📊 Sales by Product",
        data: innerData.map((p) => ({
          name: p.product || p.name,
          value: Math.round(p.revenue || 0),
        })),
        valueLabel: "Revenue ($)",
      };
    }

    return null;
  } catch {
    return null;
  }
}

function parseForecastDemand(raw) {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;

    // Single product: { metadata, summary, daily_forecast: [...] }
    // Each row: { date, day_name, predicted_quantity, confidence_low, confidence_high, ... }
    if (data.daily_forecast && Array.isArray(data.daily_forecast) && data.daily_forecast.length > 0) {
      const productName = data.metadata?.product || data.summary?.product || "All Products";
      return {
        type: "line",
        title: `🔮 Demand Forecast — ${productName}`,
        data: data.daily_forecast.slice(0, 30).map((f) => ({
          date: (f.date || "").slice(5),
          value: Math.round(
            f.predicted_quantity || f.predicted_demand || f.predicted || f.yhat || f.value || 0
          ),
        })),
        valueLabel: "Predicted Units",
      };
    }

    // Multi-product: { products: { "Burgers": { summary, daily_forecast }, ... } }
    if (data.products && typeof data.products === "object" && !Array.isArray(data.products)) {
      return {
        type: "bar",
        title: "🔮 Total Predicted Demand",
        data: Object.entries(data.products).map(([name, info]) => ({
          name,
          value: Math.round(
            typeof info === "object"
              ? info.summary?.total_predicted_quantity || info.total_predicted || info.total || 0
              : info || 0
          ),
        })),
        valueLabel: "Predicted Units",
      };
    }

    // Fallback: check for forecast/predictions arrays
    const forecast = data.forecast || data.predictions;
    if (Array.isArray(forecast) && forecast.length > 0) {
      return {
        type: "line",
        title: `🔮 Demand Forecast`,
        data: forecast.slice(0, 30).map((f) => ({
          date: (f.date || f.ds || "").slice(5),
          value: Math.round(
            f.predicted_quantity || f.predicted_demand || f.predicted || f.yhat || f.value || 0
          ),
        })),
        valueLabel: "Predicted Units",
      };
    }

    return null;
  } catch {
    return null;
  }
}

function parseProfit(raw) {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;

    // Product breakdown bar chart (primary format from calculate_profit tool)
    const products = data.product_breakdown || data.products || data.by_product;
    if (Array.isArray(products) && products.length > 0) {
      return {
        type: "bar",
        title: "💰 Profit by Product",
        data: products.map((p) => ({
          name: p.product || p.name,
          value: Math.round(p.gross_profit || p.profit || 0),
        })),
        valueLabel: "Profit ($)",
      };
    }

    // Trend data (when include_trend=true)
    const trend = data.trend || data.profit_trend;
    if (Array.isArray(trend) && trend.length > 0) {
      return {
        type: "line",
        title: "💰 Profit Trend",
        data: trend.map((t) => ({
          date: (t.date || t.period || "").slice(5),
          value: Math.round(t.profit || t.gross_profit || t.total_profit || 0),
        })),
        valueLabel: "Profit ($)",
      };
    }

    return null;
  } catch {
    return null;
  }
}

function parseInventory(raw) {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;

    if (data.products || data.inventory) {
      const items = data.products || data.inventory;
      if (Array.isArray(items) && items.length > 1) {
        return {
          type: "bar",
          title: "📦 Inventory Levels",
          data: items.map((item) => ({
            name: item.product || item.name,
            value: Math.round(item.stock_level || item.quantity || item.stock || item.in_stock || 0),
          })),
          valueLabel: "Units in Stock",
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Tool name → parser mapping (for auto-chart fallback)
const TOOL_PARSERS = {
  get_sales_analytics: parseSalesAnalytics,
  forecast_demand: parseForecastDemand,
  calculate_profit: parseProfit,
  check_inventory: parseInventory,
};

// ─── LLM-DIRECTED CHART PARSER ──────────────────────────
/**
 * 🎓 parseCreateChart — The Hybrid Reference Approach
 *
 *    When the LLM calls the create_chart tool, it sends INSTRUCTIONS
 *    like: "make a line chart from forecast_demand's data,
 *           use 'date' for x-axis, 'predicted_quantity' for y-axis"
 *
 *    This function:
 *    1. Reads the chart instruction (from create_chart's tool_end data)
 *    2. Finds the SOURCE tool's raw data (already in toolData array)
 *    3. Extracts the data array using data_path
 *    4. Maps x_field/y_field to { date/name, value } pairs
 *    5. Returns chart config that recharts can render
 *
 *    The LLM never re-sends the data — it just says WHAT to chart.
 *    The data is already on the frontend from the earlier tool call.
 *
 * @param {object} chartInstruction - The create_chart tool's output
 * @param {Array} allToolData - All toolData entries on this message
 */
function parseCreateChart(chartInstruction, allToolData) {
  try {
    const config = typeof chartInstruction === "string"
      ? JSON.parse(chartInstruction)
      : chartInstruction;

    // Verify this is actually a chart instruction
    if (!config._chart_instruction && !config.source_tool) return null;

    // ─── Direct data mode: chart data is pre-built ───────
    // Used by auto-chart comparison when we construct data
    // on the backend (e.g., summary totals bar chart)
    if (config._direct_chart && Array.isArray(config.data)) {
      return {
        type: config.chart_type || "bar",
        title: config.title || "📊 Chart",
        data: config.data,
        valueLabel: config.y_label || "Value",
      };
    }

    const { source_tool, chart_type, title, x_field, y_field, y_label, data_path } = config;

    // ─── Step 1: Find the source tool's raw data ─────────
    // The source tool (e.g., forecast_demand) was called earlier
    // in the same message. Its raw output is already in toolData.
    const sourceEntry = allToolData.find((td) => td.tool === source_tool);
    if (!sourceEntry) {
      console.warn(`[ChartRenderer] Source tool "${source_tool}" not found in toolData`);
      return null;
    }

    const sourceData = typeof sourceEntry.data === "string"
      ? JSON.parse(sourceEntry.data)
      : sourceEntry.data;

    // ─── Step 2: Find the data array ─────────────────────
    // The LLM tells us WHERE the array lives via data_path.
    // e.g., "daily_forecast" → sourceData.daily_forecast
    //        "product_breakdown" → sourceData.product_breakdown
    //        "data" → sourceData.data (for sales analytics)
    let dataArray = null;

    if (data_path) {
      // Follow dot-notation path: "foo.bar" → sourceData.foo.bar
      dataArray = data_path.split(".").reduce((obj, key) => obj?.[key], sourceData);
    }

    // If data_path didn't work, try common paths automatically
    if (!Array.isArray(dataArray)) {
      const commonPaths = [
        "daily_forecast", "product_breakdown", "products",
        "data", "forecast", "predictions", "trend",
        "inventory", "by_product", "by_channel",
      ];
      for (const path of commonPaths) {
        if (Array.isArray(sourceData?.[path])) {
          dataArray = sourceData[path];
          break;
        }
      }
    }

    // Last resort: if sourceData itself is an array
    if (!Array.isArray(dataArray) && Array.isArray(sourceData)) {
      dataArray = sourceData;
    }

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      console.warn(`[ChartRenderer] No data array found for "${source_tool}" at path "${data_path}"`);
      return null;
    }

    // ─── Step 3: Map fields to chart-friendly format ─────
    // For line charts: need { date, value }
    // For bar/pie charts: need { name, value }
    const isTimeSeries = chart_type === "line";

    const chartData = dataArray.slice(0, 60).map((item) => {
      const yVal = Number(item[y_field]) || 0;

      if (isTimeSeries) {
        // Line chart: x is a date/time, shorten it for display
        const xVal = String(item[x_field] || "");
        return {
          date: xVal.length > 5 ? xVal.slice(5) : xVal,  // "2024-11-01" → "11-01"
          value: Math.round(yVal),
        };
      } else {
        // Bar/Pie chart: x is a category name
        return {
          name: String(item[x_field] || "Unknown"),
          value: Math.round(yVal),
        };
      }
    });

    return {
      type: chart_type,
      title: title || "📊 Chart",
      data: chartData,
      valueLabel: y_label || "Value",
    };
  } catch (err) {
    console.warn("[ChartRenderer] Failed to parse create_chart instruction:", err);
    return null;
  }
}

/**
 * 🎓 parseMultiSourceChart — Merge data from MULTIPLE tools into ONE chart
 *
 *    When the LLM calls create_chart with a `sources` array instead of
 *    a single `source_tool`, this function merges data from multiple tools
 *    into a single multi-series chart (e.g., two lines on one LineChart).
 *
 *    Example use case:
 *    - "Compare last month's sales with next month's forecast"
 *    - get_sales_analytics returns daily revenue for past 30 days
 *    - forecast_demand returns daily predicted_quantity for next 30 days
 *    - Both get merged into one chart with two lines
 *
 *    The key insight: we normalize both series to use sequential index
 *    labels (Day 1, Day 2, ...) or shortened dates so they align on the
 *    same x-axis even though they cover different date ranges.
 */
function parseMultiSourceChart(chartInstruction, allToolData) {
  try {
    const config = typeof chartInstruction === "string"
      ? JSON.parse(chartInstruction)
      : chartInstruction;

    if (!config.sources || !Array.isArray(config.sources) || config.sources.length < 2) {
      return null;
    }

    const { chart_type, title, sources } = config;
    const seriesData = [];

    // Extract each series
    for (const src of sources) {
      const sourceEntry = allToolData.find((td) => td.tool === src.source_tool);
      if (!sourceEntry) continue;

      const sourceData = typeof sourceEntry.data === "string"
        ? JSON.parse(sourceEntry.data)
        : sourceEntry.data;

      // Find the data array
      let dataArray = null;
      if (src.data_path) {
        dataArray = src.data_path.split(".").reduce((obj, key) => obj?.[key], sourceData);
      }
      if (!Array.isArray(dataArray)) {
        const commonPaths = [
          "daily_forecast", "product_breakdown", "products",
          "data", "forecast", "predictions", "trend",
          "inventory", "by_product", "by_channel",
        ];
        for (const path of commonPaths) {
          if (Array.isArray(sourceData?.[path])) {
            dataArray = sourceData[path];
            break;
          }
        }
      }
      if (!Array.isArray(dataArray) || dataArray.length === 0) continue;

      seriesData.push({
        label: src.label || src.source_tool,
        data: dataArray.slice(0, 60),
        x_field: src.x_field,
        y_field: src.y_field,
      });
    }

    if (seriesData.length < 2) return null;

    // Merge into unified data points
    // Strategy: use the longest series length, index-based alignment
    const maxLen = Math.max(...seriesData.map((s) => s.data.length));
    const mergedData = [];

    for (let i = 0; i < maxLen; i++) {
      const point = {};

      // Use the first series' x-value as the label, or fall back to index
      const firstSeries = seriesData[0];
      if (i < firstSeries.data.length) {
        const xVal = String(firstSeries.data[i][firstSeries.x_field] || "");
        point.date = xVal.length > 5 ? xVal.slice(5) : xVal || `Day ${i + 1}`;
      } else {
        // Past first series length, use second series x-value
        for (const s of seriesData) {
          if (i < s.data.length) {
            const xVal = String(s.data[i][s.x_field] || "");
            point.date = xVal.length > 5 ? xVal.slice(5) : xVal || `Day ${i + 1}`;
            break;
          }
        }
      }
      if (!point.date) point.date = `Day ${i + 1}`;

      // Add each series' y-value
      for (const s of seriesData) {
        if (i < s.data.length) {
          point[s.label] = Math.round(Number(s.data[i][s.y_field]) || 0);
        }
      }

      mergedData.push(point);
    }

    return {
      type: chart_type || "line",
      title: title || "📊 Comparison Chart",
      multiSeries: true,
      seriesLabels: seriesData.map((s) => s.label),
      data: mergedData,
    };
  } catch (err) {
    console.warn("[ChartRenderer] Failed to parse multi-source chart:", err);
    return null;
  }
}

// ─── CHART COMPONENTS ───────────────────────────────────

function LineChartComponent({ data, title, valueLabel, multiSeries, seriesLabels }) {
  return (
    <div className="chart-container">
      <h4 className="chart-title">{title}</h4>
      <ResponsiveContainer width="100%" height={multiSeries ? 320 : 280}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey="date" stroke="#888" tick={{ fill: "#888", fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
          <YAxis stroke="#888" tick={{ fill: "#888", fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          {multiSeries && seriesLabels ? (
            <>
              <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
              {seriesLabels.map((label, i) => (
                <Line key={label} type="monotone" dataKey={label} name={label} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ fill: COLORS[i % COLORS.length], r: 3 }} activeDot={{ r: 5, stroke: "#fff" }} />
              ))}
            </>
          ) : (
            <Line type="monotone" dataKey="value" name={valueLabel || "Value"} stroke="#f97316" strokeWidth={2} dot={{ fill: "#f97316", r: 3 }} activeDot={{ r: 5, stroke: "#fff" }} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BarChartComponent({ data, title, valueLabel, multiSeries, seriesLabels }) {
  return (
    <div className="chart-container">
      <h4 className="chart-title">{title}</h4>
      <ResponsiveContainer width="100%" height={multiSeries ? 320 : 280}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey={multiSeries ? "date" : "name"} stroke="#888" tick={{ fill: "#888", fontSize: 11 }} />
          <YAxis stroke="#888" tick={{ fill: "#888", fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          {multiSeries && seriesLabels ? (
            <>
              <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
              {seriesLabels.map((label, i) => (
                <Bar key={label} dataKey={label} name={label} fill={COLORS[i % COLORS.length]} radius={[8, 8, 0, 0]} />
              ))}
            </>
          ) : (
            <Bar dataKey="value" name={valueLabel || "Value"} radius={[8, 8, 0, 0]}>
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PieChartComponent({ data, title }) {
  return (
    <div className="chart-container">
      <h4 className="chart-title">{title}</h4>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" labelLine={false} label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`} outerRadius={90} dataKey="value">
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────
/**
 * 🎓 TWO CHART SYSTEMS running in parallel:
 *
 *    1. AUTO-CHARTS (legacy) — TOOL_PARSERS map
 *       When forecast_demand/calculate_profit/etc. is called,
 *       the auto-parser tries to detect a chart automatically.
 *       Works for simple cases but often fails on edge cases.
 *
 *    2. LLM-DIRECTED CHARTS (new) — create_chart tool
 *       The LLM explicitly calls create_chart with instructions:
 *       "make a line chart from forecast_demand's date vs predicted_quantity"
 *       More reliable because the LLM SEES the data and CHOOSES the chart.
 *
 *    If the LLM uses create_chart, we use THAT chart and skip
 *    the auto-parser for the source tool (to avoid duplicates).
 */
export default function ChartRenderer({ toolData }) {
  const charts = useMemo(() => {
    console.log("[ChartRenderer] toolData received:", toolData);
    if (!toolData || !Array.isArray(toolData) || toolData.length === 0) {
      console.log("[ChartRenderer] No toolData, returning empty");
      return [];
    }

    console.log("[ChartRenderer] Processing", toolData.length, "tool entries:", toolData.map(t => t.tool));

    const results = [];

    // Track which source tools have LLM-directed charts (to skip auto-chart duplicates)
    const llmChartedTools = new Set();

    // ─── Pass 1: Process LLM-directed create_chart instructions ───
    for (const entry of toolData) {
      if (entry.tool === "create_chart") {
        // Try multi-source chart first (comparison charts)
        const multiChart = parseMultiSourceChart(entry.data, toolData);
        if (multiChart) {
          results.push(multiChart);
          // Mark all source tools as charted
          try {
            const config = typeof entry.data === "string" ? JSON.parse(entry.data) : entry.data;
            for (const src of config.sources || []) {
              if (src.source_tool) llmChartedTools.add(src.source_tool);
            }
          } catch {}
          continue;
        }

        // Fall back to single-source chart
        const chart = parseCreateChart(entry.data, toolData);
        if (chart) {
          results.push(chart);
          try {
            const config = typeof entry.data === "string" ? JSON.parse(entry.data) : entry.data;
            if (config.source_tool) llmChartedTools.add(config.source_tool);
          } catch {}
        }
      }
    }

    // ─── Pass 2: Auto-chart for tools NOT already charted by LLM ───
    for (const entry of toolData) {
      if (entry.tool === "create_chart") continue; // Already handled
      if (llmChartedTools.has(entry.tool)) continue; // LLM made a chart for this

      const parser = TOOL_PARSERS[entry.tool];
      if (parser) {
        const chart = parser(entry.data);
        if (chart) results.push(chart);
      }
    }

    return results;
  }, [toolData]);

  if (!toolData || toolData.length === 0 || charts.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-4">
      {charts.map((chart, index) => {
        switch (chart.type) {
          case "line":
            return <LineChartComponent key={index} data={chart.data} title={chart.title} valueLabel={chart.valueLabel} multiSeries={chart.multiSeries} seriesLabels={chart.seriesLabels} />;
          case "bar":
            return <BarChartComponent key={index} data={chart.data} title={chart.title} valueLabel={chart.valueLabel} multiSeries={chart.multiSeries} seriesLabels={chart.seriesLabels} />;
          case "pie":
            return <PieChartComponent key={index} data={chart.data} title={chart.title} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
