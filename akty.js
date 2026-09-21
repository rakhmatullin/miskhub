/* loader: engine parts on this site */
(function(){
  function inject(txt){ var s=document.createElement('script'); s.textContent=txt; document.body.appendChild(s); }
  function boot(src){
    return fetch(src).then(function(r){ if(!r.ok) throw new Error(src+' '+r.status); return r.text(); });
  }
  var parts = [1,2,3,4,5,6].map(function(n){ return boot('./engine/e'+n+'.js?v=14'); });
  Promise.all(parts).then(function(arr){
    inject(arr.join(''));
    return boot('./akty.cloud.js?v=14');
  }).then(function(cloud){ if (cloud) inject(cloud); }).catch(function(e){
    console.error(e);
    document.body.insertAdjacentHTML('beforeend','<p style="color:#ff6b7a;padding:20px">Движок не загрузился: '+e+'</p>');
  });
})();
