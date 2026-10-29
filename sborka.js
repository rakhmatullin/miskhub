/* v1.0 */
(async()=>{
let s='';
s += await (await fetch('./q0.js?v=19')).text();
s += await (await fetch('./q1.js?v=19')).text();
s += await (await fetch('./q2.js?v=19')).text();
s += await (await fetch('./q3.js?v=19')).text();
s += await (await fetch('./q4.js?v=19')).text();
s += await (await fetch('./q5.js?v=19')).text();
s += await (await fetch('./q6.js?v=19')).text();
s += await (await fetch('./q7.js?v=19')).text();
s += await (await fetch('./q8.js?v=19')).text();
const el=document.createElement('script'); el.textContent=s; document.head.appendChild(el);
})().catch(e=>{console.error(e);document.body.insertAdjacentHTML('afterbegin','<div style="padding:12px;background:#3a1820;color:#faa">'+e.message+'</div>');});
