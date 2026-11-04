try:
    from groq import Groq
except ImportError:
    from app import _GroqFallback as Groq

from config import GROQ_API_KEY, MODEL_NAME

client = None
if GROQ_API_KEY:
    try:
        client = Groq(api_key=GROQ_API_KEY, timeout=16.0)
    except TypeError:
        try:
            client = Groq(api_key=GROQ_API_KEY)
        except Exception:
            client = None
    except Exception:
        client = None


def ask_llm(prompt):
    if not client:
        return "LLM client is not configured."
    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "user", "content": prompt}
        ]
    )

    return response.choices[0].message.content
