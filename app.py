from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv
import os
import json
import re


# -----------------------------
# LOAD ENV VARIABLES
# -----------------------------

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY not found. Put it in your .env file")


# -----------------------------
# FLASK APP
# -----------------------------

app = Flask(__name__)
CORS(app)


# -----------------------------
# GROQ CLIENT
# -----------------------------

client = Groq(api_key=GROQ_API_KEY)


# -----------------------------
# ROUTES
# -----------------------------


@app.route("/")
def setup():
    return render_template("setup.html")


@app.route("/exam")
def exam():
    return render_template("index.html")


# -----------------------------
# GENERATE MCQ TEST
# -----------------------------

@app.route("/generate", methods=["POST"])
def generate():

    try:

        data = request.json

        topic = data.get("topic", "Data Structures")
        num = int(data.get("num", 5))
        difficulty = data.get("difficulty", "medium")

        prompt = f"""
Generate {num} MCQ questions about {topic}.
Difficulty: {difficulty}

Return ONLY JSON in this format:

[
{{
"question":"text",
"options":["A","B","C","D"],
"answer":"correct option text",
"explanation":"short explanation"
}}
]
"""

        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role":"user","content":prompt}
            ],
            temperature=0.3
        )

        response_text = completion.choices[0].message.content

        import re

        match = re.search(r"\[.*\]", response_text, re.DOTALL)

        if match:
            json_text = match.group()
            questions = json.loads(json_text)
        else:
            questions = []

        return jsonify(questions)

    except Exception as e:

        print("ERROR:", e)

        return jsonify({
            "error": str(e)
        }), 500

# -----------------------------
# CHATBOT API
# -----------------------------

@app.route("/chat", methods=["POST"])
def chat():

    data = request.json
    question = data.get("question")

    completion = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful exam preparation tutor. Explain concepts clearly."
            },
            {
                "role": "user",
                "content": question
            }
        ]
    )

    reply = completion.choices[0].message.content

    return jsonify({
        "reply": reply
    })


# -----------------------------
# RUN SERVER
# -----------------------------

if __name__ == "__main__":
    app.run(debug=True)