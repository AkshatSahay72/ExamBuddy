import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MODEL_NAME = os.getenv("MODEL_NAME", "qwen/qwen3.8-27b")
FALLBACK_MODEL_NAME = os.getenv("FALLBACK_MODEL_NAME", "openai/gpt-oss-20b")
