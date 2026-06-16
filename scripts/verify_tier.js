const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'Semaforo_Blackwell_v36.html'),'utf8');
const vc = new VirtualConsole();
vc.on('jsdomError',e=>console.error('JSDOM ERR:', String(e).slice(0,200)));
vc.on('error',e=>console.error('ERR:', String(e).slice(0,200)));
const dom = new JSDOM(html, {
  runScripts:'dangerously',
  pretendToBeVisual:true,
  url:'file:///x.html',
  virtualConsole:vc,
  beforeParse(w){
    const s={};
    Object.defineProperty(w,'localStorage',{value:{
      getItem:k=>k in s?s[k]:null,
      setItem:(k,v)=>{s[k]=String(v);},
      removeItem:k=>{delete s[k];},
      clear:()=>{},
      key:i=>Object.keys(s)[i]||null,
      get length(){return Object.keys(s).length;}
    }, writable:true});
  }
});
setTimeout(()=>{
  try{dom.window.dispatchEvent(new dom.window.Event('DOMContentLoaded'));}catch(e){}
  setTimeout(()=>{
    const w = dom.window, d = w.document;
    const pass = [], fail = [];
    const ok = m => pass.push(m), bad = m => fail.push(m);

    // 1. Segmentation loaded
    if (w.ACCOUNT_SEGMENTATION && Array.isArray(w.ACCOUNT_SEGMENTATION.accounts)) {
      ok('ACCOUNT_SEGMENTATION cargada: ' + w.ACCOUNT_SEGMENTATION.accounts.length + ' registros');
    } else { bad('ACCOUNT_SEGMENTATION no cargada'); }

    // 2. Top-strategic card present and rendered
    const tsBody = d.getElementById('topStrategicBody');
    if (tsBody) {
      const groups = tsBody.querySelectorAll('.ts-group');
      if (groups.length === 2) ok('Top-strategic card: 2 grupos (top + estratégicas)');
      else bad('Top-strategic groups: ' + groups.length);
      const rows = tsBody.querySelectorAll('.ts-row');
      if (rows.length >= 12) ok('Top-strategic rows: ' + rows.length + ' (12 top + 4 estr = 16 esperado)');
      else bad('Pocos rows en top-strategic: ' + rows.length);
      const topHead = tsBody.querySelector('.ts-group-head.top');
      const estHead = tsBody.querySelector('.ts-group-head.estrategica');
      if (topHead && /\(\d+\)/.test(topHead.textContent)) ok('Top group head: ' + topHead.textContent);
      if (estHead && /\(\d+\)/.test(estHead.textContent)) ok('Estr group head: ' + estHead.textContent);
    } else { bad('No #topStrategicBody'); }

    // 3. Tier badges in master table
    const tierTopBadges = d.querySelectorAll('#masterBody .badge.tier-top').length;
    const tierEstBadges = d.querySelectorAll('#masterBody .badge.tier-estrategica').length;
    ok('Master tier badges: ' + tierTopBadges + ' top + ' + tierEstBadges + ' estratégicas');
    if (tierTopBadges < 8 || tierEstBadges < 3) bad('Faltan badges esperados en master');

    // 4. Filter chip "Top + Estratégicas"
    const topChip = d.querySelector('.fchip[data-filter="top-strategic"]');
    if (topChip) ok('Filter chip "Top + Estratégicas" presente');
    else bad('Falta filter chip top-strategic');

    // 5. Tier editor modal exists
    const teBg = d.getElementById('tierEditorBg');
    if (teBg) ok('Tier editor modal en DOM');
    else bad('Tier editor modal NO presente');

    // 6. window functions
    ['openTierEditor','closeTierEditor','saveTierEdits','resetTierOverrides','exportTierSegmentation','filterTierEditorRows'].forEach(fn => {
      if (typeof w[fn] === 'function') ok('window.' + fn + '() expuesta');
      else bad('falta window.' + fn);
    });

    // 7. ACCOUNTS tienen tier
    if (w.ACCOUNTS && w.ACCOUNTS.length) {
      const withTier = w.ACCOUNTS.filter(a => a.tier).length;
      const tops = w.ACCOUNTS.filter(a => a.tier === 'top').length;
      const estras = w.ACCOUNTS.filter(a => a.tier === 'estrategica').length;
      ok('ACCOUNTS con tier: ' + withTier + '/' + w.ACCOUNTS.length + ' (top=' + tops + ' estr=' + estras + ')');
    }

    // 8. Open tier editor
    try {
      w.openTierEditor();
      const open = teBg && teBg.classList.contains('open');
      if (open) ok('openTierEditor() abre el modal');
      const rowsTE = d.querySelectorAll('#tierEditorRows .te-row');
      if (rowsTE.length >= 20) ok('Tier editor rows: ' + rowsTE.length);
      else bad('Pocos rows en tier editor: ' + rowsTE.length);
      w.closeTierEditor();
      if (!teBg.classList.contains('open')) ok('closeTierEditor() cierra el modal');
    } catch(e) { bad('Editor crash: ' + String(e).slice(0,150)); }

    // 9. Filter top-strategic works
    try {
      w.MASTER_FILTER = 'top-strategic';
      w.renderMaster && w.renderMaster();
      // Trigger by clicking chip
      topChip.click();
      const filteredRows = d.querySelectorAll('#masterBody tr');
      ok('Filter top-strategic muestra ' + filteredRows.length + ' filas');
    } catch(e) { bad('Filter crash: ' + String(e).slice(0,150)); }

    console.log('\n=== verify tier segmentation ===\n');
    console.log('PASS (' + pass.length + ')');
    pass.forEach(m => console.log('  ✓ ' + m));
    if (fail.length) {
      console.log('\nFAIL (' + fail.length + ')');
      fail.forEach(m => console.log('  ✗ ' + m));
      process.exit(1);
    }
  }, 80);
}, 50);
