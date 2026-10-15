function selectTopicPreset(topicName) {
    const topicInput = document.getElementById("topic");
    if (!topicInput) return;
    topicInput.value = topicName;
    topicInput.focus();
    
    // Clear error if any
    const errorEl = document.getElementById("setupError");
    if (errorEl) errorEl.textContent = "";

    // Highlight active topic chip
    const chips = document.querySelectorAll(".topic-chip");
    chips.forEach(chip => {
        chip.classList.toggle("is-active", chip.textContent.trim() === topicName || chip.getAttribute("onclick")?.includes(topicName));
    });
}

function selectNumPreset(count) {
    const numInput = document.getElementById("num");
    if (numInput) {
        numInput.value = count;
    }

    const presetBtns = document.querySelectorAll(".preset-btn");
    presetBtns.forEach(btn => {
        btn.classList.toggle("is-active", parseInt(btn.dataset.count, 10) === count);
    });

    const errorEl = document.getElementById("setupError");
    if (errorEl) errorEl.textContent = "";
}

function onCustomNumInput(value) {
    const count = parseInt(value, 10);
    const presetBtns = document.querySelectorAll(".preset-btn");
    presetBtns.forEach(btn => {
        btn.classList.toggle("is-active", parseInt(btn.dataset.count, 10) === count);
    });
}

// Add visual selection handler for difficulty cards
document.addEventListener("DOMContentLoaded", () => {
    const diffRadios = document.querySelectorAll(".diff-radio");
    diffRadios.forEach(radio => {
        radio.addEventListener("change", () => {
            document.querySelectorAll(".diff-card").forEach(card => card.classList.remove("is-selected"));
            const parentCard = radio.closest(".diff-card");
            if (parentCard) parentCard.classList.add("is-selected");
        });
    });

    // Also support keyboard navigation on diff cards
    const diffCards = document.querySelectorAll(".diff-card");
    diffCards.forEach(card => {
        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                const radio = card.querySelector(".diff-radio");
                if (radio) {
                    radio.checked = true;
                    radio.dispatchEvent(new Event("change"));
                }
            }
        });
    });
});

function startExam(event) {
    if (event) {
        event.preventDefault();
    }

    const topicInput = document.getElementById("topic");
    const numInput = document.getElementById("num");
    const difficultyRadio = document.querySelector('input[name="difficulty"]:checked');
    const errorEl = document.getElementById("setupError");
    const startBtn = document.getElementById("startBtn");

    const topic = (topicInput?.value || "").trim();
    const num = parseInt(numInput?.value, 10);
    const difficulty = difficultyRadio ? difficultyRadio.value : "medium";

    if (errorEl) errorEl.textContent = "";

    if (!topic) {
        if (errorEl) errorEl.textContent = "Please enter a topic or select one of the suggestions above.";
        if (topicInput) topicInput.focus();
        return;
    }

    if (isNaN(num) || num < 3 || num > 30) {
        if (errorEl) errorEl.textContent = "Please select between 3 and 30 questions.";
        if (numInput) numInput.focus();
        return;
    }

    if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerHTML = `
            <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            <span class="btn-text">Initializing Test Environment...</span>
        `;
    }

    try {
        localStorage.setItem("topic", topic);
        localStorage.setItem("num", String(num));
        localStorage.setItem("difficulty", difficulty);
        localStorage.setItem("examStartTime", String(Date.now()));
    } catch (e) {
        console.warn("localStorage error", e);
    }

    window.location.href = "/exam";
}
