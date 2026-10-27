function askServer(inp,opts){
return fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:inp})}).then(function(res){
if(!res.ok){var e=new Error("http_"+res.status);e.code=res.status===429?"rate_limited":"error";throw e}
var rd=res.body.getReader(),dc=new TextDecoder(),tx="";
function pump(){return rd.read().then(function(r){
if(r.done)return{text:tx};
tx+=dc.decode(r.value,{stream:true});
if(opts&&opts.onText)opts.onText({text:tx});
return pump()})}
return pump()})}

function initChat(){
var q=document.getElementById("cq");
if(q&&!q.children.length)Q.forEach(function(t){var b=document.createElement("button");b.textContent=t;b.onclick=function(){send(t)};q.appendChild(b)});
SM=askServer;var s=document.getElementById("cs");if(s)s.textContent="\u25cf Ready"}

function send(t){
t=(t||"").trim();if(!t||busy)return;
document.getElementById("ce").style.display="none";
addMsg("u",t);H.push({role:"user",content:t});
var inp=H.map(function(m){return{role:m.role,content:m.content}});
busy=true;document.getElementById("cg").disabled=true;
var el=addMsg("a","...");
askServer(inp,{onText:function(o){el.textContent=o.text;document.getElementById("cl").scrollTop=1e9}}).then(function(r){
if(!r||!r.text){el.textContent="The AI returned an empty reply. Please try again.";H.pop();return}
el.textContent=r.text;H.push({role:"assistant",content:r.text})
},function(e){
el.textContent=e&&e.code==="rate_limited"?"Too many requests. Please wait a moment and try again.":"Sorry, something went wrong. Please try again.";H.pop()
}).then(function(){busy=false;document.getElementById("cg").disabled=false})}

SM=askServer;
(function(){var s=document.getElementById("cs");if(s)s.textContent="\u25cf Ready"})();
