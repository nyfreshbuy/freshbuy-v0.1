async function loadTeam(){

const data=await api("/api/leader/team");

if(!data.ok) return;

const tbody=document.getElementById("team");

tbody.innerHTML="";

data.list.forEach(u=>{

const tr=document.createElement("tr");

tr.innerHTML=`

<td>${u.name}</td>
<td>${u.phoneMasked}</td>
<td>${new Date(u.createdAt).toLocaleDateString()}</td>

`;

tbody.appendChild(tr);

});

}

loadTeam();