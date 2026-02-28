"""
Test the data preprocessing pipeline end-to-end.
Run: python ml-service/scripts/test_preprocessing.py
"""
import os, sys

# Add project root to path so we can import from app/
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env"))

from app.database import get_database
from app.services.data_preprocessor import preprocess_all

# Connect to MongoDB and run the pipeline
db = get_database()
datasets = preprocess_all(db)

# Show a sample for Burgers
burgers = datasets["Burgers"]
print("\n📋 BURGERS — Sample rows:")
print(burgers[["ds", "y", "day_of_week", "day_name", "month", "is_weekend", "is_festival", "festival_name"]].head(10).to_string(index=False))

print("\n📋 BURGERS — Festival days:")
festival_rows = burgers[burgers["is_festival"] == 1][["ds", "y", "festival_name"]]
print(festival_rows.to_string(index=False))

print(f"\n📋 BURGERS — Shape: {burgers.shape} (rows, columns)")
print(f"📋 BURGERS — Columns: {list(burgers.columns)}")
