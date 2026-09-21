/* loader */
(function(){
  function inject(txt){ var s=document.createElement('script'); s.textContent=txt; document.body.appendChild(s); }
  function boot(src){
    return fetch(src).then(function(r){ if(!r.ok) throw new Error(src+' '+r.status); return r.text(); });
  }
  function loadCloud(){ return boot('./akty.cloud.js?v=15').then(function(t){ inject(t); }); }
  function tryParts(){
    return Promise.all([1,2,3,4,5,6].map(function(n){ return boot('./engine/e'+n+'.js?v=15'); }))
      .then(function(arr){ var t=arr.join(''); if(t.length<1000) throw new Error('short parts'); inject(t); });
  }
  tryParts().catch(function(){
    return boot('https://raw.githubusercontent.com/rakhmatullin/miskhub/c8a3471705530114db4947ec60574dae7766e3e4/akty.engine.js')
      .then(function(t){ if(!t || t.length<1000) throw new Error('engine'); inject(t); });
  }).then(loadCloud).catch(function(e){
    console.error(e);
    document.body.insertAdjacentHTML('beforeend','<p style="color:#ff6b7a;padding:20px">Движок не загрузился</p>');
  });
})();
