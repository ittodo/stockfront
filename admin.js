(() => {
  const $ = (s) => document.querySelector(s)
  const apiBaseEl = $('#api-base')
  const apiKeyEl = $('#api-key')
  const logEl = $('#log')
  const btn = $('#btn-refresh')
  const btnUpdate = document.querySelector('#btn-update')
  const btnDb = document.querySelector('#btn-db-size')
  const dbSizeEl = document.querySelector('#db-size')
  const dbTopEl = document.querySelector('#db-top')
  const hasuraUrlEl = $('#hasura-url')
  const btnHasura = document.querySelector('#btn-open-hasura')
  const HASURA_STORAGE_KEY = 'hasura_url'

  const log = (msg) => { if (logEl) logEl.textContent = msg }
  const normalizeUrl = (value) => {
    const trimmed = (value || '').trim()
    if (!trimmed) return ''
    if (/^https?:\/\/$/i.test(trimmed)) return trimmed
    return trimmed.replace(/\/+$/, '')
  }

  const getBase = () => {
    const v = normalizeUrl(apiBaseEl?.value)
    if (v) return v
    const ov = normalizeUrl(localStorage.getItem('api_base'))
    if (ov) return ov
    const h = location.hostname
    if (h === 'localhost' || h === '127.0.0.1') {
      const lp = (location.port || '').trim()
      const apiPort = (lp === '8001') ? '5001' : '5000'
      return `http://localhost:${apiPort}`
    }
    return 'https://api.nodostream.com'
  }

  const getHasuraUrl = () => {
    const input = normalizeUrl(hasuraUrlEl?.value)
    if (input) return input
    const stored = normalizeUrl(localStorage.getItem(HASURA_STORAGE_KEY))
    if (stored) return stored
    const host = location.hostname
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:9695'
    return ''
  }

  const persistHasuraUrl = () => {
    if (!hasuraUrlEl) return
    const normalized = normalizeUrl(hasuraUrlEl.value)
    if (normalized) {
      hasuraUrlEl.value = normalized
      localStorage.setItem(HASURA_STORAGE_KEY, normalized)
    } else {
      localStorage.removeItem(HASURA_STORAGE_KEY)
    }
  }

  const refresh = async () => {
    const base = getBase()
    const key = (apiKeyEl?.value || '').trim()
    if (!base) { log('API Base URL을 입력하세요.'); return }
    if (!key) { log('x-api-key를 입력하세요.'); return }

    log('요청 중…')
    try {
      const res = await fetch(`${base}/api/admin/master/refresh-overseas-us`, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: '{}'
      })
      const txt = await res.text()
      log(`HTTP ${res.status}\n${txt}`)
    } catch (e) {
      log(`에러: ${e}`)
    }
  }

  btn?.addEventListener('click', refresh)
  hasuraUrlEl?.addEventListener('change', persistHasuraUrl)
  hasuraUrlEl?.addEventListener('blur', persistHasuraUrl)
  btnDb?.addEventListener('click', async () => {
    const base = getBase()
    if (!base) { log('API Base URL을 입력하세요.'); return }
    dbSizeEl.textContent = '조회 중…'
    dbTopEl.textContent = ''
    try{
      const j = await fetch(`${base}/api/debug/db-size`, { headers:{ 'Accept':'application/json' } }).then(r=>r.json())
      const human = (b)=>{
        const units=['B','KB','MB','GB','TB']
        let n=b, i=0; while(n>=1024 && i<units.length-1){ n/=1024; i++ }
        return `${n.toFixed(1)} ${units[i]}`
      }
      const dbBytes = j.DatabaseBytes ?? j.databaseBytes ?? j.dbBytes ?? 0
      const relations = j.Relations ?? j.relations ?? {}
      const total = human(dbBytes)
      dbSizeEl.textContent = `총 용량: ${total}`
      const entries = Object.entries(relations).sort((a,b)=>b[1]-a[1]).slice(0,5)
      if (entries.length){
        dbTopEl.innerHTML = entries.map(([k,v])=> `${k}: ${human(v)}`).join('<br>')
      } else {
        dbTopEl.textContent = '테이블 정보 없음'
      }
    }catch(e){
      dbSizeEl.textContent = '조회 실패'
      dbTopEl.textContent = String(e)
    }
  })
  btnUpdate?.addEventListener('click', async () => {
    const base = getBase()
    const key = (apiKeyEl?.value || '').trim()
    if (!base) { log('API Base URL을 입력하세요.'); return }
    if (!key) { log('x-api-key를 입력하세요.'); return }
    const branch = prompt('브랜치를 입력하세요 (기본: main):', 'main') || 'main'
    log('업데이트 시작 요청 중…')
    try {
      const u = new URL(base + '/api/admin/update/start')
      if (branch) u.searchParams.set('branch', branch)
      const res = await fetch(u.toString(), { method:'POST', headers: { 'x-api-key': key, 'Accept':'application/json' } })
      const txt = await res.text()
      log(`HTTP ${res.status}\n${txt}`)
    } catch (e) {
      log(`업데이트 요청 에러: ${e}`)
    }
  })
  btnHasura?.addEventListener('click', () => {
    const url = getHasuraUrl()
    if (!url) {
      log('Hasura URL을 입력하세요.')
      hasuraUrlEl?.focus()
      return
    }
    localStorage.setItem(HASURA_STORAGE_KEY, url)
    const opened = window.open(url, '_blank', 'noopener')
    if (!opened) {
      log('브라우저 팝업 차단을 해제하고 다시 시도하세요.')
      return
    }
    log('Hasura 콘솔을 새 탭에서 열었습니다.')
  })
  // Initialize visible input with default if empty
  ;(() => {
    if (!apiBaseEl) return
    const cur = (apiBaseEl.value || '').trim()
    if (!cur) apiBaseEl.value = getBase()
  })()
  ;(() => {
    if (!hasuraUrlEl) return
    const current = normalizeUrl(hasuraUrlEl.value)
    if (current) {
      hasuraUrlEl.value = current
      return
    }
    const stored = normalizeUrl(localStorage.getItem(HASURA_STORAGE_KEY))
    if (stored) {
      hasuraUrlEl.value = stored
      return
    }
    const host = location.hostname
    if (host === 'localhost' || host === '127.0.0.1') {
      hasuraUrlEl.value = 'http://localhost:9695'
    }
  })()
  // 첫 진입 시 DB 용량 자동 조회 한 번 실행
  if (btnDb) btnDb.click()
  log('대기 중… 준비되었습니다.')
})()
