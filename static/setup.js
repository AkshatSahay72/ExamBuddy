function startExam(event) {
    if (event) {
        event.preventDefault()
    }

    const topicInput = document.getElementById("topic")
    const numInput = document.getElementById("num")
    const difficultyInput = document.getElementById("difficulty")
    const errorEl = document.getElementById("setupError")
    const startBtn = document.getElementById("startBtn")

    const topic = (topicInput.value || "").trim()
    const num = Number(numInput.value)
    const difficulty = difficultyInput.value

    errorEl.innerText = ""

    if (!topic) {
        errorEl.innerText = "Please enter a topic."
        return
    }

    if (!Number.isInteger(num) || num < 3 || num > 30) {
        errorEl.innerText = "Number of questions must be between 3 and 30."
        return
    }

    startBtn.disabled = true
    startBtn.innerText = "Preparing..."

    localStorage.setItem("topic", topic)
    localStorage.setItem("num", String(num))
    localStorage.setItem("difficulty", difficulty)

    window.location.href = "/exam"
}
