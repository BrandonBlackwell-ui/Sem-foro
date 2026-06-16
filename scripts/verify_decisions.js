const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'Semaforo_Blackwell_v36.html'),'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, {
  runScripts:'dangerously', pretendToBeVisual:true, url:'file:///x.html', virtualConsole:vc,
  beforeParse(w){ const s={}; Object.defineProperty(w,'localStorage',{value:{getItem:k=>k in s?s[k]:null,setItem:(k,v)=>{s[k]=String(v);},removeItem:k=>{delete s[k];},clear:()=>{},key:i=>Object.keys(s)[i]||null,get length(){return Object.keys(s).length;}}, writable:true});}
});
setTimeout(()=>{
  try{dom.window.dispatchEvent(new dom.window.Event('DOMContentLoaded'));}catch(e){}
  setTimeout(()=>{
    const w = dom.window, d = w.document;
    // Count decisions
    const decItems = d.querySelectorAll('#decisionsContent ol li');
    console.log('Decisiones items totales:', decItems.length);
    // Show which accounts
    decItems.forEach(li => {
      const strong = li.querySelector('strong');
      console.log('  -', strong ? strong.textContent : '?');
    });
    // Verify all decision accounts are top or estratégica
    const decAccountsNames = Array.from(decItems).map(li => (li.querySelector('strong') || {}).textContent || '').filter(Boolean);
    const topNames = w.ACCOUNTS.filter(a => a.tier === 'top' || a.tier === 'estrategica').map(a => a.name);
    const off = decAccountsNames.filter(n => !topNames.includes(n));
    if (off.length === 0) console.log('\n✓ Todas las decisiones son de cuentas top/estratégicas');
    else console.log('\n✗ Decisions con tier inesperado:', off);
    // KPI numbers visible
    console.log('\nKPI numbers:',
      'R='+d.getElementById('kpiRed').textContent,
      'O='+d.getElementById('kpiOrange').textContent,
      'Y='+d.getElementById('kpiYellow').textContent,
      'G='+d.getElementById('kpiGreen').textContent,
      'gray='+d.getElementById('kpiGray').textContent);
    // zone-a2 layout
    const za2 = d.querySelector('.zone-a2');
    console.log('\n.zone-a2 outer HTML start:', za2 ? za2.outerHTML.slice(0, 200) : 'NOT FOUND');
  }, 80);
}, 50);
