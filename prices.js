(() => {
  const $ = (s) => document.querySelector(s);
  const apiBaseEl = $('#api-base');
  const tickerEl = $('#ticker');
  const marketEl = $('#market');
  const fromEl = $('#from');
  const toEl = $('#to');
  const autofillEl = $('#autofill');
  const metaEl = $('#meta');
  const rawEl = $('#raw');
  const wrapEl = $('#table-wrap');
  const btnFetch = $('#btn-fetch');
  const btnDemoUs = $('#btn-demo-nflx');
  const btnDemoKr = $('#btn-demo-ss');
  const themeBtn = $('#theme-toggle');
  // Admin widgets
  const adminKeyEl = $('#admin-key');
  const clrTickerEl = $('#clr-ticker');
  const clrMarketEl = $('#clr-market');
  const clrFromEl = $('#clr-from');
  const clrToEl = $('#clr-to');
  const btnClear = $('#btn-clear');
  const resetConfirmEl = $('#reset-confirm');
  const resetFxEl = $('#reset-fx');
  const resetTickersEl = $('#reset-tickers');
  const btnReset = $('#btn-reset');

  // Restore last/auto API base
  (function initApiBase(){
    const saved = localStorage.getItem('api_base');
    if (saved && apiBaseEl) { apiBaseEl.value = saved; return; }
    const h = location.hostname;
    const dflt = (h === 'localhost' || h === '127.0.0.1') ? 'http://localhost:5000' : 'https://api.nodostream.com';
    if (apiBaseEl) apiBaseEl.value = dflt;
  })();

  function log(msg){ if(metaEl) metaEl.textContent = msg; }

  function renderTable(json){
    if(!wrapEl) return;
    const rows = json?.rows || json?.Rows || [];
    const currency = json?.currency || json?.Currency || '';
    const caption = `Currency: ${currency}, Count: ${rows.length}`;
    const html = [
      `<table><caption>${caption}</caption>`,
      '<thead><tr><th>Date</th><th>Close</th><th>Adj Close</th><th>Volume</th></tr></thead>',
      '<tbody>',
      ...rows.map(r => `<tr><td>${r.date ?? r.Date}</td><td>${r.close ?? r.Close}</td><td>${r.adjustedClose ?? r.AdjustedClose ?? ''}</td><td>${r.volume ?? r.Volume ?? ''}</td></tr>`),
      '</tbody></table>'
    ].join('');
    wrapEl.innerHTML = html;
  }

  async function fetchPrices(){
    const base = (()=>{
      const v = (apiBaseEl?.value || '').trim();
      if (v) return v.replace(/\/$/, '');
      const ov = localStorage.getItem('api_base');
      if (ov) return ov.replace(/\/$/, '');
      const h = location.hostname;
      return (h === 'localhost' || h === '127.0.0.1') ? 'http://localhost:5000' : 'https://api.nodostream.com';
    })();
    const ticker = (tickerEl?.value || '').trim();
    const market = (marketEl?.value || '').trim();
    const from = (fromEl?.value || '').trim();
    const to = (toEl?.value || '').trim();
    const wantAutofill = !!(autofillEl && autofillEl.checked);
    if(!base){ log('API Base URL을 입력하세요.'); return; }
    if(!ticker || !market){ log('티커와 마켓을 입력하세요.'); return; }
    localStorage.setItem('api_base', base);
    log('요청 중…');

    const doRequest = async (requestUrl, attempt = 0) => {
      try{
        const res = await fetch(requestUrl, { headers: { 'Accept': 'application/json' } });
        const txt = await res.text();
        // Show raw
        try{ rawEl && (rawEl.textContent = JSON.stringify(JSON.parse(txt), null, 2)); }
        catch{ rawEl && (rawEl.textContent = txt); }

        if(res.status === 202){
          const retry = parseInt(res.headers.get('Retry-After') || '2', 10) || 2;
          const loc = res.headers.get('Location');
          const msg = (()=>{ try { return JSON.parse(txt)?.Message || JSON.parse(txt)?.message; } catch { return null; } })();
          log(`백필 시작(202). ${retry}초 후 재시도${msg?` • ${msg}`:''}`);
          const nextUrl = loc ? new URL(loc, base).toString() : requestUrl.replace(/([?&])autofill=1(&|$)/,'$1').replace(/[?&]$/,'');
          setTimeout(() => doRequest(nextUrl, attempt+1), retry*1000);
          return;
        }

        if(!res.ok){ log(`HTTP ${res.status}`); return; }
        const json = JSON.parse(txt);
        renderTable(json);
        log(`HTTP ${res.status} • 완료`);
      }catch(e){
        log('에러: ' + e);
      }
    };

    const url = new URL(base + '/api/prices/close');
    url.searchParams.set('ticker', ticker);
    url.searchParams.set('market', market);
    if(from) url.searchParams.set('from', from);
    if(to) url.searchParams.set('to', to);
    if(wantAutofill) url.searchParams.set('autofill', '1');
    await doRequest(url.toString());
  }

  function setDemoUs(){
    if(marketEl) marketEl.value = 'USA';
    if(tickerEl) tickerEl.value = 'NAS:NFLX';
    const today = new Date();
    const from = new Date(today.getTime() - 13*24*3600*1000);
    if(fromEl) fromEl.value = from.toISOString().slice(0,10);
    if(toEl) toEl.value = today.toISOString().slice(0,10);
  }
  function setDemoKr(){
    if(marketEl) marketEl.value = 'KOR';
    if(tickerEl) tickerEl.value = '005930';
    const today = new Date();
    const from = new Date(today.getTime() - 13*24*3600*1000);
    if(fromEl) fromEl.value = from.toISOString().slice(0,10);
    if(toEl) toEl.value = today.toISOString().slice(0,10);
  }

  btnFetch?.addEventListener('click', fetchPrices);
  btnDemoUs?.addEventListener('click', () => { setDemoUs(); fetchPrices(); });
  btnDemoKr?.addEventListener('click', () => { setDemoKr(); fetchPrices(); });
  log('대기 중… 준비되었습니다.');

  // Theme toggle
  const THEME_KEY = 'prices_theme';
  function applyTheme(t){
    document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : '');
  }
  const savedTheme = localStorage.getItem(THEME_KEY) || '';
  applyTheme(savedTheme);
  themeBtn?.addEventListener('click', () => {
    const cur = localStorage.getItem(THEME_KEY) || '';
    const next = cur === 'dark' ? '' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  // Admin: clear selected series
  async function doClear(){
    const base = (()=>{
      const v = (apiBaseEl?.value || '').trim();
      if (v) return v.replace(/\/$/, '');
      const ov = localStorage.getItem('api_base');
      if (ov) return ov.replace(/\/$/, '');
      const h = location.hostname;
      return (h === 'localhost' || h === '127.0.0.1') ? 'http://localhost:5000' : 'https://api.nodostream.com';
    })();
    const key = (adminKeyEl?.value || '').trim();
    if(!base){ log('API Base URL을 입력하세요.'); return; }
    if(!key){ log('x-api-key를 입력하세요.'); return; }
    const body = {
      Ticker: (clrTickerEl?.value || '').trim() || null,
      Market: (clrMarketEl?.value || '').trim() || null,
      From: (clrFromEl?.value || '').replaceAll('-','') || null,
      To: (clrToEl?.value || '').replaceAll('-','') || null,
    };
    log('시계열 삭제 요청 중…');
    try{
      const res = await fetch(base + '/api/admin/db/clear-prices', {
        method: 'POST', headers: { 'x-api-key': key, 'Content-Type':'application/json', 'Accept':'application/json' },
        body: JSON.stringify(body)
      });
      const txt = await res.text();
      rawEl && (rawEl.textContent = txt);
      log(`HTTP ${res.status} • 삭제 완료`);
    }catch(e){ log('에러: ' + e); }
  }
  btnClear?.addEventListener('click', doClear);

  // Admin: reset all
  async function doReset(){
    const base = (apiBaseEl?.value || '').trim().replace(/\/$/, '');
    const key = (adminKeyEl?.value || '').trim();
    const confirm = (resetConfirmEl?.value || '').trim();
    if(!base){ log('API Base URL을 입력하세요.'); return; }
    if(!key){ log('x-api-key를 입력하세요.'); return; }
    if(confirm !== 'CONFIRM'){ log("'CONFIRM'를 입력하세요."); return; }
    const body = {
      Confirm: confirm,
      IncludeFx: !!(resetFxEl && resetFxEl.checked),
      IncludeTickers: !!(resetTickersEl && resetTickersEl.checked)
    };
    log('전체 초기화 요청 중…');
    try{
      const res = await fetch(base + '/api/admin/db/reset-all', {
        method: 'POST', headers: { 'x-api-key': key, 'Content-Type':'application/json', 'Accept':'application/json' },
        body: JSON.stringify(body)
      });
      const txt = await res.text();
      rawEl && (rawEl.textContent = txt);
      log(`HTTP ${res.status} • 초기화 완료`);
    }catch(e){ log('에러: ' + e); }
  }
  btnReset?.addEventListener('click', doReset);
})();
