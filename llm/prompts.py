def generate_mcq_prompt(topic, num_questions):

    return f"""
Generate {num_questions} multiple choice questions about {topic}.

Return ONLY valid JSON.

Format exactly:

[
 {{
  "question": "text",
  "options": ["A","B","C","D"],
  "answer": "correct option",
  "explanation": "short explanation"
 }}
]

Do not add any text outside JSON.
"""