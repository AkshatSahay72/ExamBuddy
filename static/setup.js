function startExam(){

let topic = document.getElementById("topic").value
let num = document.getElementById("num").value
let difficulty = document.getElementById("difficulty").value

if(topic.trim()===""){
alert("Enter topic")
return
}

localStorage.setItem("topic",topic)
localStorage.setItem("num",num)
localStorage.setItem("difficulty",difficulty)

window.location.href = "/exam"

}