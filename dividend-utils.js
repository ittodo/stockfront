// Shared dividend parsing utilities
(() => {
  const htmlToText = (input) => {
    const htmlLike = /<[^>]+>/.test(input || '')
    if (!htmlLike) return String(input || '')
    return String(input || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>(?!>)/gi, '\n')
      .replace(/<\/(p|div|tr|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
  }

  const cleanNum = (s) => {
    if (!s) return null
    const m = (s+'').match(/([\d,]+(?:\.\d+)?)/)
    if (!m) return null
    const raw = m[1]
    const num = parseFloat(raw.replace(/,/g,''))
    return isFinite(num) ? { raw, num } : null
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

  const parseDecision = (txt) => {
    const plain = htmlToText(txt)
    const grab = (labelRe, valRe) => {
      const src = plain
      const m = src.match(labelRe)
      if (!m) return null
      const block = src.slice(m.index, Math.min(src.length, m.index + 400))
      const v = block.match(valRe)
      return v ? (v[1]||'').trim() : null
    }
    const kind = grab(/배당구분\s*/i, /배당구분\s*([가-힣A-Za-z]+)/i) || grab(/배당구분\s*\n?/i, /\n?\s*([가-힣A-Za-z]+)/)
    const type = grab(/배당종류\s*/i, /배당종류\s*([가-힣A-Za-z]+)/i)
    // 1주당 배당금(원): 총액/합계 문맥은 배제
    const tryFindDps = () => {
      const candidates = []
      const push = (val) => { const v = cleanNum(val); if (v) candidates.push(v) }
      let m
      const re1 = /(1주당|주당)\s*배당금\s*\(\s*원\s*\)\s*(?:[:\-]?\s*)?(?:보통주식|보통)?\s*([0-9][\d,\.]*)/gi
      while ((m = re1.exec(plain))){ if (!/총액/.test(m[0])) push(m[2]) }
      const re2 = /보통주식[^\n]{0,40}(1주당|주당)[^\n]{0,10}배당금[^\n]{0,10}\(\s*원\s*\)[^\n]{0,15}([0-9][\d,\.]*)/gi
      while ((m = re2.exec(plain))){ if (!/총액/.test(m[0])) push(m[2]) }
      const re3 = /주당\s*배당금\s*\(\s*원\s*\)\s*([0-9][\d,\.]*)/gi
      while ((m = re3.exec(plain))){ if (!/총액/.test(m[0])) push(m[1]) }
      return candidates.length ? candidates[0] : null
    }
    const dpsCommon = tryFindDps()
    const ratio = cleanNum(grab(/시가배당율\s*\(%\)/i, /보통주식\s*([\d,\.]+)/i) || grab(/시가배당율\s*\(%\)/i, /\(%\)\s*([\d,\.]+)/i))
    const total = cleanNum(grab(/배당금\s*총액\s*\(원\)/i, /\(원\)\s*([\d,\.]+)/i) || grab(/배당금총액\s*\(원\)/i, /\(원\)\s*([\d,\.]+)/i))
    const findYmdFlexible = (s) => {
      if (!s) return null
      const m = s.match(/(19|20)\d{2}\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/)
      if (!m) return null
      const y = s.match(/(19|20)\d{2}/)?.[0]
      const mm = m[2].padStart(2,'0')
      const dd = m[3].padStart(2,'0')
      return y ? `${y}-${mm}-${dd}` : null
    }
    let recDate = grab(/(배당\s*기준일|기준일자|기준일)/i, /(((19|20)\d{2})[-\.\/_년\s]{0,3}\d{1,2}[-\.\/_월\s]{0,3}\d{1,2})/)
    if (!recDate) {
      const src = plain
      const m = src.match(/(배당\s*기준일|기준일자|기준일)/i)
      if (m){
        const block = src.slice(m.index, Math.min(src.length, m.index + 200))
        recDate = findYmdFlexible(block)
      }
    }
    if (recDate) recDate = recDate.replace(/[\.\/_]/g,'-').replace(/년|월/g,'-').replace(/일/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/-$/,'')
    const payDateRaw = grab(/배당금\s*지급[\s\S]{0,10}일자/i, /(((19|20)\d{2})[-\.\/_년\s]{0,3}\d{1,2}[-\.\/_월\s]{0,3}\d{1,2})/)
    const payDate = findYmdFlexible(payDateRaw || '')
    const boardDateRaw = grab(/이사회\s*결의일|결정일/i, /(((19|20)\d{2})[-\.\/_년\s]{0,3}\d{1,2}[-\.\/_월\s]{0,3}\d{1,2})/)
    const boardDate = findYmdFlexible(boardDateRaw || '')
    let precedence = null
    const T = plain.replace(/\s+/g,'')
    if (/선배당/.test(T)) precedence = '선배당'
    else if (/후배당/.test(T)) precedence = '후배당'
    else if (kind){
      if (/결산/.test(kind)) precedence = '후배당'
      else if (/중간|분기/.test(kind)) precedence = '선배당'
    }
    return { kind, type, dps: dpsCommon?.num || null, dps_raw: dpsCommon?.raw || null, ratio: ratio?.num || null, total: total?.num || null, total_raw: total?.raw || null, record_date: recDate || null, pay_date: payDate || null, board_date: boardDate || null, precedence }
  }

  window.DividendUtils = { parseDecision, toDate }
})()

