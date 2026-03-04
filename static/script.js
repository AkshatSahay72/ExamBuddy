let questions = []
let answers = []
let currentQuestion = 0
let totalQuestions = 0


/* -----------------------------
LOAD EXAM WHEN PAGE OPENS
------------------------------*/

window.onload = () => {
    generateTest()
}


/* -----------------------------
GENERATE TEST FROM API
------------------------------*/

async function generateTest(){

    let topic = localStorage.getItem("topic")
    let num = localStorage.getItem("num")
    let difficulty = localStorage.getItem("difficulty")

    const response = await fetch("/generate",{
        method:"POST",
        headers:{
            "Content-Type":"application/json"
        },
        body:JSON.stringify({
            topic:topic,
            num:num,
            difficulty:difficulty
        })
    })

    if(!response.ok){
        console.error("API ERROR")
        return
        }

        questions = await response.json()
        console.log(questions)

    totalQuestions = questions.length
    answers = new Array(totalQuestions).fill(null)

    buildNavigator()
    showQuestion()
    updateAnswered()

}


/* -----------------------------
DISPLAY QUESTION
------------------------------*/

function showQuestion(){

    let q = questions[currentQuestion]

    document.getElementById("questionNumber").innerText =
    `Question ${currentQuestion+1} of ${totalQuestions}`

    document.getElementById("questionText").innerText =
    q.question

    let optionsContainer = document.getElementById("optionsContainer")

    optionsContainer.innerHTML=""

    q.options.forEach((opt,index)=>{

        let div = document.createElement("div")

        div.classList.add("option")

        div.innerHTML =
        `<b>${String.fromCharCode(65+index)}</b> ${opt}`

        if(answers[currentQuestion] === opt){
            div.style.border="2px solid #3b6ef3"
        }

        div.onclick = () => selectOption(opt)

        optionsContainer.appendChild(div)

    })

    highlightNavigator()

}


/* -----------------------------
SELECT OPTION
------------------------------*/

function selectOption(opt){

answers[currentQuestion] = opt

let q = questions[currentQuestion]

let options = document.querySelectorAll("#optionsContainer div")

options.forEach(o => {

o.style.border = "1px solid #ddd"

})

options.forEach(o => {

if(o.innerText.includes(opt)){
o.style.border = "3px solid #3b6ef3"
}

})


/* SHOW FEEDBACK */

let feedback = document.getElementById("feedbackBox")

if(!feedback){

feedback = document.createElement("div")
feedback.id = "feedbackBox"

document.querySelector(".question-panel").appendChild(feedback)

}

if(opt === q.answer){

feedback.innerHTML = `
<div class="correct-box">
✅ Correct! <br>
${q.explanation}
</div>
`

}else{

feedback.innerHTML = `
<div class="wrong-box">
❌ Wrong <br>
Correct answer: <b>${q.answer}</b><br>
${q.explanation}
</div>
`

}

updateAnswered()
highlightNavigator()

}


/* -----------------------------
NEXT QUESTION
------------------------------*/

document.getElementById("nextBtn").onclick = () => {

    if(currentQuestion < totalQuestions-1){
        currentQuestion++
        showQuestion()
    }

}


/* -----------------------------
PREVIOUS QUESTION
------------------------------*/

document.getElementById("prevBtn").onclick = () => {

    if(currentQuestion > 0){
        currentQuestion--
        showQuestion()
    }

}


/* -----------------------------
BUILD QUESTION NAVIGATOR
------------------------------*/

function buildNavigator(){

    let grid = document.getElementById("navigatorGrid")

    grid.innerHTML=""

    for(let i=0;i<totalQuestions;i++){

        let box = document.createElement("div")

        box.innerText = i+1

        box.onclick = () => {

            currentQuestion = i
            showQuestion()

        }

        grid.appendChild(box)

    }

}


/* -----------------------------
UPDATE NAVIGATOR COLORS
------------------------------*/

function highlightNavigator(){

    let grid = document.getElementById("navigatorGrid").children

    for(let i=0;i<grid.length;i++){

        grid[i].style.background="#d9dee7"
        grid[i].style.color="black"

        if(i === currentQuestion){

            grid[i].style.background="#3b6ef3"
            grid[i].style.color="white"

        }

        else if(answers[i] !== null){

            grid[i].style.background="#2ecc71"
            grid[i].style.color="white"

        }

    }

}


/* -----------------------------
ANSWERED COUNTER
------------------------------*/

function updateAnswered(){

    let count = answers.filter(a => a !== null).length

    document.querySelector(".answered").innerText =
    `${count} / ${totalQuestions} answered`

}


/* -----------------------------
SUBMIT EXAM
------------------------------*/

function submitExam(){

let score = 0

let resultHTML = `
<h2 class="result-title">Exam Results</h2>
`

questions.forEach((q,i)=>{

let correct = answers[i] === q.answer

if(correct) score++

resultHTML += `
<div class="result-card ${correct ? "correct-card":"wrong-card"}">

<h3>Q${i+1} ${correct ? "✅ Correct":"❌ Wrong"}</h3>

<p>${q.question}</p>

<p><b>Your Answer:</b> ${answers[i] || "Not answered"}</p>

<p><b>Correct:</b> ${q.answer}</p>

<p class="explanation">${q.explanation}</p>

</div>
`

})

resultHTML += `
<h2 class="score-box">Score: ${score}/${questions.length}</h2>
`

document.querySelector(".question-panel").innerHTML = resultHTML

}


/* -----------------------------
TIMER
------------------------------*/

let timeLeft = 30*60

setInterval(()=>{

    if(timeLeft <=0) return

    timeLeft--

    let minutes = Math.floor(timeLeft/60)
    let seconds = timeLeft%60

    document.querySelector(".timer").innerText =
    `⏱ Time Left: ${minutes}:${seconds.toString().padStart(2,"0")}`

},1000)

async function sendMessage(){

let input = document.getElementById("chatInput")

let message = input.value

if(message.trim()==="") return

let chatBox = document.getElementById("chatMessages")

chatBox.innerHTML += `<div class="user-msg">${message}</div>`

input.value=""

try{

const response = await fetch("/chat",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
question:message
})

})

const data = await response.json()

chatBox.innerHTML += `<div class="bot-msg">${data.reply}</div>`

chatBox.scrollTop = chatBox.scrollHeight

}catch(err){

console.error(err)

chatBox.innerHTML += `<div class="bot-msg">⚠️ Chatbot error</div>`

}

}

function toggleChat(){

let chat = document.getElementById("chatWindow")

if(chat.style.display === "flex"){
chat.style.display = "none"
}else{
chat.style.display = "flex"
}

}


async function sendMessage(){

let input = document.getElementById("chatInput")
let message = input.value.trim()

if(message === "") return

let chatBox = document.getElementById("chatMessages")

chatBox.innerHTML += `<div class="user-msg">${message}</div>`

input.value = ""

try{

const response = await fetch("/chat",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({
question:message
})
})

const data = await response.json()

chatBox.innerHTML += `<div class="bot-msg">${data.reply}</div>`

chatBox.scrollTop = chatBox.scrollHeight

}catch(err){

chatBox.innerHTML += `<div class="bot-msg">⚠️ Chatbot error</div>`

}

}