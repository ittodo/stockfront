(() => {
  const $ = (s) => document.querySelector(s)
  const apiBaseEl = $('#api-base')
  const corpEl = $('#corp')
  const btnScanB = document.querySelector('#btn-scan-b')
  const btnScanCsv = document.querySelector('#btn-scan-csv')
  const scanTbl = document.querySelector('#scan-tbl')
  const scanMeta = document.querySelector('#scan-meta')
  const scanDoc = document.querySelector('#scan-doc')
  const scanRaw = document.querySelector('#scan-raw')
  const scanInfo = document.querySelector('#scan-info')
  const docCache = Object.create(null)

  let selectedCorpCode = ''
  const getBase = () => {
    const v = (apiBaseEl?.value || '').trim();
    if (v) return v.replace(/\/$/, '');
    const ov = localStorage.getItem('api_base');
    if (ov) return ov.replace(/\/$/, '');
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:5000';
    return 'https://api.nodostream.com';
  }
  const saveBase = () => { const b = apiBaseEl?.value?.trim(); if (b) localStorage.setItem('api_base', b) }

  // Attach company search (exclude delisted via backend flag)
  if (window.CompanySearch){
    window.CompanySearch.attach(corpEl, {
      apiBaseGetter: getBase,
      curatedUrl: './assets/important-corps.json',
      excludeDelisted: true,
      onSelect: (sel) => { selectedCorpCode = sel.corpCode; corpEl.value = sel.corpName }
    })
  }

  const parseDecision = (txt) => window.DividendUtils?.parseDecision(txt)

  // 원문 캐시 우선: DB에서 먼저 찾고, 없으면 1회 DART 호출로 캐싱 후 재시도
  const getDocXmlCachedFirst = async (base, rcp) => {
    try {
      const res1 = await fetch(`${base}/api/filings/detail/cached?rcpNo=${encodeURIComponent(rcp)}`)
      if (res1.ok) return await res1.text()
    } catch {}
    // 미캐시 시 캐싱 후 재조회
    try { await fetch(`${base}/api/dart/filings/detail?rcpNo=${encodeURIComponent(rcp)}&cache=1`).then(()=>{}) } catch {}
    const res2 = await fetch(`${base}/api/filings/detail/cached?rcpNo=${encodeURIComponent(rcp)}`)
    if (res2.ok) return await res2.text()
    throw new Error('원문 캐시를 찾을 수 없습니다')
  }

  // 주가 조회 도우미들
  const getKrStockCode = async (base, corp, corpCode) => {
    // 이름 정규화: 말미 꼬리표 제거
    const normalize = (name) => {
      let s = (name||'').trim();
      s = s.replace(/\s+BC\s+\d{8}\s*$/i, '');
      s = s.replace(/\s*\([A-Za-z0-9]+\)\s*$/g, '');
      s = s.replace(/\s+[A-Z]$/g, '');
      s = s.replace(/\s{2,}/g, ' ').trim();
      return s;
    }
    const corpNorm = normalize(corp);
    // 1) DART 프로필에서 시도
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
    // 2) KRX 로컬 마스터에서 회사명으로 폴백(정확 일치 우선)
    try{
      const list = await fetch(`${base}/api/krx/corps/local`).then(r=>r.json())
      const name = corpNorm
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
      return (await tryWindow(14, true))
          || (await tryWindow(60, true))
          || (await tryWindow(120, true))
          || null
    }catch{ return null }
  }

  // DB-first filings fetcher: exclude DART unless cache is empty, then populate once
  const fetchJson = async (u) => { const r=await fetch(u); if(!r.ok) throw new Error('HTTP '+r.status); return r.json() }
  const fetchFromDb = async (base, corp, corpCode, fromDigits, toDigits) => {
    let page=1, pageSize=200
    const acc=[]
    const qbase = corpCode ? `corpCode=${encodeURIComponent(corpCode)}` : `corp=${encodeURIComponent(corp)}`
    while(true){
      const url = `${base}/api/filings/search?${qbase}&from=${fromDigits}&to=${toDigits}&page=${page}&pageSize=${pageSize}`
      const j = await fetchJson(url)
      const items = j?.items || []
      acc.push(...items)
      const total = Number(j?.total||0)
      if (!total || page*pageSize >= total) break
      page++
      if (page>200) break
    }
    return acc
  }
  const loadFilingsRange = async (base, corp, corpCode, fromDigits, toDigits) => {
    let items = await fetchFromDb(base, corp, corpCode, fromDigits, toDigits)
    if (items.length) return items
    // Populate cache via DART once
    const qp = new URLSearchParams()
    qp.set('corp', corpCode || corp)
    qp.set('bgnDe', fromDigits)
    qp.set('endDe', toDigits)
    qp.set('pageNo','1'); qp.set('pageCount','100'); qp.set('cache','1')
    try{ await fetchJson(`${base}/api/dart/filings?${qp.toString()}`) }catch{}
    items = await fetchFromDb(base, corp, corpCode, fromDigits, toDigits)
    return items
  }

  const scanB = async () => {
    const base = getBase()
    const corp = (corpEl?.value || '').trim()
    if (!corp){ scanMeta.textContent = '회사명을 입력하세요'; return }
    const d0 = new Date(); d0.setDate(d0.getDate()-1)
    const toStr = d0.toISOString().slice(0,10)
    const d = new Date(toStr)
    const fromStr = new Date(d.getTime() - 365*24*3600*1000).toISOString().slice(0,10)
    const toDigits = toStr.replaceAll('-', '')
    const fromDigits = fromStr.replaceAll('-', '')
    scanMeta.textContent = `스캔 요청: corp=${corp} from=${fromStr} to=${toStr}`
    try{
      // 1) DB 우선 조회(캐시가 있으면 DART 호출 없이 종료)
      let all;
      try {
        const prelim = await fetchFromDb(base, corp, selectedCorpCode, fromDigits, toDigits)
        if (Array.isArray(prelim) && prelim.length) {
          all = prelim
        }
      } catch {}
      if (!all) {
      const qp = new URLSearchParams()
      qp.set('corp', selectedCorpCode || corp)
      qp.set('bgnDe', fromDigits)
      qp.set('endDe', toDigits)
      qp.set('pageNo','1'); qp.set('pageCount','100'); qp.set('cache','1')
      const url = `${base}/api/dart/filings?${qp.toString()}`
      const listJson = await fetch(url).then(async r=>{ const t=await r.text(); try{return JSON.parse(t)}catch{ return { parseError:true, raw:t } } })
      if (listJson.parseError){ scanMeta.textContent = `응답 파싱 실패: ${url}`; scanTbl.innerHTML = `<pre class="log">${(listJson.raw||'').slice(0,1000)}</pre>`; return }
      all = (listJson.list || listJson.items || [])
      const totalPage = parseInt(listJson.total_page || listJson.totalPage || '1', 10)
      if (Number.isFinite(totalPage) && totalPage > 1){
        for (let p=2; p<=totalPage; p++){
          const qp2 = new URLSearchParams()
          qp2.set('corp', selectedCorpCode || corp)
          qp2.set('bgnDe', fromDigits)
          qp2.set('endDe', toDigits)
          qp2.set('pageNo', String(p))
          qp2.set('pageCount','100')
          qp2.set('cache','1')
          const url2 = `${base}/api/dart/filings?${qp2.toString()}`
          scanMeta.textContent = `응답 수집: page ${p}/${totalPage}`
          const pj = await fetch(url2).then(async r=>{ const t=await r.text(); try{return JSON.parse(t)}catch{ return { parseError:true, raw:t } } })
          if (pj.parseError) break
          const list2 = pj.list || pj.items || []
          if (!Array.isArray(list2) || list2.length===0) break
          all = all.concat(list2)
        }
      }
      } // end DB-miss → DART 채우기
      const titleHasCashDecision = (name) => {
        const nm = (name||'').replace(/[\s·ㆍ\.\-_\/]/g,'')
        if (nm.includes('주주') || nm.includes('자회사')) return false
        return nm.includes('현금') && nm.includes('결정')
      }
      const filtered = all.filter(it => titleHasCashDecision(it.report_nm || it.reportName || ''))
      scanMeta.textContent = `응답: ${all.length}건, 현금·결정 제목: ${filtered.length}건 (${fromStr}~${toStr})`

      if (all.length){
        const headers0 = [
          { k:'rcp_dt', t:'공시일자' },
          { k:'rcp_no', t:'접수번호' },
          { k:'report_nm', t:'제목' },
          { k:'_doc', t:'원문' },
        ]
        const thead0 = `<thead><tr>${headers0.map(h=>`<th>${h.t}</th>`).join('')}</tr></thead>`
        const tbody0 = '<tbody>' + filtered.map(it=>{
          const rcp = it.rcept_no || it.rcp_no || it.rcpNo || ''
          const rdt = it.rcept_dt || it.rcp_dt || it.rcpDate || ''
          const nm  = it.report_nm || it.reportName || ''
          return `<tr><td>${rdt}</td><td>${rcp}</td><td>${nm}</td><td><button class=\"btn btn-doc\" data-rcp=\"${rcp}\" data-rcpdt=\"${rdt}\">원문</button></td></tr>`
        }).join('') + '</tbody>'
        scanTbl.innerHTML = `<table>${thead0}${tbody0}</table>`
        scanTbl.querySelectorAll('.btn-doc').forEach(btn => btn.addEventListener('click', async (e) => {
          const rcp = e.currentTarget.getAttribute('data-rcp')
          const rcpdt = e.currentTarget.getAttribute('data-rcpdt') || ''
          if (!rcp) return
          const base = getBase()
          let txt = docCache[rcp]
          try{
            if (scanInfo){ scanInfo.style.display='block'; scanInfo.textContent = `원문 로드 중… (접수번호 ${rcp})` }
            if (scanDoc) scanDoc.innerHTML = ''
            if (scanRaw) scanRaw.textContent = ''
            if (!txt){ txt = await getDocXmlCachedFirst(base, rcp); docCache[rcp]=txt }
            const parsed = parseDecision(txt) || {}
            const rec = parsed.record_date || null
            let msg = ''
            msg += rcpdt ? `공시일자: ${rcpdt}` : `공시일자 파싱 실패`
            msg += ' | '
            msg += rec ? `배당기준일: ${rec}` : `배당기준일 파싱 실패`
      if (scanInfo){
              const dr = window.DividendUtils?.toDate(rec); const dc = window.DividendUtils?.toDate(rcpdt)
              if (dr && dc){ msg += ` | 판별: ${dr>dc?'선배당':(dr<dc?'후배당':'동일일자')}` }
              else { msg += ' | 판별 불가' }
              scanInfo.textContent = msg
              scanInfo.style.display = 'block'
            }
            if (scanDoc){
              scanDoc.innerHTML=''
              const iframe=document.createElement('iframe'); iframe.style.width='100%'; iframe.style.height='420px'; iframe.setAttribute('sandbox','allow-scripts')
              const looksHtml=/^\s*<\s*(!doctype html|html[\s>])/i.test(txt)
              if(looksHtml){ iframe.srcdoc=txt } else { const escapeHtml=(s)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); const html=`<!doctype html><html><head><meta charset=\"utf-8\"><style>body{margin:0}pre{white-space:pre-wrap;word-break:break-word;padding:12px;margin:0;font-family:ui-monospace,monospace}</style></head><body><pre>${escapeHtml(txt)}</pre></body></html>`; iframe.srcdoc=html }
              scanDoc.appendChild(iframe)
            }
            if (scanRaw) scanRaw.textContent = txt.slice(0,20000)
          }catch(err){ if (scanRaw) scanRaw.textContent = `원문 로드 실패: ${err}` }
        }))
      } else {
        scanTbl.innerHTML = '<p style="color:#6b7280">현금·결정이 포함된 제목이 없습니다.</p>'
      }

      // 현재가(종가) 조회: DART 프로필→stock_code 파악 후 /api/prices/close에서 최근 종가
      let stockCode = await getKrStockCode(base, corp, selectedCorpCode)
      let priceNow = null
      if (stockCode){ priceNow = await getLatestKrClose(base, stockCode) }

      const rows = []
      for (const it of filtered){
        const rcp = it.rcept_no || it.rcp_no || it.rcpNo
        if (!rcp) continue
        let txt
        try{
          txt = await getDocXmlCachedFirst(base, rcp)
          docCache[rcp] = txt
        }catch{ txt = '' }
        const parsed = txt ? parseDecision(txt) : {}
        const reportName = it.report_nm || it.reportName || ''
        const row = { rcp_no: rcp, rcp_dt: it.rcept_dt || it.rcp_dt || it.rcpDate || '', report_nm: reportName, ...parsed }
        if (priceNow && Number.isFinite(parsed?.dps)){
          row.yield_now_pct = parsed.dps / priceNow * 100
        }
        if (priceNow) row.price_now = priceNow
        rows.push(row)
      }
      const toDate = (s) => window.DividendUtils?.toDate(s)
      rows.forEach(r => {
        const dr = toDate(r.record_date)
        const dc = toDate(r.rcp_dt)
        if (dr && dc){
          if (dr > dc) r.precedence = '선배당'
          else if (dr < dc) r.precedence = '후배당'
        }
      })
      if (!rows.length){
        scanMeta.textContent = `배당 제목: 0건 (${fromStr}~${toStr})`
        return
      }
      const headers = [
        { k:'rcp_dt', t:'공시일자' },
        { k:'rcp_no', t:'접수번호' },
        { k:'report_nm', t:'제목' },
        { k:'dps_raw', t:'1주당 배당금(원)' },
        { k:'price_now_fmt', t:'현재가(원)' },
        { k:'yield_now_fmt', t:'현재가 대비 배당율(%)' },
        { k:'precedence', t:'선/후' },
        { k:'record_date', t:'배당기준일' },
        { k:'_doc', t:'원문' },
      ]
      // 포맷팅
      const fmtComma = (n) => {
        const v = Number(n)
        return Number.isFinite(v) ? v.toLocaleString('ko-KR') : ''
      }
      rows.forEach(r => {
        r.yield_now_fmt = (typeof r.yield_now_pct === 'number') ? r.yield_now_pct.toFixed(2) : ''
        r.price_now_fmt = (typeof r.price_now === 'number') ? fmtComma(r.price_now) : ''
      })
      const thead = `<thead><tr>${headers.map(h=>`<th>${h.t}</th>`).join('')}</tr></thead>`
      const tbody = '<tbody>' + rows.map(r=>`<tr>${headers.map(h=>{
        let v = r[h.k] ?? ''
        if (h.k === '_doc') return `<td><button class=\"btn btn-doc\" data-rcp=\"${r.rcp_no}\" data-rcpdt=\"${r.rcp_dt||''}\">원문</button></td>`
        return `<td>${v}</td>`
      }).join('')}</tr>`).join('') + '</tbody>'
      scanTbl.innerHTML = `<table>${thead}${tbody}</table>`
      scanTbl.dataset.rows = JSON.stringify(rows)
      scanMeta.textContent = `현금·결정 제목: ${rows.length}건`
      scanTbl.querySelectorAll('.btn-doc').forEach(btn => btn.addEventListener('click', async (e) => {
        const rcp = e.currentTarget.getAttribute('data-rcp')
        if (!rcp) return
        const base = getBase()
        let txt = docCache[rcp]
        try {
          if (!txt){ txt = await getDocXmlCachedFirst(base, rcp); docCache[rcp] = txt }
          if (scanDoc){
            scanDoc.innerHTML = ''
            const iframe = document.createElement('iframe')
            iframe.style.width = '100%'
            iframe.style.height = '420px'
            iframe.setAttribute('sandbox', 'allow-scripts')
            const looksHtml = /^\s*<\s*(!doctype html|html[\s>])/i.test(txt)
            if (looksHtml){
              iframe.srcdoc = txt
            } else {
              const escapeHtml = (s) => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
              const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}pre{white-space:pre-wrap;word-break:break-word;padding:12px;margin:0;font-family:ui-monospace,monospace}</style></head><body><pre>${escapeHtml(txt)}</pre></body></html>`
              iframe.srcdoc = html
            }
            scanDoc.appendChild(iframe)
          }
          if (scanRaw) scanRaw.textContent = txt.slice(0, 20000)
        } catch (err) {
          if (scanRaw) scanRaw.textContent = `원문 로드 실패: ${err}`
        }
      }))
    }catch(e){ scanTbl.innerHTML = `<p style=\"color:#b91c1c\">에러: ${e}</p>`; scanMeta.textContent='에러' }
  }

  const exportScanCsv = () => {
    try{
      const rows = JSON.parse(scanTbl.dataset.rows||'[]')
      if (!rows.length){ alert('내보낼 데이터가 없습니다.'); return }
      const cols = ['rcp_dt','rcp_no','precedence','kind','type','dps_raw','price_now','yield_now_pct','ratio','total_raw','record_date','pay_date','board_date','report_nm']
      const csv = [cols.join(',')].concat(rows.map(r=>cols.map(k=>{
        const v = r[k] ?? ''
        const s = String(v)
        return /[",\n]/.test(s) ? '"'+s.replaceAll('"','""')+'"' : s
      }).join(','))).join('\n')
      const blob = new Blob([csv], { type:'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'dividend_decisions.csv'
      a.click(); URL.revokeObjectURL(a.href)
    }catch{ alert('내보내기 실패') }
  }

  apiBaseEl?.addEventListener('change', saveBase)
  btnScanB?.addEventListener('click', scanB)
  btnScanCsv?.addEventListener('click', exportScanCsv)

  const saved = localStorage.getItem('api_base')
  if (saved) apiBaseEl.value = saved
  else if (apiBaseEl && !(apiBaseEl.value||'').trim()){
    const h = location.hostname
    apiBaseEl.value = (h==='localhost'||h==='127.0.0.1') ? 'http://localhost:5000' : 'https://api.nodostream.com'
  }
  // Prefill corp from URL query (?corp=...)
  try{
    const q = new URLSearchParams(location.search)
    const corpQ = q.get('corp')
    if (corpQ && corpEl){ corpEl.value = corpQ }
  }catch{}
  if (scanMeta) scanMeta.textContent = '대기 중… 준비되었습니다.'
})()
