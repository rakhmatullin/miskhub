/* loader */
(function(){
  function boot(src){
    return fetch(src).then(function(r){ if(!r.ok) throw new Error(src+' '+r.status); return r.text(); })
      .then(function(txt){ var s=document.createElement('script'); s.textContent=txt; document.body.appendChild(s); });
  }
  boot('./akty.engine.js?v=4')
    .then(function(){ return boot('./akty.cloud.js?v=5'); })
    .catch(function(e){
      console.error(e);
      document.body.insertAdjacentHTML('beforeend','<p style="color:#ff6b7a;padding:20px">Движок не загрузился: '+e+'</p>');
    });
})();
