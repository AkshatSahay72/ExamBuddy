let questions = []
let answers = []
let currentQuestion = 0
let totalQuestions = 0
let isChatRequestInFlight = false
let currentChatHistory = []
let questionState = []

window.onload = () => {
    generateTest()
    const chatInput = document.getElementById("chatInput")
    if (chatInput) {
        chatInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault()
                sendMessage()
            }
        })
    }

    const checkButton = document.getElementById("checkAnswerBtn")
    if (checkButton) {
        checkButton.addEventListener("click", checkAnswer)
    }
}

function escapeHtml(text) {
    const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    }
    return text.replace(/[&<>"']/g, (char) => map[char])
}

function stripEmojis(text) {
    return text.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").trim()
}

function stripOptionPrefix(text) {
    const value = (text || "").toString().trim()
    return value
        .replace(/^(?:option\s*)?[A-Da-d]\s*[\)\].:\-]\s*/i, "")
        .replace(/^\(?[1-4]\)?\s*[\)\].:\-]\s*/i, "")
        .trim()
}

function getAnswerLetter(answerText) {
    const match = (answerText || "").toString().trim().match(/^(?:option\s*)?([A-Da-d])(?:\b|[\)\].:\-])/i)
    return match ? match[1].toUpperCase() : null
}

function isCorrectSelection(selectedOption, question) {
    const rawAnswer = (question && question.answer ? String(question.answer) : "").trim()
    const rawSelected = (selectedOption || "").toString().trim()
    if (!rawAnswer || !rawSelected) return false

    if (rawSelected === rawAnswer) return true

    const selectedClean = stripOptionPrefix(rawSelected).toLowerCase()
    const answerClean = stripOptionPrefix(rawAnswer).toLowerCase()
    if (selectedClean && selectedClean === answerClean) return true

    const answerLetter = getAnswerLetter(rawAnswer)
    if (!answerLetter || !Array.isArray(question.options)) return false

    const answerIndex = answerLetter.charCodeAt(0) - 65
    return question.options[answerIndex] === selectedOption
}

function getCorrectOptionValue(question) {
    if (!question || !Array.isArray(question.options)) return null

    const rawAnswer = (question.answer || "").toString().trim()
    if (!rawAnswer) return null

    const directMatch = question.options.find((opt) => {
        if (opt === rawAnswer) return true
        const optClean = stripOptionPrefix(opt).toLowerCase()
        const ansClean = stripOptionPrefix(rawAnswer).toLowerCase()
        return optClean && optClean === ansClean
    })
    if (directMatch) {
        return directMatch
    }

    const answerLetter = getAnswerLetter(rawAnswer)
    if (!answerLetter) return null

    const idx = answerLetter.charCodeAt(0) - 65
    return question.options[idx] || null
}

function getStateForQuestion(index) {
    if (!Array.isArray(questionState) || !questionState[index]) return null
    return questionState[index]
}

function getOrCreateFeedbackBox() {
    let feedback = document.getElementById("feedbackBox")
    if (!feedback) {
        feedback = document.createElement("div")
        feedback.id = "feedbackBox"
        const panel = document.querySelector(".question-panel")
        if (panel) {
            panel.appendChild(feedback)
        }
    }
    return feedback
}

function clearFeedback() {
    const feedback = document.getElementById("feedbackBox")
    if (feedback) {
        feedback.innerHTML = ""
    }
}

function renderFeedback(question, state) {
    const feedback = getOrCreateFeedbackBox()
    if (!state || !state.is_checked) {
        feedback.innerHTML = ""
        return
    }

    const selected = state.selected_option
    const isCorrect = isCorrectSelection(selected, question)

    if (isCorrect) {
        feedback.innerHTML = `
<div class="correct-box">
Correct<br>
${escapeHtml(question.explanation || "")}
</div>
`
    } else {
        feedback.innerHTML = `
<div class="wrong-box">
Wrong<br>
Correct answer: <b>${escapeHtml(stripOptionPrefix(question.answer))}</b><br>
${escapeHtml(question.explanation || "")}
</div>
`
    }
}

function applyQuestionVisualState(question, state) {
    const options = document.querySelectorAll("#optionsContainer .option")
    options.forEach((o) => {
        o.classList.remove("option-selected", "option-correct", "option-wrong")
        const value = o.dataset.optionValue
        if (state && state.selected_option === value) {
            o.classList.add("option-selected")
        }
    })

    if (!state || !state.is_checked) return

    const correctValue = getCorrectOptionValue(question)
    const selectedValue = state.selected_option

    options.forEach((o) => {
        const value = o.dataset.optionValue
        if (value === correctValue) {
            o.classList.add("option-correct")
        }
        if (value === selectedValue && value !== correctValue) {
            o.classList.add("option-wrong")
        }
    })
}

function appendChatMessage(role, content, persist = true) {
    const chatBox = document.getElementById("chatMessages")
    if (!chatBox) return

    const cleanContent = stripEmojis(content || "")
    if (!cleanContent) return
    const safeContent = escapeHtml(cleanContent)

    const cls = role === "user" ? "user-msg" : "bot-msg"
    chatBox.innerHTML += `<div class="${cls}">${safeContent}</div>`
    chatBox.scrollTop = chatBox.scrollHeight

    if (!persist) return
    currentChatHistory.push({ role, content: cleanContent })
}

function renderChatForCurrentQuestion() {
    const chatBox = document.getElementById("chatMessages")
    if (!chatBox) return
    chatBox.innerHTML = ""

    currentChatHistory.forEach((msg) => {
        const cls = msg.role === "user" ? "user-msg" : "bot-msg"
        chatBox.innerHTML += `<div class="${cls}">${escapeHtml(msg.content || "")}</div>`
    })
    chatBox.scrollTop = chatBox.scrollHeight
}

function updateChatMeta() {
    const meta = document.getElementById("chatMeta")
    if (!meta) return
    meta.innerText = totalQuestions > 0
        ? `Question ${currentQuestion + 1} help`
        : "General help"
}

function getCurrentQuestionContext() {
    if (!questions[currentQuestion]) return null

    const q = questions[currentQuestion]
    const state = getStateForQuestion(currentQuestion)
    return {
        question_number: currentQuestion + 1,
        total_questions: totalQuestions,
        question: q.question,
        options: q.options,
        selected_answer: state ? (state.selected_option || null) : (answers[currentQuestion] || null),
        correct_answer: q.answer,
        explanation: q.explanation
    }
}

function normalizeGeneratedQuestions(rawQuestions) {
    if (!Array.isArray(rawQuestions)) return []

    return rawQuestions
        .filter((q) => q && typeof q === "object")
        .map((q) => ({
            question: (q.question || "").toString().trim(),
            options: Array.isArray(q.options) ? q.options.map((opt) => String(opt).trim()).filter(Boolean) : [],
            answer: (q.answer || "").toString().trim(),
            explanation: (q.explanation || "No explanation provided.").toString().trim()
        }))
        .filter((q) => q.question && q.options.length >= 2 && q.answer)
}

async function generateTest() {
    const topic = localStorage.getItem("topic")
    const num = localStorage.getItem("num")
    const difficulty = localStorage.getItem("difficulty")

    const questionTextEl = document.getElementById("questionText")
    if (questionTextEl) {
        questionTextEl.innerText = "Generating questions..."
    }

    let lastError = "Unknown error"
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch("/generate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    topic: topic,
                    num: num,
                    difficulty: difficulty
                })
            })

            const payload = await response.json()
            if (!response.ok) {
                throw new Error(payload.error || "Generate API error")
            }

            const normalized = normalizeGeneratedQuestions(payload)
            if (normalized.length > 0) {
                questions = normalized
                break
            }

            throw new Error("No valid questions were returned.")
        } catch (err) {
            lastError = err.message || "Failed to generate questions."
            if (attempt < 3) {
                await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
            }
        }
    }

    totalQuestions = questions.length
    if (totalQuestions === 0) {
        if (questionTextEl) {
            questionTextEl.innerText = `Could not load questions. ${lastError}`
        }
        return
    }

    answers = new Array(totalQuestions).fill(null)
    questionState = questions.map(() => ({
        selected_option: null,
        is_checked: false,
        is_answered: false
    }))

    buildNavigator()
    showQuestion()
    updateAnswered()
}

function showQuestion() {
    if (totalQuestions === 0) {
        document.getElementById("questionText").innerText = "No questions generated."
        return
    }

    const q = questions[currentQuestion]
    const state = getStateForQuestion(currentQuestion)

    document.getElementById("questionNumber").innerText =
        `Question ${currentQuestion + 1} of ${totalQuestions}`
    document.getElementById("questionText").innerText = q.question

    const optionsContainer = document.getElementById("optionsContainer")
    optionsContainer.innerHTML = ""

    q.options.forEach((opt, index) => {
        const div = document.createElement("div")
        div.classList.add("option")
        div.dataset.optionValue = opt
        div.innerHTML = `<b>${String.fromCharCode(65 + index)}</b> ${escapeHtml(stripOptionPrefix(opt))}`
        div.onclick = () => selectOption(opt)
        optionsContainer.appendChild(div)
    })

    applyQuestionVisualState(q, state || null)

    const checkButton = document.getElementById("checkAnswerBtn")
    if (checkButton) {
        if (!state || !state.selected_option || state.is_checked) {
            checkButton.disabled = true
        } else {
            checkButton.disabled = false
        }
    }

    renderFeedback(q, state || null)

    highlightNavigator()
    updateChatMeta()
    currentChatHistory = []
    renderChatForCurrentQuestion()
}

function selectOption(opt) {
    const q = questions[currentQuestion]
    const state = getStateForQuestion(currentQuestion)
    if (state && state.is_checked) {
        return
    }

    answers[currentQuestion] = opt
    if (state) {
        state.selected_option = opt
        state.is_answered = true
    }

    applyQuestionVisualState(q, state || null)
    clearFeedback()

    const checkButton = document.getElementById("checkAnswerBtn")
    if (checkButton && state && !state.is_checked && state.selected_option) {
        checkButton.disabled = false
    }

    updateAnswered()
    highlightNavigator()
}

function checkAnswer() {
    const q = questions[currentQuestion]
    const state = getStateForQuestion(currentQuestion)
    if (!q || !state || state.is_checked || !state.selected_option) {
        return
    }

    state.is_checked = true
    state.is_answered = true
    answers[currentQuestion] = state.selected_option

    applyQuestionVisualState(q, state)
    renderFeedback(q, state)

    const checkButton = document.getElementById("checkAnswerBtn")
    if (checkButton) {
        checkButton.disabled = true
    }

    updateAnswered()
    highlightNavigator()
}

document.getElementById("nextBtn").onclick = () => {
    if (currentQuestion < totalQuestions - 1) {
        currentQuestion++
        showQuestion()
    }
}

document.getElementById("prevBtn").onclick = () => {
    if (currentQuestion > 0) {
        currentQuestion--
        showQuestion()
    }
}

function buildNavigator() {
    const grid = document.getElementById("navigatorGrid")
    grid.innerHTML = ""

    for (let i = 0; i < totalQuestions; i++) {
        const box = document.createElement("div")
        box.innerText = i + 1
        box.onclick = () => {
            currentQuestion = i
            showQuestion()
        }
        grid.appendChild(box)
    }
}

function highlightNavigator() {
    const grid = document.getElementById("navigatorGrid").children

    for (let i = 0; i < grid.length; i++) {
        grid[i].style.background = "#d9dee7"
        grid[i].style.color = "black"

        const state = getStateForQuestion(i)
        const isAnswered = state ? state.is_answered : answers[i] !== null

        if (i === currentQuestion) {
            grid[i].style.background = "#3b6ef3"
            grid[i].style.color = "white"
        } else if (isAnswered) {
            grid[i].style.background = "#2ecc71"
            grid[i].style.color = "white"
        }
    }
}

function updateAnswered() {
    let count = 0
    if (Array.isArray(questionState) && questionState.length) {
        count = questionState.filter((s) => s && s.is_answered).length
    } else {
        count = answers.filter(a => a !== null).length
    }
    document.querySelector(".answered").innerText = `${count} / ${totalQuestions} answered`
}

function submitExam() {
    let score = 0
    let resultHTML = `<h2 class="result-title">Exam Results</h2>`

    questions.forEach((q, i) => {
        const correct = isCorrectSelection(answers[i], q)
        if (correct) score++
        const userAnswer = answers[i] ? stripOptionPrefix(answers[i]) : "Not answered"
        const correctAnswer = stripOptionPrefix(q.answer)

        resultHTML += `
<div class="result-card ${correct ? "correct-card" : "wrong-card"}">
<h3>Q${i + 1} ${correct ? "Correct" : "Wrong"}</h3>
<p>${escapeHtml(q.question || "")}</p>
<p><b>Your Answer:</b> ${escapeHtml(userAnswer)}</p>
<p><b>Correct:</b> ${escapeHtml(correctAnswer)}</p>
<p class="explanation">${escapeHtml(q.explanation || "")}</p>
</div>
`
    })

    resultHTML += `
<div class="result-actions">
<button class="result-btn" onclick="restartExam()">Restart Test</button>
<button class="result-btn secondary" onclick="goHome()">Go Home</button>
</div>
`
    resultHTML += `<h2 class="score-box">Score: ${score}/${questions.length}</h2>`
    document.querySelector(".question-panel").innerHTML = resultHTML

    const submitButton = document.querySelector(".submit-btn")
    if (submitButton) {
        submitButton.style.display = "none"
    }
}

function restartExam() {
    window.location.href = "/exam"
}

function goHome() {
    window.location.href = "/"
}

let timeLeft = 30 * 60
setInterval(() => {
    if (timeLeft <= 0) return

    timeLeft--

    const minutes = Math.floor(timeLeft / 60)
    const seconds = timeLeft % 60

    document.querySelector(".timer").innerText =
        `Time Left: ${minutes}:${seconds.toString().padStart(2, "0")}`
}, 1000)

function toggleChat() {
    const chat = document.getElementById("chatWindow")
    chat.style.display = chat.style.display === "flex" ? "none" : "flex"
    if (chat.style.display === "flex") {
        updateChatMeta()
        renderChatForCurrentQuestion()
    }
}

async function sendMessage() {
    if (isChatRequestInFlight) return

    const input = document.getElementById("chatInput")
    const sendButton = document.getElementById("chatSendBtn")
    const message = input.value.trim()

    if (message === "") return

    const cleanUserMessage = stripEmojis(message)
    if (cleanUserMessage === "") {
        input.value = ""
        return
    }

    const historyForApi = currentChatHistory
        .slice(-4)
        .map((msg) => ({
            role: msg.role,
            content: msg.content
        }))

    appendChatMessage("user", cleanUserMessage, true)
    input.value = ""

    try {
        isChatRequestInFlight = true
        if (sendButton) sendButton.disabled = true
        appendChatMessage("assistant", "Typing...", false)

        const response = await fetch("/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                question: cleanUserMessage,
                history: historyForApi,
                question_context: getCurrentQuestionContext()
            })
        })

        const data = await response.json()
        if (!response.ok) {
            throw new Error(data.error || "Chat API failed")
        }

        renderChatForCurrentQuestion()
        const cleanReply = stripEmojis(data.reply || "")
        appendChatMessage("assistant", cleanReply, true)
    } catch (err) {
        console.error(err)
        renderChatForCurrentQuestion()
        appendChatMessage("assistant", "Chatbot error. Please try again.", false)
    } finally {
        isChatRequestInFlight = false
        if (sendButton) sendButton.disabled = false
    }
}
