(function(){
  const global = window

  const debounce = (fn, ms=200) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms) } }

  function attach(inputEl, opts={}){
    const apiBaseGetter = opts.apiBaseGetter || (()=>{
      const ov = localStorage.getItem('api_base');
      if (ov) return ov;
      const h = location.hostname;
      return (h === 'localhost' || h === '127.0.0.1') ? 'http://localhost:5000' : 'https://api.nodostream.com';
    })
    const curatedUrl = opts.curatedUrl || './assets/important-corps.json'
    const maxItems = opts.maxItems ?? 10
    const minChars = opts.minChars ?? 1
    const showCuratedOnEmpty = opts.showCuratedOnEmpty ?? true
    const onSelect = opts.onSelect || function(){}
    const excludeDelisted = opts.excludeDelisted !== false // default: true
    const fileListUrl = opts.fileListUrl || localStorage.getItem('corp_list_url') || ''

    if (!inputEl) return { destroy(){}, getSelection(){ return null } }

    const parent = inputEl.parentElement
    if (parent && getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
    const dd = document.createElement('div')
    dd.className = 'cs-suggest'
    dd.style.cssText = 'position:absolute;left:0;right:0;top:100%;z-index:50;display:none;background:#fff;border:1px solid #e5e7eb;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.06);max-height:260px;overflow:auto'
    parent.appendChild(dd)

    let curated = []
    fetch(curatedUrl).then(r=>r.ok?r.json():[]).then(j=>{ curated = Array.isArray(j)?j:[] }).catch(()=>{})

    let items = []
    let allCorps = null // large list loaded once (session memory)
    let activeNameSet = null
    
    const parseCsv = (text) => {
      const lines = text.split(/\r?\n/).filter(Boolean)
      if (!lines.length) return []
      const header = lines[0].split(',').map(h=>h.trim().replace(/^\ufeff/,''))
      const rows = []
      const idx = (nameArr) => nameArr.map(n=>header.indexOf(n)).find(i=>i>=0)
      const iCode = idx(['stock_code','isu_srt_cd','isu_cd','CODE','code'])
      const iName = idx(['corp_name','kor_isu_nm','isu_abbrv','name','NAME'])
      const iMkt  = idx(['market','mkt_tp_nm','mkt_tp','mkt','MARKET'])
      if (iCode==null || iName==null) return []
      for (let i=1;i<lines.length;i++){
        const cols = lines[i].split(',')
        const code = (cols[iCode]||'').trim()
        const name = (cols[iName]||'').trim()
        const market = (iMkt!=null && iMkt>=0) ? (cols[iMkt]||'').trim() : ''
        if (!code || !name) continue
        rows.push({ stock_code: code, corp_name: name, market, active: true })
      }
      return rows
    }
    
    const tryLoadLocalList = async () => {
      const candidates = []
      if (fileListUrl) candidates.push(fileListUrl)
      candidates.push('./assets/kr-listed.json')
      candidates.push('./assets/kr-listed.csv')
      for (const url of candidates){
        try{
          const res = await fetch(url)
          if (!res.ok) continue
          const body = await res.text()
          let arr
          if (/\.json($|\?|#)/i.test(url)) arr = JSON.parse(body)
          else arr = parseCsv(body)
          if (Array.isArray(arr) && arr.length) return arr
        }catch{}
      }
      return null
    }
    let active = -1
    let selection = null
    let justSelected = false

    const render = () => {
      if (!items.length){ dd.style.display='none'; dd.innerHTML=''; return }
      dd.innerHTML = items.map((it,i)=>{
        const name = it.corp_name || it.name || ''
        const code = it.corp_code || ''
        const stock = it.stock_code || ''
        const extra = [code?`(${code})`:'', stock?`[${stock}]`:''].filter(Boolean).join(' ')
        const cls = (i===active)?'cs-item cs-active':'cs-item'
        return `<div class="${cls}" data-idx="${i}" style="padding:8px 10px;cursor:pointer">${name} <span style="color:#6b7280">${extra}</span></div>`
      }).join('')
      dd.style.display='block'
      Array.from(dd.querySelectorAll('.cs-item')).forEach(el=>{
        el.addEventListener('mouseenter', ()=>{ active = parseInt(el.getAttribute('data-idx')||'-1'); highlight() })
        el.addEventListener('click', ()=>{ pick(parseInt(el.getAttribute('data-idx')||'-1')) })
      })
    }

    const highlight = () => {
      dd.querySelectorAll('.cs-item').forEach((el,i)=>{
        if (i===active) el.classList.add('cs-active'); else el.classList.remove('cs-active')
      })
    }

    const pick = (idx) => {
      if (idx<0 || idx>=items.length) return
      const it = items[idx]
      selection = { corpCode: it.corp_code || '', corpName: it.corp_name || it.name || '', stockCode: it.stock_code || '' }
      inputEl.value = selection.corpName
      dd.style.display='none'
      dd.innerHTML=''
      items = []
      active = -1
      justSelected = true
      onSelect(selection)
    }

    const showCurated = () => {
      if (!curated || curated.length===0){ dd.style.display='none'; dd.innerHTML=''; items=[]; active=-1; return }
      items = curated.slice(0, maxItems)
      active = items.length?0:-1
      render()
    }

    const ensureAllCorps = async () => {
      if (allCorps) return allCorps
      try{
        const base = apiBaseGetter().replace(/\/$/,'')
        // 1) Local file (if present)
        const local = await tryLoadLocalList()
        if (local && local.length){
          allCorps = excludeDelisted ? local.filter(x => x.active !== false) : local
        } else {
          // 2) Local mst parsed by server
          let ok = false
          try{
            const resLocalMst = await fetch(`${base}/api/krx/corps/local`)
            if (resLocalMst.ok){
              const arr = await resLocalMst.json()
              allCorps = Array.isArray(arr)? arr: []
              ok = allCorps.length>0
            }
          }catch{}
          // 3) KIS-listed endpoints
          if (!ok){
            try{
              const resKis = await fetch(`${base}/api/kis/corps`)
              if (resKis.ok){
                const raw = await resKis.json()
                const arr = Array.isArray(raw)? raw: []
                allCorps = excludeDelisted ? arr.filter(x => x.active === true) : arr
                ok = true
              }
            }catch{}
          }
          // 4) DART fallback
          if (!ok){
            const res = await fetch(`${base}/api/dart/corps`)
            if (res.ok){
              const raw = await res.json()
              const arr = Array.isArray(raw)? raw: []
              if (excludeDelisted){
                const isActive = (it) => (it.active === true) || (/^(\d){6}$/.test(it.stock_code||''))
                allCorps = arr.filter(isActive)
              } else {
                allCorps = arr
              }
            }
          }
        }
        if (allCorps && Array.isArray(allCorps)){
          activeNameSet = new Set(allCorps.map(x => (x.corp_name||x.name||'').toLowerCase()))
        }
      }catch{}
      return allCorps
    }

    const matches = (q, list) => {
      const qq = q.toLowerCase()
      const take = []
      for (const it of list){
        const name = (it.corp_name || it.name || '').toLowerCase()
        const code = (it.corp_code || '').toLowerCase()
        const stock = (it.stock_code || '').toLowerCase()
        if (!qq) { take.push(it) }
        else if (name.includes(qq) || code.startsWith(qq) || stock.startsWith(qq)) { take.push(it) }
        if (take.length >= maxItems) break
      }
      return take
    }

    const query = debounce(async () => {
      const q = (inputEl.value||'').trim()
      if (q.length < minChars){
        if (showCuratedOnEmpty) { showCurated(); return }
        dd.style.display='none'; dd.innerHTML=''; items=[]; active=-1; return
      }
      selection = null
      // Ensure list loaded once; then filter on client
      await ensureAllCorps()
      let merged = []
      if (allCorps && Array.isArray(allCorps)) merged = matches(q, allCorps)
      // backfill curated but only if it exists in active list (by name)
      if ((!merged || merged.length < maxItems) && curated && curated.length){
        const extras = matches(q, curated)
          .filter(x => {
            const nm = (x.corp_name || x.name || '').toLowerCase()
            return !nm || (activeNameSet ? activeNameSet.has(nm) : true)
          })
          .filter(x => !merged.find(y => (y.corp_name||'')===(x.corp_name||x.name||'')))
        merged = merged.concat(extras).slice(0, maxItems)
      }
      items = merged
      active = items.length?0:-1
      render()
    }, 200)

    inputEl.addEventListener('input', ()=>{ if (justSelected){ justSelected=false; return } query() })
    inputEl.addEventListener('focus', ()=>{
      const q = (inputEl.value||'').trim()
      if (q.length < minChars && showCuratedOnEmpty) { showCurated() } else { query() }
    })
    inputEl.addEventListener('keydown', (e)=>{
      if (dd.style.display==='none') return
      if (e.key==='ArrowDown'){ e.preventDefault(); active = Math.min(items.length-1, active+1); highlight() }
      else if (e.key==='ArrowUp'){ e.preventDefault(); active = Math.max(0, active-1); highlight() }
      else if (e.key==='Enter'){ if (active>=0){ e.preventDefault(); pick(active) } }
      else if (e.key==='Escape'){ dd.style.display='none' }
    })
    document.addEventListener('click', (e)=>{ if (!dd.contains(e.target) && e.target!==inputEl){ dd.style.display='none' } })

    return {
      destroy(){ dd.remove() },
      getSelection(){ return selection }
    }
  }

  global.CompanySearch = { attach }
})();
