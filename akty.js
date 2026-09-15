/* loader */
(function(){
  Promise.all([1,2,3,4].map(function(i){ return fetch('./akty.b'+i+'.txt').then(function(r){ return r.text(); }); }))
    .then(function(parts){
      var bin = Uint8Array.from(atob(parts.join('')), function(c){ return c.charCodeAt(0); });
      var txt = new TextDecoder('utf-8').decode(bin);
      var s = document.createElement('script');
      s.textContent = txt;
      document.body.appendChild(s);
    })
    .catch(function(e){ console.error(e); document.body.insertAdjacentHTML('beforeend','<p style="color:#ff6b7a;padding:20px">Не загрузился движок: '+e+'</p>'); });
})();
