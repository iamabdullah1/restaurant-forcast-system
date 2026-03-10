/**
 * 📊 Tool #6: create_chart
 * ═════════════════════════
 *
 * 🎓 THE HYBRID REFERENCE APPROACH:
 *    This is a SIGNALING tool, not a data-processing tool.
 *
 *    The problem:
 *    ┌──────────────────────────────────────────────────────────┐
 *    │ The auto-chart system (ChartRenderer parsers) tries to   │
 *    │ automatically detect chart types from tool output.       │
 *    │ But it often fails — wrong structure, missing fields,    │
 *    │ or the parser just doesn't match the data format.        │
 *    │                                                          │
 *    │ But the LLM is SMART — it knows:                         │
 *    │   - What data the tool returned                          │
 *    │   - What chart type fits best (line for trends,          │
 *    │     bar for comparisons, pie for distributions)          │
 *    │   - What fields to use for axes                          │
 *    └──────────────────────────────────────────────────────────┘
 *
 *    The solution: LET THE LLM DECIDE, but DON'T make it re-send data.
 *
 *    ┌──────────────────────────────────────────────────────────┐
 *    │ FLOW:                                                    │
 *    │                                                          │
 *    │ 1. LLM calls forecast_demand → data returned             │
 *    │    (frontend captures raw data via "tool_end" SSE event) │
 *    │                                                          │
 *    │ 2. LLM sees the data, decides a chart would help         │
 *    │                                                          │
 *    │ 3. LLM calls create_chart with INSTRUCTIONS:             │
 *    │    {                                                      │
 *    │      source_tool: "forecast_demand",   ← which data      │
 *    │      chart_type: "line",               ← which chart     │
 *    │      title: "Burger Forecast",         ← label           │
 *    │      x_field: "date",                  ← x-axis field    │
 *    │      y_field: "predicted_quantity",     ← y-axis field    │
 *    │      y_label: "Units"                  ← y-axis label    │
 *    │    }                                                      │
 *    │                                                          │
 *    │ 4. Frontend receives this as another "tool_end" event    │
 *    │    ChartRenderer sees "create_chart" in toolData         │
 *    │    It finds the forecast_demand data (already stored!)   │
 *    │    It renders using the LLM's field mapping              │
 *    └──────────────────────────────────────────────────────────┘
 *
 * 🎓 WHY NOT PASS DATA THROUGH THE LLM?
 *    LLMs don't "carry" data like a truck. They READ it, then
 *    RE-WRITE it from memory. This causes:
 *    - Token waste (data gets generated twice)
 *    - Truncation (LLM might skip rows to save tokens)
 *    - Mutation (numbers might get rounded or changed)
 *
 *    By passing ONLY field names (~6 strings), we keep it cheap
 *    and accurate. The actual data never leaves the frontend.
 *
 * 🎓 WHAT THIS TOOL ACTUALLY DOES:
 *    Almost nothing! It just validates the chart config and
 *    echoes it back. The REAL rendering happens on the frontend.
 *    This tool is essentially a "message in a bottle" that the
 *    LLM sends to the frontend's ChartRenderer.
 */

// ─── HANDLER ─────────────────────────────────────────────
/**
 * @param {object} args - Chart configuration from the LLM
 * @param {string} args.source_tool - Which tool's data to chart
 * @param {string} args.chart_type - "line", "bar", or "pie"
 * @param {string} args.title - Chart title
 * @param {string} args.x_field - Field name for x-axis (e.g., "date", "product")
 * @param {string} args.y_field - Field name for y-axis (e.g., "predicted_quantity", "revenue")
 * @param {string} [args.y_label] - Display label for y-axis
 * @param {string} [args.data_path] - Dot-notation path to the array in tool output
 *                                     e.g., "daily_forecast", "product_breakdown", "data"
 */
export async function handleCreateChart({ source_tool, chart_type, title, x_field, y_field, y_label, data_path }) {
  /**
   * 🎓 VALIDATION:
   *    We do basic validation here, but the REAL work happens
   *    on the frontend. This handler is a passthrough that:
   *    1. Confirms the chart config is valid
   *    2. Returns it as JSON (which gets sent via SSE "tool_end")
   *    3. ChartRenderer on the frontend reads this config
   *       and pairs it with the already-captured tool data
   */

  const validTools = [
    "forecast_demand",
    "check_inventory",
    "calculate_profit",
    "get_sales_analytics",
    "get_upcoming_festivals",
  ];

  if (!validTools.includes(source_tool)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Unknown source tool: ${source_tool}. Valid tools: ${validTools.join(", ")}`,
          }),
        },
      ],
    };
  }

  // Build the chart instruction (this is what ChartRenderer reads)
  const chartConfig = {
    _chart_instruction: true,  // Flag so ChartRenderer knows this is a chart command
    source_tool,
    chart_type,
    title: title || `📊 Chart`,
    x_field,
    y_field,
    y_label: y_label || "Value",
    data_path: data_path || null,  // Optional: where the array lives in the source data
  };

  console.error(`[create_chart] LLM requested: ${chart_type} chart from ${source_tool} (x=${x_field}, y=${y_field})`);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(chartConfig),
      },
    ],
  };
}
