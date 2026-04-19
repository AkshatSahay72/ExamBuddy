let questions = []
let answers = []
let currentQuestion = 0
let totalQuestions = 0
let questionState = []
let isHintRequestInFlight = false

window.onload = () => {
    generateTest()

    const checkButton = document.getElementById("checkAnswerBtn")
    if (checkButton) {
        checkButton.addEventListener("click", checkAnswer)
    }

    const hintBtn = document.getElementById("hintBtn")
    if (hintBtn) {
        hintBtn.addEventListener("click", generateHint)
    }

    const doubtInput = document.getElementById("doubtInput")
    const doubtAskBtn = document.getElementById("doubtAskBtn")
    if (doubtAskBtn) {
        doubtAskBtn.addEventListener("click", askDoubt)
    }
    if (doubtInput) {
        doubtInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault()
                askDoubt()
            }
        })
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
        o.setAttribute("aria-checked", "false")
        const value = o.dataset.optionValue
        if (state && state.selected_option === value) {
            o.classList.add("option-selected")
            o.setAttribute("aria-checked", "true")
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

function getCurrentQuestionContext() {
    if (!questions[currentQuestion]) return null

    const q = questions[currentQuestion]
    const state = getStateForQuestion(currentQuestion)
    const isChecked = !!(state && state.is_checked)
    const isAnswered = !!(state && state.is_answered)
    return {
        question_number: currentQuestion + 1,
        total_questions: totalQuestions,
        question: q.question,
        options: q.options,
        selected_answer: state ? (state.selected_option || null) : (answers[currentQuestion] || null),
        is_checked: isChecked,
        is_answered: isAnswered,
        ...(isChecked ? { correct_answer: q.answer, explanation: q.explanation } : {})
    }
}

function setAiResponseMode(isChecked) {
    const title = document.getElementById("doubtResponseTitle")
    if (!title) return
    title.innerText = isChecked ? "✅ Explanation" : "💡 Guidance"
}

function resetHintPanel() {
    const hintText = document.getElementById("hintText")
    const hintExplanation = document.getElementById("hintExplanation")
    const hintConcepts = document.getElementById("hintConcepts")
    const loading = document.getElementById("hintLoading")
    const doubtLoading = document.getElementById("doubtLoading")
    const doubtResponse = document.getElementById("doubtResponse")
    const doubtInput = document.getElementById("doubtInput")
    const doubtTitle = document.getElementById("doubtResponseTitle")

    if (loading) loading.classList.add("d-none")
    if (doubtLoading) doubtLoading.classList.add("d-none")
    if (hintText) hintText.innerText = "Click “Generate Hint” to get a nudge without revealing the answer."
    if (hintExplanation) hintExplanation.innerText = "—"
    if (hintConcepts) hintConcepts.innerHTML = `<li class="eb-hint-muted">—</li>`
    if (doubtTitle) doubtTitle.innerText = "💡 Guidance"
    if (doubtResponse) {
        doubtResponse.classList.add("eb-hint-muted")
        doubtResponse.innerText = "—"
    }
    if (doubtInput) doubtInput.value = ""
}

function setHintLoading(isLoading) {
    const loading = document.getElementById("hintLoading")
    const hintBtn = document.getElementById("hintBtn")
    if (loading) {
        loading.classList.toggle("d-none", !isLoading)
    }
    if (hintBtn) {
        hintBtn.disabled = isLoading
        hintBtn.innerText = isLoading ? "Generating..." : "Generate Hint"
    }
}

function parseHintReply(text) {
    const cleaned = stripEmojis((text || "").toString()).trim()
    if (!cleaned) {
        return { hint: "", explanation: "", concepts: [] }
    }

    const normalize = (s) => (s || "").toString().trim()
    const pickSection = (label) => {
        const re = new RegExp(String.raw`(?:^|\n)\s*${label}\s*:\s*([\s\S]*?)(?=\n\s*(?:Hint|Explanation|Key\s*Concepts?)\s*:|$)`, "i")
        const m = cleaned.match(re)
        return m ? normalize(m[1]) : ""
    }

    const hint = pickSection("Hint")
    const explanation = pickSection("Explanation")
    const conceptsRaw = pickSection("Key\\s*Concepts?")

    const concepts = conceptsRaw
        ? conceptsRaw
            .split("\n")
            .map((l) => l.replace(/^\s*[-*•]\s+/, "").trim())
            .filter(Boolean)
        : []

    // If the model didn't follow the template, degrade gracefully.
    if (!hint && !explanation && concepts.length === 0) {
        return { hint: cleaned, explanation: "", concepts: [] }
    }

    return { hint, explanation, concepts }
}

async function generateHint() {
    if (isHintRequestInFlight) return
    if (!questions[currentQuestion]) return

    const hintText = document.getElementById("hintText")
    const hintExplanation = document.getElementById("hintExplanation")
    const hintConcepts = document.getElementById("hintConcepts")

    try {
        isHintRequestInFlight = true
        setHintLoading(true)

        const prompt =
            "You are an AI exam assistant. Generate help WITHOUT revealing the correct answer.\n" +
            "Return exactly in this format:\n" +
            "Hint: <2-4 lines>\n" +
            "Explanation: <short concept-level explanation>\n" +
            "Key Concepts:\n" +
            "- <bullet>\n" +
            "- <bullet>\n"

        const response = await fetch("/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                question: prompt,
                history: [],
                question_context: getCurrentQuestionContext()
            })
        })

        const data = await response.json()
        if (!response.ok) {
            throw new Error(data.error || "Hint API failed")
        }

        const parsed = parseHintReply(data.reply || "")
        if (hintText) hintText.innerText = parsed.hint || "No hint available."
        if (hintExplanation) hintExplanation.innerText = parsed.explanation || "—"
        if (hintConcepts) {
            if (parsed.concepts && parsed.concepts.length) {
                hintConcepts.innerHTML = parsed.concepts.map((c) => `<li>${escapeHtml(c)}</li>`).join("")
            } else {
                hintConcepts.innerHTML = `<li class="eb-hint-muted">—</li>`
            }
        }
    } catch (err) {
        console.error(err)
        if (hintText) hintText.innerText = "Couldn’t generate a hint right now. Please try again."
        if (hintExplanation) hintExplanation.innerText = "—"
        if (hintConcepts) hintConcepts.innerHTML = `<li class="eb-hint-muted">—</li>`
    } finally {
        setHintLoading(false)
        isHintRequestInFlight = false
    }
}

function setDoubtLoading(isLoading) {
    const loading = document.getElementById("doubtLoading")
    const askBtn = document.getElementById("doubtAskBtn")
    if (loading) {
        loading.classList.toggle("d-none", !isLoading)
    }
    if (askBtn) {
        askBtn.disabled = isLoading
        askBtn.innerText = isLoading ? "Asking..." : "Ask"
    }
}

async function askDoubt() {
    if (isHintRequestInFlight) return
    if (!questions[currentQuestion]) return

    const input = document.getElementById("doubtInput")
    const responseBox = document.getElementById("doubtResponse")
    const userInput = (input?.value || "").trim()
    if (!userInput) return

    const state = getStateForQuestion(currentQuestion)
    const q = questions[currentQuestion]

    try {
        isHintRequestInFlight = true
        setDoubtLoading(true)
        if (responseBox) {
            responseBox.classList.remove("eb-hint-muted")
            responseBox.innerText = ""
        }

        const prompt =
            "You are an AI exam assistant. Help the student understand the concept without directly revealing the correct answer.\n\n" +
            `Question: ${q.question}\n` +
            `Options: ${(Array.isArray(q.options) ? q.options.join(" | ") : "")}\n` +
            `User Doubt: ${userInput}\n\n` +
            "Rules:\n" +
            "- Do NOT directly say the correct answer\n" +
            "- Do NOT eliminate options explicitly\n" +
            "- Guide the user using hints and concepts\n" +
            "- Explain the logic behind the topic\n" +
            "- If user asks directly for the answer, respond:\n" +
            "  'Try to think through the concept. I can guide you, but I won’t directly reveal the answer.'\n" +
            "- Keep answers short and helpful"

        const res = await fetch("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                question: prompt,
                history: [],
                user_doubt: userInput,
                question_context: getCurrentQuestionContext()
            })
        })

        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Doubt API failed")

        const reply = stripEmojis(data.reply || "").trim()
        if (responseBox) {
            responseBox.classList.toggle("eb-hint-muted", !reply)
            responseBox.innerText = reply || "—"
        }

        if (input) input.value = ""
    } catch (err) {
        console.error(err)
        if (responseBox) {
            responseBox.classList.remove("eb-hint-muted")
            responseBox.innerText = "Couldn’t answer right now. Please try again."
        }
    } finally {
        setDoubtLoading(false)
        isHintRequestInFlight = false
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
        div.setAttribute("role", "radio")
        div.setAttribute("aria-checked", "false")
        div.innerHTML = `
<div class="eb-opt-letter" aria-hidden="true">${String.fromCharCode(65 + index)}</div>
<div class="eb-opt-text">${escapeHtml(stripOptionPrefix(opt))}</div>
`
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
    resetHintPanel()
    setAiResponseMode(!!(state && state.is_checked))
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
    setAiResponseMode(true)
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
        box.classList.add("eb-nav-item")
        box.onclick = () => {
            currentQuestion = i
            showQuestion()
        }
        grid.appendChild(box)
    }
}

function highlightNavigator() {
    const grid = document.getElementById("navigatorGrid")?.children
    if (!grid) return

    for (let i = 0; i < grid.length; i++) {
        grid[i].classList.remove("is-current", "is-answered")
        const state = getStateForQuestion(i)
        const isAnswered = state ? state.is_answered : answers[i] !== null

        if (i === currentQuestion) {
            grid[i].classList.add("is-current")
        } else if (isAnswered) {
            grid[i].classList.add("is-answered")
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
    const answeredEl = document.querySelector(".answered")
    if (answeredEl) answeredEl.innerText = `${count} / ${totalQuestions} answered`

    const bar = document.getElementById("topProgressBar")
    if (bar && totalQuestions > 0) {
        const pct = Math.round((count / totalQuestions) * 100)
        bar.style.width = `${pct}%`
    }
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

    const submitButton = document.querySelector(".eb-btn-submit")
    if (submitButton) {
        submitButton.style.display = "none"
    }

    const sidebar = document.querySelector("aside")
    if (sidebar) {
        sidebar.style.display = "none"
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
