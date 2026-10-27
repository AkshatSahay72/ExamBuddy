from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_cors import CORS
try:
    from groq import Groq
except ImportError:
    import urllib.request
    import urllib.error
    import json
    import ssl

    class _GroqFallback:
        def __init__(self, api_key=None):
            self.api_key = api_key
            self.chat = self._Chat(api_key)

        class _Chat:
            def __init__(self, api_key):
                self.completions = self._Completions(api_key)

            class _Completions:
                def __init__(self, api_key):
                    self.api_key = api_key

                def create(self, model, messages, temperature=0.2, **kwargs):
                    url = "https://api.groq.com/openai/v1/chat/completions"
                    headers = {
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ExamBuddy/1.0"
                    }
                    payload = {
                        "model": model,
                        "messages": messages,
                        "temperature": temperature,
                        **kwargs
                    }
                    req = urllib.request.Request(
                        url,
                        data=json.dumps(payload).encode("utf-8"),
                        headers=headers,
                        method="POST"
                    )

                    def _fetch(ctx):
                        with urllib.request.urlopen(req, context=ctx, timeout=45) as resp:
                            return json.loads(resp.read().decode("utf-8"))

                    try:
                        ctx = ssl.create_default_context()
                        data = _fetch(ctx)
                    except urllib.error.HTTPError as http_err:
                        body = http_err.read().decode("utf-8", errors="replace")
                        try:
                            err_data = json.loads(body)
                            msg = err_data.get("error", {}).get("message") or body
                        except Exception:
                            msg = body
                        raise RuntimeError(f"Groq API error ({http_err.code}): {msg}")
                    except (urllib.error.URLError, ssl.SSLError) as url_err:
                        is_ssl = isinstance(url_err, ssl.SSLError) or (
                            hasattr(url_err, "reason") and isinstance(url_err.reason, ssl.SSLError)
                        )
                        if is_ssl:
                            try:
                                ctx = ssl._create_unverified_context()
                                data = _fetch(ctx)
                            except urllib.error.HTTPError as http_err:
                                body = http_err.read().decode("utf-8", errors="replace")
                                try:
                                    err_data = json.loads(body)
                                    msg = err_data.get("error", {}).get("message") or body
                                except Exception:
                                    msg = body
                                raise RuntimeError(f"Groq API error ({http_err.code}): {msg}")
                        else:
                            raise

                    if not isinstance(data, dict) or not data.get("choices"):
                        err_msg = data.get("error", {}).get("message") if isinstance(data, dict) else str(data)
                        raise RuntimeError(f"Groq API returned invalid response: {err_msg}")

                    class _Choice:
                        def __init__(self, c):
                            class _Msg:
                                def __init__(self, m):
                                    self.content = m.get("content", "")
                            self.message = _Msg(c.get("message", {}))

                    class _Completion:
                        def __init__(self, d):
                            self.choices = [_Choice(c) for c in d.get("choices", [])]

                    return _Completion(data)

    Groq = _GroqFallback
from dotenv import load_dotenv
import os
import json
import re


# -----------------------------
# LOAD ENV VARIABLES
# -----------------------------

load_dotenv()

from config import GROQ_API_KEY, MODEL_NAME

# -----------------------------
# FLASK APP
# -----------------------------

app = Flask(__name__)
CORS(app)


# -----------------------------
# GROQ CLIENT
# -----------------------------

client = None
if GROQ_API_KEY:
    try:
        client = Groq(api_key=GROQ_API_KEY)
    except Exception as e:
        print(f"Warning: Failed to initialize Groq client: {e}")
else:
    print("Warning: GROQ_API_KEY is not set. API generation will be unavailable.")


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
    # if no context yet, allow the question
    if not isinstance(question_context, dict) or not question_context:
        return True

    query = (user_query or "").strip().lower()
    if not query:
        return False

    # build MCQ text
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

    # strong signal: user directly mentions words from MCQ
    if query_tokens & mcq_tokens:
        return True

    # allow common exam help queries
    if re.search(r"\b(option|correct|wrong|answer|explain|why|how)\b", query):
        return True

    # allow short conceptual questions (like "what is algorithm")
    if len(query.split()) <= 6:
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


@app.route("/health")
def health():
    return jsonify({
        "status": "healthy",
        "app": "ExamBuddy",
        "groq_configured": bool(GROQ_API_KEY and client)
    }), 200


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
    if not client:
        return jsonify({"error": "GROQ_API_KEY is not configured on this server."}), 500

    try:

        data = request.json or {}

        raw_topic = (data.get("topic") or "").strip()
        topic = raw_topic if raw_topic else "Data Structures"
        normalized_topic = normalize_exam_topic(topic)
        try:
            num = max(3, min(int(data.get("num") or 5), 30))
        except (ValueError, TypeError):
            num = 5
        difficulty = (data.get("difficulty") or "medium").lower()
        if difficulty not in ("easy", "medium", "hard"):
            difficulty = "medium"

        base_prompt = f"""
        Generate {num} multiple choice questions about {normalized_topic}.
        Difficulty: {difficulty}

        IMPORTANT RULES:
        - Output must be STRICT VALID JSON.
        - Do NOT write explanations outside JSON.
        - Do NOT write headings.
        - Do NOT number the questions.
        - Do NOT use markdown.
        - Do NOT use ```.

        Output format MUST be exactly:

        [
        {{
            "question": "Question text",
            "options": ["option1", "option2", "option3", "option4"],
            "answer": "correct option text",
            "explanation": "short explanation"
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
                model=MODEL_NAME,
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
    if not client:
        return jsonify({"error": "GROQ_API_KEY is not configured on this server."}), 500
    try:
        data = request.json or {}
        question = (data.get("question") or "").strip()
        user_doubt = (data.get("user_doubt") or "").strip()
        history = data.get("history") or []
        question_context = data.get("question_context") or {}

        if not question:
            return jsonify({"error": "Question is required"}), 400

        if not is_question_related(question, question_context):
            return jsonify({
                "reply": "Please ask questions related to the current question only."
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
        is_checked = False
        if isinstance(question_context, dict) and question_context:
            q_text = (question_context.get("question") or "").strip()
            options = question_context.get("options") or []
            selected = question_context.get("selected_answer")
            correct = question_context.get("correct_answer")
            explanation = question_context.get("explanation")
            is_checked = bool(question_context.get("is_checked"))
            q_no = question_context.get("question_number")
            total = question_context.get("total_questions")

            if q_text:
                context_lines.append(f"Current question ({q_no}/{total}): {q_text}")
            if isinstance(options, list) and options:
                context_lines.append("Options: " + " | ".join(str(opt) for opt in options))
            if selected:
                context_lines.append(f"Student selected: {selected}")
            # Only include answer/explanation context AFTER "Check Answer"
            if is_checked:
                if correct:
                    context_lines.append(f"Correct answer: {correct}")
                if explanation:
                    context_lines.append(f"Base explanation: {explanation}")

        # Lightweight "cheat" detection (only before answer is checked)
        doubt_text = (user_doubt or question).lower()
        if not is_checked and re.search(r"\b(answer|correct option|correct answer|tell me the answer|give me the answer)\b", doubt_text):
            return jsonify({"reply": "I’ll help you understand, but try solving it first 😉"})

        if is_checked:
            system_prompt = (
                "You are an AI exam assistant. The student has already checked the answer. "
                "You may reveal the correct answer and explain clearly why it is correct and why other options are wrong. "
                "Keep it short and helpful. Do not use emoji."
            )
        else:
            system_prompt = (
                "You are an AI exam assistant. Help the student understand the concept without directly revealing the correct answer.\n\n"
                "Rules:\n"
                "- Do NOT directly say the correct answer\n"
                "- Do NOT eliminate options explicitly\n"
                "- Guide the user using hints and concepts\n"
                "- Explain the logic behind the topic\n"
                "- If user asks directly for the answer, respond:\n"
                "  'Try to think through the concept. I can guide you, but I won’t directly reveal the answer.'\n"
                "- Keep answers short and helpful\n"
                "Do not use emoji."
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
            model=MODEL_NAME,
            messages=messages,
            temperature=0.2
        )

        reply = completion.choices[0].message.content
        return jsonify({"reply": reply})
    except Exception as e:
        print("CHAT ERROR:", e)
        return jsonify({"error": str(e)}), 500


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(
        os.path.join(app.root_path, "static"),
        "favicon.svg",
        mimetype="image/svg+xml"
    )


@app.errorhandler(404)
def page_not_found(e):
    return render_template("404.html"), 404


@app.errorhandler(500)
def server_error(e):
    return render_template("404.html", error_title="Server Error", error_message="An unexpected server error occurred. Please try again."), 500


# -----------------------------
# RUN SERVER
# -----------------------------

if __name__ == "__main__":
    debug_mode = os.getenv("FLASK_DEBUG", "0") == "1"
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "5000"))
    app.run(debug=debug_mode, host=host, port=port)
