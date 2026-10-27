let questions = [];
let answers = [];
let currentQuestion = 0;
let totalQuestions = 0;
let questionState = [];
let isHintRequestInFlight = false;
let isExamSubmitted = false;
let timerInterval = null;
let timeLeft = 30 * 60; // 30 minutes in seconds
let currentFilter = "all"; // for results review
let chatHistoryByQuestion = {}; // conversational history per question

window.addEventListener("DOMContentLoaded", () => {
    initExamView();

    const checkButton = document.getElementById("checkAnswerBtn");
    if (checkButton) {
        checkButton.addEventListener("click", checkAnswer);
    }

    const prevBtn = document.getElementById("prevBtn");
    if (prevBtn) {
        prevBtn.addEventListener("click", goToPrevQuestion);
    }

    const nextBtn = document.getElementById("nextBtn");
    if (nextBtn) {
        nextBtn.addEventListener("click", goToNextQuestion);
    }

    // Global keyboard shortcuts (Escape for modals, 1-4 for options)
    document.addEventListener("keydown", handleGlobalKeydown);
});

function escapeHtml(text) {
    if (!text) return "";
    const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    };
    return String(text).replace(/[&<>"']/g, (char) => map[char]);
}

function stripEmojis(text) {
    return (text || "").replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").trim();
}

function stripOptionPrefix(text) {
    const value = (text || "").toString().trim();
    return value
        .replace(/^(?:option\s*)?[A-Da-d]\s*[\)\].:\-]\s*/i, "")
        .replace(/^\(?[1-4]\)?\s*[\)\].:\-]\s*/i, "")
        .trim();
}

function getAnswerLetter(answerText) {
    const match = (answerText || "").toString().trim().match(/^(?:option\s*)?([A-Da-d])(?:\b|[\)\].:\-])/i);
    return match ? match[1].toUpperCase() : null;
}

function isCorrectSelection(selectedOption, question) {
    const rawAnswer = (question && question.answer ? String(question.answer) : "").trim();
    const rawSelected = (selectedOption || "").toString().trim();
    if (!rawAnswer || !rawSelected) return false;

    if (rawSelected === rawAnswer) return true;

    const selectedClean = stripOptionPrefix(rawSelected).toLowerCase();
    const answerClean = stripOptionPrefix(rawAnswer).toLowerCase();
    if (selectedClean && selectedClean === answerClean) return true;

    const answerLetter = getAnswerLetter(rawAnswer);
    if (!answerLetter || !Array.isArray(question.options)) return false;

    const answerIndex = answerLetter.charCodeAt(0) - 65;
    return question.options[answerIndex] === selectedOption;
}

function getCorrectOptionValue(question) {
    if (!question || !Array.isArray(question.options)) return null;

    const rawAnswer = (question.answer || "").toString().trim();
    if (!rawAnswer) return null;

    const directMatch = question.options.find((opt) => {
        if (opt === rawAnswer) return true;
        const optClean = stripOptionPrefix(opt).toLowerCase();
        const ansClean = stripOptionPrefix(rawAnswer).toLowerCase();
        return optClean && optClean === ansClean;
    });
    if (directMatch) return directMatch;

    const answerLetter = getAnswerLetter(rawAnswer);
    if (!answerLetter) return null;

    const idx = answerLetter.charCodeAt(0) - 65;
    return question.options[idx] || null;
}

function getStateForQuestion(index) {
    if (!Array.isArray(questionState) || !questionState[index]) return null;
    return questionState[index];
}

function initExamView() {
    const storedTopic = localStorage.getItem("topic") || "Data Structures & Algorithms";
    const storedDiff = localStorage.getItem("difficulty") || "medium";
    const headerTopicText = document.getElementById("headerTopicText");
    const diffBadge = document.getElementById("questionDiffBadge");

    if (headerTopicText) {
        headerTopicText.textContent = storedTopic;
    }
    if (diffBadge) {
        diffBadge.textContent = storedDiff.toUpperCase();
        diffBadge.className = `badge eb-difficulty-badge eb-diff-${storedDiff.toLowerCase()}`;
    }

    generateTest();
}

function normalizeGeneratedQuestions(rawQuestions) {
    if (!Array.isArray(rawQuestions)) return [];

    return rawQuestions
        .filter((q) => q && typeof q === "object")
        .map((q) => ({
            question: (q.question || "").toString().trim(),
            options: Array.isArray(q.options) ? q.options.map((opt) => String(opt).trim()).filter(Boolean) : [],
            answer: (q.answer || "").toString().trim(),
            explanation: (q.explanation || "No explanation provided.").toString().trim()
        }))
        .filter((q) => q.question && q.options.length >= 2 && q.answer);
}

async function generateTest() {
    let topic = localStorage.getItem("topic");
    let num = localStorage.getItem("num");
    let difficulty = localStorage.getItem("difficulty");

    if (!topic) {
        topic = "Data Structures & Algorithms";
        localStorage.setItem("topic", topic);
    }
    if (!num) {
        num = "10";
        localStorage.setItem("num", num);
    }
    if (!difficulty) {
        difficulty = "medium";
        localStorage.setItem("difficulty", difficulty);
    }

    questions = [];
    answers = [];
    currentQuestion = 0;
    totalQuestions = 0;
    questionState = [];

    const questionTextEl = document.getElementById("questionText");
    const optionsContainer = document.getElementById("optionsContainer");
    const questionNumberEl = document.getElementById("questionNumber");
    
    if (questionNumberEl) questionNumberEl.textContent = "Generating Test...";
    if (optionsContainer) optionsContainer.innerHTML = "";
    if (questionTextEl) {
        questionTextEl.innerHTML = `
            <div class="skeleton-shimmer-wrapper">
                <div class="skeleton-line full"></div>
                <div class="skeleton-line half mt-3"></div>
                <div class="skeleton-line full mt-4"></div>
                <div class="d-flex align-items-center gap-2 mt-4 text-primary">
                    <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                    <span class="fw-semibold">ExamBuddy AI is preparing your questions...</span>
                </div>
            </div>
        `;
    }

    let lastError = "Unable to connect to the test generation engine.";
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const response = await fetch("generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    topic: topic,
                    num: parseInt(num, 10) || 10,
                    difficulty: difficulty
                })
            });

            let payload = null;
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                try {
                    payload = await response.json();
                } catch (jsonErr) {
                    // Handled below
                }
            }

            if (!response.ok) {
                const errMsg = (payload && payload.error)
                    ? payload.error
                    : `Server returned HTTP ${response.status}: ${response.statusText || "Error"}`;
                throw new Error(errMsg);
            }

            if (!payload) {
                try {
                    payload = await response.json();
                } catch (parseErr) {
                    throw new Error(`Invalid response format from server (HTTP ${response.status})`);
                }
            }

            const normalized = normalizeGeneratedQuestions(payload);
            if (normalized.length > 0) {
                questions = normalized;
                break;
            }

            throw new Error("No valid question items found in the model response.");
        } catch (err) {
            lastError = err.message || "Failed to generate questions.";
            if (attempt < 2) {
                await new Promise((r) => setTimeout(r, 800));
            }
        }
    }

    totalQuestions = questions.length;
    if (totalQuestions === 0) {
        renderGenerationError(lastError);
        return;
    }

    // Allocate time based on question count (1.5 minutes per question, min 10 min, max 45 min)
    const minutesAllowed = Math.max(10, Math.min(45, Math.round(totalQuestions * 1.5)));
    timeLeft = minutesAllowed * 60;
    startTimer();

    answers = new Array(totalQuestions).fill(null);
    questionState = questions.map(() => ({
        selected_option: null,
        is_checked: false,
        is_answered: false
    }));

    // Reset control buttons state on successful load/retry
    const nextBtn = document.getElementById("nextBtn");
    const submitBtn = document.getElementById("submitExamBtn");
    if (nextBtn) nextBtn.disabled = false;
    if (submitBtn) submitBtn.disabled = false;

    buildNavigator();
    showQuestion();
    updateAnswered();
}

function renderGenerationError(errorMessage) {
    const questionTextEl = document.getElementById("questionText");
    const questionNumberEl = document.getElementById("questionNumber");
    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");
    const submitBtn = document.getElementById("submitExamBtn");
    const checkBtn = document.getElementById("checkAnswerBtn");
    const optionsContainer = document.getElementById("optionsContainer");

    if (questionNumberEl) questionNumberEl.textContent = "Generation Error";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
    if (checkBtn) checkBtn.disabled = true;
    if (optionsContainer) optionsContainer.innerHTML = "";

    if (questionTextEl) {
        questionTextEl.innerHTML = `
            <div class="eb-generation-error">
                <div class="error-icon" aria-hidden="true">⚠️</div>
                <h3 class="error-title">Could Not Load Questions</h3>
                <p class="error-desc">${escapeHtml(errorMessage)}</p>
                <div class="d-flex gap-2 justify-content-center mt-3">
                    <button class="btn btn-primary" onclick="generateTest()">Retry Generation</button>
                    <a href="./" class="btn btn-outline-secondary">Back to Setup</a>
                </div>
            </div>
        `;
    }
}

function showQuestion() {
    if (totalQuestions === 0) return;

    const q = questions[currentQuestion];
    const state = getStateForQuestion(currentQuestion);

    const questionNumberEl = document.getElementById("questionNumber");
    const questionTextEl = document.getElementById("questionText");
    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");

    if (questionNumberEl) {
        questionNumberEl.textContent = `Question ${currentQuestion + 1} of ${totalQuestions}`;
    }
    if (questionTextEl) {
        questionTextEl.textContent = q.question;
    }

    if (prevBtn) prevBtn.disabled = currentQuestion === 0;
    if (nextBtn) {
        nextBtn.textContent = currentQuestion === totalQuestions - 1 ? "Review All" : "Next \u2192";
    }

    const optionsContainer = document.getElementById("optionsContainer");
    if (optionsContainer) {
        optionsContainer.innerHTML = "";

        q.options.forEach((opt, index) => {
            const letter = String.fromCharCode(65 + index);
            const div = document.createElement("div");
            div.className = "option";
            div.dataset.optionValue = opt;
            div.dataset.optionIndex = index;
            div.setAttribute("role", "radio");
            div.setAttribute("tabindex", "0");
            div.setAttribute("aria-checked", "false");
            div.setAttribute("aria-label", `Option ${letter}: ${stripOptionPrefix(opt)}`);

            div.innerHTML = `
                <div class="eb-opt-letter" aria-hidden="true">${letter}</div>
                <div class="eb-opt-text">${escapeHtml(stripOptionPrefix(opt))}</div>
                <div class="eb-opt-indicator" aria-hidden="true"></div>
            `;

            div.onclick = () => selectOption(opt);
            div.onkeydown = (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectOption(opt);
                } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                    e.preventDefault();
                    const next = div.nextElementSibling || optionsContainer.firstElementChild;
                    if (next) next.focus();
                } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const prev = div.previousElementSibling || optionsContainer.lastElementChild;
                    if (prev) prev.focus();
                }
            };

            optionsContainer.appendChild(div);
        });
    }

    applyQuestionVisualState(q, state || null);

    const checkButton = document.getElementById("checkAnswerBtn");
    if (checkButton) {
        checkButton.disabled = !state || !state.selected_option || state.is_checked;
    }

    renderFeedback(q, state || null);
    highlightNavigator();
    renderChatForCurrentQuestion();
}

function selectOption(opt) {
    if (isExamSubmitted) return;
    const q = questions[currentQuestion];
    const state = getStateForQuestion(currentQuestion);
    if (state && state.is_checked) return;

    answers[currentQuestion] = opt;
    if (state) {
        state.selected_option = opt;
        state.is_answered = true;
    }

    applyQuestionVisualState(q, state || null);
    clearFeedback();

    const checkButton = document.getElementById("checkAnswerBtn");
    if (checkButton && state && !state.is_checked && state.selected_option) {
        checkButton.disabled = false;
    }

    updateAnswered();
    highlightNavigator();
}

function applyQuestionVisualState(question, state) {
    const options = document.querySelectorAll("#optionsContainer .option");
    options.forEach((o) => {
        o.classList.remove("option-selected", "option-correct", "option-wrong");
        o.setAttribute("aria-checked", "false");
        const value = o.dataset.optionValue;
        if (state && state.selected_option === value) {
            o.classList.add("option-selected");
            o.setAttribute("aria-checked", "true");
        }
    });

    if (!state || !state.is_checked) return;

    const correctValue = getCorrectOptionValue(question);
    const selectedValue = state.selected_option;

    options.forEach((o) => {
        const value = o.dataset.optionValue;
        if (value === correctValue) {
            o.classList.add("option-correct");
        }
        if (value === selectedValue && value !== correctValue) {
            o.classList.add("option-wrong");
        }
    });
}

function checkAnswer() {
    if (isExamSubmitted) return;
    const q = questions[currentQuestion];
    const state = getStateForQuestion(currentQuestion);
    if (!q || !state || state.is_checked || !state.selected_option) return;

    state.is_checked = true;
    state.is_answered = true;
    answers[currentQuestion] = state.selected_option;

    applyQuestionVisualState(q, state);
    renderFeedback(q, state);

    const checkButton = document.getElementById("checkAnswerBtn");
    if (checkButton) checkButton.disabled = true;

    updateAnswered();
    highlightNavigator();
    renderChatForCurrentQuestion();
}

function clearFeedback() {
    const feedback = document.getElementById("feedbackBox");
    if (feedback) feedback.innerHTML = "";
}

function renderFeedback(question, state) {
    const feedback = document.getElementById("feedbackBox");
    if (!feedback) return;

    if (!state || !state.is_checked) {
        feedback.innerHTML = "";
        return;
    }

    const selected = state.selected_option;
    const isCorrect = isCorrectSelection(selected, question);

    if (isCorrect) {
        feedback.innerHTML = `
            <div class="correct-box" role="status">
                <div class="feedback-header">
                    <span class="feedback-icon" aria-hidden="true">&#x2714;</span>
                    <strong>Correct!</strong>
                </div>
                <div class="feedback-body">${escapeHtml(question.explanation || "Great work! You identified the correct concept.")}</div>
            </div>
        `;
    } else {
        feedback.innerHTML = `
            <div class="wrong-box" role="status">
                <div class="feedback-header">
                    <span class="feedback-icon" aria-hidden="true">&#x2716;</span>
                    <strong>Incorrect</strong>
                </div>
                <div class="feedback-correct-answer">
                    Correct Answer: <b>${escapeHtml(stripOptionPrefix(question.answer))}</b>
                </div>
                <div class="feedback-body">${escapeHtml(question.explanation || "")}</div>
            </div>
        `;
    }
}

function goToNextQuestion() {
    if (currentQuestion < totalQuestions - 1) {
        currentQuestion++;
        showQuestion();
    } else {
        // At the last question, open submit confirmation
        openSubmitModal();
    }
}

function goToPrevQuestion() {
    if (currentQuestion > 0) {
        currentQuestion--;
        showQuestion();
    }
}

function buildNavigator() {
    const grid = document.getElementById("navigatorGrid");
    if (!grid) return;
    grid.innerHTML = "";

    for (let i = 0; i < totalQuestions; i++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = i + 1;
        btn.className = "eb-nav-item";
        btn.id = `navBtn-${i}`;
        btn.setAttribute("aria-label", `Go to question ${i + 1}`);
        btn.onclick = () => {
            currentQuestion = i;
            showQuestion();
        };
        grid.appendChild(btn);
    }
}

function highlightNavigator() {
    const grid = document.getElementById("navigatorGrid");
    if (!grid) return;

    const items = grid.children;
    const navBadge = document.getElementById("navigatorCountBadge");
    let answeredCount = 0;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        item.classList.remove("is-current", "is-answered");
        const state = getStateForQuestion(i);
        const isAnswered = state ? state.is_answered : answers[i] !== null;

        if (isAnswered) answeredCount++;

        if (i === currentQuestion) {
            item.classList.add("is-current");
            item.setAttribute("aria-current", "step");
        } else {
            item.removeAttribute("aria-current");
            if (isAnswered) {
                item.classList.add("is-answered");
            }
        }

        const statusText = i === currentQuestion ? "current" : (isAnswered ? "answered" : "unanswered");
        item.setAttribute("aria-label", `Question ${i + 1} of ${totalQuestions}, ${statusText}`);
    }

    if (navBadge) {
        navBadge.textContent = `${answeredCount} / ${totalQuestions}`;
    }
}

function updateAnswered() {
    let count = 0;
    if (Array.isArray(questionState) && questionState.length) {
        count = questionState.filter((s) => s && s.is_answered).length;
    } else {
        count = answers.filter((a) => a !== null).length;
    }

    const answeredEl = document.getElementById("answeredPill");
    if (answeredEl) {
        answeredEl.textContent = `${count} / ${totalQuestions} answered`;
    }

    const bar = document.getElementById("topProgressBar");
    const container = document.getElementById("topProgressContainer");
    if (bar && totalQuestions > 0) {
        const pct = Math.round((count / totalQuestions) * 100);
        bar.style.width = `${pct}%`;
        if (container) container.setAttribute("aria-valuenow", String(pct));
    }
}

function getCurrentQuestionContext() {
    if (!questions[currentQuestion]) return null;

    const q = questions[currentQuestion];
    const state = getStateForQuestion(currentQuestion);
    const isChecked = !!(state && state.is_checked);
    const isAnswered = !!(state && state.is_answered);
    return {
        question_number: currentQuestion + 1,
        total_questions: totalQuestions,
        question: q.question,
        options: q.options,
        selected_answer: state ? state.selected_option : answers[currentQuestion],
        is_checked: isChecked,
        is_answered: isAnswered,
        ...(isChecked ? { correct_answer: q.answer, explanation: q.explanation } : {})
    };
}

// -------------------------------------------------------------
// MODERN AI CHATBOT ENGINE
// -------------------------------------------------------------
function formatBotResponse(text) {
    if (!text) return "";
    let clean = stripEmojis(text);
    let escaped = escapeHtml(clean);

    // Markdown bold: **text**
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Markdown italic: *text*
    escaped = escaped.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
    // Inline code: `code`
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bullet lists and paragraphs
    const lines = escaped.split("\n");
    let inList = false;
    let listType = "ul";
    let formattedHtml = "";

    for (let rawLine of lines) {
        const line = rawLine.trim();
        const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
        const numberMatch = line.match(/^(\d+)\.\s+(.*)$/);

        if (bulletMatch) {
            if (!inList) {
                formattedHtml += "<ul>";
                inList = true;
                listType = "ul";
            } else if (listType === "ol") {
                formattedHtml += "</ol><ul>";
                listType = "ul";
            }
            formattedHtml += `<li>${bulletMatch[1]}</li>`;
        } else if (numberMatch) {
            if (!inList) {
                formattedHtml += "<ol>";
                inList = true;
                listType = "ol";
            } else if (listType === "ul") {
                formattedHtml += "</ul><ol>";
                listType = "ol";
            }
            formattedHtml += `<li>${numberMatch[2]}</li>`;
        } else {
            if (inList) {
                formattedHtml += listType === "ol" ? "</ol>" : "</ul>";
                inList = false;
            }
            if (line) {
                formattedHtml += `<p class="mb-1">${line}</p>`;
            }
        }
    }
    if (inList) {
        formattedHtml += listType === "ol" ? "</ol>" : "</ul>";
    }

    return formattedHtml || "<p class='mb-0'>No response generated.</p>";
}

function renderChatForCurrentQuestion() {
    const container = document.getElementById("chatMessages");
    const modeText = document.getElementById("chatModeText");
    if (!container) return;

    const state = getStateForQuestion(currentQuestion);
    const isChecked = !!(state && state.is_checked);

    if (modeText) {
        modeText.textContent = isChecked ? "Solution & Explanation Mode" : "Socratic Guidance Mode";
    }

    const history = chatHistoryByQuestion[currentQuestion] || [];

    if (history.length === 0) {
        container.innerHTML = `
            <div class="chat-welcome-card">
                <div class="welcome-avatar" aria-hidden="true">✨</div>
                <div class="welcome-title">AI Study Coach for Question ${currentQuestion + 1}</div>
                <p class="welcome-desc">
                    ${isChecked 
                        ? "You’ve checked this question! Ask me to break down why the correct answer works or why specific options are wrong."
                        : "Stuck or want to check your reasoning? Ask a doubt below or tap one of the suggested prompts above!"}
                </p>
            </div>
        `;
    } else {
        let html = "";
        history.forEach((msg) => {
            if (msg.role === "user") {
                html += `
                    <div class="chat-msg-user">
                        <div class="msg-bubble">${escapeHtml(msg.content)}</div>
                    </div>
                `;
            } else {
                html += `
                    <div class="chat-msg-bot">
                        <div class="bot-avatar" aria-hidden="true">AI</div>
                        <div class="msg-bubble">${formatBotResponse(msg.content)}</div>
                    </div>
                `;
            }
        });
        container.innerHTML = html;
    }

    scrollChatToBottom();
}

function scrollChatToBottom() {
    const container = document.getElementById("chatMessages");
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function clearCurrentChat() {
    chatHistoryByQuestion[currentQuestion] = [];
    renderChatForCurrentQuestion();
    const input = document.getElementById("doubtInput");
    if (input) {
        input.value = "";
        input.focus();
    }
}

function sendQuickPrompt(promptText) {
    const input = document.getElementById("doubtInput");
    if (input) input.value = promptText;
    sendUserChatMessage(promptText);
}

function handleChatSubmit(event) {
    if (event) event.preventDefault();
    const input = document.getElementById("doubtInput");
    const query = (input?.value || "").trim();
    if (!query) return;
    sendUserChatMessage(query);
}

async function sendUserChatMessage(query) {
    if (isHintRequestInFlight || !questions[currentQuestion]) return;

    const input = document.getElementById("doubtInput");
    const sendBtn = document.getElementById("doubtAskBtn");
    const container = document.getElementById("chatMessages");

    if (!chatHistoryByQuestion[currentQuestion]) {
        chatHistoryByQuestion[currentQuestion] = [];
    }

    // 1. Append user message to UI and history
    chatHistoryByQuestion[currentQuestion].push({
        role: "user",
        content: query
    });

    if (input) input.value = "";
    if (sendBtn) sendBtn.disabled = true;
    if (input) input.disabled = true;

    // Render current history
    renderChatForCurrentQuestion();

    // Append typing bubble
    if (container) {
        const typingEl = document.createElement("div");
        typingEl.id = "chatTypingIndicator";
        typingEl.className = "chat-msg-bot";
        typingEl.innerHTML = `
            <div class="bot-avatar" aria-hidden="true">AI</div>
            <div class="chat-typing-bubble" aria-label="AI is thinking">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
        `;
        container.appendChild(typingEl);
        scrollChatToBottom();
    }

    isHintRequestInFlight = true;

    try {
        const q = questions[currentQuestion];
        const state = getStateForQuestion(currentQuestion);
        const isChecked = !!(state && state.is_checked);

        // Prepare conversation history to send (last 8 messages for context)
        const recentHistory = chatHistoryByQuestion[currentQuestion]
            .slice(0, -1) // exclude the message we just added
            .slice(-8)
            .map(m => ({ role: m.role, content: m.content }));

        const response = await fetch("chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                question: query,
                history: recentHistory,
                user_doubt: query,
                question_context: getCurrentQuestionContext()
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Chat failed");
        }

        const reply = (data.reply || "I couldn’t process that. Try rephrasing your question!").trim();

        // 2. Append assistant response to history
        chatHistoryByQuestion[currentQuestion].push({
            role: "assistant",
            content: reply
        });
    } catch (err) {
        console.error("Chat error:", err);
        chatHistoryByQuestion[currentQuestion].push({
            role: "assistant",
            content: "I ran into a temporary issue answering that. Please try asking again in a moment!"
        });
    } finally {
        isHintRequestInFlight = false;
        if (input) input.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        renderChatForCurrentQuestion();
        if (input) input.focus();
    }
}

// -------------------------------------------------------------
// TIMER LOGIC
// -------------------------------------------------------------
function startTimer() {
    if (timerInterval) clearInterval(timerInterval);

    updateTimerDisplay();

    timerInterval = setInterval(() => {
        if (isExamSubmitted) {
            clearInterval(timerInterval);
            return;
        }

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            onTimeExpired();
            return;
        }

        timeLeft--;
        updateTimerDisplay();
    }, 1000);
}

function updateTimerDisplay() {
    const timerEl = document.getElementById("timerPill");
    if (!timerEl) return;

    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerEl.textContent = `Time Left: ${minutes}:${seconds.toString().padStart(2, "0")}`;

    if (timeLeft < 120) {
        timerEl.classList.add("eb-pill-danger");
        timerEl.classList.remove("eb-pill-warning");
    } else if (timeLeft < 300) {
        timerEl.classList.add("eb-pill-warning");
        timerEl.classList.remove("eb-pill-danger");
    } else {
        timerEl.classList.remove("eb-pill-warning", "eb-pill-danger");
    }
}

function onTimeExpired() {
    const timeUpModal = document.getElementById("timeUpModal");
    if (timeUpModal) {
        timeUpModal.classList.remove("d-none");
    } else {
        confirmFinalSubmit();
    }
}

// -------------------------------------------------------------
// MODALS & CONFIRMATIONS
// -------------------------------------------------------------
function openSubmitModal() {
    let answered = 0;
    if (Array.isArray(questionState)) {
        answered = questionState.filter((s) => s && s.is_answered).length;
    } else {
        answered = answers.filter((a) => a !== null).length;
    }
    const unanswered = totalQuestions - answered;

    const modalAnswered = document.getElementById("modalAnsweredCount");
    const modalUnanswered = document.getElementById("modalUnansweredCount");
    const modalTotal = document.getElementById("modalTotalCount");
    const modalWarning = document.getElementById("modalWarningText");

    if (modalAnswered) modalAnswered.textContent = answered;
    if (modalUnanswered) modalUnanswered.textContent = unanswered;
    if (modalTotal) modalTotal.textContent = totalQuestions;

    if (modalWarning) {
        if (unanswered > 0) {
            modalWarning.innerHTML = `⚠️ <b>Note:</b> You have <b>${unanswered}</b> unanswered question(s). You can return to finish them, or submit now to view results.`;
            modalWarning.className = "eb-modal-warning text-warning-emphasis";
        } else {
            modalWarning.innerHTML = `🎉 <b>Awesome!</b> You have answered all ${totalQuestions} questions. Ready to view your comprehensive scorecard?`;
            modalWarning.className = "eb-modal-warning text-success-emphasis";
        }
    }

    const modal = document.getElementById("submitModal");
    if (modal) {
        modal.classList.remove("d-none");
        const confirmBtn = document.getElementById("confirmSubmitBtn");
        if (confirmBtn) confirmBtn.focus();
    }
}

function closeSubmitModal() {
    const modal = document.getElementById("submitModal");
    if (modal) modal.classList.add("d-none");
    const submitBtn = document.getElementById("submitExamBtn");
    if (submitBtn) submitBtn.focus();
}

function confirmExitExam(event) {
    if (event) event.preventDefault();
    if (isExamSubmitted) {
        window.location.href = "./";
        return;
    }

    const modal = document.getElementById("exitModal");
    if (modal) {
        modal.classList.remove("d-none");
    }
}

function closeExitModal() {
    const modal = document.getElementById("exitModal");
    if (modal) modal.classList.add("d-none");
}

function openChatWindow() {
    const win = document.getElementById("floatingChatWindow");
    const trigger = document.getElementById("floatingChatTrigger");
    if (win) {
        win.classList.remove("d-none");
    }
    if (trigger) {
        trigger.style.display = "none";
    }
    scrollChatToBottom();
    const input = document.getElementById("doubtInput");
    if (input) {
        setTimeout(() => input.focus(), 80);
    }
}

function closeChatWindow() {
    const win = document.getElementById("floatingChatWindow");
    const trigger = document.getElementById("floatingChatTrigger");
    if (win) {
        win.classList.add("d-none");
    }
    if (trigger) {
        trigger.style.display = "flex";
    }
}

function toggleChatWindow() {
    const win = document.getElementById("floatingChatWindow");
    if (win && win.classList.contains("d-none")) {
        openChatWindow();
    } else {
        closeChatWindow();
    }
}

function handleGlobalKeydown(e) {
    if (e.key === "Escape") {
        closeSubmitModal();
        closeExitModal();
        closeChatWindow();
        return;
    }

    // Number keys 1-4 for quick option selection when not typing in an input
    const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
    if (activeTag === "input" || activeTag === "textarea") return;

    if (["1", "2", "3", "4"].includes(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const options = document.querySelectorAll("#optionsContainer .option");
        if (options && options[idx]) {
            options[idx].click();
        }
    }
}

// -------------------------------------------------------------
// SUBMIT EXAM & RESULTS VIEW
// -------------------------------------------------------------
function confirmFinalSubmit() {
    // Close any open modals and windows
    closeSubmitModal();
    closeChatWindow();
    const trigger = document.getElementById("floatingChatTrigger");
    if (trigger) trigger.style.display = "none";
    const timeUpModal = document.getElementById("timeUpModal");
    if (timeUpModal) timeUpModal.classList.add("d-none");

    isExamSubmitted = true;
    if (timerInterval) clearInterval(timerInterval);

    renderResultsDashboard();
}

function renderResultsDashboard() {
    let score = 0;
    let answeredCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;

    questions.forEach((q, i) => {
        const userChoice = answers[i];
        if (userChoice) {
            answeredCount++;
            if (isCorrectSelection(userChoice, q)) {
                score++;
            } else {
                wrongCount++;
            }
        } else {
            skippedCount++;
        }
    });

    const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

    let gradeTitle = "Needs Practice";
    let gradeBadgeClass = "grade-badge-low";
    if (percentage >= 85) {
        gradeTitle = "Excellent Mastery";
        gradeBadgeClass = "grade-badge-high";
    } else if (percentage >= 70) {
        gradeTitle = "Proficient & Strong";
        gradeBadgeClass = "grade-badge-mid";
    } else if (percentage >= 50) {
        gradeTitle = "Fair Understanding";
        gradeBadgeClass = "grade-badge-fair";
    }

    // Hide sidebar and top pills
    const sidebar = document.getElementById("sidebarColumn");
    const questionCol = document.getElementById("questionColumn");
    const answeredPill = document.getElementById("answeredPill");
    const timerPill = document.getElementById("timerPill");

    if (sidebar) sidebar.style.display = "none";
    if (questionCol) {
        questionCol.className = "col-12 col-xl-10";
    }
    if (answeredPill) answeredPill.textContent = `Completed (${score}/${totalQuestions})`;
    if (timerPill) timerPill.textContent = "Evaluation Finished";

    // Build rich Results HTML
    const panel = document.getElementById("questionCardBody");
    if (!panel) return;

    let reviewCardsHTML = "";
    questions.forEach((q, i) => {
        const userChoice = answers[i];
        const isAnswered = !!userChoice;
        const isCorrect = isAnswered && isCorrectSelection(userChoice, q);
        const correctChoice = getCorrectOptionValue(q) || q.answer;

        let statusClass = "review-wrong";
        let statusTag = "Incorrect";
        let filterCategory = "wrong";

        if (!isAnswered) {
            statusClass = "review-skipped";
            statusTag = "Unanswered";
            filterCategory = "skipped";
        } else if (isCorrect) {
            statusClass = "review-correct";
            statusTag = "Correct";
            filterCategory = "correct";
        }

        reviewCardsHTML += `
            <div class="result-review-card ${statusClass}" data-category="${filterCategory}">
                <div class="review-card-header">
                    <span class="review-qnum">Question ${i + 1}</span>
                    <span class="review-status-tag ${filterCategory}">${statusTag}</span>
                </div>
                <h3 class="review-question-text">${escapeHtml(q.question)}</h3>

                <div class="review-choices-grid">
                    <div class="review-choice-item ${isAnswered ? (isCorrect ? 'is-correct-choice' : 'is-wrong-choice') : 'is-skipped'}">
                        <span class="choice-label">Your Response:</span>
                        <span class="choice-val">${escapeHtml(isAnswered ? stripOptionPrefix(userChoice) : "Skipped")}</span>
                    </div>
                    <div class="review-choice-item is-correct-choice">
                        <span class="choice-label">Correct Answer:</span>
                        <span class="choice-val">${escapeHtml(stripOptionPrefix(correctChoice))}</span>
                    </div>
                </div>

                <div class="review-explanation">
                    <strong>Explanation:</strong>
                    <p class="mb-0 mt-1">${escapeHtml(q.explanation || "No explanation provided.")}</p>
                </div>
            </div>
        `;
    });

    panel.innerHTML = `
        <div class="results-dashboard">
            <div class="results-hero">
                <div class="results-hero-left">
                    <span class="results-tag">Test Performance Report</span>
                    <h2 class="results-title">${escapeHtml(localStorage.getItem("topic") || "Mock Test")}</h2>
                    <div class="results-grade-pill ${gradeBadgeClass}">${gradeTitle}</div>
                </div>
                <div class="results-score-circle">
                    <div class="score-number">${percentage}%</div>
                    <div class="score-subtext">${score} of ${totalQuestions} Correct</div>
                </div>
            </div>

            <!-- Stats Bar -->
            <div class="results-stats-row">
                <div class="res-stat-card">
                    <span class="res-stat-val text-primary">${score}</span>
                    <span class="res-stat-lbl">Correct</span>
                </div>
                <div class="res-stat-card">
                    <span class="res-stat-val text-danger">${wrongCount}</span>
                    <span class="res-stat-lbl">Incorrect</span>
                </div>
                <div class="res-stat-card">
                    <span class="res-stat-val text-warning">${skippedCount}</span>
                    <span class="res-stat-lbl">Unanswered</span>
                </div>
                <div class="res-stat-card">
                    <span class="res-stat-val text-success">${percentage}%</span>
                    <span class="res-stat-lbl">Accuracy</span>
                </div>
            </div>

            <!-- Filter and Actions Toolbar -->
            <div class="results-toolbar">
                <div class="results-filter-pills" role="radiogroup" aria-label="Filter results">
                    <button type="button" class="res-filter-btn is-active" data-filter="all" onclick="filterResults('all')">
                        All Questions (${totalQuestions})
                    </button>
                    <button type="button" class="res-filter-btn" data-filter="wrong" onclick="filterResults('wrong')">
                        Incorrect (${wrongCount})
                    </button>
                    <button type="button" class="res-filter-btn" data-filter="correct" onclick="filterResults('correct')">
                        Correct (${score})
                    </button>
                    ${skippedCount > 0 ? `
                    <button type="button" class="res-filter-btn" data-filter="skipped" onclick="filterResults('skipped')">
                        Unanswered (${skippedCount})
                    </button>` : ''}
                </div>

                <div class="results-action-buttons">
                    <button type="button" class="btn btn-primary eb-res-btn" onclick="restartSameExam()">
                        &#x21bb; Retake Test
                    </button>
                    <a href="./" class="btn btn-outline-secondary eb-res-btn">
                        New Topic Test
                    </a>
                </div>
            </div>

            <!-- Questions Review List -->
            <div class="results-review-list mt-4" id="reviewListContainer">
                ${reviewCardsHTML}
            </div>
        </div>
    `;

    // Scroll to top of results smoothly
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function filterResults(category) {
    currentFilter = category;
    const filterBtns = document.querySelectorAll(".res-filter-btn");
    filterBtns.forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.filter === category);
    });

    const cards = document.querySelectorAll(".result-review-card");
    cards.forEach((card) => {
        if (category === "all" || card.dataset.category === category) {
            card.style.display = "block";
        } else {
            card.style.display = "none";
        }
    });
}

function restartSameExam() {
    window.location.reload();
}
