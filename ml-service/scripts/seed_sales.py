"""
Seed MongoDB with sales_synthetic.csv data
"""
import os
import pandas as pd
from pymongo import MongoClient
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

MONGO_URI = os.getenv("MONGODB_URI")
CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "sales_synthetic.csv")

client = MongoClient(MONGO_URI)
db = client["restaurant-forecast"]
sales_col = db["sales"]

print(f"Reading CSV: {CSV_PATH}")
df = pd.read_csv(CSV_PATH)

# Rename columns to match Mongoose schema (lowercase field names)
# CSV headers: "Order ID", "Date", "Product", "Price", "Quantity", "Purchase Type", "Payment Method"
# Mongoose schema: orderId, date, product, price, quantity, purchaseType, paymentMethod
column_map = {
    "Order ID": "orderId",
    "Date": "date",
    "Product": "product",
    "Price": "price",
    "Quantity": "quantity",
    "Purchase Type": "purchaseType",
    "Payment Method": "paymentMethod",
}
df = df.rename(columns=column_map)

# Convert date column to ISO format
def iso_date(date_str):
    try:
        return pd.to_datetime(date_str).isoformat()
    except Exception:
        return date_str

if "date" in df.columns:
    df["date"] = df["date"].apply(iso_date)

# Prepare records for MongoDB
records = df.to_dict(orient="records")

print(f"Deleting old sales records...")
sales_col.delete_many({})
print(f"Inserting {len(records)} new sales records...")
sales_col.insert_many(records)
print("Seeding complete.")
client.close()
