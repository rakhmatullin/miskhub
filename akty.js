/* loader */
(function(){
  function boot(src){
    return fetch(src).then(function(r){ if(!r.ok) throw new Error(src+' '+r.status); return r.text(); })
      .then(function(txt){ var s=document.createElement('script'); s.textContent=txt; document.body.appendChild(s); });
  }
  var engine = './akty.engine.js?v=8';
  var fallback = 'https://raw.githubusercontent.com/rakhmatullin/miskhub/c8a3471705530114db4947ec60574dae7766e3e4/akty.engine.js';
  fetch(engine).then(function(r){ return r.ok && r.headers.get('content-length') !== '11' ? r.text() : Promise.reject(); })
    .catch(function(){ return fetch(fallback).then(function(r){ if(!r.ok) throw new Error('engine'); return r.text(); }); })
    .then(function(txt){
      if (!txt || txt.trim() === 'PLACEHOLDER' || txt.length < 1000) throw new Error('bad engine');
      var s=document.createElement('script'); s.textContent=txt; document.body.appendChild(s);
      return boot('./akty.cloud.js?v=8');
    })
    .catch(function(e){
      console.error(e);
      document.body.insertAdjacentHTML('beforeend','<p style="color:#ff6b7a;padding:20px">Движок не загрузился: '+e+'</p>');
    });
})();
