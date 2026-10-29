/* v1.0 */
(async()=>{
  const a = await (await fetch('./loader_part1.js?v=19')).text();
  const b = await (await fetch('./loader_part2.js?v=19')).text();
  eval(a + b);
})().catch(e=>{console.error(e);document.body.insertAdjacentHTML('afterbegin','<div style="padding:12px;background:#3a1820;color:#faa">'+e.message+'</div>');});
