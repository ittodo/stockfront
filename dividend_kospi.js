(() => {
  const $ = (s) => document.querySelector(s)
  const apiBaseEl = $('#api-base')
  const btnStart = $('#btn-start')
  const btnExport = $('#btn-export')
  const btnClear = $('#btn-clear-scan-cache')
  const rangeDaysEl = $('#range-days')
  const concEl = $('#concurrency')
  const limitEl = $('#limit')
  const statusEl = $('#status')
  const progbar = $('#progbar')
  const tbl = $('#tbl')

  // DART 가용성/매핑 캐시
  let dartAvailable = false
  const dartStockToCorp = new Map() // stock_code(6) -> corp_code(8)

  const detectDartAndLoadMap = async (base) => {
    dartAvailable = false
    dartStockToCorp.clear()
    try{
      const res = await fetch(base + '/api/dart/corps')
      if (res.ok){
        const arr = await res.json()
        if (Array.isArray(arr)){
          for (const it of arr){
            const sc = (it.stock_code || it.stockCode || '').trim()
            const cc = (it.corp_code || it.corpCode || '').trim()
            if (sc && cc) dartStockToCorp.set(String(sc).padStart(6,'0'), cc)
          }
          dartAvailable = true
          return
        }
      }
    }catch{}
    try{
      const dbg = await fetch(base + '/api/dart/debug')
      dartAvailable = dbg.ok
    }catch{ dartAvailable = false }
  }

  const getBase = () => {
    const v = (apiBaseEl?.value || '').trim();
    if (v) return v.replace(/\/$/, '');
    const ov = localStorage.getItem('api_base');
    if (ov) return ov.replace(/\/$/, '');
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') {
      const lp = (location.port || '').trim();
      const apiPort = (lp === '8001') ? '5001' : '5000';
      return `http://localhost:${apiPort}`;
    }
    return 'https://api.nodostream.com';
  }
  const saveBase = () => { const b = apiBaseEl?.value?.trim(); if (b) localStorage.setItem('api_base', b) }

  const formatYmd = (d) => {
    const y = d.getFullYear()
    const m = String(d.getMonth()+1).padStart(2,'0')
    const day = String(d.getDate()).padStart(2,'0')
    return `${y}${m}${day}`
  }
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate()-1); return d }

  const parseDecision = (txt) => window.DividendUtils?.parseDecision(txt)

  // 원문 캐시 우선: DB 먼저 → 없으면 1회 DART로 캐시 후 재시도
  const getDocXmlCachedFirst = async (base, rcp) => {
    try{
      const r1 = await fetch(`${base}/api/filings/detail/cached?rcpNo=${encodeURIComponent(rcp)}`)
      if (r1.ok) return await r1.text()
    }catch{}
    try{ await fetch(`${base}/api/dart/filings/detail?rcpNo=${encodeURIComponent(rcp)}&cache=1`).then(()=>{}) }catch{}
    const r2 = await fetch(`${base}/api/filings/detail/cached?rcpNo=${encodeURIComponent(rcp)}`)
    if (r2.ok) return await r2.text()
    throw new Error('원문 캐시를 찾을 수 없습니다')
  }

  // Initialize API base input if empty
  ;(()=>{
    const el = document.querySelector('#api-base');
    if (el && !(el.value||'').trim()){
      const h = location.hostname;
      if (h==='localhost'||h==='127.0.0.1'){
        const lp = (location.port||'').trim();
        const apiPort = (lp==='8001') ? '5001' : '5000';
        el.value = `http://localhost:${apiPort}`;
      } else {
        el.value = 'https://api.nodostream.com';
      }
    }
  })();

  // 주가 조회 도우미들 (복사: dividend.js)
  const getKrStockCode = async (base, corp, corpCode) => {
    try{
      const qp = new URLSearchParams()
      if (corpCode) qp.set('corpCode', corpCode); else qp.set('corp', corp)
      qp.set('cache','1')
      const res = await fetch(`${base}/api/dart/corp/profile?${qp.toString()}`)
      if (res.ok){
        const txt = await res.text()
        const j = JSON.parse(txt)
        const obj = j?.company || j
        const code = obj?.stock_code || obj?.stockCode
        if (code) return String(code).padStart(6,'0')
      }
    }catch{}
    try{
      const list = await fetch(`${base}/api/krx/corps/local`).then(r=>r.json())
      const name = (corp||'').trim()
      const exact = list.find(x => (x.corp_name||'').trim() === name)
      if (exact && exact.stock_code) return String(exact.stock_code).padStart(6,'0')
      const contains = list.find(x => (x.corp_name||'').includes(name))
      if (contains && contains.stock_code) return String(contains.stock_code).padStart(6,'0')
    }catch{}
    return null
  }

  const getLatestKrClose = async (base, stockCode) => {
    try{
      const today = new Date();
      const y = new Date(today.getTime() - 24*3600*1000)
      const tryWindow = async (days, doAutofill) => {
        const from = new Date(today.getTime() - days*24*3600*1000)
        const mkUrl = (autofill) => {
          const url = new URL(base + '/api/prices/close')
          url.searchParams.set('ticker', stockCode)
          url.searchParams.set('market', 'KOR')
          url.searchParams.set('from', from.toISOString().slice(0,10))
          url.searchParams.set('to', y.toISOString().slice(0,10))
          if (autofill) url.searchParams.set('autofill','1')
          return url.toString()
        }
        let res = await fetch(mkUrl(false), { headers: { 'Accept':'application/json' }})
        if (res.status === 202){
          const ra = parseInt(res.headers.get('Retry-After')||'2',10)||2
          await new Promise(r=>setTimeout(r, ra*1000))
          res = await fetch(mkUrl(false), { headers: { 'Accept':'application/json' }})
        }
        if (res.ok){
          const data = await res.json();
          let rows = data?.rows || data?.Rows || []
          if (rows.length){
            const last = rows[rows.length-1]
            const val = last.close ?? last.Close ?? last.adjustedClose ?? last.AdjustedClose
            const n = Number(val)
            if (Number.isFinite(n)) return n
          }
        }
        if (doAutofill){
          res = await fetch(mkUrl(true), { headers: { 'Accept':'application/json' }})
          if (res.status === 202){
            const ra = parseInt(res.headers.get('Retry-After')||'2',10)||2
            await new Promise(r=>setTimeout(r, ra*1000))
          }
          res = await fetch(mkUrl(false), { headers: { 'Accept':'application/json' }})
          if (res.ok){
            const data2 = await res.json()
            const rows2 = data2?.rows || data2?.Rows || []
            if (rows2.length){
              const last2 = rows2[rows2.length-1]
              const val2 = last2.close ?? last2.Close ?? last2.adjustedClose ?? last2.AdjustedClose
              const n2 = Number(val2)
              if (Number.isFinite(n2)) return n2
            }
          }
        }
        return null
      }
      // 14일 → 60일 → 120일 (점진 확대), 첫 시도는 autofill까지 허용
      return (await tryWindow(14, true))
          || (await tryWindow(60, true))
          || (await tryWindow(120, true))
          || null
    }catch{ return null }
  }

  async function fetchJson(url){
    const res = await fetch(url)
    if (!res.ok) throw new Error('HTTP '+res.status)
    return res.json()
  }

  async function fetchFilingsFromDb(base, corp, fromYmd, toYmd, corpCode){
    let page = 1, pageSize = 200
    const acc = []
    while(true){
      const qp = new URLSearchParams()
      if (corpCode) qp.set('corpCode', corpCode); else qp.set('corp', corp)
      qp.set('from', fromYmd); qp.set('to', toYmd); qp.set('page', String(page)); qp.set('pageSize', String(pageSize))
      const url = `${base}/api/filings/search?${qp.toString()}`
      const j = await fetchJson(url)
      const items = j?.items || []
      acc.push(...items)
      const total = Number(j?.total || 0)
      if (!total || page*pageSize >= total) break
      page++
      if (page>200) break
    }
    return acc
  }

  // 이름 정규화: 말미의 (A) / BC 00000000 등 제거
  const normalizeCorpName = (name) => {
    let s = (name||'').trim()
    s = s.replace(/\s+BC\s+\d{8}\s*$/i, '')
    s = s.replace(/\s*\([A-Za-z0-9]+\)\s*$/g, '')
    s = s.replace(/\s+[A-Z]$/g, '')
    s = s.replace(/\s{2,}/g, ' ').trim()
    return s
  }

  // Resolve DART corp code: prefer stock_code mapping, fallback to DART search/profile
  const getCorpCode = async (base, corpName, stockCode) => {
    const norm = normalizeCorpName(corpName)
    // 1) DART corp map by stock_code (사전 로드)
    if (dartAvailable && stockCode){
      const six = String(stockCode).padStart(6,'0')
      const cc = dartStockToCorp.get(six)
      if (cc) return cc
      // stock_code가 있는데 DART 맵에 없으면 펀드/ETN/특수상품 가능성이 큼 → 이름 탐색은 건너뜀
      return null
    }
    // 2) DART search by name
    if (dartAvailable) try{
      const q = encodeURIComponent(norm)
      const res = await fetch(`${base}/api/dart/search?q=${q}`)
      if (res.ok){
        const arr = await res.json()
        if (Array.isArray(arr) && arr.length){
          const exact = arr.find(x => (x.corp_name||'') === norm)
          const any = exact || arr[0]
          if (any && (any.corp_code||any.corpCode)) return String(any.corp_code||any.corpCode)
        }
      }
    }catch{}
    // 3) Fallback: try profile by normalized name (may 500 if not resolvable)
    if (dartAvailable) try{
      const qp = new URLSearchParams(); qp.set('corp', norm); qp.set('cache','1')
      const res = await fetch(`${base}/api/dart/corp/profile?${qp.toString()}`)
      if (res.ok){
        const txt = await res.text(); const j = JSON.parse(txt); const obj = j?.company || j
        const code = obj?.corp_code || obj?.corpCode
        if (code) return String(code)
      }
    }catch{}
    try{
      // no code
    }catch{}
    return null
  }

  async function ensureCachedFilings(base, corp, fromYmd, toYmd, stockCode){
    // Resolve corpCode once
    const corpCode = await getCorpCode(base, corp, stockCode)
    // DB-first
    const norm = normalizeCorpName(corp)
    let items = await fetchFilingsFromDb(base, norm, fromYmd, toYmd, corpCode || undefined)
    if (items.length) return items
    // Populate cache via DART (once) — corpCode가 있을 때만 시도 (이름 기반은 404/500 가능성 높음)
    if (dartAvailable && corpCode) try{
      await fetch(`${base}/api/dart/filings?corp=${encodeURIComponent(corpCode)}&bgnDe=${fromYmd}&endDe=${toYmd}&pageNo=1&pageCount=100&cache=1`).then(()=>{})
    }catch{}
    // Read again from DB
    items = await fetchFilingsFromDb(base, norm, fromYmd, toYmd, corpCode || undefined)
    return items
  }

  const filtering = (rows) => {
    // Include: 현금 AND 결정; Exclude: 주주 OR 자회사
    const inc = /현금/i
    const inc2 = /결정/i
    const exc = /주주|자회사/i
    return rows.filter(r => {
      const nm = r.report_nm || r.reportName || ''
      return inc.test(nm) && inc2.test(nm) && !exc.test(nm)
    })
  }

  const toDate = (s) => {
    if (!s) return null
    const t = String(s).trim()
    let y,m,d
    if (/^\d{8}$/.test(t)) { y=t.slice(0,4); m=t.slice(4,6); d=t.slice(6,8) }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { const parts=t.split('-'); y=parts[0]; m=parts[1]; d=parts[2] }
    else return null
    const dt = new Date(Number(y), Number(m)-1, Number(d))
    return isNaN(dt.getTime()) ? null : dt
  }

  // sort state
  let sortKey = null
  let sortDir = 1 // 1 asc, -1 desc
  let results = []

  const renderTable = () => {
    const headers = [
      { k:'stock_code', t:'코드' },
      { k:'corp_name', t:'회사명' },
      { k:'is_dividend', t:'배당기업' },
      { k:'price_now_fmt', t:'현재가(원)' },
      { k:'last_year_dps_sum_fmt', t:'작년 합(원/주)' },
      { k:'last_year_yield_fmt', t:'작년 배당율(%)' },
      { k:'ttm_dps_sum_fmt', t:'최근1년 합(원/주)' },
      { k:'ttm_yield_fmt', t:'최근1년 배당율(%)' },
      { k:'last_precedence', t:'마지막 선/후' },
      { k:'count', t:'공시횟수' },
      { k:'last_rcp_dt', t:'마지막 공시일' },
      { k:'last_rcp_no', t:'접수번호' },
      { k:'_detail', t:'상세' },
    ]
    const thead = `<thead><tr>${headers.map(h=>`<th data-k="${h.k}" class="sortable">${h.t}${sortKey===h.k? (sortDir>0?' ▲':' ▼') : ''}</th>`).join('')}</tr></thead>`
    const tbodyId = 'tbody'
    const makeRow = (r) => `<tr>`+
      headers.map(h=>{
        if (h.k === 'is_dividend'){
          const ok = r.is_dividend === 'Y'
          return `<td><span class="tag ${ok?'y':'n'}">${ok?'Y':'N'}</span></td>`
        }
        if (h.k === '_detail'){
          const q = new URLSearchParams({ corp: r.corp_name || '' }).toString()
          return `<td><a class="btn" href="./dividend.html?${q}">이동</a></td>`
        }
        return `<td>${r[h.k] ?? ''}</td>`
      }).join('')+
    `</tr>`
    const fmtComma = (n) => { const v=Number(n); return Number.isFinite(v)? v.toLocaleString('ko-KR') : '' }
    const fmtPct = (n) => { const v=Number(n); return Number.isFinite(v)? v.toFixed(2) : '' }
    let data = results.slice().map(r => ({
      ...r,
      price_now_fmt: fmtComma(r.price_now),
      last_year_dps_sum_fmt: fmtComma(r.last_year_dps_sum),
      last_year_yield_fmt: fmtPct(r.last_year_yield_pct),
      ttm_dps_sum_fmt: fmtComma(r.ttm_dps_sum),
      ttm_yield_fmt: fmtPct(r.ttm_yield_pct),
    }))
    if (sortKey){
      const key = sortKey
      const dir = sortDir
      data.sort((a,b)=>{
        let va = a[key]
        let vb = b[key]
        // normalize
        if (['count','price_now','last_year_dps_sum','last_year_yield_pct','ttm_dps_sum','ttm_yield_pct'].includes(key)) { va = Number(va||0); vb = Number(vb||0) }
        else if (key === 'last_rcp_dt') { va = String(va||''); vb = String(vb||'') }
        else { va = String(va||''); vb = String(vb||'') }
        if (va < vb) return -1*dir
        if (va > vb) return 1*dir
        return 0
      })
    }
    tbl.innerHTML = `<table>${thead}<tbody id="${tbodyId}">` + data.map(makeRow).join('') + `</tbody></table>`
    tbl.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => {
      const k = th.getAttribute('data-k')
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1 }
      renderTable()
    }))
  }

  const run = async () => {
    const base = getBase()
    if (!base){ statusEl.textContent = 'API Base를 입력하세요'; return }
    const days = Number(rangeDaysEl.value || '730')
    statusEl.textContent = '서버 스캔 요청 중…'
    progbar.style.width = '0%'
    results = []
    renderTable()

    const fetchScan = async () => {
      const url = `${base}/api/scans/dividends/kospi?days=${days}`
      const res = await fetch(url, { headers: { 'Accept':'application/json' }})
      if (res.status === 202){
        const ra = parseInt(res.headers.get('Retry-After')||'3',10)||3
        statusEl.textContent = `서버 계산 중… ${ra}초 후 재시도`
        setTimeout(fetchScan, ra*1000)
        return
      }
      if (!res.ok){ statusEl.textContent = `HTTP ${res.status}`; return }
      const j = await res.json()
      results = j?.rows || []
      tbl.dataset.rows = JSON.stringify(results)
      renderTable()
      statusEl.textContent = `완료: ${results.length}건 (as of ${j?.as_of||''})`
      progbar.style.width = '100%'
    }
    await fetchScan()
  }

  const exportCsv = () => {
    try{
      const rows = JSON.parse(tbl.dataset.rows||'[]')
      if (!rows.length){ alert('내보낼 데이터가 없습니다.'); return }
      const cols = ['stock_code','corp_name','is_dividend','price_now','last_year_dps_sum','last_year_yield_pct','ttm_dps_sum','ttm_yield_pct','last_precedence','count','last_rcp_dt','last_rcp_no']
      const csv = [cols.join(',')].concat(rows.map(r=>cols.map(k=>{
        const v = r[k] ?? ''
        const s = String(v)
        return /[",\n]/.test(s) ? '"'+s.replaceAll('"','""')+'"' : s
      }).join(','))).join('\n')
      const blob = new Blob([csv], { type:'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'kospi_dividend_scan.csv'
      a.click(); URL.revokeObjectURL(a.href)
    }catch{ alert('내보내기 실패') }
  }

  apiBaseEl?.addEventListener('change', saveBase)
  btnStart?.addEventListener('click', run)
  btnExport?.addEventListener('click', exportCsv)

  const saved = localStorage.getItem('api_base')
  if (saved) apiBaseEl.value = saved
  statusEl.textContent = '대기 중… 준비되었습니다.'

  // dev 환경에서만 캐시 삭제 버튼 노출: localhost/127.0.0.1 기준
  try{
    const host = location.hostname
    const isDevHost = host === 'localhost' || host === '127.0.0.1'
    if (isDevHost && btnClear) btnClear.style.display = ''
  }catch{}

  // 캐시 삭제 핸들러
  async function clearScanCache(){
    const base = getBase()
    if (!base){ alert('API Base를 입력하세요'); return }
    const days = Number(rangeDaysEl.value || '730')
    const all = confirm('모든 스캔 캐시를 삭제할까요? (취소 시 현재 파라미터만 삭제)')
    const qp = new URLSearchParams()
    if (all) qp.set('all','1'); else qp.set('days', String(days))
    try{
      const headers = { 'Accept':'application/json' }
      const storedKey = localStorage.getItem('admin_key') || ''
      if (storedKey) headers['x-api-key'] = storedKey
      let res = await fetch(`${base}/api/admin/scans/dividends/kospi/clear?${qp.toString()}`, { method:'POST', headers })
      if (res.status === 401){
        const key = prompt('x-api-key를 입력하세요 (입력 시 저장됩니다):')
        if (!key){ alert('취소됨'); return }
        localStorage.setItem('admin_key', key)
        headers['x-api-key'] = key
        res = await fetch(`${base}/api/admin/scans/dividends/kospi/clear?${qp.toString()}`, { method:'POST', headers })
      }
      const txt = await res.text();
      try{ const j = JSON.parse(txt); alert(`캐시 삭제 완료: ${j.count||0}건`) }
      catch{ alert('캐시 삭제 응답: '+txt.slice(0,200)) }
    }catch(e){ alert('캐시 삭제 실패: '+e) }
  }
  btnClear?.addEventListener('click', clearScanCache)
})()
