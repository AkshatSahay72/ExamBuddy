const fs = require("fs");
const path = require("path");
const assert = require("assert");

// Simple lightweight DOM & Browser mock for Node.js
class MockElement {
    constructor(tagName, id = "") {
        this.tagName = (tagName || "div").toUpperCase();
        this.id = id;
        this.className = "";
        this.classList = {
            _classes: new Set(),
            add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
            remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
            toggle: (c, force) => {
                if (force === undefined) {
                    if (this.classList._classes.has(c)) {
                        this.classList._classes.delete(c);
                        return false;
                    } else {
                        this.classList._classes.add(c);
                        return true;
                    }
                }
                if (force) this.classList._classes.add(c);
                else this.classList._classes.delete(c);
                return force;
            },
            contains: (c) => this.classList._classes.has(c)
        };
        this.dataset = {};
        this.attributes = {};
        this.style = {};
        this.children = [];
        this.textContent = "";
        this.innerHTML = "";
        this.disabled = false;
        this.value = "";
    }

    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] || null; }
    removeAttribute(k) { delete this.attributes[k]; }
    appendChild(child) { this.children.push(child); return child; }
    focus() {}
    click() { if (this.onclick) this.onclick(); }
}

const elementsById = new Map();

function getOrCreateElement(id, tag = "div") {
    if (!elementsById.has(id)) {
        elementsById.set(id, new MockElement(tag, id));
    }
    return elementsById.get(id);
}

// Global browser mocks
const localStorageStore = new Map();
global.localStorage = {
    getItem: (k) => (localStorageStore.has(k) ? localStorageStore.get(k) : null),
    setItem: (k, v) => localStorageStore.set(k, String(v)),
    clear: () => localStorageStore.clear()
};

global.window = {
    location: {
        href: "https://server.myhost.com/apps/ExamBuddy/exam"
    },
    addEventListener: () => {}
};

global.document = {
    getElementById: (id) => getOrCreateElement(id),
    querySelectorAll: (selector) => {
        if (selector === ".diff-card") return [new MockElement("label"), new MockElement("label")];
        if (selector === ".preset-btn") return [new MockElement("button")];
        if (selector === ".topic-chip") return [new MockElement("button")];
        if (selector === "#optionsContainer .option") {
            const container = getOrCreateElement("optionsContainer");
            return container.children;
        }
        return [];
    },
    querySelector: (selector) => {
        if (selector.includes('input[name="difficulty"]')) {
            const radio = new MockElement("input");
            radio.value = "medium";
            radio.checked = true;
            return radio;
        }
        return null;
    },
    createElement: (tag) => new MockElement(tag),
    addEventListener: () => {}
};

// Test Suite
console.log("--- Starting Frontend Simulation Tests ---");

// Test 1: Subpath URL resolution
{
    const examUrl = "https://server.myhost.com/apps/ExamBuddy/exam";
    const resolvedGen = new URL("generate", examUrl).toString();
    const resolvedChat = new URL("chat", examUrl).toString();
    const resolvedHome = new URL("./", examUrl).toString();
    const resolvedStatic = new URL("static/style.css", examUrl).toString();

    assert.strictEqual(resolvedGen, "https://server.myhost.com/apps/ExamBuddy/generate");
    assert.strictEqual(resolvedChat, "https://server.myhost.com/apps/ExamBuddy/chat");
    assert.strictEqual(resolvedHome, "https://server.myhost.com/apps/ExamBuddy/");
    assert.strictEqual(resolvedStatic, "https://server.myhost.com/apps/ExamBuddy/static/style.css");
    console.log("✔ Test 1: Relative URLs correctly resolve under /apps/ExamBuddy/ path prefix");
}

// Test 2: Setup form validation & serialization
{
    const setupJsContent = fs.readFileSync(path.join(__dirname, "../static/setup.js"), "utf8");
    (0, eval)(setupJsContent);

    const topicInput = getOrCreateElement("topic", "input");
    topicInput.value = "Operating Systems";
    const numInput = getOrCreateElement("num", "input");
    numInput.value = "5";

    startExam();

    assert.strictEqual(localStorage.getItem("topic"), "Operating Systems");
    assert.strictEqual(localStorage.getItem("num"), "5");
    assert.strictEqual(localStorage.getItem("difficulty"), "medium");
    assert.strictEqual(window.location.href, "exam");
    console.log("✔ Test 2: Setup form correctly validates and serializes parameters to localStorage");
}

// Test 3: Load script.js without syntax error
{
    let scriptJsContent = fs.readFileSync(path.join(__dirname, "../static/script.js"), "utf8");
    // Expose top-level let declarations to global scope for assertions
    scriptJsContent = scriptJsContent.replace(/^let ([a-zA-Z0-9_]+)/gm, "global.$1");
    (0, eval)(scriptJsContent);
    assert(typeof initExamView === "function");
    assert(typeof generateTest === "function");
    assert(typeof showQuestion === "function");
    assert(typeof selectOption === "function");
    assert(typeof checkAnswer === "function");
    assert(typeof goToNextQuestion === "function");
    assert(typeof goToPrevQuestion === "function");
    console.log("✔ Test 3: script.js evaluates without syntax or reference errors");
}

// Test 4: Generation flow with mocked fetch
(async () => {
    const mockQuestions = [
        {
            question: "What is virtual memory?",
            options: ["Storage illusion", "RAM hardware", "GPU cache", "CPU register"],
            answer: "Storage illusion",
            explanation: "Virtual memory creates the illusion of large contiguous memory."
        },
        {
            question: "Which scheduling algorithm is non-preemptive?",
            options: ["FCFS", "Round Robin", "SRTF", "Multilevel Feedback"],
            answer: "FCFS",
            explanation: "First-Come First-Served is strictly non-preemptive."
        }
    ];

    global.fetch = async (url, options) => {
        if (url === "generate") {
            const reqBody = JSON.parse(options.body);
            assert.strictEqual(reqBody.topic, "Operating Systems");
            assert.strictEqual(reqBody.num, 5);
            return {
                ok: true,
                status: 200,
                headers: { get: () => "application/json" },
                json: async () => mockQuestions
            };
        }
        if (url === "chat") {
            return {
                ok: true,
                status: 200,
                headers: { get: () => "application/json" },
                json: async () => ({ reply: "Think about CPU burst times." })
            };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    await generateTest();

    const qNumEl = getOrCreateElement("questionNumber");
    const qTextEl = getOrCreateElement("questionText");
    const optionsCont = getOrCreateElement("optionsContainer");
    const navBadge = getOrCreateElement("navigatorCountBadge");
    const answeredPill = getOrCreateElement("answeredPill");

    assert.strictEqual(qNumEl.textContent, "Question 1 of 2");
    assert.strictEqual(qTextEl.textContent, "What is virtual memory?");
    assert.strictEqual(optionsCont.children.length, 4);
    assert.strictEqual(navBadge.textContent, "0 / 2");
    assert.strictEqual(answeredPill.textContent, "0 / 2 answered");
    console.log("✔ Test 4: generateTest successfully initializes question 1, options, and question navigator");

    // Test 5: Answer selection and check
    const firstOption = optionsCont.children[0];
    firstOption.click();
    assert.strictEqual(firstOption.classList.contains("option-selected"), true);

    const checkBtn = getOrCreateElement("checkAnswerBtn");
    assert.strictEqual(checkBtn.disabled, false);

    checkAnswer();
    assert.strictEqual(checkBtn.disabled, true);
    assert.strictEqual(firstOption.classList.contains("option-correct"), true);
    assert.strictEqual(navBadge.textContent, "1 / 2");
    assert.strictEqual(answeredPill.textContent, "1 / 2 answered");

    const feedbackBox = getOrCreateElement("feedbackBox");
    assert(feedbackBox.innerHTML.includes("Correct!"));
    console.log("✔ Test 5: Option selection and answer checking work with instant feedback");

    // Test 6: Question navigation
    goToNextQuestion();
    assert.strictEqual(qNumEl.textContent, "Question 2 of 2");
    assert.strictEqual(qTextEl.textContent, "Which scheduling algorithm is non-preemptive?");

    goToPrevQuestion();
    assert.strictEqual(qNumEl.textContent, "Question 1 of 2");
    assert.strictEqual(qTextEl.textContent, "What is virtual memory?");
    console.log("✔ Test 6: Question navigation (next/prev) transitions state properly");

    // Test 7: Error handling and button recovery
    global.fetch = async () => ({
        ok: false,
        status: 500,
        headers: { get: () => "application/json" },
        json: async () => ({ error: "Model capacity reached" })
    });

    await generateTest();
    assert.strictEqual(qNumEl.textContent, "Generation Error");
    assert(qTextEl.innerHTML.includes("Model capacity reached"));
    assert(qTextEl.innerHTML.includes('href="./"'));
    const nextBtn = getOrCreateElement("nextBtn");
    assert.strictEqual(nextBtn.disabled, true);

    // Now restore mock and verify retry cleans up and re-enables buttons
    global.fetch = async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => mockQuestions
    });

    await generateTest();
    assert.strictEqual(qNumEl.textContent, "Question 1 of 2");
    assert.strictEqual(nextBtn.disabled, false);
    const submitBtn = getOrCreateElement("submitExamBtn");
    assert.strictEqual(submitBtn.disabled, false);
    console.log("✔ Test 7: Error state gracefully renders, and retry properly re-enables controls");

    // Test 8: AI Tutor chat flow
    global.fetch = async (url) => {
        if (url === "chat") {
            return {
                ok: true,
                status: 200,
                headers: { get: () => "application/json" },
                json: async () => ({ reply: "Think about CPU burst times." })
            };
        }
        return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => mockQuestions };
    };

    await sendUserChatMessage("Can you give me a concept hint?");
    const chatHistory = chatHistoryByQuestion[currentQuestion];
    assert(chatHistory.length >= 2);
    assert.strictEqual(chatHistory[0].role, "user");
    assert.strictEqual(chatHistory[1].role, "assistant");
    assert.strictEqual(chatHistory[1].content, "Think about CPU burst times.");
    console.log("✔ Test 8: AI Tutor chatbot sends context and receives guidance reply");

    console.log("\nALL FRONTEND SIMULATION TESTS PASSED SUCCESSFULLY! 🚀");
    process.exit(0);
})();
