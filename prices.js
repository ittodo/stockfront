(() => {
  const $ = (s) => document.querySelector(s);
  const apiBaseEl = $('#api-base');
  const tickerEl = $('#ticker');
  const marketEl = $('#market');
  const rangeEl = $('#range');
  const toEl = $('#to');
  const autofillEl = $('#autofill');
  const metaEl = $('#meta');
  const rawEl = $('#raw');
  const wrapEl = $('#table-wrap');
  const chartCanvas = document.getElementById('chart');
  const chartWrap = document.getElementById('chart-wrap');
  const chartMeta = document.getElementById('chart-meta');
  const chartTooltip = document.getElementById('chart-tooltip');
  const useAdjEl = document.getElementById('use-adj');
  // Lightweight Charts elements
  const lcWrap = document.getElementById('lc-wrap');
  const lcContainer = document.getElementById('lc-chart');
  const lcMeta = document.getElementById('lc-meta');
  let lcChart = null, lcCandle = null, lcVolume = null;
  let baseCanvas = null; // offscreen static layer
  const btnFetch = $('#btn-fetch');
  const btnRedraw = document.getElementById('btn-redraw');
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
    if (apiBaseEl){
      if (h === 'localhost' || h === '127.0.0.1'){
        const lp = (location.port || '').trim();
        const apiPort = (lp === '8001') ? '5001' : '5000';
        apiBaseEl.value = `http://localhost:${apiPort}`;
      } else {
        apiBaseEl.value = 'https://api.nodostream.com';
      }
    }
  })();

  // Attach ticker auto-complete (KOR + USA) and set hidden market
  if (window.TickerSearch && tickerEl) {
    window.TickerSearch.attach(tickerEl, {
      apiBaseGetter: () => {
        const v = (apiBaseEl?.value || '').trim();
        if (v) return v.replace(/\/$/, '');
        const ov = localStorage.getItem('api_base');
        if (ov) return ov.replace(/\/$/, '');
        const h = location.hostname;
        if (h === 'localhost' || h === '127.0.0.1'){
          const lp = (location.port || '').trim();
          const apiPort = (lp === '8001') ? '5001' : '5000';
          return `http://localhost:${apiPort}`;
        }
        return 'https://api.nodostream.com';
      },
      onSelect: (sel) => {
        if (sel && sel.market && marketEl) { marketEl.value = sel.market; }
        if (sel && sel.ticker && tickerEl) tickerEl.value = sel.ticker;
        const badge = document.querySelector('#market-badge');
        if (badge) {
          const v = (sel?.market||'').toUpperCase();
          badge.textContent = v || '-';
          badge.style.color = v==='USA' ? '#2563eb' : (v==='KOR' ? '#059669' : 'var(--muted)');
          badge.style.borderColor = v ? (v==='USA' ? '#2563eb55' : (v==='KOR' ? '#05966955' : 'var(--border)')) : 'var(--border)';
        }
      }
    });
  }

  // Also infer market on free typing to show badge
  tickerEl?.addEventListener('input', () => {
    const t = (tickerEl.value||'').trim();
    let mkt = '';
    if (/^\d{6}$/.test(t)) mkt = 'KOR';
    else if (t.includes(':')) mkt = 'USA';
    if (marketEl) marketEl.value = mkt;
    const badge = document.querySelector('#market-badge');
    if (badge) {
      const v = (mkt||'').toUpperCase();
      badge.textContent = v || '-';
      badge.style.color = v==='USA' ? '#2563eb' : (v==='KOR' ? '#059669' : 'var(--muted)');
      badge.style.borderColor = v ? (v==='USA' ? '#2563eb55' : (v==='KOR' ? '#05966955' : 'var(--border)')) : 'var(--border)';
    }
  });

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

  let lastSeries = null;
  function buildOhlcv(rows){
    const pts = [];
    for (const r of rows){
      const d = r.date || r.Date; if(!d) continue;
      const t = new Date(String(d)).getTime(); if (!isFinite(t)) continue;
      const preferAdj = !!(useAdjEl && useAdjEl.checked);
      const rawClose = r.close ?? r.Close;
      const rawAdj = r.adjustedClose ?? r.AdjustedClose;
      const c = (preferAdj && rawAdj != null) ? rawAdj : rawClose;
      if (c == null) continue;
      let o = r.open ?? r.Open; let h = r.high ?? r.High; let l = r.low ?? r.Low; const v = r.volume ?? r.Volume;
      // Fallback: if O/H/L are missing (e.g., rows inserted by close-only ingester), use Close
      if (o == null) o = c;
      if (h == null) h = c;
      if (l == null) l = c;
      pts.push({ t, d: String(d).slice(0,10), o:+o, h:+h, l:+l, c:+c, v: v!=null?+v:null });
    }
    pts.sort((a,b)=>a.t-b.t);
    return pts;
  }

  function drawChartCandles(series){
    if (!chartCanvas || !chartWrap){ lastSeries = series; return; }
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = chartWrap.getBoundingClientRect();
    const W = Math.max(200, Math.floor(rect.width));
    const H = Math.max(220, Math.floor(rect.height));
    chartCanvas.width = Math.floor(W * dpr);
    chartCanvas.height = Math.floor(H * dpr);
    chartCanvas.style.width = W + 'px';
    chartCanvas.style.height = H + 'px';
    const ctx = chartCanvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const colAxis = isDark ? '#475569' : '#94a3b8';
    const colGrid = isDark ? '#1f2937' : '#e5e7eb';
    const upCol = isDark ? '#34d399' : '#059669';
    const dnCol = isDark ? '#f87171' : '#dc2626';
    const volCol = isDark ? '#64748b' : '#94a3b8';

    ctx.clearRect(0,0,W,H);
    if (!series || series.length < 1){
      ctx.fillStyle = colAxis;
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.fillText('데이터가 부족합니다.', 8, 18);
      return;
    }
    let pad = { l: 52, r: 12, t: 8, b: 22 };
    // If width is significantly larger than height, add extra left/right padding for breathing room
    if (W > H) {
      const extra = Math.min(40, Math.floor((W - H) * 0.05));
      pad = { l: pad.l + extra, r: pad.r + extra, t: pad.t, b: pad.b };
    }
    // Use index-based horizontal scale so non-trading days (holidays/weekends)
    // do not create gaps between candles.
    const count = series.length;
    let lo = Math.min(...series.map(p=>p.l)), hi = Math.max(...series.map(p=>p.h));
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    const margin = (hi-lo) * 0.03; lo -= margin; hi += margin;
    const volMax = Math.max(1, Math.max(...series.map(p=>p.v||0)));
    const split = 0.78; const Hprice = (H - pad.t - pad.b) * split; const Hvol = (H - pad.t - pad.b) * (1-split) - 6;
    const avail = (W - pad.l - pad.r);
    const step = count > 1 ? (avail / (count - 1)) : avail; // distance between candle centers
    const xAt = (i)=> pad.l + i * step;
    const yP = (v)=> pad.t + (1 - ((v - lo) / Math.max(1e-9,(hi-lo)))) * Hprice;
    const yV = (v)=> pad.t + Hprice + 6 + (1 - (v/volMax)) * Hvol;

    baseCanvas = document.createElement('canvas');
    baseCanvas.width = Math.floor(W * dpr); baseCanvas.height = Math.floor(H * dpr);
    const bctx = baseCanvas.getContext('2d'); bctx.setTransform(dpr,0,0,dpr,0,0);
    // Grid (price area only)
    bctx.strokeStyle = colGrid; bctx.lineWidth = 1; bctx.beginPath();
    for (let i=0;i<=4;i++){ const yy = pad.t + i*(Hprice)/4; bctx.moveTo(pad.l, yy); bctx.lineTo(W-pad.r, yy); }
    bctx.stroke();
    // Candles
    const bw = Math.max(1, Math.min(18, step*0.6));
    for (let i=0;i<series.length;i++){
      const p = series[i]; const xx = xAt(i); const col = (p.c>=p.o)?upCol:dnCol;
      bctx.strokeStyle = col; bctx.lineWidth = 1; bctx.beginPath(); bctx.moveTo(xx, yP(p.h)); bctx.lineTo(xx, yP(p.l)); bctx.stroke();
      const y1 = yP(p.o), y2 = yP(p.c); const top = Math.min(y1,y2), h = Math.max(1, Math.abs(y1-y2));
      bctx.fillStyle = col; bctx.fillRect(xx - bw/2, top, bw, h);
    }
    // Axis labels
    bctx.fillStyle = colAxis; bctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    bctx.textAlign = 'left';  bctx.fillText(series[0].d, pad.l, H-6);
    bctx.textAlign = 'right'; bctx.fillText(series[series.length-1].d, W-pad.r, H-6);
    bctx.textAlign = 'right'; bctx.fillText(hi.toFixed(2), pad.l-6, yP(hi));
    bctx.textAlign = 'right'; bctx.fillText(lo.toFixed(2), pad.l-6, yP(lo));
    // Volume bars
    for (let i=0;i<series.length;i++){
      const p = series[i]; const vv = p.v||0; if (vv<=0) continue;
      const xx = xAt(i); const vw = Math.max(1, Math.min(18, step*0.6)); const top = yV(vv);
      bctx.fillStyle = volCol; bctx.fillRect(xx - vw/2, top, vw, pad.t + Hprice + 6 + Hvol - top);
    }
    // Blit (dest in CSS px; ctx already scaled by dpr)
    ctx.clearRect(0,0,W,H); ctx.drawImage(baseCanvas, 0,0, baseCanvas.width, baseCanvas.height, 0,0, W, H);
    // Hover
    function nearestIndex(px){
      // Compute nearest candle center by index spacing
      const rel = Math.max(0, Math.min(avail, px - pad.l));
      const approx = step > 0 ? Math.round(rel / step) : 0;
      return Math.max(0, Math.min(series.length - 1, approx));
    }
    function onMove(ev){ const r=chartCanvas.getBoundingClientRect(); const mx=(ev.clientX - r.left); const idx=nearestIndex(mx); if(idx<0){ if(chartTooltip) chartTooltip.style.display='none'; return; }
      const px=xAt(idx), py=yP(series[idx].c); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H); if(baseCanvas) ctx.drawImage(baseCanvas,0,0,baseCanvas.width,baseCanvas.height,0,0,W,H);
      ctx.strokeStyle = isDark ? '#fbbf24' : '#d97706'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, H-pad.b); ctx.stroke(); ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI*2); ctx.stroke();
      if(chartTooltip){ const p=series[idx]; chartTooltip.style.display='block'; chartTooltip.textContent=`${p.d} • O ${p.o} H ${p.h} L ${p.l} C ${p.c}${p.v?` • Vol ${p.v}`:''}`; chartTooltip.style.left=(px+8)+'px'; chartTooltip.style.top=(py-8)+'px'; }
    }
    function onLeave(){ if(chartTooltip) chartTooltip.style.display='none'; ctx.setTransform(dpr,0,0,dpr,0,0); if(baseCanvas){ ctx.clearRect(0,0,W,H); ctx.drawImage(baseCanvas,0,0,baseCanvas.width,baseCanvas.height,0,0,W,H);} }
    chartCanvas.onmousemove=onMove; chartCanvas.onmouseleave=onLeave;

    // Also render comparison chart using Lightweight Charts (if available)
    try { drawLcChart(series); } catch {}
  }

  function refreshChartMeta(currency, series){
    if (!chartMeta) return;
    if (!series || series.length===0){ chartMeta.textContent = ''; return; }
    const first = series[0], last = series[series.length-1];
    const chg = last.c - first.c;
    const pct = first.c !== 0 ? (chg/first.c*100) : 0;
    chartMeta.textContent = `${first.d} → ${last.d} • ${currency} ${last.c.toFixed(2)} (${chg>=0?'+':''}${chg.toFixed(2)}, ${pct.toFixed(2)}%)`;
  }

  async function fetchPrices(){
    const base = (()=>{
      const v = (apiBaseEl?.value || '').trim();
      if (v) return v.replace(/\/$/, '');
      const ov = localStorage.getItem('api_base');
      if (ov) return ov.replace(/\/$/, '');
      const h = location.hostname;
      if (h === 'localhost' || h === '127.0.0.1'){
        const lp = (location.port || '').trim();
        const apiPort = (lp === '8001') ? '5001' : '5000';
        return `http://localhost:${apiPort}`;
      }
      return 'https://api.nodostream.com';
    })();
    const ticker = (tickerEl?.value || '').trim();
    let market = (marketEl?.value || '').trim();
    const to = (toEl?.value || '').trim();
    const range = (rangeEl?.value || '').trim() || '1y';
    const wantAutofill = !!(autofillEl && autofillEl.checked);
    if(!base){ log('API Base URL을 입력하세요.'); return; }
    if(!market){
      if (/^\d{6}$/.test(ticker)) market = 'KOR';
      else if (ticker.includes(':')) market = 'USA';
    }
    if(!ticker || !market){ log('티커를 선택하거나 올바른 형식으로 입력하세요.'); return; }
    localStorage.setItem('api_base', base);
    log('요청 중…');

    const doRequest = async (requestUrl, attempt = 0) => {
      try{
        const res = await fetch(requestUrl, { headers: { 'Accept': 'application/json' } });
        const txt = await res.text();
        // (raw omitted)

        if(res.status === 202){
          const retry = parseInt(res.headers.get('Retry-After') || '2', 10) || 2;
          const loc = res.headers.get('Location');
          const body = (()=>{ try { return JSON.parse(txt) } catch { return null; } })();
          const msg = body?.Message || body?.message;
          log(`백필 시작(202). ${retry}초 후 재시도${msg?` • ${msg}`:''}`);
          const nextUrl = loc ? new URL(loc, base).toString() : requestUrl.replace(/([?&])autofill=1(&|$)/,'$1').replace(/[?&]$/,'');
          // WS 힌트가 있으면 구독하여 완료 시 즉시 refetch
          const wsHint = body?.Ws || body?.ws;
          const refetchFn = () => doRequest(nextUrl, attempt+1);
          if (!openBackfillWs(base, wsHint, refetchFn)){
            setTimeout(refetchFn, retry*1000);
          }
          return;
        }

        if(!res.ok){ log(`HTTP ${res.status}`); return; }
        const json = JSON.parse(txt);
        try{
          const series = buildOhlcv(json.Rows || json.rows || []);
          lastSeries = series; drawChartCandles(series);
          const cur = json.Currency || json.currency || '';
          refreshChartMeta(cur, series);
        }catch{}
        log(`HTTP ${res.status} • 완료`);
      }catch(e){
        log('에러: ' + e);
      }
    };

    // Compute from date by range
    function iso(d){ return d.toISOString().slice(0,10); }
    let toIso = to;
    if (!toIso){ toIso = iso(new Date()); }
    let fromIso = null;
    if (range !== 'max'){
      const t = toIso ? new Date(toIso + 'T00:00:00') : new Date();
      const y = t.getFullYear(); const m = t.getMonth(); const day = t.getDate();
      let d;
      if (range === '6m') d = new Date(y, m - 6, day);
      else if (range === '1y') d = new Date(y - 1, m, day);
      else if (range === '2y') d = new Date(y - 2, m, day);
      else if (range === '3y') d = new Date(y - 3, m, day);
      else if (range === '5y') d = new Date(y - 5, m, day);
      else d = new Date(y - 1, m, day);
      fromIso = iso(d);
    } else {
      // For 'max', send an explicit very-early from date to avoid edge cases with missing 'from'
      fromIso = '1900-01-01';
    }
    // Guard: if to < from, swap
    if (fromIso && toIso && toIso < fromIso){ const t = fromIso; fromIso = toIso; toIso = t; }

    // 1) 먼저 DB에서 OHLCV 가져오기(autofill 파라미터 없이)
    const url = new URL(base + '/api/prices/ohlcv');
    url.searchParams.set('ticker', ticker);
    url.searchParams.set('market', market);
    if(fromIso) url.searchParams.set('from', fromIso);
    if(toIso) url.searchParams.set('to', toIso);
    try{
      const res1 = await fetch(url.toString(), { headers: { 'Accept':'application/json' } });
      const txt1 = await res1.text();
      if (!res1.ok){ log(`HTTP ${res1.status}`); return; }
      const json1 = JSON.parse(txt1);
      const rows1 = json1?.Rows || json1?.rows || [];
      const rows = rows1.map(r => ({
        Date: r.Date || r.date,
        Open: r.Open || r.open || (r.Close || r.close),
        High: r.High || r.high || (r.Close || r.close),
        Low:  r.Low  || r.low  || (r.Close || r.close),
        Close:r.Close|| r.close,
        Volume:r.Volume|| r.volume || null
      }));
      const coveredFrom = rows.length ? rows[0].Date : null;
      const coveredTo = rows.length ? rows[rows.length-1].Date : null;
      let needsMore = rows.length === 0;
      if (!needsMore && fromIso && coveredFrom && coveredFrom > fromIso) needsMore = true;
      if (!needsMore && toIso && coveredTo && coveredTo < toIso) needsMore = true;

      // 2) 차트 그리기(먼저 보여주고)
      try{
        const series = buildOhlcv(json1.Rows || json1.rows || []);
        lastSeries = series; drawChartCandles(series);
        const cur = json1.Currency || json1.currency || '';
        refreshChartMeta(cur, series);
      }catch{}

      // 3) 부족하면, 자동 백필이 켜진 경우 전체 요청 창에 대해 OHLCV에서 백필을 트리거(세그먼트 처리/WS 지원)
      if (needsMore && wantAutofill){
        const url2 = new URL(url.toString());
        url2.searchParams.set('autofill','1');
        await doRequest(url2.toString());
      } else {
        log(`HTTP 200 • 완료`);
      }
    }catch(e){ log('에러: ' + e); }
  }

  function setDemoUs(){
    if(marketEl) marketEl.value = 'USA';
    if(tickerEl) tickerEl.value = 'NAS:NFLX';
    const today = new Date();
    if(rangeEl) rangeEl.value = '6m';
    if(toEl) toEl.value = today.toISOString().slice(0,10);
  }
  function setDemoKr(){
    if(marketEl) marketEl.value = 'KOR';
    if(tickerEl) tickerEl.value = '005930';
    const today = new Date();
    if(rangeEl) rangeEl.value = '6m';
    if(toEl) toEl.value = today.toISOString().slice(0,10);
  }

  btnFetch?.addEventListener('click', fetchPrices);
  btnRedraw?.addEventListener('click', () => { if (lastSeries && chartCanvas) { log('차트 재그리기'); drawChartCandles(lastSeries); } });
  useAdjEl?.addEventListener('change', () => { if (lastSeries) { const preferAdj = !!(useAdjEl && useAdjEl.checked); /* rebuild from latest raw? require refetch */ }});
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
      if (h === 'localhost' || h === '127.0.0.1'){
        const lp = (location.port || '').trim();
        const apiPort = (lp === '8001') ? '5001' : '5000';
        return `http://localhost:${apiPort}`;
      }
      return 'https://api.nodostream.com';
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
      /* raw omitted */
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
      /* raw omitted */
      log(`HTTP ${res.status} • 초기화 완료`);
    }catch(e){ log('에러: ' + e); }
  }
  btnReset?.addEventListener('click', doReset);

  // Defaults for date controls (set 'to' = today if empty)
  ;(() => {
    const today = new Date().toISOString().slice(0,10);
    if (toEl && !(toEl.value||'').trim()) toEl.value = today;
    if (rangeEl && !(rangeEl.value||'').trim()) rangeEl.value = '1y';
  })();

  // Redraw on resize/theme toggle
  window.addEventListener('resize', () => { if (lastSeries) drawChartCandles(lastSeries); });
  function updateLcTheme(){
    if (!lcChart) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    lcChart.applyOptions({
      layout: {
        background: { color: 'transparent' },
        textColor: isDark ? '#e5e7eb' : '#111827'
      },
      grid: {
        vertLines: { color: isDark ? '#1f2937' : '#e5e7eb' },
        horzLines: { color: isDark ? '#1f2937' : '#e5e7eb' }
      }
    });
    if (lcCandle) lcCandle.applyOptions({
      upColor: isDark ? '#34d399' : '#059669',
      borderUpColor: isDark ? '#34d399' : '#059669',
      wickUpColor: isDark ? '#34d399' : '#059669',
      downColor: isDark ? '#f87171' : '#dc2626',
      borderDownColor: isDark ? '#f87171' : '#dc2626',
      wickDownColor: isDark ? '#f87171' : '#dc2626'
    });
    if (lcVolume) lcVolume.applyOptions({ color: isDark ? '#64748b' : '#94a3b8' });
  }
  themeBtn?.addEventListener('click', () => {
    setTimeout(()=>{ if (lastSeries) drawChartCandles(lastSeries); updateLcTheme(); }, 0);
  });

  function ensureLcChart(){
    if (!lcContainer || !window.LightweightCharts) return false;
    if (lcChart) return true;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const { createChart } = window.LightweightCharts;
    lcChart = createChart(lcContainer, {
      width: lcContainer.clientWidth || 600,
      height: lcContainer.clientHeight || 420,
      layout: { background: { color: 'transparent' }, textColor: isDark ? '#e5e7eb' : '#111827' },
      rightPriceScale: { borderVisible: false },
      timeScale: { rightOffset: 0, barSpacing: 6, fixLeftEdge: false, lockVisibleTimeRangeOnResize: false, secondsVisible: false, timeVisible: true, borderVisible: false },
      grid: { vertLines: { color: isDark ? '#1f2937' : '#e5e7eb' }, horzLines: { color: isDark ? '#1f2937' : '#e5e7eb' } },
      crosshair: { mode: 1 }
    });
    // Constrain volume to lower area and keep candles above (no overlap)
    lcChart.priceScale('right').applyOptions({ scaleMargins: { top: 0, bottom: 0.2 } }); // candles: top 80%
    lcChart.priceScale('left').applyOptions({ visible: false, scaleMargins: { top: 0.8, bottom: 0 } }); // volume: bottom 20%
    lcCandle = lcChart.addCandlestickSeries({
      upColor: isDark ? '#34d399' : '#059669',
      borderUpColor: isDark ? '#34d399' : '#059669',
      wickUpColor: isDark ? '#34d399' : '#059669',
      downColor: isDark ? '#f87171' : '#dc2626',
      borderDownColor: isDark ? '#f87171' : '#dc2626',
      wickDownColor: isDark ? '#f87171' : '#dc2626'
    });
    lcVolume = lcChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'left',
      color: isDark ? '#64748b' : '#94a3b8',
      base: 0
    });
    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!lcChart) return;
      lcChart.applyOptions({ width: lcContainer.clientWidth, height: lcContainer.clientHeight });
    });
    ro.observe(lcContainer);
    return true;
  }

  function drawLcChart(series){
    if (!ensureLcChart()) return;
    const candles = series.map(p => ({ time: p.d, open: p.o, high: p.h, low: p.l, close: p.c }));
    lcCandle.setData(candles);
    const vols = series.map(p => ({ time: p.d, value: (p.v||0) }));
    lcVolume.setData(vols);
    lcChart.timeScale().fitContent();
    if (lcMeta && series.length){
      const first = series[0], last = series[series.length-1];
      const chg = last.c - first.c; const pct = first.c ? chg/first.c*100 : 0;
      lcMeta.textContent = `${first.d} → ${last.d} • ${last.c.toFixed(2)} (${chg>=0?'+':''}${chg.toFixed(2)}, ${pct.toFixed(2)}%)`;
    }
  }
})();
  // Active backfill WebSocket (single at a time)
  let backfillWs = null;
  function closeBackfillWs(){ try{ if (backfillWs){ backfillWs.close(); backfillWs = null; } }catch{}
  }
  function openBackfillWs(apiBase, wsHint, refetchFn){
    if (!wsHint) return false;
    const wsBase = apiBase.replace(/^http/i,'ws');
    const list = Array.isArray(wsHint) ? wsHint : [wsHint];
    const first = list.find(x => typeof x === 'string' && x.length>0);
    if (!first) return false;
    const url = first.startsWith('ws') ? first : (wsBase.replace(/\/$/,'') + (first.startsWith('/')? first : ('/'+first)));
    try{
      closeBackfillWs();
      backfillWs = new WebSocket(url);
      backfillWs.onopen = () => { log(`백필 진행 수신 중(WS): ${url}`); };
      backfillWs.onmessage = (e) => {
        try{
          const ev = JSON.parse(e.data || '{}');
          if (ev.eventType === 'status'){
            // running/queued 표시만
            if (ev.status) log(`백필 상태: ${ev.status}`);
          } else if (ev.eventType === 'log'){
            // 너무 시끄러우면 생략 가능
          } else if (ev.eventType === 'done'){
            log('백필 완료. 차트 갱신…');
            closeBackfillWs();
            if (typeof refetchFn === 'function') refetchFn();
          }
        }catch{}
      };
      backfillWs.onerror = () => { /* noop; 폴백은 기존 Retry-After */ };
      backfillWs.onclose = () => { /* closed */ };
      return true;
    }catch{ return false; }
  }
