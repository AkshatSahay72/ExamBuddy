# ExamBuddy

AI-powered mock test generator for exam preparation. Build topic-specific MCQ tests, get instant correctness feedback, and ask focused doubt-clearing questions on the active MCQ.

Live Demo: https://exambuddy-78un.onrender.com/

## Highlights
- Generate MCQ tests by `topic`, `difficulty`, and `question count`.
- Instant per-question feedback with explanation.
- Question navigator with answered/current state.
- 30-minute timer UI for test simulation.
- Built-in AI help assistant constrained to the current MCQ context.
- Handles noisy model output and retries JSON parsing for stable generation.
- GATE topic normalization (for example, `GATE DA` is treated as the Data Science and AI paper).

## Tech Stack
- Backend: Flask, Flask-CORS
- LLM: Groq API (`llama-3.1-8b-instant`)
- Frontend: HTML, CSS, Vanilla JavaScript
- Deployment: Render + Gunicorn

## Project Structure
```text
ExamBuddy/
|- app.py
|- requirements.txt
|- render.yaml
|- Procfile
|- templates/
|  |- setup.html
|  |- index.html
|- static/
|  |- setup.js
|  |- script.js
|  |- style.css
|- data/
|- engine/
|- llm/
|- utils/
```

## Core Flow
1. User selects topic, question count, and difficulty.
2. Frontend sends request to `POST /generate`.
3. Backend prompts Groq model and enforces strict JSON output.
4. Parsed/normalized MCQs are returned and rendered.
5. On each answer selection, feedback is shown instantly.
6. Doubt support uses `POST /chat` with active question context.

## API Endpoints
- `GET /` -> Setup screen
- `GET /exam` -> Test screen
- `POST /generate` -> Generate MCQs
- `POST /chat` -> Context-aware help for current MCQ

## Local Setup
### 1) Clone and enter project
```bash
git clone <your-repo-url>
cd ExamBuddy
```

### 2) Create and activate virtual environment
```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
```

### 3) Install dependencies
```bash
pip install -r requirements.txt
```

### 4) Configure environment
Create `.env` in project root:
```env
GROQ_API_KEY=your_groq_api_key_here
FLASK_DEBUG=1
HOST=0.0.0.0
PORT=5000
```

### 5) Run app
```bash
python app.py
```
Open: `http://localhost:5000`

## Deploy on Render
This repo includes both `render.yaml` and `Procfile`.

### Option A: Blueprint deploy (`render.yaml`)
1. Push repo to GitHub.
2. In Render, choose New + Blueprint.
3. Select repository.
4. Add environment variable:
   - `GROQ_API_KEY` (required)
5. Deploy.

### Option B: Manual Web Service
- Build command:
```bash
pip install -r requirements.txt
```
- Start command:
```bash
gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120
```
- Environment variable:
```env
GROQ_API_KEY=your_groq_api_key_here
```

## Reliability and Safety Notes
- Retries generation up to 3 times if model output is invalid JSON.
- Normalizes question payload before rendering.
- Chat access is limited to current-question context.
- Frontend escapes model text before injecting into HTML.

## Common Issues
- `GROQ_API_KEY not found`:
  - Add key in `.env` (local) or Render environment variables.
- Empty/invalid generated questions:
  - Retry with clearer topic text.
  - Check Groq key quota and service status.
- Render boot issues:
  - Verify start command and Python version in Render settings.

## Roadmap
- User authentication and test history.
- Performance analytics by topic.
- More robust syllabus mapping per exam.
- Export results to PDF.

## License
Use and modify for academic/personal projects.
