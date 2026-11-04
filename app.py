import socket

# Built-in DNS fallback for environments where libc dnsproxyd does not resolve public DNS (e.g. Android Termux)
_orig_getaddrinfo = socket.getaddrinfo
_FALLBACK_DNS = {
    "api.groq.com": ["104.18.38.236", "172.64.149.20"],
    "pypi.org": ["151.101.0.223", "151.101.64.223", "151.101.128.223", "151.101.192.223"],
    "files.pythonhosted.org": ["151.101.1.63", "151.101.65.63"]
}

def _patched_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    try:
        return _orig_getaddrinfo(host, port, family, type, proto, flags)
    except (socket.gaierror, OSError):
        if host in _FALLBACK_DNS:
            for ip in _FALLBACK_DNS[host]:
                try:
                    return _orig_getaddrinfo(ip, port, family, type, proto, flags)
                except Exception:
                    continue
        raise

socket.getaddrinfo = _patched_getaddrinfo

from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_cors import CORS
DEFAULT_GROQ_TIMEOUT = 16.0


class GroqAPIError(RuntimeError):
    def __init__(self, message, status_code=500, retry_after=None):
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after


try:
    from groq import Groq
except ImportError:
    import urllib.request
    import urllib.error
    import json
    import ssl

    class _GroqFallback:
        def __init__(self, api_key=None, timeout=DEFAULT_GROQ_TIMEOUT):
            self.api_key = api_key
            self.timeout = timeout
            self.chat = self._Chat(api_key, timeout)

        class _Chat:
            def __init__(self, api_key, timeout):
                self.completions = self._Completions(api_key, timeout)

            class _Completions:
                def __init__(self, api_key, timeout):
                    self.api_key = api_key
                    self.timeout = timeout

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

                    def _parse_http_err(http_err):
                        body = http_err.read().decode("utf-8", errors="replace")
                        retry_after = None
                        raw_ra = http_err.headers.get("Retry-After") or http_err.headers.get("retry-after")
                        if raw_ra:
                            try:
                                retry_after = float(raw_ra)
                            except (ValueError, TypeError):
                                pass

                        try:
                            err_data = json.loads(body)
                            msg = err_data.get("error", {}).get("message") or body
                        except Exception:
                            msg = body

                        if retry_after is None and msg:
                            m = re.search(r"try again in ([0-9]+(?:\.[0-9]+)?)s", msg, re.IGNORECASE)
                            if m:
                                try:
                                    retry_after = float(m.group(1))
                                except ValueError:
                                    pass

                        return GroqAPIError(
                            f"Groq API error ({http_err.code}): {msg}",
                            status_code=http_err.code,
                            retry_after=retry_after
                        )

                    def _fetch(ctx):
                        with urllib.request.urlopen(req, context=ctx, timeout=self.timeout) as resp:
                            return json.loads(resp.read().decode("utf-8"))

                    try:
                        ctx = ssl.create_default_context()
                        data = _fetch(ctx)
                    except urllib.error.HTTPError as http_err:
                        raise _parse_http_err(http_err)
                    except (urllib.error.URLError, ssl.SSLError) as url_err:
                        is_ssl = isinstance(url_err, ssl.SSLError) or (
                            hasattr(url_err, "reason") and isinstance(url_err.reason, ssl.SSLError)
                        )
                        if is_ssl:
                            try:
                                ctx = ssl._create_unverified_context()
                                data = _fetch(ctx)
                            except urllib.error.HTTPError as http_err:
                                raise _parse_http_err(http_err)
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

DEFAULT_GROQ_TIMEOUT = 16.0

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
        client = Groq(api_key=GROQ_API_KEY, timeout=DEFAULT_GROQ_TIMEOUT)
    except TypeError:
        try:
            client = Groq(api_key=GROQ_API_KEY)
        except Exception as e:
            print(f"Warning: Failed to initialize Groq client: {e}")
    except Exception as e:
        print(f"Warning: Failed to initialize Groq client: {e}")
else:
    print("Warning: GROQ_API_KEY is not set. API generation will be unavailable.")


def is_rate_limit_error(e):
    if getattr(e, "status_code", None) == 429:
        return True
    if hasattr(e, "response") and getattr(e.response, "status_code", None) == 429:
        return True
    name = type(e).__name__
    if "RateLimit" in name:
        return True
    err_str = str(e).lower()
    if "429" in err_str or "rate limit" in err_str:
        return True
    return False


def get_retry_after(e, default=5.0):
    if getattr(e, "retry_after", None) is not None:
        try:
            return float(e.retry_after)
        except (ValueError, TypeError):
            pass
    if hasattr(e, "response") and getattr(e.response, "headers", None):
        ra = e.response.headers.get("retry-after") or e.response.headers.get("Retry-After")
        if ra:
            try:
                return float(ra)
            except (ValueError, TypeError):
                pass
    m = re.search(r"try again in ([0-9]+(?:\.[0-9]+)?)s", str(e), re.IGNORECASE)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return default


def extract_json_structures(text: str):
    """
    Finds balanced JSON array [...] or object {...} substrings in text,
    properly handling strings, escaped quotes, and nested brackets.
    """
    if not text or not isinstance(text, str):
        return []

    candidates = []

    # 1. Direct trimmed text
    stripped = text.strip()
    if stripped:
        candidates.append(stripped)

    # 2. Markdown code fences
    fence_matches = re.findall(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    for fm in fence_matches:
        f_stripped = fm.strip()
        if f_stripped and f_stripped not in candidates:
            candidates.append(f_stripped)

    # 3. Balanced bracket/brace scanner
    def scan_balanced(open_char, close_char):
        found = []
        i = 0
        n = len(text)
        while i < n:
            if text[i] == open_char:
                start_idx = i
                depth = 0
                in_string = False
                escape = False
                j = i
                while j < n:
                    ch = text[j]
                    if in_string:
                        if escape:
                            escape = False
                        elif ch == "\\":
                            escape = True
                        elif ch == '"':
                            in_string = False
                    else:
                        if ch == '"':
                            in_string = True
                        elif ch == open_char:
                            depth += 1
                        elif ch == close_char:
                            depth -= 1
                            if depth == 0:
                                candidate = text[start_idx : j + 1].strip()
                                if candidate not in candidates and candidate not in found:
                                    found.append(candidate)
                                i = j
                                break
                    j += 1
            i += 1
        return found

    candidates.extend(scan_balanced("[", "]"))
    candidates.extend(scan_balanced("{", "}"))
    return candidates


def extract_questions_from_text(raw_text):
    if not raw_text:
        return []

    candidates = extract_json_structures(raw_text)

    for candidate in candidates:
        parsed = None
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            # Trailing comma cleanup
            cleaned = re.sub(r",\s*([\]\}])", r"\1", candidate)
            try:
                parsed = json.loads(cleaned)
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

        question = str(item.get("question") or item.get("question_text") or item.get("prompt") or "").strip()
        raw_options = item.get("options") or item.get("choices") or item.get("answers")
        answer = str(item.get("answer") or item.get("correct_answer") or item.get("correct_option") or item.get("correct") or "").strip()
        explanation = str(item.get("explanation") or item.get("reason") or item.get("rationale") or "").strip()

        cleaned_options = []
        if isinstance(raw_options, dict):
            for k in ["A", "B", "C", "D", "a", "b", "c", "d", "1", "2", "3", "4"]:
                if k in raw_options:
                    cleaned_options.append(str(raw_options[k]).strip())
            if not cleaned_options:
                cleaned_options = [str(v).strip() for v in raw_options.values() if str(v).strip()]
        elif isinstance(raw_options, list):
            cleaned_options = [str(opt).strip() for opt in raw_options if str(opt).strip()]

        if not question or len(cleaned_options) < 2:
            continue

        # If answer is just a letter like 'A' or 'B', map to option text
        letter_map = {"A": 0, "B": 1, "C": 2, "D": 3, "a": 0, "b": 1, "c": 2, "d": 3}
        if answer in letter_map and letter_map[answer] < len(cleaned_options):
            resolved_answer = cleaned_options[letter_map[answer]]
        elif answer in cleaned_options:
            resolved_answer = answer
        elif answer:
            resolved_answer = answer
        else:
            continue

        normalized.append({
            "question": question,
            "options": cleaned_options[:4],
            "answer": resolved_answer,
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
        rate_limit_retry_after = 5.0

        # Coordinated backend retry budget: at most 2 model calls
        max_backend_attempts = 2
        for attempt in range(max_backend_attempts):
            prompt = base_prompt
            if attempt > 0:
                prompt += "\nPrevious output was invalid. Return strict valid JSON only."

            try:
                completion = client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.2
                )
            except Exception as e:
                if is_rate_limit_error(e):
                    wait_time = get_retry_after(e, default=5.0)
                    rate_limit_retry_after = max(rate_limit_retry_after, wait_time)
                    # Bounded single backend retry if wait time <= 6s
                    if attempt < max_backend_attempts - 1 and wait_time <= 6.0:
                        import time
                        time.sleep(wait_time)
                        continue
                    else:
                        resp = jsonify({
                            "error": "ExamBuddy AI rate limit reached. Please wait before retrying.",
                            "code": "rate_limit_exceeded",
                            "retry_after": round(wait_time, 1)
                        })
                        resp.status_code = 429
                        resp.headers["Retry-After"] = str(int(wait_time) + 1)
                        return resp
                else:
                    status_code = getattr(e, "status_code", None)
                    if status_code in (400, 401, 403, 404):
                        return jsonify({
                            "error": f"API configuration error: {str(e)}",
                            "code": "api_error"
                        }), 502

                    if attempt < max_backend_attempts - 1:
                        import time
                        time.sleep(1.5)
                        continue
                    return jsonify({
                        "error": f"AI service temporarily unavailable: {str(e)}",
                        "code": "service_unavailable"
                    }), 503

            response_text = completion.choices[0].message.content
            parsed_questions = extract_questions_from_text(response_text)
            valid_questions = normalize_questions(parsed_questions)

            if len(valid_questions) >= num:
                return jsonify(valid_questions[:num])

            if len(valid_questions) >= 3 or (valid_questions and attempt >= 1):
                return jsonify(valid_questions[:num])

            last_error = "Invalid question format returned by model."

        return jsonify({
            "error": last_error or "Could not generate questions.",
            "code": "format_error"
        }), 502

    except Exception as e:
        return jsonify({
            "error": str(e),
            "code": "server_error"
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
