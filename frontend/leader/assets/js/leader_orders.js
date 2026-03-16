async function loadOrders(){

const data=await api("/api/leader/orders");

if(!data.ok) return;

const tbody=document.getElementById("orders");

tbody.innerHTML="";

data.items.forEach(o=>{

const tr=document.createElement("tr");

tr.innerHTML=`

<td>${o.orderNo}</td>
<td>${o.customerName}</td>
<td>$${o.total}</td>
<td>${o.statusText}</td>

`;

tbody.appendChild(tr);

});

}

loadOrders();