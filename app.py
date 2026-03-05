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


def extract_questions_from_text(raw_text):
    if not raw_text:
        return []

    candidates = [raw_text]

    block_match = re.search(r"```(?:json)?\s*(.*?)```", raw_text, re.DOTALL | re.IGNORECASE)
    if block_match:
        candidates.append(block_match.group(1))

    candidates.extend(re.findall(r"\[[\s\S]*?\]", raw_text))

    for candidate in candidates:
        candidate = candidate.strip()
        if not candidate:
            continue

        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue

        if isinstance(parsed, list):
            return parsed

        if isinstance(parsed, dict) and isinstance(parsed.get("questions"), list):
            return parsed.get("questions")

    return []


def normalize_questions(raw_questions):
    normalized = []

    for item in raw_questions:
        if not isinstance(item, dict):
            continue

        question = str(item.get("question", "")).strip()
        options = item.get("options")
        answer = str(item.get("answer", "")).strip()
        explanation = str(item.get("explanation", "")).strip()

        if not question or not isinstance(options, list) or len(options) < 2 or not answer:
            continue

        cleaned_options = [str(opt).strip() for opt in options if str(opt).strip()]
        if len(cleaned_options) < 2:
            continue

        normalized.append({
            "question": question,
            "options": cleaned_options[:4],
            "answer": answer,
            "explanation": explanation or "No explanation provided."
        })

    return normalized


def tokenize_text(text):
    words = re.findall(r"[a-zA-Z0-9]+", (text or "").lower())
    stop_words = {
        "the", "is", "a", "an", "of", "to", "and", "in", "on", "for", "with",
        "this", "that", "it", "as", "are", "be", "or", "by", "at", "from",
        "was", "were", "i", "you", "we", "they", "he", "she", "my", "your",
        "me", "explain", "why", "what", "how", "which", "option", "answer"
    }
    return {w for w in words if len(w) > 2 and w not in stop_words}


def is_question_related(user_query, question_context):
    if not isinstance(question_context, dict) or not question_context:
        return False

    query = (user_query or "").strip().lower()
    if not query:
        return False

    mcq_parts = [
        str(question_context.get("question", "")),
        str(question_context.get("correct_answer", "")),
        str(question_context.get("selected_answer", "")),
        str(question_context.get("explanation", ""))
    ]
    options = question_context.get("options") or []
    if isinstance(options, list):
        mcq_parts.extend(str(opt) for opt in options)

    mcq_text = " ".join(mcq_parts).lower()
    mcq_tokens = tokenize_text(mcq_text)
    query_tokens = tokenize_text(query)

    # Allow common direct MCQ phrasing even with low token overlap.
    if re.search(r"\b(option|correct|wrong|answer|explain|why)\b", query):
        if query_tokens & mcq_tokens:
            return True

    # Strong related signal: user mentions text present in the active MCQ.
    overlap = query_tokens & mcq_tokens
    if len(overlap) >= 1:
        return True

    # Short follow-ups that usually refer to current MCQ.
    if len(query.split()) <= 5 and re.search(r"\b(why|how|this|that|not)\b", query):
        return True

    return False


def normalize_exam_topic(topic):
    raw = (topic or "").strip()
    if not raw:
        return raw

    compact = re.sub(r"[^a-z0-9]+", " ", raw.lower()).strip()
    if "gate" not in compact:
        return raw

    gate_paper_aliases = {
        "da": "Data Science and Artificial Intelligence (DA)",
        "ece": "Electronics and Communication Engineering (EC)",
        "cse": "Computer Science and Information Technology (CS)",
        "cs": "Computer Science and Information Technology (CS)",
        "ee": "Electrical Engineering (EE)",
        "me": "Mechanical Engineering (ME)",
        "ce": "Civil Engineering (CE)"
    }

    tokens = compact.split()
    for token in tokens:
        if token in gate_paper_aliases:
            return f"GATE {gate_paper_aliases[token]}"

    joined = " ".join(tokens)
    if "data science" in joined or "artificial intelligence" in joined:
        return "GATE Data Science and Artificial Intelligence (DA)"

    return raw


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

        data = request.json or {}

        topic = data.get("topic", "Data Structures")
        normalized_topic = normalize_exam_topic(topic)
        num = max(3, min(int(data.get("num", 5)), 30))
        difficulty = data.get("difficulty", "medium")

        base_prompt = f"""
Generate {num} MCQ questions about {normalized_topic}.
Difficulty: {difficulty}

If this is a GATE paper code/topic, strictly stay within that paper's syllabus.
Do not switch to another GATE branch.

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

        last_error = None
        for attempt in range(3):
            prompt = (
                base_prompt
                + "\nDo not include markdown, headings, or code fences."
            )
            if attempt > 0:
                prompt += "\nPrevious output was invalid. Return strict valid JSON only."

            completion = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2
            )

            response_text = completion.choices[0].message.content
            parsed_questions = extract_questions_from_text(response_text)
            valid_questions = normalize_questions(parsed_questions)

            if len(valid_questions) >= num:
                return jsonify(valid_questions[:num])

            if valid_questions and attempt == 2:
                return jsonify(valid_questions)

            last_error = "Invalid question format returned by model."

        return jsonify({"error": last_error or "Could not generate questions."}), 500

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
    try:
        data = request.json or {}
        question = (data.get("question") or "").strip()
        history = data.get("history") or []
        question_context = data.get("question_context") or {}

        if not question:
            return jsonify({"error": "Question is required"}), 400

        if not is_question_related(question, question_context):
            return jsonify({
                "reply": "Please ask only about the current question and its options."
            })

        safe_history = []
        if isinstance(history, list):
            for item in history[-10:]:
                if not isinstance(item, dict):
                    continue
                role = item.get("role")
                content = (item.get("content") or "").strip()
                if role not in ("user", "assistant"):
                    continue
                if not content:
                    continue
                safe_history.append({"role": role, "content": content})

        context_lines = []
        if isinstance(question_context, dict) and question_context:
            q_text = (question_context.get("question") or "").strip()
            options = question_context.get("options") or []
            selected = question_context.get("selected_answer")
            correct = question_context.get("correct_answer")
            explanation = question_context.get("explanation")
            q_no = question_context.get("question_number")
            total = question_context.get("total_questions")

            if q_text:
                context_lines.append(f"Current question ({q_no}/{total}): {q_text}")
            if isinstance(options, list) and options:
                context_lines.append("Options: " + " | ".join(str(opt) for opt in options))
            if selected:
                context_lines.append(f"Student selected: {selected}")
            if correct:
                context_lines.append(f"Correct answer: {correct}")
            if explanation:
                context_lines.append(f"Base explanation: {explanation}")

        system_prompt = (
            "You are an MCQ exam tutor. Respond precisely and briefly. "
            "Use current-question context when available. "
            "Explain why the correct option is correct and why the asked/selected option is incorrect. "
            "Do not use emoji. "
            "Response rules: 1) max 45 words, 2) short lines, 3) no long paragraphs, "
            "4) if user asks direct fact, answer in one line first."
        )

        messages = [{"role": "system", "content": system_prompt}]
        if context_lines:
            messages.append(
                {
                    "role": "system",
                    "content": "Current MCQ context:\n" + "\n".join(context_lines)
                }
            )
        messages.extend(safe_history)
        messages.append({"role": "user", "content": question})

        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=messages,
            temperature=0.2
        )

        reply = completion.choices[0].message.content
        return jsonify({"reply": reply})
    except Exception as e:
        print("CHAT ERROR:", e)
        return jsonify({"error": str(e)}), 500


# -----------------------------
# RUN SERVER
# -----------------------------

if __name__ == "__main__":
    debug_mode = os.getenv("FLASK_DEBUG", "0") == "1"
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "5000"))
    app.run(debug=debug_mode, host=host, port=port)
