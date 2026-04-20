<script setup>
import { ref, computed, watch, onMounted } from 'vue'

// ═══════════════════════════════════════════════════════════
//  Section 1 — API Configuration
//  Vite 會根據目前是開發環境 (npm run dev) 還是生產環境 (npm run build)
//  自動決定讀取 .env.development 還是 .env.production
// ═══════════════════════════════════════════════════════════
const API_BASE = import.meta.env.VITE_API_BASE
console.log('當前 API 連線位址:', API_BASE)

async function api(path, params = {}) {
  try {
    const url = new URL(`${API_BASE}${path}`)
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v)
    })
    const response = await fetch(url.toString())
    if (!response.ok) throw new Error(`網路請求失敗：HTTP ${response.status}`)
    return response.json()
  } catch (error) {
    console.error('取得資料時發生錯誤:', error)
    throw error
  }
}

// ═══════════════════════════════════════════════════════════
//  Section 2 — Case Type Definitions
// ═══════════════════════════════════════════════════════════
const CATEGORIES = [
  { key: 'criminal', label: '刑事' },
  { key: 'civil', label: '民事' },
  { key: 'family', label: '家事' },
]

const CASE_TYPES = {
  criminal_litigation: { label: '刑事訴訟', category: 'criminal', icon: '⚖️' },
  civil_litigation:    { label: '民事訴訟', category: 'civil',    icon: '📋' },
  civil_nonlitig:      { label: '民事非訟', category: 'civil',    icon: '📝' },
  family_litigation:   { label: '家事訴訟', category: 'family',   icon: '👨‍👩‍👧' },
}

// ═══════════════════════════════════════════════════════════
//  Section 3 — Shared Utility Functions
// ═══════════════════════════════════════════════════════════
const numFmt = v => { const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10); return Number.isNaN(n) ? String(v ?? '') : n.toLocaleString() }
function fmtPctTenths(tenths) { const n = Number(tenths || 0); return n % 10 === 0 ? `${n/10}%` : `${(n/10).toFixed(1)}%` }
function wrapTextLines(text, maxChars = 12, maxLines = 3) { const s = String(text ?? ''); if (!s) return ['']; const chunks = []; for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars)); if (chunks.length <= maxLines) return chunks; const kept = chunks.slice(0, maxLines); kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(0, maxChars - 1)) + '…'; return kept }
function formatMetricValue(v, mode, digits = 1) { const n = Number(v); if (!Number.isFinite(n)) return ''; const rounded = Number(n.toFixed(digits)); const isInt = Math.abs(rounded - Math.round(rounded)) < 1e-9; if (mode === 'fine') return isInt ? Math.round(rounded).toLocaleString() : rounded.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }); return isInt ? String(Math.round(rounded)) : rounded.toFixed(digits) }
function getMetricBaseStep(mode, maxVal) { const safe = Math.max(1, maxVal || 1); if (mode === 'imprisonment') return 12; if (mode === 'detention') return 5; if (mode === 'fine') { if (safe <= 2000) return 100; if (safe <= 20000) return 1000; if (safe <= 200000) return 10000; return 50000 }; return 1 }
function buildNiceTicks(maxVal, mode, target = 6) { const safe = Math.max(1, maxVal || 1); const base = getMetricBaseStep(mode, safe); const step = Math.max(base, Math.ceil(safe / target / base) * base); const maxTick = Math.max(step, Math.ceil(safe / step) * step); const ticks = []; for (let t = 0; t <= maxTick + 1e-9; t += step) ticks.push(Number(t.toFixed(10))); return { ticks, maxTick, step } }
function buildRangeTicks(minVal, maxVal, mode, target = 6) { const safeMin = Math.max(0, minVal ?? 0), safeMax = Math.max(safeMin + 1, maxVal ?? 1); const base = getMetricBaseStep(mode, safeMax); const step = Math.max(base, Math.ceil(Math.max(safeMax - safeMin, safeMax) / target / base) * base); let start = Math.floor(safeMin / step) * step, end = Math.ceil(safeMax / step) * step; if (start === end) end = start + step; const ticks = []; for (let t = start; t <= end + 1e-9; t += step) ticks.push(Number(t.toFixed(10))); return { ticks, start, end, step } }
function qtl(sorted, q) { if (!sorted.length) return 0; const p = (sorted.length - 1) * q; const b = Math.floor(p); return sorted[b + 1] !== undefined ? sorted[b] + (p - b) * (sorted[b + 1] - sorted[b]) : sorted[b] }

const PALETTE = ['#4F86F7', '#F28C52', '#35B679', '#D9A93A']
const AG_MIT_CATS = ['無加重無減輕', '僅有加重法條', '僅有減輕法條', '有加重有減輕']
const AG_MIT_COLORS = { '無加重無減輕': '#4F86F7', '僅有加重法條': '#F28C52', '僅有減輕法條': '#35B679', '有加重有減輕': '#D9A93A' }
const CLS_CLR = { '一人一罪': '#4F86F7', '一人多罪': '#D9A93A', '多人一罪': '#F28C52', '多人多罪': '#E45C5C', '無罪名資料': '#888' }
const JURL = 'https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id='
const CH34 = { law: 18, tick: 16, axisTitle: 16, note: 15 }

// ═══════════════════════════════════════════════════════════
//  Section 4 — Reactive State
// ═══════════════════════════════════════════════════════════
const activeCat = ref('criminal')
const activeType = ref('criminal_litigation')
const loading = ref(false)
const error = ref(null)
const availableTypes = ref([])

// Data from API
const filterOptions = ref({})
const dashData = ref(null)

// Sidebar state
const sideOpen = ref(true)
const openAcc = ref(null)
const searchStates = ref({})
function getSearch(key) { return searchStates.value[key] || '' }
function setSearch(key, val) { searchStates.value = { ...searchStates.value, [key]: val } }
function toggleAcc(key) { openAcc.value = openAcc.value === key ? null : key }

// Filter values (generic, keyed by filter name)
const filters = ref({})
const appliedFilters = ref({})
const pg = ref(0)
const PG = 10

// Metric selection for criminal charts
const selectedMetric = ref('imprisonment')

function setFilter(key, val) {
  filters.value = { ...filters.value, [key]: val }
}
function toggleChip(arr, val) {
  const s = new Set(arr || [])
  s.has(val) ? s.delete(val) : s.add(val)
  return [...s]
}
function getFilter(key) { return filters.value[key] || [] }

function clearAllFilters() {
  filters.value = {}
  appliedFilters.value = {}
  pg.value = 0
}

// ═══════════════════════════════════════════════════════════
//  Section 5 — API Calls
// ═══════════════════════════════════════════════════════════
async function loadTypeList() {
  try {
    const types = await api('/api/types')
    availableTypes.value = types.filter(t => t.available)
  } catch (e) {
    console.error('Failed to load types:', e)
  }
}

async function loadOptions() {
  try {
    filterOptions.value = await api(`/api/${activeType.value}/options`)
  } catch (e) {
    console.error('Failed to load options:', e)
    filterOptions.value = {}
  }
}

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const params = buildApiParams()
    params.page = pg.value
    params.page_size = PG
    dashData.value = await api(`/api/${activeType.value}/data`, params)
  } catch (e) {
    error.value = e.message
    console.error('Failed to load data:', e)
  } finally {
    loading.value = false
  }
}

function buildApiParams() {
  const a = appliedFilters.value
  const p = {}
  // Map filter keys to API params based on case type
  if (activeType.value === 'criminal_litigation') {
    if (a.cls?.length) p.cls = a.cls.join(',')
    if (a.court?.length) p.court = a.court.join(',')
    if (a.ending?.length) p.ending = a.ending.join(',')
    if (a.defense?.length) p.defense = a.defense.join(',')
    if (a.procedure?.length) p.procedure = a.procedure.join(',')
    if (a.probation?.length) p.probation = a.probation.join(',')
    if (a.recidivist?.length) p.recidivist = a.recidivist.join(',')
    if (a.article?.length) p.article = a.article.join(',')
    if (a.result?.length) p.result = a.result.join(',')
  } else if (activeType.value === 'civil_litigation') {
    if (a.court?.length) p.court = a.court.join(',')
    if (a.ending?.length) p.ending = a.ending.join(',')
    if (a.cause?.length) p.cause = a.cause.join(',')
    if (a.lawyer?.length) p.lawyer = a.lawyer.join(',')
    if (a.amount?.length) p.amount = a.amount.join(',')
    if (a.national_comp?.length) p.national_comp = a.national_comp[0]
    if (a.countersuit?.length) p.countersuit = a.countersuit[0]
    if (a.appeal?.length) p.appeal = a.appeal[0]
  } else if (activeType.value === 'civil_nonlitig') {
    if (a.court?.length) p.court = a.court.join(',')
    if (a.ending?.length) p.ending = a.ending.join(',')
    if (a.cause?.length) p.cause = a.cause.join(',')
    if (a.is_debt?.length) p.is_debt = a.is_debt[0]
    if (a.applicant?.length) p.applicant = a.applicant.join(',')
  } else if (activeType.value === 'family_litigation') {
    if (a.court?.length) p.court = a.court.join(',')
    if (a.ending?.length) p.ending = a.ending.join(',')
    if (a.cause?.length) p.cause = a.cause.join(',')
    if (a.lawyer?.length) p.lawyer = a.lawyer.join(',')
    if (a.initiator?.length) p.initiator = a.initiator.join(',')
    if (a.divorce_reason?.length) p.divorce_reason = a.divorce_reason.join(',')
  }
  if (a.ym_min) p.ym_min = a.ym_min
  if (a.ym_max) p.ym_max = a.ym_max
  return p
}

function handleSubmit() {
  appliedFilters.value = { ...filters.value }
  sideOpen.value = false
  pg.value = 0
  loadData()
}

// ═══════════════════════════════════════════════════════════
//  Section 6 — Tab Navigation
// ═══════════════════════════════════════════════════════════
const typesInCategory = computed(() => {
  return Object.entries(CASE_TYPES)
    .filter(([_, v]) => v.category === activeCat.value)
    .map(([k, v]) => ({ key: k, ...v }))
})

async function switchType(typeKey) {
  if (typeKey === activeType.value) return
  activeType.value = typeKey
  activeCat.value = CASE_TYPES[typeKey].category
  clearAllFilters()
  dashData.value = null
  await loadOptions()
  await loadData()
}

async function switchCategory(catKey) {
  activeCat.value = catKey
  // Auto-select first type in category
  const first = Object.entries(CASE_TYPES).find(([_, v]) => v.category === catKey)
  if (first) await switchType(first[0])
}

// ═══════════════════════════════════════════════════════════
//  Section 7 — Filter Definitions per Type
// ═══════════════════════════════════════════════════════════
const filterSections = computed(() => {
  const opts = filterOptions.value
  if (!opts || !Object.keys(opts).length) return []
  const t = activeType.value

  if (t === 'criminal_litigation') {
    return [
      { title: '案件資訊', color: 'blue', items: [
        { key: 'cls', label: '案件分類', options: opts.classes || [] },
        { key: 'court', label: '法院別', options: opts.courts || [] },
        { key: 'ending', label: '全案終結情形', options: opts.endings || [] },
      ]},
      { title: '被告資訊', color: 'orange', items: [
        { key: 'defense', label: '辯護及代理', options: opts.defs || [] },
        { key: 'procedure', label: '裁判程序', options: opts.procs || [] },
        { key: 'probation', label: '宣告緩刑', options: opts.probs || [] },
        { key: 'recidivist', label: '累犯', options: opts.recid || [] },
      ]},
      { title: '罪刑資訊', color: 'green', items: [
        { key: 'article', label: '定罪法條', options: opts.articles || [] },
        { key: 'result', label: '罪名裁判結果', options: opts.results || [] },
      ]},
    ]
  }

  if (t === 'civil_litigation') {
    return [
      { title: '案件資訊', color: 'blue', items: [
        { key: 'court', label: '法院別', options: opts.courts || [] },
        { key: 'ending', label: '終結情形', options: opts.endings || [] },
        { key: 'cause', label: '案由大分類', options: opts.causes || [] },
      ]},
      { title: '當事人資訊', color: 'orange', items: [
        { key: 'lawyer', label: '律師代理情形', options: opts.lawyers || [] },
        { key: 'amount', label: '訴訟標的金額級距', options: opts.amounts || [] },
        { key: 'countersuit', label: '是否反訴', options: opts.countersuits || [] },
        { key: 'appeal', label: '可否上訴', options: opts.appeals || [] },
      ]},
    ]
  }

  if (t === 'civil_nonlitig') {
    return [
      { title: '案件資訊', color: 'blue', items: [
        { key: 'court', label: '法院別', options: opts.courts || [] },
        { key: 'ending', label: '終結情形', options: opts.endings || [] },
        { key: 'cause', label: '案由大分類', options: opts.causes || [] },
        { key: 'is_debt', label: '消債事件', options: opts.isDebt || [] },
        { key: 'applicant', label: '聲請人別', options: opts.applicants || [] },
      ]},
    ]
  }

  if (t === 'family_litigation') {
    return [
      { title: '案件資訊', color: 'blue', items: [
        { key: 'court', label: '法院別', options: opts.courts || [] },
        { key: 'ending', label: '終結情形', options: opts.endings || [] },
        { key: 'cause', label: '案由大分類', options: opts.causes || [] },
      ]},
      { title: '當事人資訊', color: 'orange', items: [
        { key: 'lawyer', label: '律師代理情形', options: opts.lawyers || [] },
        { key: 'initiator', label: '主動離婚者', options: opts.initiators || [] },
        { key: 'divorce_reason', label: '離婚原因', options: opts.divorceReasons || [] },
      ]},
    ]
  }

  return []
})

// ═══════════════════════════════════════════════════════════
//  Section 8 — Stat Cards per Type
// ═══════════════════════════════════════════════════════════
const statCards = computed(() => {
  const s = dashData.value?.stats
  if (!s) return []
  const t = activeType.value

  if (t === 'criminal_litigation') {
    return [
      { l: '判決（篇數）', v: s.judgments, a: '#4F86F7' },
      { l: '被告（人數）', v: s.defendants, a: '#F28C52' },
      { l: '犯罪數（筆數）', v: s.crimes, a: '#D9A93A' },
      { l: '犯罪法條總數', v: s.uniqueLaws, a: '#35B679' },
    ]
  }
  if (t === 'civil_litigation') {
    const cards = [
      { l: '裁判書（篇數）', v: s.judgments, a: '#4F86F7' },
      { l: '資料筆數', v: s.totalRows, a: '#F28C52' },
    ]
    if (s.avgAmount != null) cards.push({ l: '平均訴訟標的金額', v: Math.round(s.avgAmount).toLocaleString() + ' 元', a: '#D9A93A', raw: true })
    if (s.lawyerRate != null) cards.push({ l: '律師代理率', v: s.lawyerRate + '%', a: '#35B679', raw: true })
    return cards
  }
  if (t === 'civil_nonlitig') {
    const cards = [
      { l: '裁判書（篇數）', v: s.judgments, a: '#4F86F7' },
      { l: '資料筆數', v: s.totalRows, a: '#F28C52' },
    ]
    if (s.debtRate != null) cards.push({ l: '消債事件比率', v: s.debtRate + '%', a: '#D9A93A', raw: true })
    return cards
  }
  if (t === 'family_litigation') {
    const cards = [
      { l: '裁判書（篇數）', v: s.judgments, a: '#4F86F7' },
      { l: '資料筆數', v: s.totalRows, a: '#F28C52' },
    ]
    if (s.divorceRate != null) cards.push({ l: '離婚案比率', v: s.divorceRate + '%', a: '#D9A93A', raw: true })
    if (s.lawyerRate != null) cards.push({ l: '律師代理率', v: s.lawyerRate + '%', a: '#35B679', raw: true })
    return cards
  }
  return []
})

// ═══════════════════════════════════════════════════════════
//  Section 9 — SVG Chart Renderers (reused from v2)
// ═══════════════════════════════════════════════════════════
function stackedBarSvg(stackData, segments) {
  if (!stackData?.length || !segments?.length) return { W: 0, H: 0, rows: [] }
  const LM = 130, RM = 20, TM = 10, rowH = 32
  const W = 600, H = TM + rowH * stackData.length + 30
  const barW = W - LM - RM
  const rows = stackData.map((d, idx) => {
    const y = TM + rowH * idx
    let accX = LM
    const bars = segments.map((seg, si) => {
      const tenths = d[seg] || 0
      const w = (tenths / 1000) * barW
      const x = accX; accX += w
      return { x, w, y: y + 4, h: rowH - 8, fill: PALETTE[si], seg, tenths, count: d.__counts?.[seg] || 0 }
    })
    return { law: d.law, y, bars, labelLines: wrapTextLines(d.law, 9, 2) }
  })
  return { W, H, rows, LM, barW }
}

function violinSvgData(violinData, mode, axisLabel) {
  if (!violinData?.length) return null
  const LM = 210, RM = 78, TM = 28, BM = 76, rowH = 104, W = 860
  const H = TM + BM + rowH * violinData.length
  const plotW = W - LM - RM
  const allV = violinData.flatMap(d => d.values)
  const gMin = Math.min(...allV), gMax = Math.max(...allV), rawRange = gMax - gMin || 1
  const { ticks, start, end } = buildRangeTicks(gMin, gMax, mode, 6)
  const domain = Math.max(1, end - start)
  const xS = v => LM + ((v - start) / domain) * plotW

  function densityBins(values) {
    const bins = Array(16).fill(0); const step = rawRange / 16 || 1
    values.forEach(v => { let idx = Math.floor((v - gMin) / step); if (idx < 0) idx = 0; if (idx >= 16) idx = 15; bins[idx]++ })
    return bins.map((c, i) => ({ cx: gMin + step * (i + 0.5), c }))
  }

  const rows = violinData.map((d, idx) => {
    const y = TM + rowH * idx + rowH / 2
    const bins = densityBins(d.values)
    const maxC = Math.max(...bins.map(b => b.c), 1)
    const halfW = 24
    const pts = bins.map(b => ({ x: xS(b.cx), hw: (b.c / maxC) * halfW }))
    const up = pts.map(p => `${p.x},${y - p.hw}`).join(' L ')
    const dn = [...pts].reverse().map(p => `${p.x},${y + p.hw}`).join(' L ')
    const lastPt = pts[pts.length - 1]
    const path = `M ${pts[0].x},${y} L ${up} L ${lastPt.x},${y} L ${dn} Z`
    const meanX = xS(d.mean), medianX = xS(d.median)
    const meanNR = meanX > W - RM - 92, medNR = medianX > W - RM - 92
    return { name: d.name, y, path, meanX, medianX, meanNR, medNR, n: d.n, meanLabel: formatMetricValue(d.mean, mode, 1), medLabel: formatMetricValue(d.median, mode, 1), labelLines: wrapTextLines(d.name, 8, 3) }
  })

  const tickData = ticks.filter(t => { const x = xS(t); return x >= LM - 2 && x <= W - RM + 2 }).map(t => ({ x: xS(t), label: formatMetricValue(t, mode, 1) }))
  return { W, H, LM, RM, TM, BM, rows, tickData, axisLabel }
}

function boxSvgData(boxData, mode, axisLabel) {
  if (!boxData?.length) return null
  const LM = 210, RM = 22, TM = 28, BM = 110, rowH = 104, W = 860
  const H = TM + BM + rowH * boxData.length
  const plotW = W - LM - RM
  const rawMax = Math.max(...boxData.map(d => Math.max(d.whiskerHigh, ...(d.outliers || []), d.q3)), getMetricBaseStep(mode, 1))
  const { ticks, maxTick } = buildNiceTicks(rawMax, mode, 6)
  const xS = v => LM + (Math.max(0, v) / maxTick) * plotW

  const rows = boxData.map((d, idx) => {
    const y = TM + rowH * idx + rowH / 2
    const q1X = xS(d.q1), medianX = xS(d.median), q3X = xS(d.q3)
    const wlX = xS(d.whiskerLow), whX = xS(d.whiskerHigh)
    const color = AG_MIT_COLORS[d.dominant] || '#4F86F7'
    const noteX = Math.min(W - RM - 6, q3X + 12)
    const noteAnc = noteX >= W - RM - 30 ? 'end' : 'start'
    const outlierPts = (d.outliers || []).map(v => ({ cx: xS(v) }))
    return { law: d.law, y, q1X, medianX, q3X, wlX, whX, color, noteX, noteAnc, n: d.n, medLabel: formatMetricValue(d.median, mode, 1), iqrLabel: formatMetricValue(d.iqr, mode, 1), outlierPts, labelLines: wrapTextLines(d.law, 8, 3), boxW: Math.max(2, q3X - q1X) }
  })
  const tickData = ticks.map(t => ({ x: xS(t), label: formatMetricValue(t, mode, 1) }))
  return { W, H, LM, RM, TM, BM, rows, tickData, axisLabel, legend: AG_MIT_CATS.map(c => ({ label: c, color: AG_MIT_COLORS[c] })) }
}

// ═══════════════════════════════════════════════════════════
//  Section 10 — Computed Chart SVGs
// ═══════════════════════════════════════════════════════════
const METRIC_LABELS = { imprisonment: '有期徒刑', detention: '拘役', fine: '罰金' }
const METRIC_UNITS = { imprisonment: '月', detention: '日', fine: '元' }
const METRIC_AXIS = { imprisonment: '刑期（月）', detention: '拘役（日）', fine: '罰金（元）' }

const criminalStackSvg = computed(() => {
  const charts = dashData.value?.charts
  if (!charts?.lawStack) return { W: 0, H: 0, rows: [] }
  return stackedBarSvg(charts.lawStack.data, charts.lawStack.segments)
})

const currentMetric = computed(() => {
  const charts = dashData.value?.charts
  if (!charts?.metrics) return null
  return charts.metrics[selectedMetric.value] || null
})

const criminalViolinSvg = computed(() => {
  const m = currentMetric.value
  if (!m?.violin?.length) return null
  return violinSvgData(m.violin, selectedMetric.value, METRIC_AXIS[selectedMetric.value])
})

const criminalBoxSvg = computed(() => {
  const m = currentMetric.value
  if (!m?.box?.length) return null
  return boxSvgData(m.box, selectedMetric.value, METRIC_AXIS[selectedMetric.value])
})

// ═══════════════════════════════════════════════════════════
//  Section 10b — NEW Computed Chart SVGs for Civil/NonLitig/Family
// ═══════════════════════════════════════════════════════════
const stackColors = ['#4F86F7', '#F28C52', '#35B679', '#D9A93A', '#7c3aed', '#e11d48', '#06b6d4', '#84cc16', '#a855f7', '#f97316']

function genericStackSvg(chartData) {
  if (!chartData?.data?.length || !chartData?.segments?.length) return { W: 0, H: 0, rows: [] }
  const LM = 130, RM = 80, TM = 10, rowH = 32
  const W = 600, H = TM + rowH * chartData.data.length + 30
  const barW = W - LM - RM
  const rows = chartData.data.map((d, idx) => {
    const y = TM + rowH * idx
    let accX = LM
    const bars = chartData.segments.map((seg, si) => {
      const tenths = d[seg] || 0
      const w = (tenths / 1000) * barW
      const x = accX; accX += w
      return { x, w, segment: seg, color: stackColors[si % stackColors.length], tenths, count: d.__counts?.[seg] || 0 }
    })
    return { label: d.name, y, bars, total: d.__total || 0 }
  })
  return { W, H, rows }
}

// Civil Litigation stacked bars
const civilCauseStackSvg = computed(() => genericStackSvg(dashData.value?.charts?.causeEndingStack))
const civilLawyerStackSvg = computed(() => genericStackSvg(dashData.value?.charts?.lawyerEndingStack))

// Non-litigation stacked bar
const nonlitigCauseStackSvg = computed(() => genericStackSvg(dashData.value?.charts?.causeEndingStack))

// Family stacked bars
const familyCauseStackSvg = computed(() => genericStackSvg(dashData.value?.charts?.causeEndingStack))
const familyLawyerStackSvg = computed(() => genericStackSvg(dashData.value?.charts?.lawyerEndingStack))

// Civil Amount Box-Whisker
const civilAmountBoxSvg = computed(() => {
  const boxData = dashData.value?.charts?.amountBox
  if (!boxData?.length) return { W: 0, H: 0, items: [], gridLines: [] }
  const LM = 130, RM = 30, TM = 20, rowH = 40
  const W = 600, H = TM + rowH * boxData.length + 40
  const plotW = W - LM - RM
  const maxVal = Math.max(...boxData.map(d => Math.max(d.whiskerHigh || 0, d.max || 0)), 1)
  const niceMax = Math.ceil(maxVal / Math.pow(10, Math.floor(Math.log10(maxVal)))) * Math.pow(10, Math.floor(Math.log10(maxVal)))
  const xS = v => LM + (Math.max(0, v) / niceMax) * plotW
  const step = niceMax / 5
  const gridLines = Array.from({ length: 6 }, (_, i) => {
    const v = step * i
    return { x: xS(v), label: v >= 10000 ? (v / 10000).toFixed(0) + '萬' : v.toLocaleString() }
  })
  const items = boxData.map((d, idx) => {
    const y = TM + rowH * idx + rowH / 2
    return {
      label: d.cause, y,
      labelX: LM - 6,
      whiskerLX: xS(d.whiskerLow || 0),
      whiskerHX: xS(d.whiskerHigh || 0),
      q1X: xS(d.q1 || 0),
      boxW: xS(d.q3 || 0) - xS(d.q1 || 0),
      medianX: xS(d.median || 0),
      medLabel: (d.median || 0) >= 10000 ? ((d.median || 0) / 10000).toFixed(1) + '萬' : Math.round(d.median || 0).toLocaleString(),
    }
  })
  return { W, H, items, gridLines }
})

// ═══════════════════════════════════════════════════════════
//  Section 11 — Bar Chart SVG for Civil/Family
// ═══════════════════════════════════════════════════════════
function barChartSvg(data, title) {
  if (!data?.length) return null
  const sorted = [...data].sort((a, b) => b.count - a.count)
  const LM = 140, RM = 60, TM = 10, rowH = 28
  const W = 560, H = TM + rowH * sorted.length + 20
  const barW = W - LM - RM
  const maxCount = Math.max(...sorted.map(d => d.count), 1)
  const rows = sorted.map((d, idx) => ({
    label: d.name,
    count: d.count,
    y: TM + rowH * idx,
    w: (d.count / maxCount) * barW,
    pct: ((d.count / data.reduce((s, x) => s + x.count, 0)) * 100).toFixed(1),
  }))
  return { W, H, LM, RM, TM, barW, rows, maxCount }
}

// ═══════════════════════════════════════════════════════════
//  Section 12 — Pagination
// ═══════════════════════════════════════════════════════════
const judgments = computed(() => dashData.value?.judgments || { items: [], page: 0, totalPages: 0, totalJudgments: 0 })
const totalPages = computed(() => judgments.value.totalPages || 1)

async function goPrev() { if (pg.value > 0) { pg.value--; await loadData() } }
async function goNext() { if (pg.value < totalPages.value - 1) { pg.value++; await loadData() } }

// Expand judgment detail
const expJid = ref(null)

// ═══════════════════════════════════════════════════════════
//  Section 13 — Search within filter options
// ═══════════════════════════════════════════════════════════
function filteredOptions(options, searchKey) {
  if (!options?.length) return []
  const q = getSearch(searchKey)?.trim()?.toLowerCase()
  if (!q) return options
  return options.filter(o => o.val.toLowerCase().includes(q))
}

// ═══════════════════════════════════════════════════════════
//  Section 14 — Lifecycle
// ═══════════════════════════════════════════════════════════
onMounted(async () => {
  await loadTypeList()
  await loadOptions()
  await loadData()
})
</script>

<template>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet" />

  <div class="app-root">
    <!-- ════ Top Navigation Bar ════ -->
    <nav class="topnav">
      <div class="topnav-left">
        <span class="topnav-logo">⚖️</span>
        <span class="topnav-title">裁判書量化實證研究檢索與分析平台</span>
      </div>
      <div class="topnav-tabs">
        <button v-for="cat in CATEGORIES" :key="cat.key"
          @click="switchCategory(cat.key)"
          :class="['cat-tab', { active: activeCat === cat.key }]">
          {{ cat.label }}
        </button>
      </div>
    </nav>

    <!-- ════ Sub-type Tabs ════ -->
    <div class="subtab-bar">
      <button v-for="st in typesInCategory" :key="st.key"
        @click="switchType(st.key)"
        :class="['sub-tab', { active: activeType === st.key }]">
        <span class="sub-tab-icon">{{ st.icon }}</span>
        {{ st.label }}
      </button>
    </div>

    <!-- ════ Dashboard Body ════ -->
    <div class="dashboard">
      <!-- Sidebar toggle -->
      <div @click="sideOpen = !sideOpen" class="sidebar-tab" :class="{ open: sideOpen }">
        {{ sideOpen ? '◀ 收起' : '篩選 ▶' }}
      </div>

      <!-- ██ Sidebar ██ -->
      <div class="sidebar" :style="{ width: sideOpen ? '300px' : '0', minWidth: sideOpen ? '300px' : '0' }">
        <div class="sidebar-inner">
          <div class="sidebar-header">
            <h2 style="font-size:15px;font-weight:700;margin:0 0 10px 0;color:#111827">篩選條件</h2>
            <div style="display:flex;gap:8px">
              <button @click="handleSubmit" class="btn-submit">送出篩選</button>
              <button @click="clearAllFilters(); loadData()" class="btn-reset">重置</button>
            </div>
          </div>

          <div class="sidebar-scroll">
            <!-- Year-month range -->
            <div class="filter-group" v-if="filterOptions.ym?.length">
              <div class="filter-label">終結年月（區間）</div>
              <div style="display:flex;gap:6px;align-items:center">
                <select v-model="filters.ym_min" class="sel">
                  <option value="">最早</option>
                  <option v-for="y in filterOptions.ym" :key="y" :value="y">{{ y.replace('/', '年') + '月' }}</option>
                </select>
                <span style="color:#9ca3af;font-size:11px">～</span>
                <select v-model="filters.ym_max" class="sel">
                  <option value="">最晚</option>
                  <option v-for="y in filterOptions.ym" :key="y" :value="y">{{ y.replace('/', '年') + '月' }}</option>
                </select>
              </div>
            </div>

            <!-- Dynamic filter sections -->
            <div class="acc-group" v-for="section in filterSections" :key="section.title">
              <div class="section-title" :class="section.color">{{ section.title }}</div>
              <div class="acc-border">
                <template v-for="item in section.items" :key="item.key">
                  <div class="acc-item" v-if="item.options?.length">
                    <div @click="toggleAcc(item.key)" class="acc-trigger">
                      <div style="display:flex;align-items:center;gap:6px">
                        <span class="acc-arrow" :class="{ open: openAcc === item.key }">▶</span>
                        <span class="acc-title">{{ item.label }}</span>
                      </div>
                      <span v-if="getFilter(item.key).length" class="acc-badge">{{ getFilter(item.key).length }}</span>
                    </div>
                    <div v-if="openAcc === item.key" class="acc-body">
                      <input v-if="item.options.length > 10" type="text" placeholder="搜尋…" :value="getSearch(item.key)" @input="setSearch(item.key, $event.target.value)" class="search-input" style="width:100%;margin-bottom:6px" />
                      <div :class="['chip-wrap', { scrollable: item.options.length > 10 }]">
                        <button v-for="o in filteredOptions(item.options, item.key)" :key="o.val"
                          @click="setFilter(item.key, toggleChip(getFilter(item.key), o.val))"
                          :class="['chip', { active: getFilter(item.key).includes(o.val) }]">
                          {{ o.val }} <span class="chip-count">({{ o.count }})</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ██ Main Area ██ -->
      <div class="main-area">
        <!-- Loading overlay -->
        <div v-if="loading" class="loading-overlay">
          <div class="spinner"></div>
          <span>載入中…</span>
        </div>

        <!-- Error -->
        <div v-if="error" class="error-banner">⚠️ {{ error }}</div>

        <!-- Header -->
        <div class="main-header">
          <h1 style="font-size:22px;font-weight:700;margin:0;color:#0f172a">
            {{ CASE_TYPES[activeType]?.icon }} {{ CASE_TYPES[activeType]?.label }}判決資料統計
          </h1>
          <div v-if="dashData" style="font-size:12px;color:#6b7280">
            共 {{ (dashData.filteredRows || 0).toLocaleString() }} 筆資料
          </div>
        </div>

        <!-- Stats -->
        <div class="stats-grid" :style="{ 'grid-template-columns': `repeat(${statCards.length}, 1fr)` }" v-if="statCards.length">
          <div v-for="s in statCards" :key="s.l" class="stat-card">
            <div class="stat-accent" :style="{ background: s.a }"></div>
            <div class="stat-label">{{ s.l }}</div>
            <div class="stat-value">{{ s.raw ? s.v : (s.v || 0).toLocaleString() }}</div>
          </div>
        </div>

        <!-- ════════════════════════════════════════════ -->
        <!--  CRIMINAL LITIGATION CHARTS                 -->
        <!-- ════════════════════════════════════════════ -->
        <template v-if="activeType === 'criminal_litigation' && dashData?.charts">
          <div class="chart-grid">
            <!-- Heatmap -->
            <div class="chart-card">
              <div class="chart-title">案件結構熱度圖</div>
              <div class="chart-sub">案件分類 × 終結情形</div>
              <div v-if="!dashData.charts.heatmap?.xLabels?.length" class="no-data">無資料</div>
              <div v-else style="overflow-x:auto">
                <table class="heatmap">
                  <thead><tr><th style="width:100px"></th><th v-for="x in dashData.charts.heatmap.xLabels" :key="x">{{ x }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(y, yi) in dashData.charts.heatmap.yLabels" :key="y">
                      <td class="hm-label">{{ y }}</td>
                      <td v-for="(x, xi) in dashData.charts.heatmap.xLabels" :key="x"
                        :title="`${y} × ${x}：${dashData.charts.heatmap.matrix[yi][xi]} 件`"
                        :style="{ background: `rgba(79,134,247,${0.08 + (dashData.charts.heatmap.matrix[yi][xi] / (dashData.charts.heatmap.max || 1)) * 0.82})`, color: (dashData.charts.heatmap.matrix[yi][xi] / (dashData.charts.heatmap.max || 1)) > 0.5 ? '#fff' : '#111827' }"
                        class="hm-cell">{{ dashData.charts.heatmap.matrix[yi][xi] }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Stacked bar -->
            <div class="chart-card">
              <div class="chart-title">法條量刑結構堆疊圖</div>
              <div class="chart-sub">適用加重減輕類型分布</div>
              <div v-if="!criminalStackSvg.rows?.length" class="no-data">無資料</div>
              <template v-else>
                <svg :viewBox="`0 0 ${criminalStackSvg.W} ${criminalStackSvg.H}`" width="100%" preserveAspectRatio="xMinYMin meet">
                  <template v-for="(row, ri) in criminalStackSvg.rows" :key="ri">
                    <text :x="criminalStackSvg.LM - 6" :y="row.y + 20" text-anchor="end" font-size="11" fill="#111827" font-weight="500">
                      <tspan v-for="(line, li) in row.labelLines" :key="li" :x="criminalStackSvg.LM - 6" :dy="li === 0 ? 0 : 13">{{ line }}</tspan>
                    </text>
                    <rect v-for="b in row.bars" :key="b.seg" :x="b.x" :y="b.y" :width="Math.max(0, b.w)" :height="b.h" :fill="b.fill" rx="2">
                      <title>{{ b.seg }}：{{ fmtPctTenths(b.tenths) }}（{{ b.count }} 件）</title>
                    </rect>
                  </template>
                  <text v-for="p in [0, 25, 50, 75, 100]" :key="p" :x="criminalStackSvg.LM + (p / 100) * criminalStackSvg.barW" :y="criminalStackSvg.H - 6" text-anchor="middle" font-size="10" fill="#6b7280">{{ p }}%</text>
                </svg>
                <div class="legend-row">
                  <div v-for="(seg, si) in AG_MIT_CATS" :key="seg" class="legend-item"><span class="legend-dot" :style="{ background: PALETTE[si] }"></span>{{ seg }}</div>
                </div>
              </template>
            </div>

            <!-- Violin -->
            <div class="chart-card">
              <div class="chart-title">法條{{ METRIC_LABELS[selectedMetric] }}分布小提琴圖</div>
              <div class="chart-sub">
                <span>量刑指標：</span>
                <button v-for="mk in ['imprisonment', 'detention', 'fine']" :key="mk"
                  @click="selectedMetric = mk"
                  :class="['metric-btn', { active: selectedMetric === mk }]">
                  {{ METRIC_LABELS[mk] }}
                </button>
              </div>
              <div v-if="!criminalViolinSvg" class="no-data">無資料</div>
              <div v-else style="width:100%;overflow-x:auto">
                <svg width="100%" :viewBox="`0 0 ${criminalViolinSvg.W} ${criminalViolinSvg.H}`" preserveAspectRatio="xMinYMin meet">
                  <template v-for="(t, ti) in criminalViolinSvg.tickData" :key="ti">
                    <line :x1="t.x" :x2="t.x" :y1="criminalViolinSvg.TM - 6" :y2="criminalViolinSvg.H - criminalViolinSvg.BM + 12" stroke="#e5e7eb" stroke-dasharray="3 3" />
                    <text :x="t.x" :y="criminalViolinSvg.H - criminalViolinSvg.BM + 34" text-anchor="middle" :font-size="CH34.tick" fill="#374151" font-weight="600">{{ t.label }}</text>
                  </template>
                  <text :x="(criminalViolinSvg.LM + criminalViolinSvg.W - criminalViolinSvg.RM) / 2" :y="criminalViolinSvg.H - 14" text-anchor="middle" :font-size="CH34.axisTitle" fill="#6b7280" font-weight="600">{{ criminalViolinSvg.axisLabel }}</text>
                  <template v-for="d in criminalViolinSvg.rows" :key="d.name">
                    <text :x="criminalViolinSvg.LM - 10" :y="d.y" text-anchor="end" :font-size="CH34.law" fill="#111827" font-weight="600">
                      <tspan v-for="(line, li) in d.labelLines" :key="li" :x="criminalViolinSvg.LM - 10" :dy="li === 0 ? -14 : 18">{{ line }}</tspan>
                    </text>
                    <line :x1="criminalViolinSvg.LM" :x2="criminalViolinSvg.W - criminalViolinSvg.RM" :y1="d.y" :y2="d.y" stroke="#f1f5f9" />
                    <path :d="d.path" fill="rgba(79,134,247,0.22)" stroke="rgba(79,134,247,0.90)" stroke-width="1.5" />
                    <line :x1="d.medianX" :x2="d.medianX" :y1="d.y - 22" :y2="d.y + 22" stroke="#D9A93A" stroke-width="2.4" />
                    <circle :cx="d.meanX" :cy="d.y" r="4.8" fill="#35B679" stroke="#fff" stroke-width="1.8" />
                    <text :x="d.meanNR ? criminalViolinSvg.W - criminalViolinSvg.RM - 6 : Math.min(criminalViolinSvg.W - criminalViolinSvg.RM - 6, d.meanX + 10)" :y="d.y - 12" :text-anchor="d.meanNR ? 'end' : 'start'" :font-size="CH34.note" fill="#059669" font-weight="700">平均 {{ d.meanLabel }}</text>
                    <text :x="d.medNR ? criminalViolinSvg.W - criminalViolinSvg.RM - 6 : Math.min(criminalViolinSvg.W - criminalViolinSvg.RM - 6, d.medianX + 10)" :y="d.y + 22" :text-anchor="d.medNR ? 'end' : 'start'" :font-size="CH34.note" fill="#B8860B" font-weight="700">中位 {{ d.medLabel }}</text>
                    <text :x="criminalViolinSvg.W - criminalViolinSvg.RM + 8" :y="d.y + 6" text-anchor="start" :font-size="CH34.note" fill="#374151" font-weight="600">n={{ d.n }}</text>
                  </template>
                </svg>
              </div>
            </div>

            <!-- Box-whisker -->
            <div class="chart-card">
              <div class="chart-title">法條{{ METRIC_LABELS[selectedMetric] }}盒鬚圖</div>
              <div class="chart-sub">中位數、四分位距與離群值</div>
              <div v-if="!criminalBoxSvg" class="no-data">無資料</div>
              <template v-else>
                <div style="width:100%;overflow-x:auto">
                  <svg width="100%" :viewBox="`0 0 ${criminalBoxSvg.W} ${criminalBoxSvg.H}`" preserveAspectRatio="xMinYMin meet">
                    <template v-for="(t, ti) in criminalBoxSvg.tickData" :key="ti">
                      <line :x1="t.x" :x2="t.x" :y1="criminalBoxSvg.TM" :y2="criminalBoxSvg.H - criminalBoxSvg.BM + 10" stroke="#e5e7eb" stroke-dasharray="3 3" />
                      <text :x="t.x" :y="criminalBoxSvg.H - criminalBoxSvg.BM + 30" text-anchor="middle" :font-size="CH34.tick" fill="#374151" font-weight="600">{{ t.label }}</text>
                    </template>
                    <line :x1="criminalBoxSvg.LM" :x2="criminalBoxSvg.W - criminalBoxSvg.RM" :y1="criminalBoxSvg.H - criminalBoxSvg.BM + 10" :y2="criminalBoxSvg.H - criminalBoxSvg.BM + 10" stroke="#9ca3af" />
                    <text :x="(criminalBoxSvg.LM + criminalBoxSvg.W - criminalBoxSvg.RM) / 2" :y="criminalBoxSvg.H - 16" text-anchor="middle" :font-size="CH34.axisTitle" fill="#6b7280" font-weight="600">{{ criminalBoxSvg.axisLabel }}</text>
                    <template v-for="d in criminalBoxSvg.rows" :key="d.law">
                      <line :x1="criminalBoxSvg.LM" :x2="criminalBoxSvg.W - criminalBoxSvg.RM" :y1="d.y" :y2="d.y" stroke="#f1f5f9" />
                      <text :x="criminalBoxSvg.LM - 10" :y="d.y" text-anchor="end" :font-size="CH34.law" fill="#111827" font-weight="600">
                        <tspan v-for="(line, li) in d.labelLines" :key="li" :x="criminalBoxSvg.LM - 10" :dy="li === 0 ? -14 : 18">{{ line }}</tspan>
                      </text>
                      <line :x1="d.wlX" :x2="d.whX" :y1="d.y" :y2="d.y" stroke="#111827" stroke-width="1.8" />
                      <line :x1="d.wlX" :x2="d.wlX" :y1="d.y - 10" :y2="d.y + 10" stroke="#111827" stroke-width="1.8" />
                      <line :x1="d.whX" :x2="d.whX" :y1="d.y - 10" :y2="d.y + 10" stroke="#111827" stroke-width="1.8" />
                      <rect :x="d.q1X" :y="d.y - 12" :width="d.boxW" height="24" rx="4" :fill="d.color" opacity="0.88" stroke="#111827" stroke-width="1" />
                      <line :x1="d.medianX" :x2="d.medianX" :y1="d.y - 12" :y2="d.y + 12" stroke="#111827" stroke-width="2.4" />
                      <circle v-for="(ol, oi) in d.outlierPts" :key="oi" :cx="ol.cx" :cy="d.y" r="4.5" fill="#fff" stroke="#111827" stroke-width="1.6" />
                      <text :x="d.noteX" :y="d.y - 12" :text-anchor="d.noteAnc" :font-size="CH34.note" fill="#111827" font-weight="700">中位 {{ d.medLabel }}</text>
                      <text :x="d.noteX" :y="d.y + 22" :text-anchor="d.noteAnc" :font-size="CH34.note" fill="#374151" font-weight="700">IQR {{ d.iqrLabel }}</text>
                    </template>
                  </svg>
                </div>
                <div v-if="criminalBoxSvg.legend?.length" class="legend-row" style="margin-top:10px">
                  <div v-for="it in criminalBoxSvg.legend" :key="it.label" class="legend-item"><span class="legend-dot" :style="{ background: it.color }"></span>{{ it.label }}</div>
                  <div class="legend-item"><span style="width:12px;height:2px;background:#111827;display:inline-block"></span>中位數</div>
                  <div class="legend-item"><span style="width:9px;height:9px;border-radius:999px;border:1.6px solid #111827;background:#fff;display:inline-block"></span>離群值</div>
                </div>
              </template>
            </div>
          </div>
        </template>

        <!-- ════════════════════════════════════════════ -->
        <!--  CIVIL LITIGATION CHARTS                    -->
        <!-- ════════════════════════════════════════════ -->
        <template v-if="activeType === 'civil_litigation' && dashData?.charts">
          <div class="chart-grid">
            <!-- Ending distribution -->
            <div class="chart-card">
              <div class="chart-title">終結情形分布</div>
              <div class="chart-sub">各終結情形大分類件數</div>
              <div v-if="!dashData.charts.endingDist?.length" class="no-data">無資料</div>
              <template v-else>
                <svg v-bind="barChartAttrs(dashData.charts.endingDist)" preserveAspectRatio="xMinYMin meet">
                  <template v-for="(r, ri) in barChartRows(dashData.charts.endingDist)" :key="ri">
                    <text :x="134" :y="r.y + 18" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ r.label }}</text>
                    <rect :x="140" :y="r.y + 4" :width="Math.max(2, r.w)" height="20" fill="#4F86F7" rx="3" opacity="0.85">
                      <title>{{ r.label }}：{{ r.count }} 件（{{ r.pct }}%）</title>
                    </rect>
                    <text :x="144 + r.w" :y="r.y + 18" font-size="10" fill="#374151" font-weight="600">{{ r.count.toLocaleString() }}（{{ r.pct }}%）</text>
                  </template>
                </svg>
              </template>
            </div>

            <!-- Cause distribution -->
            <div class="chart-card">
              <div class="chart-title">案由大分類分布</div>
              <div class="chart-sub">各案由類型件數</div>
              <div v-if="!dashData.charts.causeDist?.length" class="no-data">無資料</div>
              <template v-else>
                <svg v-bind="barChartAttrs(dashData.charts.causeDist)" preserveAspectRatio="xMinYMin meet">
                  <template v-for="(r, ri) in barChartRows(dashData.charts.causeDist)" :key="ri">
                    <text :x="134" :y="r.y + 18" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ r.label }}</text>
                    <rect :x="140" :y="r.y + 4" :width="Math.max(2, r.w)" height="20" fill="#F28C52" rx="3" opacity="0.85">
                      <title>{{ r.label }}：{{ r.count }} 件（{{ r.pct }}%）</title>
                    </rect>
                    <text :x="144 + r.w" :y="r.y + 18" font-size="10" fill="#374151" font-weight="600">{{ r.count.toLocaleString() }}（{{ r.pct }}%）</text>
                  </template>
                </svg>
              </template>
            </div>

            <!-- Lawyer × Ending heatmap -->
            <div class="chart-card">
              <div class="chart-title">律師代理 × 終結情形</div>
              <div class="chart-sub">律師代理情形與終結結果交叉分析</div>
              <div v-if="!dashData.charts.lawyerHeatmap?.xLabels?.length" class="no-data">無資料</div>
              <div v-else style="overflow-x:auto">
                <table class="heatmap">
                  <thead><tr><th style="width:100px"></th><th v-for="x in dashData.charts.lawyerHeatmap.xLabels" :key="x">{{ x }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(y, yi) in dashData.charts.lawyerHeatmap.yLabels" :key="y">
                      <td class="hm-label">{{ y }}</td>
                      <td v-for="(x, xi) in dashData.charts.lawyerHeatmap.xLabels" :key="x"
                        :style="{ background: `rgba(79,134,247,${0.08 + (dashData.charts.lawyerHeatmap.matrix[yi][xi] / (dashData.charts.lawyerHeatmap.max || 1)) * 0.82})`, color: (dashData.charts.lawyerHeatmap.matrix[yi][xi] / (dashData.charts.lawyerHeatmap.max || 1)) > 0.5 ? '#fff' : '#111827' }"
                        class="hm-cell">{{ dashData.charts.lawyerHeatmap.matrix[yi][xi] }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Amount × Ending heatmap -->
            <div class="chart-card">
              <div class="chart-title">訴訟標的金額 × 終結情形</div>
              <div class="chart-sub">金額級距與終結結果交叉分析</div>
              <div v-if="!dashData.charts.amountHeatmap?.xLabels?.length" class="no-data">無資料</div>
              <div v-else style="overflow-x:auto">
                <table class="heatmap">
                  <thead><tr><th style="width:100px"></th><th v-for="x in dashData.charts.amountHeatmap.xLabels" :key="x">{{ x }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(y, yi) in dashData.charts.amountHeatmap.yLabels" :key="y">
                      <td class="hm-label">{{ y }}</td>
                      <td v-for="(x, xi) in dashData.charts.amountHeatmap.xLabels" :key="x"
                        :style="{ background: `rgba(242,140,82,${0.08 + (dashData.charts.amountHeatmap.matrix[yi][xi] / (dashData.charts.amountHeatmap.max || 1)) * 0.82})`, color: (dashData.charts.amountHeatmap.matrix[yi][xi] / (dashData.charts.amountHeatmap.max || 1)) > 0.5 ? '#fff' : '#111827' }"
                        class="hm-cell">{{ dashData.charts.amountHeatmap.matrix[yi][xi] }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- NEW: Cause × Ending Stacked Bar -->
            <div class="chart-card">
              <div class="chart-title">案由 × 終結情形堆疊圖</div>
              <div class="chart-sub">各案由的終結情形比例分布</div>
              <div v-if="!dashData.charts.causeEndingStack?.data?.length" class="no-data">無資料</div>
              <template v-else>
                <div style="overflow-x:auto">
                  <svg :width="civilCauseStackSvg.W" :height="civilCauseStackSvg.H" class="chart-svg">
                    <template v-for="(r, ri) in civilCauseStackSvg.rows" :key="ri">
                      <text :x="124" :y="r.y + 20" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ r.label }}</text>
                      <rect v-for="(b, bi) in r.bars" :key="bi" :x="b.x" :y="r.y + 4" :width="b.w || 1" height="24" :fill="b.color" rx="0" opacity="0.85">
                        <title>{{ b.segment }}：{{ b.count }} 件（{{ fmtPctTenths(b.tenths) }}）</title>
                      </rect>
                      <text :x="r.bars[r.bars.length-1]?.x + (r.bars[r.bars.length-1]?.w||0) + 6" :y="r.y + 20" font-size="10" fill="#374151" font-weight="600">{{ r.total.toLocaleString() }} 件</text>
                    </template>
                  </svg>
                </div>
                <div class="legend-row" style="margin-top:8px">
                  <div v-for="(seg, si) in dashData.charts.causeEndingStack.segments" :key="si" class="legend-item">
                    <span class="legend-dot" :style="{ background: stackColors[si % stackColors.length] }"></span>{{ seg }}
                  </div>
                </div>
              </template>
            </div>

            <!-- NEW: Lawyer × Ending Stacked Bar -->
            <div class="chart-card">
              <div class="chart-title">律師代理 × 終結情形堆疊圖</div>
              <div class="chart-sub">不同律師代理情形的終結結果比例</div>
              <div v-if="!dashData.charts.lawyerEndingStack?.data?.length" class="no-data">無資料</div>
              <template v-else>
                <div style="overflow-x:auto">
                  <svg :width="civilLawyerStackSvg.W" :height="civilLawyerStackSvg.H" class="chart-svg">
                    <template v-for="(r, ri) in civilLawyerStackSvg.rows" :key="ri">
                      <text :x="124" :y="r.y + 20" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ r.label }}</text>
                      <rect v-for="(b, bi) in r.bars" :key="bi" :x="b.x" :y="r.y + 4" :width="b.w || 1" height="24" :fill="b.color" rx="0" opacity="0.85">
                        <title>{{ b.segment }}：{{ b.count }} 件（{{ fmtPctTenths(b.tenths) }}）</title>
                      </rect>
                      <text :x="r.bars[r.bars.length-1]?.x + (r.bars[r.bars.length-1]?.w||0) + 6" :y="r.y + 20" font-size="10" fill="#374151" font-weight="600">{{ r.total.toLocaleString() }} 件</text>
                    </template>
                  </svg>
                </div>
                <div class="legend-row" style="margin-top:8px">
                  <div v-for="(seg, si) in dashData.charts.lawyerEndingStack.segments" :key="si" class="legend-item">
                    <span class="legend-dot" :style="{ background: stackColors[si % stackColors.length] }"></span>{{ seg }}
                  </div>
                </div>
              </template>
            </div>

            <!-- NEW: Court × Ending Heatmap -->
            <div class="chart-card">
              <div class="chart-title">法院 × 終結情形熱度圖</div>
              <div class="chart-sub">各法院終結結果交叉分析</div>
              <div v-if="!dashData.charts.courtHeatmap?.xLabels?.length" class="no-data">無資料</div>
              <div v-else style="overflow-x:auto">
                <table class="heatmap">
                  <thead><tr><th style="width:100px"></th><th v-for="x in dashData.charts.courtHeatmap.xLabels" :key="x">{{ x }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(y, yi) in dashData.charts.courtHeatmap.yLabels" :key="y">
                      <td class="hm-label">{{ y }}</td>
                      <td v-for="(x, xi) in dashData.charts.courtHeatmap.xLabels" :key="x"
                        :style="{ background: `rgba(124,58,237,${0.08 + (dashData.charts.courtHeatmap.matrix[yi][xi] / (dashData.charts.courtHeatmap.max || 1)) * 0.82})`, color: (dashData.charts.courtHeatmap.matrix[yi][xi] / (dashData.charts.courtHeatmap.max || 1)) > 0.5 ? '#fff' : '#111827' }"
                        class="hm-cell">{{ dashData.charts.courtHeatmap.matrix[yi][xi] }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- NEW: Amount Box-Whisker -->
            <div class="chart-card">
              <div class="chart-title">訴訟標的金額盒鬚圖</div>
              <div class="chart-sub">各案由的金額分布（中位數、四分位距）</div>
              <div v-if="!dashData.charts.amountBox?.length" class="no-data">無資料</div>
              <template v-else>
                <div style="overflow-x:auto">
                  <svg :width="civilAmountBoxSvg.W" :height="civilAmountBoxSvg.H" class="chart-svg">
                    <line v-for="gl in civilAmountBoxSvg.gridLines" :key="gl.x" :x1="gl.x" :x2="gl.x" :y1="10" :y2="civilAmountBoxSvg.H - 20" stroke="#e5e7eb" stroke-width="1" />
                    <text v-for="gl in civilAmountBoxSvg.gridLines" :key="'t'+gl.x" :x="gl.x" :y="civilAmountBoxSvg.H - 6" text-anchor="middle" font-size="9" fill="#9ca3af">{{ gl.label }}</text>
                    <template v-for="(d, di) in civilAmountBoxSvg.items" :key="di">
                      <text :x="d.labelX" :y="d.y + 4" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ d.label }}</text>
                      <line :x1="d.whiskerLX" :x2="d.whiskerHX" :y1="d.y" :y2="d.y" stroke="#111827" stroke-width="1.5" />
                      <line :x1="d.whiskerLX" :x2="d.whiskerLX" :y1="d.y - 8" :y2="d.y + 8" stroke="#111827" stroke-width="1.5" />
                      <line :x1="d.whiskerHX" :x2="d.whiskerHX" :y1="d.y - 8" :y2="d.y + 8" stroke="#111827" stroke-width="1.5" />
                      <rect :x="d.q1X" :y="d.y - 12" :width="Math.max(2, d.boxW)" height="24" rx="4" fill="#4F86F7" opacity="0.75" stroke="#111827" stroke-width="1" />
                      <line :x1="d.medianX" :x2="d.medianX" :y1="d.y - 12" :y2="d.y + 12" stroke="#111827" stroke-width="2.4" />
                      <text :x="d.medianX" :y="d.y - 16" text-anchor="middle" font-size="9" fill="#111827" font-weight="700">{{ d.medLabel }}</text>
                    </template>
                  </svg>
                </div>
              </template>
            </div>
          </div>
        </template>

        <!-- ════════════════════════════════════════════ -->
        <!--  CIVIL NON-LITIGATION CHARTS                -->
        <!-- ════════════════════════════════════════════ -->
        <template v-if="activeType === 'civil_nonlitig' && dashData?.charts">
          <div class="chart-grid">
            <!-- Ending distribution -->
            <div class="chart-card">
              <div class="chart-title">終結情形分布</div>
              <div class="chart-sub">各終結情形大分類件數</div>
              <div v-if="!dashData.charts.endingDist?.length" class="no-data">無資料</div>
              <template v-else>
                <svg v-bind="barChartAttrs(dashData.charts.endingDist)" preserveAspectRatio="xMinYMin meet">
                  <template v-for="(r, ri) in barChartRows(dashData.charts.endingDist)" :key="ri">
                    <text :x="134" :y="r.y + 18" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ r.label }}</text>
                    <rect :x="140" :y="r.y + 4" :width="Math.max(2, r.w)" height="20" fill="#35B679" rx="3" opacity="0.85">
                      <title>{{ r.label }}：{{ r.count }} 件（{{ r.pct }}%）</title>
                    </rect>
                    <text :x="144 + r.w" :y="r.y + 18" font-size="10" fill="#374151" font-weight="600">{{ r.count.toLocaleString() }}（{{ r.pct }}%）</text>
                  </template>
                </svg>
              </template>
            </div>

            <!-- Cause distribution -->
            <div class="chart-card">
              <div class="chart-title">案由大分類分布</div>
              <div class="chart-sub">各案由類型件數</div>
              <div v-if="!dashData.charts.causeDist?.length" class="no-data">無資料</div>
              <template v-else>
                <svg v-bind="barChartAttrs(dashData.charts.causeDist)" preserveAspectRatio="xMinYMin meet">
                  <template v-for="(r, ri) in barChartRows(dashData.charts.causeDist)" :key="ri">
                    <text :x="134" :y="r.y + 18" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ r.label }}</text>
                    <rect :x="140" :y="r.y + 4" :width="Math.max(2, r.w)" height="20" fill="#D9A93A" rx="3" opacity="0.85">
                      <title>{{ r.label }}：{{ r.count }} 件（{{ r.pct }}%）</title>
                    </rect>
                    <text :x="144 + r.w" :y="r.y + 18" font-size="10" fill="#374151" font-weight="600">{{ r.count.toLocaleString() }}（{{ r.pct }}%）</text>
                  </template>
                </svg>
              </template>
            </div>

            <!-- Cause × Ending heatmap -->
            <div class="chart-card">
              <div class="chart-title">案由 × 終結情形</div>
              <div class="chart-sub">案由大分類與終結結果交叉分析</div>
              <div v-if="!dashData.charts.causeEndingHeatmap?.xLabels?.length" class="no-data">無資料</div>
              <div v-else style="overflow-x:auto">
                <table class="heatmap">
                  <thead><tr><th style="width:100px"></th><th v-for="x in dashData.charts.causeEndingHeatmap.xLabels" :key="x">{{ x }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(y, yi) in dashData.charts.causeEndingHeatmap.yLabels" :key="y">
                      <td class="hm-label">{{ y }}</td>
                      <td v-for="(x, xi) in dashData.charts.causeEndingHeatmap.xLabels" :key="x"
                        :style="{ background: `rgba(53,182,121,${0.08 + (dashData.charts.causeEndingHeatmap.matrix[yi][xi] / (dashData.charts.causeEndingHeatmap.max || 1)) * 0.82})`, color: (dashData.charts.causeEndingHeatmap.matrix[yi][xi] / (dashData.charts.causeEndingHeatmap.max || 1)) > 0.5 ? '#fff' : '#111827' }"
                        class="hm-cell">{{ dashData.charts.causeEndingHeatmap.matrix[yi][xi] }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Debt comparison -->
            <div class="chart-card">
              <div class="chart-title">消債事件比較</div>
              <div class="chart-sub">消債 vs 非消債事件的終結情形分布</div>
              <div v-if="!dashData.charts.debtComparison?.length" class="no-data">無資料</div>
              <div v-else>
                <div v-for="group in dashData.charts.debtComparison" :key="group.label" style="margin-bottom:12px">
                  <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:4px">{{ group.label === '是' ? '消債事件' : '非消債事件' }}（{{ group.count.toLocaleString() }} 件）</div>
                  <div style="display:flex;gap:4px;flex-wrap:wrap">
                    <span v-for="(cnt, key) in group.endings" :key="key" class="debt-tag">{{ key }} {{ cnt.toLocaleString() }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- NEW: Cause × Ending Stacked Bar -->
            <div class="chart-card">
              <div class="chart-title">案由 × 終結情形堆疊圖</div>
              <div class="chart-sub">各案由的終結情形比例分布</div>
              <div v-if="!dashData.charts.causeEndingStack?.data?.length" class="no-data">無資料</div>
              <template v-else>
                <div style="overflow-x:auto">
                  <svg :width="nonlitigCauseStackSvg.W" :height="nonlitigCauseStackSvg.H" class="chart-svg">
                    <template v-for="(r, ri) in nonlitigCauseStackSvg.rows" :key="ri">
                      <text :x="124" :y="r.y + 20" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ r.label }}</text>
                      <rect v-for="(b, bi) in r.bars" :key="bi" :x="b.x" :y="r.y + 4" :width="b.w || 1" height="24" :fill="b.color" rx="0" opacity="0.85">
                        <title>{{ b.segment }}：{{ b.count }} 件（{{ fmtPctTenths(b.tenths) }}）</title>
                      </rect>
                      <text :x="r.bars[r.bars.length-1]?.x + (r.bars[r.bars.length-1]?.w||0) + 6" :y="r.y + 20" font-size="10" fill="#374151" font-weight="600">{{ r.total.toLocaleString() }} 件</text>
                    </template>
                  </svg>
                </div>
                <div class="legend-row" style="margin-top:8px">
                  <div v-for="(seg, si) in dashData.charts.causeEndingStack.segments" :key="si" class="legend-item">
                    <span class="legend-dot" :style="{ background: stackColors[si % stackColors.length] }"></span>{{ seg }}
                  </div>
                </div>
              </template>
            </div>

            <!-- NEW: Court × Ending Heatmap -->
            <div class="chart-card">
              <div class="chart-title">法院 × 終結情形熱度圖</div>
              <div class="chart-sub">各法院終結結果交叉分析</div>
              <div v-if="!dashData.charts.courtHeatmap?.xLabels?.length" class="no-data">無資料</div>
              <div v-else style="overflow-x:auto">
                <table class="heatmap">
                  <thead><tr><th style="width:100px"></th><th v-for="x in dashData.charts.courtHeatmap.xLabels" :key="x">{{ x }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(y, yi) in dashData.charts.courtHeatmap.yLabels" :key="y">
                      <td class="hm-label">{{ y }}</td>
                      <td v-for="(x, xi) in dashData.charts.courtHeatmap.xLabels" :key="x"
                        :style="{ background: `rgba(53,182,121,${0.08 + (dashData.charts.courtHeatmap.matrix[yi][xi] / (dashData.charts.courtHeatmap.max || 1)) * 0.82})`, color: (dashData.charts.courtHeatmap.matrix[yi][xi] / (dashData.charts.courtHeatmap.max || 1)) > 0.5 ? '#fff' : '#111827' }"
                        class="hm-cell">{{ dashData.charts.courtHeatmap.matrix[yi][xi] }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- NEW: Debt × Ending Heatmap -->
            <div class="chart-card">
              <div class="chart-title">消債事件 × 終結情形熱度圖</div>
              <div class="chart-sub">消債與非消債案件終結結果交叉分析</div>
              <div v-if="!dashData.charts.debtEndingHeatmap?.xLabels?.length" class="no-data">無資料</div>
              <div v-else style="overflow-x:auto">
                <table class="heatmap">
                  <thead><tr><th style="width:100px"></th><th v-for="x in dashData.charts.debtEndingHeatmap.xLabels" :key="x">{{ x }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(y, yi) in dashData.charts.debtEndingHeatmap.yLabels" :key="y">
                      <td class="hm-label">{{ y }}</td>
                      <td v-for="(x, xi) in dashData.charts.debtEndingHeatmap.xLabels" :key="x"
                        :style="{ background: `rgba(217,169,58,${0.08 + (dashData.charts.debtEndingHeatmap.matrix[yi][xi] / (dashData.charts.debtEndingHeatmap.max || 1)) * 0.82})`, color: (dashData.charts.debtEndingHeatmap.matrix[yi][xi] / (dashData.charts.debtEndingHeatmap.max || 1)) > 0.5 ? '#fff' : '#111827' }"
                        class="hm-cell">{{ dashData.charts.debtEndingHeatmap.matrix[yi][xi] }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- NEW: Applicant Distribution -->
            <div class="chart-card">
              <div class="chart-title">聲請人別分布</div>
              <div class="chart-sub">各類聲請人件數</div>
              <div v-if="!dashData.charts.applicantDist?.length" class="no-data">無資料</div>
              <template v-else>
                <svg v-bind="barChartAttrs(dashData.charts.applicantDist)" preserveAspectRatio="xMinYMin meet">
                  <template v-for="(r, ri) in barChartRows(dashData.charts.applicantDist)" :key="ri">
                    <text :x="134" :y="r.y + 18" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ r.label }}</text>
                    <rect :x="140" :y="r.y + 4" :width="Math.max(2, r.w)" height="20" fill="#7c3aed" rx="3" opacity="0.85">
                      <title>{{ r.label }}：{{ r.count }} 件（{{ r.pct }}%）</title>
                    </rect>
                    <text :x="144 + r.w" :y="r.y + 18" font-size="10" fill="#374151" font-weight="600">{{ r.count.toLocaleString() }}（{{ r.pct }}%）</text>
                  </template>
                </svg>
              </template>
            </div>
          </div>
        </template>

        <!-- ════════════════════════════════════════════ -->
        <!--  FAMILY LITIGATION CHARTS                   -->
        <!-- ════════════════════════════════════════════ -->
        <template v-if="activeType === 'family_litigation' && dashData?.charts">
          <div class="chart-grid">
            <!-- Ending distribution -->
            <div class="chart-card">
              <div class="chart-title">終結情形分布</div>
              <div class="chart-sub">各終結情形大分類件數</div>
              <div v-if="!dashData.charts.endingDist?.length" class="no-data">無資料</div>
              <template v-else>
                <svg v-bind="barChartAttrs(dashData.charts.endingDist)" preserveAspectRatio="xMinYMin meet">
                  <template v-for="(r, ri) in barChartRows(dashData.charts.endingDist)" :key="ri">
                    <text :x="134" :y="r.y + 18" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ r.label }}</text>
                    <rect :x="140" :y="r.y + 4" :width="Math.max(2, r.w)" height="20" fill="#7c3aed" rx="3" opacity="0.85">
                      <title>{{ r.label }}：{{ r.count }} 件（{{ r.pct }}%）</title>
                    </rect>
                    <text :x="144 + r.w" :y="r.y + 18" font-size="10" fill="#374151" font-weight="600">{{ r.count.toLocaleString() }}（{{ r.pct }}%）</text>
                  </template>
                </svg>
              </template>
            </div>

            <!-- Cause distribution -->
            <div class="chart-card">
              <div class="chart-title">案由大分類分布</div>
              <div class="chart-sub">各案由類型件數</div>
              <div v-if="!dashData.charts.causeDist?.length" class="no-data">無資料</div>
              <template v-else>
                <svg v-bind="barChartAttrs(dashData.charts.causeDist)" preserveAspectRatio="xMinYMin meet">
                  <template v-for="(r, ri) in barChartRows(dashData.charts.causeDist)" :key="ri">
                    <text :x="134" :y="r.y + 18" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ r.label }}</text>
                    <rect :x="140" :y="r.y + 4" :width="Math.max(2, r.w)" height="20" fill="#F28C52" rx="3" opacity="0.85">
                      <title>{{ r.label }}：{{ r.count }} 件（{{ r.pct }}%）</title>
                    </rect>
                    <text :x="144 + r.w" :y="r.y + 18" font-size="10" fill="#374151" font-weight="600">{{ r.count.toLocaleString() }}（{{ r.pct }}%）</text>
                  </template>
                </svg>
              </template>
            </div>

            <!-- Lawyer × Ending heatmap -->
            <div class="chart-card">
              <div class="chart-title">律師代理 × 終結情形</div>
              <div class="chart-sub">律師代理情形與終結結果交叉分析</div>
              <div v-if="!dashData.charts.lawyerHeatmap?.xLabels?.length" class="no-data">無資料</div>
              <div v-else style="overflow-x:auto">
                <table class="heatmap">
                  <thead><tr><th style="width:100px"></th><th v-for="x in dashData.charts.lawyerHeatmap.xLabels" :key="x">{{ x }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(y, yi) in dashData.charts.lawyerHeatmap.yLabels" :key="y">
                      <td class="hm-label">{{ y }}</td>
                      <td v-for="(x, xi) in dashData.charts.lawyerHeatmap.xLabels" :key="x"
                        :style="{ background: `rgba(124,58,237,${0.08 + (dashData.charts.lawyerHeatmap.matrix[yi][xi] / (dashData.charts.lawyerHeatmap.max || 1)) * 0.82})`, color: (dashData.charts.lawyerHeatmap.matrix[yi][xi] / (dashData.charts.lawyerHeatmap.max || 1)) > 0.5 ? '#fff' : '#111827' }"
                        class="hm-cell">{{ dashData.charts.lawyerHeatmap.matrix[yi][xi] }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Divorce info -->
            <div class="chart-card">
              <div class="chart-title">離婚案件分析</div>
              <div class="chart-sub">離婚原因與主動離婚者分布</div>
              <div v-if="!dashData.charts.divorceReasons?.length && !dashData.charts.initiators?.length" class="no-data">無離婚相關資料</div>
              <div v-else>
                <div v-if="dashData.charts.initiators?.length" style="margin-bottom:16px">
                  <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:8px">主動離婚者</div>
                  <div style="display:flex;gap:10px;flex-wrap:wrap">
                    <div v-for="item in dashData.charts.initiators" :key="item.name" class="initiator-card">
                      <div class="initiator-val">{{ item.count.toLocaleString() }}</div>
                      <div class="initiator-label">{{ item.name }}</div>
                    </div>
                  </div>
                </div>
                <div v-if="dashData.charts.divorceReasons?.length">
                  <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:8px">離婚原因</div>
                  <div v-for="item in dashData.charts.divorceReasons" :key="item.name" class="divorce-row">
                    <span class="divorce-label">{{ item.name }}</span>
                    <div class="divorce-bar-bg">
                      <div class="divorce-bar-fill" :style="{ width: Math.max(2, (item.count / (dashData.charts.divorceReasons[0]?.count || 1)) * 100) + '%' }"></div>
                    </div>
                    <span class="divorce-count">{{ item.count.toLocaleString() }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- NEW: Cause × Ending Stacked Bar -->
            <div class="chart-card">
              <div class="chart-title">案由 × 終結情形堆疊圖</div>
              <div class="chart-sub">各案由的終結情形比例分布</div>
              <div v-if="!dashData.charts.causeEndingStack?.data?.length" class="no-data">無資料</div>
              <template v-else>
                <div style="overflow-x:auto">
                  <svg :width="familyCauseStackSvg.W" :height="familyCauseStackSvg.H" class="chart-svg">
                    <template v-for="(r, ri) in familyCauseStackSvg.rows" :key="ri">
                      <text :x="124" :y="r.y + 20" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ r.label }}</text>
                      <rect v-for="(b, bi) in r.bars" :key="bi" :x="b.x" :y="r.y + 4" :width="b.w || 1" height="24" :fill="b.color" rx="0" opacity="0.85">
                        <title>{{ b.segment }}：{{ b.count }} 件（{{ fmtPctTenths(b.tenths) }}）</title>
                      </rect>
                      <text :x="r.bars[r.bars.length-1]?.x + (r.bars[r.bars.length-1]?.w||0) + 6" :y="r.y + 20" font-size="10" fill="#374151" font-weight="600">{{ r.total.toLocaleString() }} 件</text>
                    </template>
                  </svg>
                </div>
                <div class="legend-row" style="margin-top:8px">
                  <div v-for="(seg, si) in dashData.charts.causeEndingStack.segments" :key="si" class="legend-item">
                    <span class="legend-dot" :style="{ background: stackColors[si % stackColors.length] }"></span>{{ seg }}
                  </div>
                </div>
              </template>
            </div>

            <!-- NEW: Lawyer × Ending Stacked Bar -->
            <div class="chart-card">
              <div class="chart-title">律師代理 × 終結情形堆疊圖</div>
              <div class="chart-sub">不同律師代理情形的終結結果比例</div>
              <div v-if="!dashData.charts.lawyerEndingStack?.data?.length" class="no-data">無資料</div>
              <template v-else>
                <div style="overflow-x:auto">
                  <svg :width="familyLawyerStackSvg.W" :height="familyLawyerStackSvg.H" class="chart-svg">
                    <template v-for="(r, ri) in familyLawyerStackSvg.rows" :key="ri">
                      <text :x="124" :y="r.y + 20" text-anchor="end" font-size="11" fill="#374151" font-weight="500">{{ r.label }}</text>
                      <rect v-for="(b, bi) in r.bars" :key="bi" :x="b.x" :y="r.y + 4" :width="b.w || 1" height="24" :fill="b.color" rx="0" opacity="0.85">
                        <title>{{ b.segment }}：{{ b.count }} 件（{{ fmtPctTenths(b.tenths) }}）</title>
                      </rect>
                      <text :x="r.bars[r.bars.length-1]?.x + (r.bars[r.bars.length-1]?.w||0) + 6" :y="r.y + 20" font-size="10" fill="#374151" font-weight="600">{{ r.total.toLocaleString() }} 件</text>
                    </template>
                  </svg>
                </div>
                <div class="legend-row" style="margin-top:8px">
                  <div v-for="(seg, si) in dashData.charts.lawyerEndingStack.segments" :key="si" class="legend-item">
                    <span class="legend-dot" :style="{ background: stackColors[si % stackColors.length] }"></span>{{ seg }}
                  </div>
                </div>
              </template>
            </div>

            <!-- NEW: Court × Ending Heatmap -->
            <div class="chart-card">
              <div class="chart-title">法院 × 終結情形熱度圖</div>
              <div class="chart-sub">各法院終結結果交叉分析</div>
              <div v-if="!dashData.charts.courtHeatmap?.xLabels?.length" class="no-data">無資料</div>
              <div v-else style="overflow-x:auto">
                <table class="heatmap">
                  <thead><tr><th style="width:100px"></th><th v-for="x in dashData.charts.courtHeatmap.xLabels" :key="x">{{ x }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(y, yi) in dashData.charts.courtHeatmap.yLabels" :key="y">
                      <td class="hm-label">{{ y }}</td>
                      <td v-for="(x, xi) in dashData.charts.courtHeatmap.xLabels" :key="x"
                        :style="{ background: `rgba(124,58,237,${0.08 + (dashData.charts.courtHeatmap.matrix[yi][xi] / (dashData.charts.courtHeatmap.max || 1)) * 0.82})`, color: (dashData.charts.courtHeatmap.matrix[yi][xi] / (dashData.charts.courtHeatmap.max || 1)) > 0.5 ? '#fff' : '#111827' }"
                        class="hm-cell">{{ dashData.charts.courtHeatmap.matrix[yi][xi] }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- NEW: Divorce Initiator × Reason Heatmap -->
            <div class="chart-card">
              <div class="chart-title">主動離婚者 × 離婚原因熱度圖</div>
              <div class="chart-sub">主動離婚者與離婚原因交叉分析</div>
              <div v-if="!dashData.charts.divorceInitiatorHeatmap?.xLabels?.length" class="no-data">無資料</div>
              <div v-else style="overflow-x:auto">
                <table class="heatmap">
                  <thead><tr><th style="width:100px"></th><th v-for="x in dashData.charts.divorceInitiatorHeatmap.xLabels" :key="x">{{ x }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(y, yi) in dashData.charts.divorceInitiatorHeatmap.yLabels" :key="y">
                      <td class="hm-label">{{ y }}</td>
                      <td v-for="(x, xi) in dashData.charts.divorceInitiatorHeatmap.xLabels" :key="x"
                        :style="{ background: `rgba(242,140,82,${0.08 + (dashData.charts.divorceInitiatorHeatmap.matrix[yi][xi] / (dashData.charts.divorceInitiatorHeatmap.max || 1)) * 0.82})`, color: (dashData.charts.divorceInitiatorHeatmap.matrix[yi][xi] / (dashData.charts.divorceInitiatorHeatmap.max || 1)) > 0.5 ? '#fff' : '#111827' }"
                        class="hm-cell">{{ dashData.charts.divorceInitiatorHeatmap.matrix[yi][xi] }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </template>

        <!-- ════════════════════════════════════════════ -->
        <!--  JUDGMENT TABLE (all types)                  -->
        <!-- ════════════════════════════════════════════ -->
        <div class="table-wrap" v-if="dashData">
          <div class="table-header">
            <div style="font-size:14px;font-weight:700;color:#111827">
              裁判書列表
              <span style="font-weight:400;color:#6b7280;font-size:12px">
                第 {{ pg + 1 }} / {{ totalPages }} 頁，共 {{ (judgments.totalJudgments || 0).toLocaleString() }} 篇
              </span>
            </div>
            <div style="display:flex;gap:6px">
              <button :disabled="pg === 0" @click="goPrev" class="btn-page">‹ 上一頁</button>
              <button :disabled="pg >= totalPages - 1" @click="goNext" class="btn-page">下一頁 ›</button>
            </div>
          </div>

          <!-- Criminal table columns -->
          <template v-if="activeType === 'criminal_litigation'">
            <div class="table-col-header" style="grid-template-columns: minmax(180px,2fr) 90px 1fr 90px 80px 70px 80px 80px">
              <div>裁判書 ID</div><div style="text-align:center">法院別</div><div style="text-align:center">案由</div><div style="text-align:center">分類</div><div style="text-align:center">終結</div><div style="text-align:center">被告</div><div style="text-align:center">犯罪數</div><div style="text-align:center">法條數</div>
            </div>
            <div v-for="j in judgments.items" :key="j.jid" class="table-row" style="grid-template-columns: minmax(180px,2fr) 90px 1fr 90px 80px 70px 80px 80px">
              <div class="table-jid"><a :href="JURL + j.jid" target="_blank" rel="noopener noreferrer" class="jid-link">{{ j.jid }}</a></div>
              <div style="font-size:10px;text-align:center">{{ j.court }}</div>
              <div class="table-reason">{{ j.cause }}</div>
              <div style="text-align:center"><span class="cls-badge" :style="{ background: (CLS_CLR[j.cls]||'#888') + '18', color: CLS_CLR[j.cls]||'#888' }">{{ j.cls }}</span></div>
              <div style="font-size:10px;text-align:center">{{ j.ending }}</div>
              <div style="text-align:center">{{ j.defendants }}</div>
              <div style="text-align:center">{{ j.crimeCount }}</div>
              <div style="text-align:center">{{ j.lawCount }}</div>
            </div>
          </template>

          <!-- Civil / NonLitig / Family table columns -->
          <template v-else>
            <div class="table-col-header" style="grid-template-columns: minmax(200px,2fr) 100px 1fr 120px 100px">
              <div>裁判書 ID</div><div style="text-align:center">法院別</div><div style="text-align:center">案由</div><div style="text-align:center">終結情形</div><div style="text-align:center">{{ activeType === 'civil_nonlitig' ? '案由分類' : '律師代理' }}</div>
            </div>
            <div v-for="j in judgments.items" :key="j.jid" class="table-row" style="grid-template-columns: minmax(200px,2fr) 100px 1fr 120px 100px">
              <div class="table-jid"><a :href="JURL + j.jid" target="_blank" rel="noopener noreferrer" class="jid-link">{{ j.jid }}</a></div>
              <div style="font-size:10px;text-align:center">{{ j.court }}</div>
              <div class="table-reason">{{ j.cause }}</div>
              <div style="font-size:10px;text-align:center">{{ j.ending }}</div>
              <div style="font-size:10px;text-align:center">{{ j.lawyer || j.causeCat || '' }}</div>
            </div>
          </template>

          <div v-if="!judgments.items?.length" style="padding:32px;text-align:center;color:#9ca3af;font-size:12px">無符合條件的裁判書</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// Helper functions exposed to template for bar charts
export default {
  methods: {
    barChartAttrs(data) {
      if (!data?.length) return {}
      const sorted = [...data].sort((a, b) => b.count - a.count)
      const H = 10 + 28 * sorted.length + 20
      return { viewBox: `0 0 560 ${H}`, width: '100%' }
    },
    barChartRows(data) {
      if (!data?.length) return []
      const sorted = [...data].sort((a, b) => b.count - a.count)
      const total = sorted.reduce((s, x) => s + x.count, 0)
      const maxCount = Math.max(...sorted.map(d => d.count), 1)
      const barW = 560 - 140 - 60
      return sorted.map((d, idx) => ({
        label: d.name,
        count: d.count,
        y: 10 + 28 * idx,
        w: (d.count / maxCount) * barW,
        pct: ((d.count / total) * 100).toFixed(1),
      }))
    },
  },
}
</script>

<style scoped>
* { box-sizing: border-box; margin: 0; padding: 0; }
.app-root { min-height: 100vh; background: #f8fafc; font-family: 'DM Sans','Noto Sans TC',sans-serif; color: #111827; }

/* Top Navigation */
.topnav { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; height: 52px; background: #0f172a; color: #fff; flex-shrink: 0; }
.topnav-left { display: flex; align-items: center; gap: 10px; }
.topnav-logo { font-size: 22px; }
.topnav-title { font-size: 15px; font-weight: 700; letter-spacing: 0.5px; }
.topnav-tabs { display: flex; gap: 2px; }
.cat-tab { padding: 8px 22px; border: none; background: transparent; color: rgba(255,255,255,0.6); font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; border-radius: 8px 8px 0 0; transition: all 0.15s; }
.cat-tab:hover { color: rgba(255,255,255,0.85); background: rgba(255,255,255,0.08); }
.cat-tab.active { color: #fff; background: rgba(255,255,255,0.15); }

/* Sub-type tabs */
.subtab-bar { display: flex; gap: 0; padding: 0 20px; background: #1e293b; border-bottom: 2px solid #334155; }
.sub-tab { padding: 10px 24px; border: none; background: transparent; color: rgba(255,255,255,0.55); font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s; border-bottom: 3px solid transparent; display: flex; align-items: center; gap: 6px; }
.sub-tab:hover { color: rgba(255,255,255,0.8); background: rgba(255,255,255,0.05); }
.sub-tab.active { color: #fff; border-bottom-color: #60a5fa; background: rgba(255,255,255,0.08); }
.sub-tab-icon { font-size: 15px; }

/* Dashboard layout */
.dashboard { display: flex; min-height: calc(100vh - 90px); }

/* Sidebar */
.sidebar-tab { width: 28px; min-width: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border-right: 1px solid #d1d5db; transition: all 0.2s; z-index: 10; writing-mode: vertical-rl; font-size: 12px; font-weight: 600; user-select: none; letter-spacing: 3px; background: #1e40af; color: #fff; }
.sidebar-tab.open { background: #f1f5f9; color: #64748b; }
.sidebar { overflow: hidden; transition: all 0.3s ease; border-right: 1px solid #e5e7eb; background: #fff; flex-shrink: 0; }
.sidebar-inner { width: 300px; height: calc(100vh - 90px); display: flex; flex-direction: column; }
.sidebar-header { padding: 14px 14px 12px; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; background: #fff; z-index: 5; box-shadow: 0 2px 4px rgba(0,0,0,0.03); }
.sidebar-scroll { flex: 1; overflow-y: auto; padding: 10px 14px; }
.btn-submit { flex: 1; padding: 9px; border-radius: 8px; border: none; background: #2563eb; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: 0 1px 3px rgba(37,99,235,0.3); }
.btn-reset { padding: 9px 14px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; color: #4b5563; font-size: 13px; cursor: pointer; font-family: inherit; }

/* Filter controls */
.filter-group { margin-bottom: 8px; }
.filter-label { font-size: 11px; font-weight: 600; color: #374151; margin-bottom: 4px; }
.sel { padding: 4px 8px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; color: #111827; font-size: 11px; font-family: inherit; outline: none; width: 100%; }
.section-title { font-size: 11px; font-weight: 700; margin-bottom: 6px; padding-bottom: 4px; letter-spacing: 0.5px; border-bottom: 2px solid; }
.section-title.blue { color: #2563eb; border-color: #dbeafe; }
.section-title.orange { color: #ea580c; border-color: #fed7aa; margin-top: 10px; }
.section-title.green { color: #059669; border-color: #bbf7d0; margin-top: 10px; }
.acc-group { margin-bottom: 8px; }
.acc-border { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
.acc-item { border-bottom: 1px solid #f1f5f9; }
.acc-item:last-child { border-bottom: none; }
.acc-trigger { display: flex; align-items: center; justify-content: space-between; padding: 8px; cursor: pointer; user-select: none; transition: background 0.15s; }
.acc-trigger:hover { background: #f8fafc; }
.acc-arrow { font-size: 9px; color: #9ca3af; transition: transform 0.2s; display: inline-block; }
.acc-arrow.open { transform: rotate(90deg); }
.acc-title { font-size: 12px; font-weight: 600; color: #374151; }
.acc-badge { font-size: 10px; font-weight: 700; color: #fff; background: #2563eb; border-radius: 999px; padding: 1px 7px; min-width: 18px; text-align: center; }
.acc-body { padding: 6px 8px 10px 16px; }
.chip-wrap { display: flex; flex-wrap: wrap; gap: 4px; }
.chip-wrap.scrollable { max-height: 120px; overflow-y: auto; }
.chip { padding: 3px 8px; border-radius: 12px; font-size: 10px; cursor: pointer; font-family: inherit; border: 1px solid #d1d5db; background: #fff; color: #4b5563; }
.chip.active { border-color: #4F86F7; background: rgba(79,134,247,0.10); color: #2563eb; }
.chip-count { opacity: 0.55; }
.search-input { padding: 4px 8px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; color: #111827; font-size: 10px; font-family: inherit; outline: none; }

/* Main area */
.main-area { flex: 1; min-width: 0; padding: 18px 22px; overflow-y: auto; height: calc(100vh - 90px); position: relative; }
.main-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px; }
.loading-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(248,250,252,0.85); display: flex; align-items: center; justify-content: center; gap: 10px; z-index: 20; font-size: 14px; color: #6b7280; }
.spinner { width: 24px; height: 24px; border: 3px solid #e5e7eb; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-banner { padding: 10px 16px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #dc2626; font-size: 13px; margin-bottom: 12px; }

/* Stats */
.stats-grid { display: grid; gap: 12px; margin-bottom: 18px; }
.stat-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px 20px; position: relative; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.stat-accent { position: absolute; top: 0; left: 0; width: 4px; height: 100%; border-radius: 14px 0 0 14px; }
.stat-label { font-size: 13px; color: #374151; margin-bottom: 6px; font-weight: 500; }
.stat-value { font-size: 28px; font-weight: 700; color: #111827; line-height: 1; }

/* Charts */
.chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 24px; }
.chart-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px 20px; min-height: 300px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); min-width: 0; overflow: hidden; }
.chart-title { font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 4px; }
.chart-sub { font-size: 10px; color: #6b7280; margin-bottom: 12px; line-height: 1.5; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.no-data { height: 200px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 14px; }

/* Heatmap */
.heatmap { width: 100%; border-collapse: separate; border-spacing: 3px; table-layout: fixed; }
.heatmap th { font-size: 10px; color: #374151; text-align: center; word-break: break-word; line-height: 1.3; font-weight: 500; padding: 3px 2px; }
.hm-label { font-size: 10px; color: #374151; text-align: right; padding-right: 6px; word-break: break-word; line-height: 1.3; font-weight: 500; }
.hm-cell { height: 40px; border-radius: 6px; border: 1px solid #dbe3f1; text-align: center; font-size: 8px; font-weight: 700; }

/* Legend */
.legend-row { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; margin-top: 6px; }
.legend-item { display: flex; align-items: center; gap: 5px; font-size: 10px; color: #374151; }
.legend-dot { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }

/* Metric selector */
.metric-btn { padding: 2px 10px; border-radius: 999px; border: 1px solid #d1d5db; background: #fff; color: #6b7280; font-size: 10px; cursor: pointer; font-family: inherit; font-weight: 500; }
.metric-btn.active { background: #eff6ff; color: #2563eb; border-color: #93c5fd; font-weight: 700; }

/* Table */
.table-wrap { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.table-header { padding: 12px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
.btn-page { padding: 5px 14px; border-radius: 10px; border: 1px solid #d1d5db; background: #fff; color: #374151; cursor: pointer; font-size: 12px; font-family: inherit; font-weight: 500; }
.btn-page:disabled { color: #cbd5e1; cursor: default; }
.table-col-header { display: grid; padding: 10px 20px; border-bottom: 1px solid #e5e7eb; font-size: 12px; font-weight: 700; color: #374151; gap: 6px; align-items: center; }
.table-row { display: grid; padding: 10px 18px; border-bottom: 1px solid #f1f5f9; background: #fff; font-size: 11px; align-items: center; gap: 6px; }
.table-row:hover { background: #fafafa; }
.table-jid { font-family: monospace; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jid-link { color: #374151; text-decoration: none; border-bottom: 1px dashed #cbd5e1; }
.table-reason { font-size: 10px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cls-badge { padding: 2px 6px; border-radius: 8px; font-size: 9px; font-weight: 600; }

/* Family-specific */
.initiator-card { padding: 12px 20px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 10px; text-align: center; min-width: 80px; }
.initiator-val { font-size: 22px; font-weight: 700; color: #7c3aed; }
.initiator-label { font-size: 12px; color: #6b7280; margin-top: 2px; }
.divorce-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.divorce-label { font-size: 11px; color: #374151; min-width: 100px; flex-shrink: 0; word-break: break-word; line-height: 1.3; }
.divorce-bar-bg { flex: 1; height: 14px; background: #f3e8ff; border-radius: 7px; overflow: hidden; }
.divorce-bar-fill { height: 100%; background: #7c3aed; border-radius: 7px; transition: width 0.3s; }
.divorce-count { font-size: 11px; font-weight: 600; color: #374151; min-width: 40px; text-align: right; }

/* Debt tags */
.debt-tag { padding: 3px 10px; border-radius: 8px; font-size: 10px; background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; font-weight: 500; }
</style>
