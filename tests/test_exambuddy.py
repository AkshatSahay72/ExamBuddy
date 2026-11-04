import os
import sys
import json
import subprocess
import pytest
from unittest.mock import MagicMock, patch

# Ensure app can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import app as flask_app_module
from app import app, extract_questions_from_text, normalize_questions, is_question_related


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


class TestJavaScriptRegressionAndContracts:
    """Tests verifying frontend JavaScript syntax and URL routing contracts."""

    def test_script_syntax_validity(self):
        """Regression test for syntax error that broke exam loading on line 35."""
        result = subprocess.run(
            ["node", "-c", "static/script.js"],
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"static/script.js syntax error: {result.stderr}"

    def test_setup_syntax_validity(self):
        """Verify static/setup.js syntax."""
        result = subprocess.run(
            ["node", "-c", "static/setup.js"],
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"static/setup.js syntax error: {result.stderr}"

    def test_frontend_simulation_suite(self):
        """Execute full end-to-end frontend simulation in node."""
        result = subprocess.run(
            ["node", "tests/test_frontend_flow.js"],
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Frontend simulation failed:\n{result.stdout}\n{result.stderr}"

    def test_no_hardcoded_root_navigation_links(self):
        """
        Verify that static/script.js does not contain hardcoded href='/' links,
        which break subpath routing when deployed at /apps/ExamBuddy/.
        """
        with open("static/script.js", "r", encoding="utf-8") as f:
            content = f.read()

        # Check for href="/" which breaks subpath navigation
        assert 'href="/"' not in content, "Found hardcoded href='/' in static/script.js; should use relative './'"
        assert 'href="./"' in content, "Expected relative href='./' for navigation back to home"

    def test_relative_resource_and_endpoint_references(self):
        """Verify relative endpoints are used in JavaScript and HTML templates."""
        with open("static/script.js", "r", encoding="utf-8") as f:
            script_js = f.read()
        assert 'fetch("generate"' in script_js or "fetch('generate'" in script_js
        assert 'fetch("chat"' in script_js or "fetch('chat'" in script_js

        with open("static/setup.js", "r", encoding="utf-8") as f:
            setup_js = f.read()
        assert 'window.location.href = "exam"' in setup_js or "window.location.href = 'exam'" in setup_js

        with open("templates/setup.html", "r", encoding="utf-8") as f:
            setup_html = f.read()
        assert 'href="static/style.css"' in setup_html
        assert 'src="static/setup.js"' in setup_html

        with open("templates/index.html", "r", encoding="utf-8") as f:
            index_html = f.read()
        assert 'href="static/style.css"' in index_html
        assert 'src="static/script.js"' in index_html


class TestFlaskEndpointsAndContracts:
    """Test Flask backend endpoints, contracts, and error responses."""

    def test_health_endpoint(self, client):
        """Verify /health endpoint contract for PersonalServer monitoring."""
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "healthy"
        assert data["app"] == "ExamBuddy"
        assert "groq_configured" in data

    def test_setup_page(self, client):
        """Verify setup page loads with correct initial form controls."""
        resp = client.get("/")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert 'id="topic"' in html
        assert 'id="startBtn"' in html
        assert "Generate Practice Test" in html

    def test_exam_page(self, client):
        """Verify exam page loads with required DOM IDs for question generation."""
        resp = client.get("/exam")
        assert resp.status_code == 200
        html = resp.get_data(as_text=True)
        assert 'id="questionNumber"' in html
        assert 'id="questionText"' in html
        assert 'id="optionsContainer"' in html
        assert 'id="navigatorCountBadge"' in html
        assert 'id="nextBtn"' in html
        assert 'id="prevBtn"' in html
        assert 'id="submitExamBtn"' in html

    def test_static_assets_served(self, client):
        """Verify static files are accessible."""
        for path in ["/static/script.js", "/static/setup.js", "/static/style.css", "/static/favicon.svg"]:
            resp = client.get(path)
            assert resp.status_code == 200, f"Failed to serve {path}"

    def test_generate_endpoint_success(self, client):
        """Test question generation contract when Groq returns valid JSON."""
        mock_raw_output = json.dumps([
            {
                "question": "What is the time complexity of binary search?",
                "options": ["O(log n)", "O(n)", "O(n log n)", "O(1)"],
                "answer": "O(log n)",
                "explanation": "Binary search divides the search space in half at each step."
            },
            {
                "question": "Which data structure uses LIFO order?",
                "options": ["Stack", "Queue", "Array", "Linked List"],
                "answer": "Stack",
                "explanation": "A stack follows Last-In-First-Out order."
            },
            {
                "question": "What does SQL stand for?",
                "options": ["Structured Query Language", "Simple Query Logic", "System Queue Language", "Standard Query Link"],
                "answer": "Structured Query Language",
                "explanation": "SQL stands for Structured Query Language."
            }
        ])

        mock_completion = MagicMock()
        mock_completion.choices = [
            MagicMock(message=MagicMock(content=mock_raw_output))
        ]

        with patch.object(flask_app_module, "client") as mock_client:
            mock_client.chat.completions.create.return_value = mock_completion

            resp = client.post("/generate", json={
                "topic": "Data Structures",
                "num": 3,
                "difficulty": "medium"
            })

            assert resp.status_code == 200
            questions = resp.get_json()
            assert isinstance(questions, list)
            assert len(questions) == 3
            for q in questions:
                assert "question" in q and len(q["question"]) > 0
                assert "options" in q and len(q["options"]) == 4
                assert "answer" in q and len(q["answer"]) > 0
                assert "explanation" in q

    def test_generate_endpoint_rate_limit_429(self, client):
        """Test /generate returns HTTP 429 with retry-after when Groq rate limit is hit."""
        with patch.object(flask_app_module, "client") as mock_client:
            mock_client.chat.completions.create.side_effect = RuntimeError("Rate limit reached for model qwen/qwen3.8-27b ... Please try again in 5.34s.")

            resp = client.post("/generate", json={
                "topic": "Algorithms",
                "num": 5,
                "difficulty": "hard"
            })

            assert resp.status_code == 429
            data = resp.get_json()
            assert "error" in data
            assert data.get("code") == "rate_limit_exceeded"
            assert data.get("retry_after") >= 5.0
            assert "Retry-After" in resp.headers

    def test_generate_endpoint_error_handling(self, client):
        """Test /generate returns a JSON error response when unexpected generation failure occurs."""
        with patch.object(flask_app_module, "client") as mock_client:
            mock_client.chat.completions.create.side_effect = RuntimeError("Unexpected internal engine error")

            resp = client.post("/generate", json={
                "topic": "Algorithms",
                "num": 5,
                "difficulty": "hard"
            })

            assert resp.status_code in (500, 502, 503)
            data = resp.get_json()
            assert "error" in data
            assert "Unexpected internal engine error" in data["error"]

    def test_chat_endpoint(self, client):
        """Test AI Tutor chat endpoint with contextual guidance."""
        mock_completion = MagicMock()
        mock_completion.choices = [
            MagicMock(message=MagicMock(content="Consider how binary search eliminates half the remaining elements."))
        ]

        with patch.object(flask_app_module, "client") as mock_client:
            mock_client.chat.completions.create.return_value = mock_completion

            resp = client.post("/chat", json={
                "question": "Give me a hint about time complexity",
                "user_doubt": "Give me a hint about time complexity",
                "history": [],
                "question_context": {
                    "question": "What is the time complexity of binary search?",
                    "options": ["O(log n)", "O(n)", "O(n log n)", "O(1)"],
                    "is_checked": False
                }
            })

            assert resp.status_code == 200
            data = resp.get_json()
            assert "reply" in data
            assert len(data["reply"]) > 0


class TestQuestionProcessingLogic:
    """Test text parsing and question normalization functions in app.py."""

    def test_extract_questions_from_markdown_codeblock(self):
        raw = "Here are the questions:\n```json\n[{\"question\":\"Q1\",\"options\":[\"A\",\"B\"],\"answer\":\"A\",\"explanation\":\"E1\"}]\n```"
        extracted = extract_questions_from_text(raw)
        assert len(extracted) == 1
        assert extracted[0]["question"] == "Q1"

    def test_extract_questions_from_dict_wrapper(self):
        raw = "```json\n{\"questions\": [{\"question\":\"Q2\",\"options\":[\"A\",\"B\"],\"answer\":\"B\",\"explanation\":\"E2\"}]}\n```"
        extracted = extract_questions_from_text(raw)
        assert len(extracted) == 1
        assert extracted[0]["question"] == "Q2"

    def test_normalize_questions_filters_invalid_items(self):
        raw = [
            {"question": "", "options": ["A", "B"], "answer": "A"},  # missing question
            {"question": "Q1", "options": ["A"], "answer": "A"},  # < 2 options
            {"question": "Q2", "options": ["A", "B"], "answer": ""},  # missing answer
            {"question": "Valid Q", "options": ["A", "B", "C", "D"], "answer": "A"}  # valid
        ]
        normalized = normalize_questions(raw)
        assert len(normalized) == 1
        assert normalized[0]["question"] == "Valid Q"
        assert normalized[0]["explanation"] == "No explanation provided."

    def test_robust_json_extraction_with_intro_prose_and_nested_brackets(self):
        """Regression test for the non-greedy regex bug that sliced at options: [...]."""
        raw = """Here are the multiple choice questions you requested:
[
  {
    "question": "What is the time complexity of searching in a balanced BST?",
    "options": ["O(1)", "O(log n)", "O(n)", "O(n^2)"],
    "answer": "O(log n)",
    "explanation": "Height of balanced tree is log n."
  },
  {
    "question": "Which data structure uses LIFO?",
    "options": ["Queue", "Stack", "Tree", "Graph"],
    "answer": "Stack",
    "explanation": "Stack operates Last-In First-Out."
  }
]
I hope this helps with your exam preparation!"""
        extracted = extract_questions_from_text(raw)
        assert len(extracted) == 2
        assert extracted[0]["question"] == "What is the time complexity of searching in a balanced BST?"
        assert extracted[1]["answer"] == "Stack"

    def test_robust_json_extraction_with_brackets_in_strings(self):
        raw = """[
  {
    "question": "What does arr[0] evaluate to in arr = [10, 20]?",
    "options": ["10", "20", "None", "Error"],
    "answer": "10",
    "explanation": "0-based indexing returns first element."
  }
]"""
        extracted = extract_questions_from_text(raw)
        assert len(extracted) == 1
        assert "arr[0]" in extracted[0]["question"]

    def test_robust_json_extraction_with_trailing_commas(self):
        raw = """[
  {
    "question": "Valid syntax test?",
    "options": ["A", "B",],
    "answer": "A",
    "explanation": "Trailing comma in JSON array",
  },
]"""
        extracted = extract_questions_from_text(raw)
        assert len(extracted) == 1
        assert extracted[0]["question"] == "Valid syntax test?"


class TestGroqFallbackClient:
    """Test pure-Python HTTP fallback client used on systems without prebuilt wheels."""

    def test_fallback_completion_structure(self):
        # Dynamically instantiate fallback client logic
        import urllib.request
        from unittest.mock import patch, MagicMock
        import io

        mock_resp_data = {
            "choices": [
                {
                    "message": {
                        "content": "Test completion response"
                    }
                }
            ]
        }

        mock_resp = io.BytesIO(json.dumps(mock_resp_data).encode("utf-8"))
        # GroqFallback is defined inside app.py if groq wasn't importable, or we can test its definition directly
        # Let's verify _GroqFallback class exists or test fallback path
        fallback_cls = getattr(flask_app_module, "_GroqFallback", None)
        if not fallback_cls:
            # If Groq SDK was imported, _GroqFallback might not be bound to module root unless we test it
            # Let's verify client exists and has chat.completions.create
            assert hasattr(flask_app_module.client or flask_app_module.Groq(api_key="test"), "chat")
        else:
            fb = fallback_cls(api_key="test-key")
            with patch("urllib.request.urlopen", return_value=mock_resp):
                comp = fb.chat.completions.create(
                    model="test-model",
                    messages=[{"role": "user", "content": "hi"}]
                )
                assert len(comp.choices) == 1
                assert comp.choices[0].message.content == "Test completion response"



    def test_backend_timeout_and_execution_budget_alignment(self):
        """
        Verify backend per-attempt timeout and total execution budget stay strictly
        below frontend's 45-second AbortController timeout.
        """
        default_timeout = getattr(flask_app_module, "DEFAULT_GROQ_TIMEOUT", None)
        assert default_timeout is not None, "DEFAULT_GROQ_TIMEOUT must be defined"
        assert default_timeout <= 20.0, f"Per-attempt timeout ({default_timeout}s) is too high"

        max_backend_attempts = 2
        max_retry_wait = 6.0  # Max sleep duration allowed for rate limits in generate()
        overhead_buffer = 1.0  # Marshalling, DNS, HTTP headers

        total_max_backend_budget = (max_backend_attempts * default_timeout) + max_retry_wait + overhead_buffer
        frontend_abort_timeout = 45.0

        assert total_max_backend_budget < frontend_abort_timeout, (
            f"Total backend budget ({total_max_backend_budget}s) must be strictly less than "
            f"frontend abort timeout ({frontend_abort_timeout}s) to prevent orphan processing."
        )

    def test_fallback_client_timeout_propagation(self):
        """Verify _GroqFallback sets and propagates configured timeout."""
        fallback_cls = getattr(flask_app_module, "_GroqFallback", None)
        if fallback_cls:
            fb = fallback_cls(api_key="test-key", timeout=12.0)
            assert fb.timeout == 12.0
            assert fb.chat.completions.timeout == 12.0
