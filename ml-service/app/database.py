"""
🔌 MongoDB Connection for Python ML Service
════════════════════════════════════════════

Connects to the SAME MongoDB Atlas database that the Node.js MCP Server uses.
Both services share the same data — the MCP Server writes/reads sales,
inventory, festivals, and this ML service reads sales data for training.

WHY pymongo INSTEAD OF mongoose?
  Mongoose is a Node.js library. In Python, we use PyMongo — it's the
  official MongoDB driver for Python. Unlike Mongoose, PyMongo doesn't
  have schemas — it gives you raw dictionaries. That's fine because
  we'll convert data into pandas DataFrames for ML processing.
"""

import os
from pymongo import MongoClient

# Will hold the singleton connection
_client = None
_db = None


def get_database():
    """
    Returns the MongoDB database instance (singleton pattern).
    
    Singleton = only ONE connection is created, reused everywhere.
    First call: creates the connection. All subsequent calls: returns the same one.
    
    This is the same pattern as mongodb.js in the MCP Server,
    just written in Python instead of JavaScript.
    """
    global _client, _db

    if _db is not None:
        return _db

    mongo_uri = os.getenv("MONGODB_URI")
    if not mongo_uri:
        raise ValueError("MONGODB_URI not found in environment variables. Check your .env file.")

    # MongoClient handles connection pooling automatically.
    # Unlike mongoose.connect(), PyMongo creates a pool of connections
    # and reuses them. No need for manual connect/disconnect.
    _client = MongoClient(mongo_uri)

    # Extract database name from URI, or default to "restaurant-forecast"
    # URI format: mongodb+srv://user:pass@host/DATABASE_NAME?options
    db_name = mongo_uri.split("/")[-1].split("?")[0] or "restaurant-forecast"
    _db = _client[db_name]

    print(f"✅ Connected to MongoDB database: {db_name}")
    return _db


def close_database():
    """Closes the MongoDB connection cleanly (called on shutdown)."""
    global _client, _db
    if _client:
        _client.close()
        _client = None
        _db = None
        print("🔌 MongoDB connection closed")
