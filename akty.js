/* loader */
(function(){
  fetch('./akty.engine.js').then(function(r){ if(!r.ok) throw new Error(r.status); return r.text(); })
    .then(function(txt){ var s=document.createElement('script'); s.textContent=txt; document.body.appendChild(s); })
    .catch(function(e){ console.error(e); document.body.insertAdjacentHTML('beforeend','<p style="color:#ff6b7a;padding:20px">Движок не загрузился: '+e+'</p>'); });
})();
