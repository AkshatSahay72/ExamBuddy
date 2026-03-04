import json
from llm.llm_client import ask_llm
from llm.prompts import generate_mcq_prompt

def generate_mcqs(topic, n):

    prompt = generate_mcq_prompt(topic, n)

    response = ask_llm(prompt)

    try:
        questions = json.loads(response)
        return questions
    except:
        return None