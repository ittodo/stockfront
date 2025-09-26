(() => {
  const $ = (s) => document.querySelector(s)
  const apiBaseEl = $('#api-base')
  const apiKeyEl = $('#api-key')
  const logEl = $('#log')
  const btn = $('#btn-refresh')

  const log = (msg) => { if (logEl) logEl.textContent = msg }

  const getBase = () => {
    const v = (apiBaseEl?.value || '').trim()
    if (v) return v.replace(/\/$/, '')
    const ov = localStorage.getItem('api_base')
    if (ov) return ov.replace(/\/$/, '')
    const h = location.hostname
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:5000'
    return 'https://api.nodostream.com'
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
  // Initialize visible input with default if empty
  ;(() => {
    if (!apiBaseEl) return
    const cur = (apiBaseEl.value || '').trim()
    if (!cur) apiBaseEl.value = getBase()
  })()
  log('대기 중… 준비되었습니다.')
})()
