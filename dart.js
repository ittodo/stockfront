(() => {
  const $ = (s) => document.querySelector(s)
  const apiBaseEl = $('#api-base')
  const corpEl = $('#corp')
  const corpSuggest = $('#corp-suggest')
  const fromEl = $('#from')
  const toEl = $('#to')
  const fetchRemoteEl = $('#fetch-remote')
  const pageEl = $('#page')
  const pageSizeEl = $('#page-size')
  const btnSearch = $('#btn-search')
  const btnExport = $('#btn-export')
  const metaEl = $('#meta')
  const tblWrap = $('#tbl')
  const xmlEl = $('#xml')
  const detailPanel = document.querySelector('#detail-panel')
  const docWrap = $('#doc')
  const btnViewRendered = $('#btn-view-rendered')
  const btnViewSource = $('#btn-view-source')
  let currentBlobUrl = null
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
  const setMeta = (msg) => { if (metaEl) metaEl.textContent = msg }
  const saveBase = () => { const b = apiBaseEl?.value?.trim(); if (b) localStorage.setItem('api_base', b) }

  const toYmd = (v) => v ? v.replaceAll('-', '') : ''
  const debounce = (fn, ms=250) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms) } }
  // Use shared company search control
  if (window.CompanySearch){
    window.CompanySearch.attach(corpEl, {
      apiBaseGetter: getBase,
      curatedUrl: './assets/important-corps.json',
      onSelect: (sel) => { selectedCorpCode = sel.corpCode; corpEl.value = sel.corpName }
    })
  }

  const renderTable = (items) => {
    if (!items || items.length === 0){ tblWrap.innerHTML = '<p style="color:#6b7280">결과 없음</p>'; return }
    const th = ['rcp_no','corp_name','report_nm','flr_nm','rcp_dt','rmk','액션']
    const rows = items.map(it => {
      const rcp = it.rcpNo || it.rcp_no
      const code = it.corpCode || it.corp_code || ''
      const btn = `<button class=\"btn btn-view\" data-rcp=\"${rcp}\">상세</button> ` +
                  (code ? `<a class=\"btn\" href=\"./corp.html?corpCode=${code}\">프로필</a>` : '')
      return `<tr>
        <td>${rcp || ''}</td>
        <td>${it.corpName || it.corp_name || ''}</td>
        <td>${it.reportName || it.report_nm || ''}</td>
        <td>${it.flrName || it.flr_nm || ''}</td>
        <td>${it.rcpDate || it.rcp_dt || ''}</td>
        <td>${it.remark || it.rmk || ''}</td>
        <td>${btn}</td>
      </tr>`
    }).join('')
    tblWrap.innerHTML = `<table><caption>총 ${items.length}건</caption><thead><tr>${th.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`
    tblWrap.querySelectorAll('.btn-view').forEach(btn => btn.addEventListener('click', onView))
  }

  const exportCsv = () => {
    const table = tblWrap.querySelector('table')
    if (!table){ alert('내보낼 데이터가 없습니다.'); return }
    const rows = []
    const headers = Array.from(table.querySelectorAll('thead th')).slice(0,6).map(th => th.textContent)
    rows.push(headers)
    table.querySelectorAll('tbody tr').forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('td')).slice(0,6).map(td => td.textContent || '')
      rows.push(cells)
    })
    const csv = rows.map(r => r.map(v => /[",\n]/.test(v) ? '"'+v.replaceAll('"','""')+'"' : v).join(',')).join('\n')
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const ymd = new Date().toISOString().slice(0,10)
    a.download = `filings_${ymd}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const setMode = (mode) => {
    // mode: 'rendered' | 'source'
    if (docWrap) docWrap.style.display = (mode === 'rendered') ? 'block' : 'none'
    if (xmlEl) xmlEl.style.display = (mode === 'source') ? 'block' : 'none'
  }

  const onView = async (e) => {
    const rcp = e.currentTarget?.getAttribute('data-rcp')
    if (!rcp) return
    const base = getBase()
    try{
      setMeta('상세 가져오는 중…')
      const res = await fetch(`${base}/api/dart/filings/detail?rcpNo=${encodeURIComponent(rcp)}&cache=1`)
      const txt = await res.text()
      // Auto-open details
      if (detailPanel) detailPanel.open = true

      // Always keep source available
      if (xmlEl) xmlEl.textContent = txt

      // Rendered view
      const looksHtml = /^\s*<\s*(!doctype html|html[\s>])/i.test(txt)
      if (docWrap){
        // Cleanup previous blob url if any
        if (currentBlobUrl){ URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null }
        docWrap.innerHTML = ''
        const iframe = document.createElement('iframe')
        iframe.style.width = '100%'
        iframe.style.height = '480px'
        // Allow scripts only; keep origin opaque to avoid sandbox escape warnings
        iframe.setAttribute('sandbox', 'allow-scripts')
        if (looksHtml){
          iframe.srcdoc = txt
        } else {
          // Render XML/text inside an HTML shell to avoid XML parser errors on malformed docs
          const escapeHtml = (s) => s
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
          const html = `<!doctype html><html><head><meta charset="utf-8"><style>
            body{margin:0;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace;}
            pre{white-space:pre-wrap;word-break:break-word;padding:12px;margin:0}
          </style></head><body><pre>${escapeHtml(txt)}</pre></body></html>`
          iframe.srcdoc = html
        }
        docWrap.appendChild(iframe)
      }

      // Default to rendered mode
      setMode('rendered')
      setMeta(`상세: HTTP ${res.status}`)
    }catch(err){ setMeta(`상세 오류: ${err}`) }
  }

  btnViewRendered?.addEventListener('click', () => setMode('rendered'))
  btnViewSource?.addEventListener('click', () => setMode('source'))

  const search = async () => {
    saveBase()
    const base = getBase()
    const corp = (corpEl?.value || '').trim()
    const from = toYmd(fromEl?.value || '')
    const to = toYmd(toEl?.value || '')
    const page = Math.max(1, parseInt(pageEl?.value||'1')||1)
    const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeEl?.value||'50')||50))
    const doFetch = !!fetchRemoteEl?.checked

    setMeta('검색 중…')
    try{
      if (doFetch && corp){
        // Bring from DART and cache first
        const qp = new URLSearchParams()
        qp.set('pageNo', '1')
        qp.set('pageCount', String(pageSize))
        qp.set('cache', '1')
        qp.set('corp', corp)
        if (from) qp.set('bgnDe', from)
        if (to) qp.set('endDe', to)
        const res = await fetch(`${base}/api/dart/filings?${qp.toString()}`)
        await res.text() // ignore body; DB search next
      }
      // Query DB
      const qp2 = new URLSearchParams()
      if (selectedCorpCode) qp2.set('corpCode', selectedCorpCode)
      else if (corp) qp2.set('corp', corp)
      if (from) qp2.set('from', from)
      if (to) qp2.set('to', to)
      qp2.set('page', String(page))
      qp2.set('pageSize', String(pageSize))
      const res2 = await fetch(`${base}/api/filings/search?${qp2.toString()}`)
      const data = await res2.json()
      setMeta(`DB 검색: 총 ${data.total}건 / 페이지 ${data.page} (size ${data.pageSize})`)
      renderTable(data.items || [])
    }catch(err){ setMeta(`검색 오류: ${err}`) }
  }

  apiBaseEl?.addEventListener('change', saveBase)
  // Initialize input if empty
  ;(()=>{ if(apiBaseEl && !(apiBaseEl.value||'').trim()){ apiBaseEl.value = getBase() } })()
  btnSearch?.addEventListener('click', search)
  btnExport?.addEventListener('click', exportCsv)

  // restore base
  const saved = localStorage.getItem('api_base')
  if (saved) apiBaseEl.value = saved
  setMeta('대기 중… 준비되었습니다.')
  // suggestions handled by shared control
})()
