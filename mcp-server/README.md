---
title: restaurant-mcp-server
emoji: "🍔"
colorFrom: orange
colorTo: blue
sdk: docker
app_port: 7860
---

# Restaurant MCP Server (HTTP + STDIO)

This Space runs the MCP server with an HTTP bridge so your frontend can call tools remotely.

## Endpoints
- `GET /health`
- `GET /tools`
- `POST /tool/:name`

## Required Secrets
Set these in the Space **Secrets**:
- `MONGODB_URI`

## Optional Secrets
- `REDIS_URL` (enables shared cache)
- `ML_SERVICE_URL` (points to the ML service Space URL)

## Example
```
POST /tool/forecast_demand
{
  "product": "Burgers",
  "days_ahead": 7
}
```
