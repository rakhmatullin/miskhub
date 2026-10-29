/* v1.0 */
(async()=>{
let s='';
s += await (await fetch('./p0.js?v=19')).text();
s += await (await fetch('./p1.js?v=19')).text();
s += await (await fetch('./p2.js?v=19')).text();
s += await (await fetch('./p3.js?v=19')).text();
s += await (await fetch('./p4.js?v=19')).text();
const el=document.createElement('script'); el.textContent=s; document.head.appendChild(el);
})().catch(e=>{console.error(e);document.body.insertAdjacentHTML('afterbegin','<div style="padding:12px;background:#3a1820;color:#faa">'+e.message+'</div>');});
