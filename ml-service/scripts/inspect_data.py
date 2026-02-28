"""Quick script to inspect MongoDB data structure."""
import os, sys
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env"))

from pymongo import MongoClient, ASCENDING, DESCENDING

uri = os.getenv("MONGODB_URI")
print("Connecting to MongoDB...")
client = MongoClient(uri, serverSelectionTimeoutMS=10000, connectTimeoutMS=10000)
db = client["restaurant-forecast"]

try:
    print(f"Total sales: {db.sales.count_documents({})}")
    sample = db.sales.find_one()
    print(f"Sample keys: {list(sample.keys())}")
    print(f"Sample: product={sample['product']}, qty={sample['quantity']}, date={sample['date']}")

    first = db.sales.find_one(sort=[("date", ASCENDING)])
    last = db.sales.find_one(sort=[("date", DESCENDING)])
    print(f"Date range: {first['date']} to {last['date']}")
    print(f"Products: {db.sales.distinct('product')}")
    print(f"Festivals: {db.festivals.count_documents({})}")
except Exception as e:
    print(f"Error: {e}")
finally:
    client.close()
