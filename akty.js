/* loader */
(function(){
  function inject(txt){ var s=document.createElement('script'); s.textContent=txt; document.body.appendChild(s); }
  function boot(src){
    return fetch(src).then(function(r){ if(!r.ok) throw new Error(src+' '+r.status); return r.text(); });
  }
  var sources = [
    'https://litter.catbox.moe/8yt4mt.js',
    'https://raw.githubusercontent.com/rakhmatullin/miskhub/c8a3471705530114db4947ec60574dae7766e3e4/akty.engine.js'
  ];
  (function next(i){
    if (i >= sources.length) {
      document.body.insertAdjacentHTML('beforeend','<p style="color:#ff6b7a;padding:20px">Движок не загрузился</p>');
      return;
    }
    boot(sources[i]).then(function(txt){
      if (!txt || txt.length < 1000 || txt.trim() === 'PLACEHOLDER') throw new Error('short');
      inject(txt);
      return boot('./akty.cloud.js?v=11');
    }).then(function(cloud){ if (cloud) inject(cloud); }).catch(function(){ next(i+1); });
  })(0);
})();
