(() => {
  const $ = (s) => document.querySelector(s);
  const apiBaseEl = $('#api-base');
  const apiKeyEl = $('#api-key');
  const pathEl = $('#kis-path');
  const tridEl = $('#kis-trid');
  const paramsEl = $('#kis-params');
  const btnFetch = $('#btn-fetch');
  const rawEl = $('#kis-raw');
  const mapCodeEl = $('#map-code');
  const mapLogEl = $('#map-log');
  const btnMap = $('#btn-map');
  const btnUpsert = $('#btn-upsert');
  const tblEl = $('#tbl');

  const defaultMapper = `// 예시: 해외 마스터 output2 배열을 티커로
// 결과는 [{TickerCode,Market,Name,Currency,Type,IsActive}]
const rows = [];
if (data && data.output2 && Array.isArray(data.output2)) {
  for (const e of data.output2) {
    // 예시 필드명은 KIS 응답에 맞게 수정하세요
    const code = (e.SYMB || e.symb || '').trim().toUpperCase();
    const exch = (e.EXCD || e.excd || 'NAS').trim().toUpperCase();
    const name = (e.KOR_NM || e.kor_nm || e.HTS_KOR_ISNM || e.hts_kor_isnm || e.NAME || e.name || (exch + ':' + code)).trim();
    if (!code || !exch) continue;
    rows.push({ TickerCode: (exch + ':' + code), Market: 'USA', Name: name, Currency: 'USD', Type: 'EQUITY', IsActive: true });
  }
}
rows;`;

  mapCodeEl.value = defaultMapper;

  function parseParams(text){
    text = (text || '').trim();
    if (!text) return {};
    if (text.startsWith('{')) {
      try { return JSON.parse(text); } catch { return {}; }
    }
    const out = {};
    for (const kv of text.split('&')){
      if(!kv) continue; const i = kv.indexOf('=');
      if(i<0){ out[kv] = ''; } else { out[kv.substring(0,i)] = kv.substring(i+1); }
    }
    return out;
  }

  function getBase(){
    const v = (apiBaseEl?.value || '').trim();
    if (v) return v.replace(/\/$/, '');
    const ov = localStorage.getItem('api_base');
    if (ov) return ov.replace(/\/$/, '');
    const h = location.hostname;
    return (h === 'localhost' || h === '127.0.0.1') ? 'http://localhost:5000' : 'https://api.nodostream.com';
  }

  btnFetch?.addEventListener('click', async () => {
    const base = getBase();
    const key = (apiKeyEl?.value || '').trim();
    if(!base){ rawEl.textContent = 'API Base 필요'; return; }
    if(!key){ rawEl.textContent = 'x-api-key 필요'; return; }
    const path = (pathEl?.value || '').trim();
    const trid = (tridEl?.value || '').trim();
    const params = parseParams(paramsEl?.value || '');
    const url = new URL(base + '/api/admin/kis/get');
    url.searchParams.set('path', path);
    if(trid) url.searchParams.set('tr_id', trid);
    for (const k of Object.keys(params)) url.searchParams.set(k, params[k]);
    rawEl.textContent = '요청 중…';
    try{
      const res = await fetch(url.toString(), { headers: { 'x-api-key': key, 'Accept':'application/json' } });
      const txt = await res.text();
      rawEl.textContent = txt;
      try { window.__kis_data__ = JSON.parse(txt).http_raw ? JSON.parse(JSON.parse(txt).http_raw) : JSON.parse(txt); }
      catch { window.__kis_data__ = null; }
    }catch(e){ rawEl.textContent = '에러: ' + e; }
  });

  btnMap?.addEventListener('click', () => {
    try{
      const data = window.__kis_data__;
      // eslint-disable-next-line no-new-func
      const fn = new Function('data', mapCodeEl.value);
      const rows = fn(data);
      renderTable(rows);
      mapLogEl.textContent = `변환됨: ${rows?.length||0}개`;
    }catch(e){ mapLogEl.textContent = '변환 에러: ' + e; }
  });

  btnUpsert?.addEventListener('click', async () => {
    try{
      const rows = window.__mapped_rows__ || [];
      const base = getBase();
      const key = (apiKeyEl?.value || '').trim();
      if(!base || !key){ mapLogEl.textContent='API Base/x-api-key 필요'; return; }
      const res = await fetch(base + '/api/admin/tickers/update-bulk', { method:'POST', headers:{ 'x-api-key': key, 'Content-Type':'application/json', 'Accept':'application/json' }, body: JSON.stringify({ Tickers: rows }) });
      const txt = await res.text();
      mapLogEl.textContent = `HTTP ${res.status}\n${txt}`;
    }catch(e){ mapLogEl.textContent = '업서트 에러: ' + e; }
  });

  function renderTable(rows){
    window.__mapped_rows__ = rows;
    if(!Array.isArray(rows) || !rows.length){ tblEl.innerHTML = '<div class="log">행 없음</div>'; return; }
    let html = '<table><thead><tr><th>Market</th><th>TickerCode</th><th>Name</th><th>Currency</th><th>Type</th><th>Active</th></tr></thead><tbody>';
    for(const r of rows){
      html += `<tr><td>${r.Market||''}</td><td>${r.TickerCode||''}</td><td>${r.Name||''}</td><td>${r.Currency||''}</td><td>${r.Type||''}</td><td>${r.IsActive??true}</td></tr>`;
    }
    html += '</tbody></table>';
    tblEl.innerHTML = html;
  }

  // Initialize visible input with default if empty
  ;(()=>{
    if (!apiBaseEl) return;
    const cur = (apiBaseEl.value || '').trim();
    if (!cur) apiBaseEl.value = getBase();
  })();
})();
