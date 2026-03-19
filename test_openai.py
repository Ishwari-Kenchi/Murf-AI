import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
key = os.getenv("OPENAI_API_KEY")
print(f"Key length: {len(key) if key else 0}")

client = OpenAI(api_key=key)

try:
    models = client.models.list()
    print("API Key is VALID.")
except Exception as e:
    print(f"API Key is INVALID or Error: {e}")
