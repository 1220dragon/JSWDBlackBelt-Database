document.getElementById("quote").style.opacity = "1"
import{blockList} from '/blockList.js'

 
update()

document.querySelector("#genButton").addEventListener('click', generate)
document.querySelector("#saveButton").addEventListener('click', save)
document.querySelector("#reportButton").addEventListener('click', report)


function showQuote(){
  document.getElementById("quote").style.opacity = "1"
}

function update(){
  fetch('https://uselessfacts.jsph.pl/api/v2/facts/random')
  .then(response => response.json())
  .then(data => {
    if(!blockList.some(word => data.text.includes(word))){
      document.getElementById("quote").innerHTML = data.text;
    document.getElementById("source").innerHTML = "Source: " + data.source
    document.getElementById("source").href = "https://" + data.source
    document.getElementById("send").href = data.permalink
    blockList.push(data.text)
    }else{
      update()
    }
    
    

  })
  .catch(error => console.error('Error fetching fact:', error));
}

function generate(){
  document.getElementById("quote").style.opacity = "0"
  setTimeout(showQuote, 2000)
  setTimeout(update, 1900)
  
}

function save(){
   db.insert({ text: document.getElementById("quote").innerHTML })  
}

function report(){
   db.insert({ "reported": document.getElementById("quote").innerHTML })  
}

function load(){
  document.getElementById("quote").style.opacity = "0"
  setTimeout(showQuote, 2000)
  setTimeout(function(){
    document.getElementById("quote").innerHTML = localStorage.getItem("item")
  }, 1900)
}
