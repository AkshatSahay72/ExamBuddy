from groq import Groq
import os
from dotenv import load_dotenv

load_dotenv()

from config import MODEL_NAME

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

response = client.chat.completions.create(
    model=MODEL_NAME,
    messages=[
        {"role":"user","content":"Explain normalization in DBMS in one sentence"}
    ]
)

print(response.choices[0].message.content)