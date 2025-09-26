(() => {
  const $ = (s) => document.querySelector(s)
  const apiBase = () => {
    const override = localStorage.getItem('api_base')
    if (override) return override.replace(/\/$/, '')
    const h = location.hostname
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:5000'
    return 'https://api.nodostream.com'
  }

  const corpInput = $('#corp-input')
  const btnLoad = $('#btn-load')
  const profileEl = $('#profile')
  const filingsEl = $('#filings')
  const linkDart = $('#link-dart')

  const qp = new URLSearchParams(location.search)
  const initialCorp = qp.get('corpCode') || qp.get('corp') || ''
  if (initialCorp) corpInput.value = initialCorp

  const renderProfile = (p) => {
    if (!p){ profileEl.innerHTML = '<p style="color:#6b7280">프로필 없음</p>'; return }
    const rows = [
      ['회사명', p.corpName],
      ['법인코드', p.corpCode],
      ['종목코드', p.stockCode],
      ['상장구분', p.corpCls],
      ['대표자', p.ceoNm],
      ['설립일', p.estDt],
      ['결산월', p.accMt],
      ['산업코드', p.indutyCode],
      ['홈페이지', p.hmUrl ? `<a href="${p.hmUrl}" target="_blank" rel="noopener">${p.hmUrl}</a>` : ''],
      ['IR', p.irUrl ? `<a href="${p.irUrl}" target="_blank" rel="noopener">${p.irUrl}</a>` : ''],
      ['전화', p.phnNo],
      ['팩스', p.faxNo],
      ['주소', p.adres],
      ['업데이트', p.updatedAt?.replace('T',' ').replace('Z','')]
    ]
    profileEl.innerHTML = `
      <div class="kv">
        ${rows.map(([k,v]) => `<div class="k">${k}</div><div class="v">${v||''}</div>`).join('')}
      </div>
    `
  }

  const renderFilings = (list) => {
    if (!list || list.length === 0){ filingsEl.innerHTML = '<p style="color:#6b7280">최근 공시 없음</p>'; return }
    const headers = ['rcept_no','report_nm','rcept_dt','flr_nm']
    const rows = list.map(it => `<tr>
      <td>${it.rcpNo || it.rcept_no || it.RcpNo || ''}</td>
      <td>${it.reportName || it.report_nm || ''}</td>
      <td>${it.rcpDate || it.rcept_dt || ''}</td>
      <td>${it.flrName || it.flr_nm || ''}</td>
    </tr>`).join('')
    filingsEl.innerHTML = `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`
  }

  const load = async () => {
    const corp = (corpInput?.value || '').trim()
    if (!corp){ alert('corpCode 또는 회사명을 입력하세요'); return }
    const base = apiBase()
    profileEl.innerHTML = '<p style="color:#6b7280">프로필 로딩…</p>'
    filingsEl.innerHTML = ''
    try{
      // ensure profile cached and read profile+recent filings
      const profRes = await fetch(`${base}/api/dart/corp/profile?${corp.match(/^\d{1,8}$/) ? 'corpCode' : 'corp'}=${encodeURIComponent(corp)}&cache=1`)
      await profRes.text()
      // now overview
      const code = corp.match(/^\d{1,8}$/) ? corp.padStart(8,'0') : corp
      const ovRes = await fetch(`${base}/api/corps/${encodeURIComponent(code)}/overview?take=20`)
      const ov = await ovRes.json()
      renderProfile(ov.profile)
      renderFilings(ov.filings?.items || [])
      linkDart.href = `./dart.html?corp=${encodeURIComponent(corp)}`
    }catch(e){
      profileEl.innerHTML = `<p style="color:#b91c1c">에러: ${e}</p>`
    }
  }

  btnLoad?.addEventListener('click', load)
  // Attach shared company search; auto-load on selection
  if (window.CompanySearch){
    window.CompanySearch.attach(corpInput, {
      apiBaseGetter: apiBase,
      curatedUrl: './assets/important-corps.json',
      onSelect: (sel) => { corpInput.value = sel.corpName; load() }
    })
  }
  if (initialCorp) load()
})()
