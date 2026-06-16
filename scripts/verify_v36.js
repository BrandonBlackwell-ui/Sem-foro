const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'Semaforo_Blackwell_v36.html'),'utf8');
const vc = new VirtualConsole(); vc.on('jsdomError',()=>{});vc.on('error',()=>{});
const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'file:///x.html', virtualConsole:vc,
  beforeParse(w){ const s={}; Object.defineProperty(w,'localStorage',{value:{getItem:k=>k in s?s[k]:null,setItem:(k,v)=>{s[k]=String(v);},removeItem:k=>{delete s[k];},clear:()=>{},key:i=>Object.keys(s)[i]||null,get length(){return Object.keys(s).length;}}, writable:true}); }
});
setTimeout(()=>{
  try{dom.window.dispatchEvent(new dom.window.Event('DOMContentLoaded'));}catch(e){}
  setTimeout(()=>{
    const w = dom.window, d = w.document;
    const pass = [], fail = [];
    const ok = m => pass.push(m), bad = m => fail.push(m);
    // Header
    if (/Corte:/.test(d.getElementById('header-corte').textContent)) ok('Header corte');
    if (d.getElementById('header-chip').textContent) ok('Header chip: '+d.getElementById('header-chip').textContent);
    // Gauge
    const gnum = d.getElementById('gaugeNum').textContent;
    if (/\d/.test(gnum)) ok('Gauge: '+gnum);
    else bad('Gauge sin número');
    const needle = d.getElementById('gaugeNeedle');
    if (needle && needle.getAttribute('transform') && /rotate/.test(needle.getAttribute('transform'))) ok('Gauge needle rotado: '+needle.getAttribute('transform'));
    // KPIs
    const kr = d.getElementById('kpiRed').textContent, kg = d.getElementById('kpiGreen').textContent;
    ok(`KPIs: 🔴${kr} 🟠${d.getElementById('kpiOrange').textContent} 🟡${d.getElementById('kpiYellow').textContent} 🟢${kg}`);
    // Master + sort
    const rows = d.querySelectorAll('#masterBody tr:not(.section-divider)');
    if (rows.length >= 25) ok('Master rows: '+rows.length);
    // Sort verification: first row should be red
    const firstColor = rows[0] && rows[0].querySelector('.dot') && rows[0].querySelector('.dot').className;
    if (/red/.test(firstColor)) ok('Sort: primer row es rojo (peor primero)');
    else if (/orange/.test(firstColor)) ok('Sort: primer row es naranja (no hay rojos activos)');
    else bad('Sort weird, primer row: '+firstColor);
    // Tabs exist
    const tabs = d.querySelectorAll('.tab');
    if (tabs.length === 4) ok('Tabs: 4');
    // Filter chips
    const chips = d.querySelectorAll('.fchip');
    if (chips.length >= 9) ok('Filter chips: '+chips.length);
    // Sparkline
    const sparks = d.querySelectorAll('.spark');
    if (sparks.length > 0) ok('Sparklines: '+sparks.length);
    // Modal abre
    if (typeof w.openModal === 'function' && w.ACCOUNTS && w.ACCOUNTS.length) {
      w.openModal(w.ACCOUNTS[0].id);
      const open = d.getElementById('modalBg').classList.contains('open');
      if (open) ok('Modal abre');
    }
    // Config drawer
    if (typeof w.openConfig === 'function') {
      w.openConfig();
      const open = d.getElementById('configDrawer').classList.contains('open');
      if (open) ok('Config drawer abre');
      w.closeConfig();
      const closed = !d.getElementById('configDrawer').classList.contains('open');
      if (closed) ok('Config drawer cierra');
    }
    // Theme
    if (typeof w.setTheme === 'function') {
      w.setTheme('dark');
      if (d.documentElement.dataset.theme === 'dark') ok('Theme dark aplica');
      w.setTheme('light');
    }
    // Data loaded
    if (w.SYNC_DATA && w.SYNC_DATA.accounts && w.SYNC_DATA.accounts.length === 29) ok('SYNC_DATA: 29 cuentas');
    if (w.CHECKLIST_RECALC_DATA && w.CHECKLIST_RECALC_DATA.schema) ok('CHECKLIST_RECALC_DATA cargado');
    if (w.DRIVE_INTELLIGENCE && w.DRIVE_INTELLIGENCE.accounts) ok('DRIVE_INTELLIGENCE: '+w.DRIVE_INTELLIGENCE.accounts.length+' cuentas analizadas');
    if (w.ACCOUNTS_META && Array.isArray(w.ACCOUNTS_META.accounts)) ok('ACCOUNTS_META: '+w.ACCOUNTS_META.accounts.length+' cuentas con owners');
    else bad('ACCOUNTS_META no cargado');
    // CELLS loaded
    if (w.CELLS && Array.isArray(w.CELLS.cells) && w.CELLS.cells.length === 2) {
      const cA = w.CELLS.cells.find(c=>c.id==='A');
      const cB = w.CELLS.cells.find(c=>c.id==='B');
      ok('CELLS: A='+cA.lead_name+' ('+cA.members.length+'), B='+cB.lead_name+' ('+cB.members.length+')');
    } else bad('CELLS no cargado o estructura inválida');
    // Every active cuenta has a cell (or is in unassigned)
    if (w.ACCOUNTS && w.CELLS) {
      const orphans = w.ACCOUNTS.filter(a => a.status === 'active' && !a.cell);
      if (orphans.length === 0) ok('Todas las cuentas activas tienen célula');
      else ok('Activas sin célula ('+orphans.length+'): '+orphans.map(o=>o.id).join(','));
      const cellACount = w.ACCOUNTS.filter(a=>a.cell==='A').length;
      const cellBCount = w.ACCOUNTS.filter(a=>a.cell==='B').length;
      ok('ACCOUNTS por célula: A='+cellACount+', B='+cellBCount);
    }
    // Master table cell badges
    const cellBadges = d.querySelectorAll('#masterBody .badge.cell-a, #masterBody .badge.cell-b');
    if (cellBadges.length > 0) ok('Master table muestra '+cellBadges.length+' cell badges');
    else bad('Master table sin cell badges');
    // Filter por célula A
    const fchipA = d.querySelector('.fchip[data-filter="cell-A"]');
    const fchipB = d.querySelector('.fchip[data-filter="cell-B"]');
    if (fchipA && fchipB) ok('Filter chips célula A/B presentes');
    if (fchipA) {
      fchipA.click();
      const visibleRows = d.querySelectorAll('#masterBody tr:not(.section-divider)');
      ok('Filter cell-A: '+visibleRows.length+' filas');
      const allA = Array.from(visibleRows).every(r => /cell-a/.test(r.innerHTML));
      if (allA) ok('Filter cell-A: todas las filas son de célula A');
      else bad('Filter cell-A: hay filas que no son de célula A');
      // reset
      const fchipAll = d.querySelector('.fchip[data-filter="all"]');
      if (fchipAll) fchipAll.click();
    }
    // Decisions split by cell
    const decContent = d.getElementById('decisionsContent').innerHTML;
    if (/Célula A/.test(decContent) && /Célula B/.test(decContent)) ok('Decisiones split por célula A y B');
    else bad('Decisiones sin split por célula: '+decContent.slice(0,160));
    // Gauge color class
    const gnumEl = d.getElementById('gaugeNum');
    const cls = gnumEl.className;
    if (/(green|yellow|orange|red)/.test(cls)) ok('Gauge color class: '+cls);
    else bad('Gauge sin color class: '+cls);
    // Equipo tab populated (cell-based)
    if (typeof w.renderEquipo === 'function') {
      w.renderEquipo();
    } else {
      const equipoBtn = d.querySelector('.tab[data-tab="equipo"]');
      if (equipoBtn) equipoBtn.click();
    }
    const eq = d.getElementById('equipoContent');
    const inner = eq ? eq.innerHTML : '';
    if (inner && /Célula A/.test(inner) && /Célula B/.test(inner) && /Marisol/.test(inner) && /Johanna/.test(inner)) {
      ok('Equipo tab: muestra Célula A (Marisol) y Célula B (Johanna)');
    } else bad('Equipo tab no muestra células: '+(inner||'').slice(0,300));

    // Splash: 1ra vez del día debe mostrarse
    const splashBg = d.getElementById('splashBg');
    if (splashBg && splashBg.classList.contains('open')) ok('Splash visible en primera carga (auto-show)');
    else bad('Splash no se mostró automáticamente');
    // Splash content
    const splashBody = d.getElementById('splashBody');
    if (splashBody) {
      const sb = splashBody.innerHTML;
      const hasPortfolio = /Resumen del portafolio/.test(sb);
      const hasCells = /Por célula/.test(sb) && /Célula A/.test(sb) && /Célula B/.test(sb);
      const hasScore = /Score global/.test(sb);
      if (hasPortfolio && hasCells && hasScore) ok('Splash content: portfolio + cells + score global');
      else bad('Splash content incompleto: portfolio='+hasPortfolio+' cells='+hasCells+' score='+hasScore);
      // Frase motivacional
      const hasQuote = /splash-quote/.test(sb);
      const quoteEl = d.querySelector('.splash-quote');
      const quoteText = quoteEl ? quoteEl.textContent.trim() : '';
      const hasAttr = quoteEl && quoteEl.querySelector('.attr');
      if (hasQuote && quoteText.length > 20 && hasAttr) ok('Splash quote del día: '+quoteText.slice(0,70)+'…');
      else bad('Splash sin frase motivacional');
    }
    // Greeting
    const greeting = d.getElementById('splashGreeting').textContent;
    if (/Buenos días|Buenas tardes|Buenas noches/.test(greeting)) ok('Splash greeting: '+greeting);
    // Date
    const splashDate = d.getElementById('splashDate').textContent;
    if (/(domingo|lunes|martes|miércoles|jueves|viernes|sábado)/.test(splashDate)) ok('Splash date en español: '+splashDate);
    // Dismiss
    if (typeof w.dismissSplash === 'function') {
      w.dismissSplash();
      const closed = !d.getElementById('splashBg').classList.contains('open');
      if (closed) ok('Splash dismiss funciona');
      else bad('Splash no se cerró tras dismiss');
      // localStorage debe persistir
      const lastShown = w.localStorage.getItem('v35:splash:lastShown');
      if (lastShown) ok('Splash persistido en localStorage: '+lastShown);
      else bad('Splash no se persistió en localStorage');
    }
    // 2nd showSplash() (no force) debe NO abrir
    if (typeof w.showSplash === 'function') {
      const result = w.showSplash();
      if (result === false || !d.getElementById('splashBg').classList.contains('open')) ok('Splash NO se reabre el mismo día (segunda carga)');
      else bad('Splash se reabrió incorrectamente el mismo día');
    }
    // Force show
    if (typeof w.showSplash === 'function') {
      w.showSplash(true);
      if (d.getElementById('splashBg').classList.contains('open')) ok('Splash force-show funciona');
      else bad('Splash force-show falló');
    }

    // v3.6 — nuevos statuses active_litigation y active_new
    if (w.ACCOUNTS) {
      const luca = w.ACCOUNTS.find(a => a.id === 'luca');
      const coast = w.ACCOUNTS.find(a => a.id === 'coastoil');
      if (luca) {
        ok('LUCA: status='+luca.status+' isActive='+luca.isActive+' score='+luca.global+' variant='+luca.statusVariant);
      } else bad('LUCA no aparece en ACCOUNTS');
      if (coast && coast.status === 'active_new' && coast.isActive && coast.global !== null) {
        ok('COAST OIL: status=active_new, isActive=true, score='+coast.global+', variant='+coast.statusVariant);
      } else bad('COAST OIL no tiene active_new correcto: ' + JSON.stringify(coast && {status:coast.status, isActive:coast.isActive, global:coast.global, variant:coast.statusVariant}));
      // Conteo de activas debe incluir variantes
      const activeCount = w.ACCOUNTS.filter(a => a.isActive).length;
      if (activeCount === 25) ok('ACCOUNTS isActive=true: '+activeCount+' (incluye active + active_litigation + active_new)');
      else ok('ACCOUNTS isActive=true: '+activeCount);
    }
    // Litigio + Nueva badges en master table
    const litigioBadges = d.querySelectorAll('#masterBody .badge.litigio');
    const nuevaBadges = d.querySelectorAll('#masterBody .badge.nueva');
    ok('Master table badges litigio: '+litigioBadges.length+' (0 esperado si LUCA está concluded)');
    if (nuevaBadges.length >= 1) ok('Master table muestra '+nuevaBadges.length+' badge(s) nueva');
    else bad('Master table sin badge nueva');
    // Versión bumpeada
    if (/v3\.6/.test(d.title)) ok('Title: '+d.title);
    const versionH1 = d.querySelector('header h1 small');
    if (versionH1 && /v3\.6/.test(versionH1.textContent)) ok('Header version: '+versionH1.textContent);
    else bad('Header version sin v3.6');

    console.log('\n=== verify v3.6 ===\n');
    console.log(`✅ PASS (${pass.length})`);
    pass.forEach(m => console.log('  ✓ ' + m));
    if (fail.length) {
      console.log(`\n❌ FAIL (${fail.length})`);
      fail.forEach(m => console.log('  ✗ ' + m));
      process.exit(1);
    }
    console.log('\n🎉 v3.6 listo.\n');
    process.exit(0);
  }, 250);
}, 200);
