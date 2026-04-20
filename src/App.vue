<script setup>
import { ref, computed, watch, onMounted } from 'vue'

// ═══════════════════════════════════════════════════════════
//  Section 1 — API Configuration
// ═══════════════════════════════════════════════════════════
const API_BASE = import.meta.env.VITE_API_BASE
console.log('API 連線位址:', API_BASE)

async function api(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v)
  })
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ═══════════════════════════════════════════════════════════
//  Section 2 — Type & Constant Definitions
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
const PALETTE = ['#4F86F7','#F28C52','#35B679','#D9A93A','#E45C5C','#8B5CF6','#06B6D4','#EC4899','#84CC16']
const AG_MIT_CATS = ['無加重無減輕','僅有加重法條','僅有減輕法條','有加重有減輕']
const AG_MIT_COLORS = {'無加重無減輕':'#4F86F7','僅有加重法條':'#F28C52','僅有減輕法條':'#35B679','有加重有減輕':'#D9A93A'}
const JURL = 'https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id='

// ═══════════════════════════════════════════════════════════
//  Section 3 — Utility Functions
// ═══════════════════════════════════════════════════════════
const numFmt = v => { const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10); return Number.isNaN(n) ? String(v ?? '') : n.toLocaleString() }
function fmtPctTenths(t) { const n = Number(t || 0); return n % 10 === 0 ? `${n/10}%` : `${(n/10).toFixed(1)}%` }
function wrapTextLines(text, maxChars = 12, maxLines = 3) {
  const s = String(text ?? ''); if (!s) return ['']
  const chunks = []; for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars))
  if (chunks.length <= maxLines) return chunks
  const kept = chunks.slice(0, maxLines); kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(0, maxChars - 1)) + '…'; return kept
}
function formatMetricValue(v, mode, digits = 1) {
  const n = Number(v); if (!Number.isFinite(n)) return ''
  const rounded = Number(n.toFixed(digits)); const isInt = Math.abs(rounded - Math.round(rounded)) < 1e-9
  if (mode === 'fine') return isInt ? Math.round(rounded).toLocaleString() : rounded.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return isInt ? String(Math.round(rounded)) : rounded.toFixed(digits)
}
function getMetricBaseStep(mode, maxVal) { const safe = Math.max(1, maxVal || 1); if (mode === 'imprisonment') return 12; if (mode === 'detention') return 5; if (mode === 'fine') { if (safe <= 2000) return 100; if (safe <= 20000) return 1000; if (safe <= 200000) return 10000; return 50000 }; return 1 }
function buildNiceTicks(maxVal, mode, target = 6) { const safe = Math.max(1, maxVal || 1); const base = getMetricBaseStep(mode, safe); const step = Math.max(base, Math.ceil(safe / target / base) * base); const maxTick = Math.max(step, Math.ceil(safe / step) * step); const ticks = []; for (let t = 0; t <= maxTick + 1e-9; t += step) ticks.push(Number(t.toFixed(10))); return { ticks, maxTick, step } }
function buildRangeTicks(minVal, maxVal, mode, target = 6) { const safeMin = Math.max(0, minVal ?? 0), safeMax = Math.max(safeMin + 1, maxVal ?? 1); const base = getMetricBaseStep(mode, safeMax); const step = Math.max(base, Math.ceil(Math.max(safeMax - safeMin, safeMax) / target / base) * base); let start = Math.floor(safeMin / step) * step, end = Math.ceil(safeMax / step) * step; if (start === end) end = start + step; const ticks = []; for (let t = start; t <= end + 1e-9; t += step) ticks.push(Number(t.toFixed(10))); return { ticks, start, end, step } }
function qtl(sorted, q) { if (!sorted.length) return 0; const p = (sorted.length - 1) * q; const b = Math.floor(p); return sorted[b + 1] !== undefined ? sorted[b] + (p - b) * (sorted[b + 1] - sorted[b]) : sorted[b] }

// ═══════════════════════════════════════════════════════════
//  Section 4 — Filter Definitions per Case Type
// ═══════════════════════════════════════════════════════════
// Each case type has a list of filter groups; each filter group has a section title, color, and items.
// Each item: { key (param name), label, optsKey (key in filterOptions), canToggle }
// "canToggle" means the user can switch between union(+) and intersection(&).
const LOCKED_OR_KEYS = new Set(['cls','court','ending','procedure','probation','recidivist','cause','lawyer','initiator','divorce_reason','action','subject','lawsuit_type','amount_tier','national_comp','agency_type','comp_type','public_type','election_type','is_debt','debt_reason'])

function getFilterDefs(caseType) {
  if (caseType === 'criminal_litigation') return [
    { title: '案件資訊', color: 'blue', items: [
      { key: 'cls', label: '案件分類', optsKey: 'classes' },
      { key: 'court', label: '法院別', optsKey: 'courts' },
      { key: 'ending', label: '全案終結情形', optsKey: 'endings' },
    ]},
    { title: '被告資訊', color: 'orange', items: [
      { key: 'defense', label: '辯護及代理', optsKey: 'defs' },
      { key: 'security', label: '保安處分', optsKey: 'security', canToggle: true },
      { key: 'procedure', label: '裁判程序', optsKey: 'procs' },
      { key: 'compensation', label: '賠償對象', optsKey: 'compensation', canToggle: true },
      { key: 'confiscation', label: '沒收', optsKey: 'confiscation', canToggle: true },
      { key: 'probation', label: '宣告緩刑', optsKey: 'probs' },
      { key: 'probcond', label: '緩刑條件', optsKey: 'probcond', canToggle: true },
      { key: 'dv', label: '家暴相關', optsKey: 'dv', canToggle: true },
      { key: 'recidivist', label: '累犯', optsKey: 'recid' },
    ]},
    { title: '罪刑資訊', color: 'green', items: [
      { key: 'article', label: '定罪法條', optsKey: 'articles', canToggle: true },
      { key: 'crime_flags', label: '罪犯類型', optsKey: 'crimeFlags', canToggle: true },
      { key: 'aggravation', label: '量刑加重事由', optsKey: 'aggr', canToggle: true },
      { key: 'mitigation', label: '量刑減輕事由', optsKey: 'miti', canToggle: true },
      { key: 'result', label: '罪名裁判結果', optsKey: 'results', canToggle: true },
    ]},
  ]
  if (caseType === 'civil_litigation') return [
    { title: '案件資訊', color: 'blue', items: [
      { key: 'court', label: '法院別', optsKey: 'courts' },
      { key: 'ending', label: '終結情形', optsKey: 'endings' },
      { key: 'action', label: '案由-動作', optsKey: 'actions' },
      { key: 'subject', label: '案由-標的', optsKey: 'subjects' },
      { key: 'lawsuit_type', label: '訴訟標的類別', optsKey: 'lawsuitTypes' },
      { key: 'amount_tier', label: '金額級距', optsKey: 'amountTiers' },
    ]},
    { title: '當事人資訊', color: 'orange', items: [
      { key: 'lawyer', label: '律師代理情形', optsKey: 'lawyers' },
      { key: 'national_comp', label: '是否國賠事件', optsKey: 'nationalComp' },
      { key: 'agency_type', label: '被請求機關類別', optsKey: 'agencyTypes' },
      { key: 'comp_type', label: '賠償類別', optsKey: 'compTypes' },
      { key: 'public_type', label: '公職類別', optsKey: 'publicTypes' },
      { key: 'election_type', label: '選舉類別', optsKey: 'electionTypes' },
    ]},
  ]
  if (caseType === 'civil_nonlitig') return [
    { title: '案件資訊', color: 'blue', items: [
      { key: 'court', label: '法院別', optsKey: 'courts' },
      { key: 'ending', label: '終結情形', optsKey: 'endings' },
      { key: 'action', label: '案由-動作', optsKey: 'actions' },
      { key: 'subject', label: '案由-標的', optsKey: 'subjects' },
    ]},
    { title: '其他', color: 'orange', items: [
      { key: 'is_debt', label: '是否消債事件', optsKey: 'isDebt' },
      { key: 'debt_reason', label: '消債事件駁回原因', optsKey: 'debtReasons' },
    ]},
  ]
  if (caseType === 'family_litigation') return [
    { title: '案件資訊', color: 'blue', items: [
      { key: 'court', label: '法院別', optsKey: 'courts' },
      { key: 'ending', label: '終結情形', optsKey: 'endings' },
      { key: 'cause', label: '案由', optsKey: 'causes' },
    ]},
    { title: '當事人資訊', color: 'orange', items: [
      { key: 'lawyer', label: '律師代理情形', optsKey: 'lawyers' },
      { key: 'initiator', label: '主動離婚者', optsKey: 'initiators' },
      { key: 'divorce_reason', label: '離婚原因', optsKey: 'divorceReasons' },
    ]},
  ]
  return []
}

// ═══════════════════════════════════════════════════════════
//  Section 5 — Reactive State
// ═══════════════════════════════════════════════════════════
const activeCat = ref('criminal')
const activeType = ref('criminal_litigation')
const loading = ref(false)
const error = ref(null)
const availableTypes = ref([])

// Data from API
const filterOptions = ref({})
const dashData = ref(null)

// Sidebar
const sideOpen = ref(true)
const openAcc = ref(null)
const searchStates = ref({})
const showFilterTip = ref(false)
function getSearch(key) { return searchStates.value[key] || '' }
function setSearch(key, val) { searchStates.value = { ...searchStates.value, [key]: val } }
function toggleAcc(key) { openAcc.value = openAcc.value === key ? null : key }

// Filters — stored as { paramKey: [selectedValues] } plus ym_min/ym_max
const filters = ref({})
const logicModes = ref({})   // { paramKey: 'or' | 'and' }
const appliedFilters = ref(null) // snapshot after submit
const appliedLogic = ref(null)
const pg = ref(0)
const PG = 10

function getFilter(key) { return filters.value[key] || [] }
function setFilter(key, val) { filters.value = { ...filters.value, [key]: val } }
function toggleChip(arr, val) {
  const s = new Set(arr || [])
  s.has(val) ? s.delete(val) : s.add(val)
  return [...s]
}
function getLogicMode(key) { return LOCKED_OR_KEYS.has(key) ? 'or' : (logicModes.value[key] || 'or') }
function setLogicMode(key, val) { logicModes.value = { ...logicModes.value, [key]: LOCKED_OR_KEYS.has(key) ? 'or' : val } }

function filteredOptions(options, searchKey) {
  if (!options?.length) return []
  const q = getSearch(searchKey)?.trim()?.toLowerCase()
  if (!q) return options
  return options.filter(o => o.val.toLowerCase().includes(q))
}

function allClear() {
  filters.value = {}
  logicModes.value = {}
  appliedFilters.value = null
  appliedLogic.value = null
  pg.value = 0
  showFilterTip.value = false
  searchStates.value = {}
  openAcc.value = null
}

// ═══════════════════════════════════════════════════════════
//  Section 6 — Filter Summary Builder
// ═══════════════════════════════════════════════════════════
const filterSummary = computed(() => {
  if (!appliedFilters.value) return '所選條件：全部案件'
  const parts = []
  const af = appliedFilters.value
  const lg = appliedLogic.value || {}
  const defs = getFilterDefs(activeType.value)
  for (const section of defs) {
    for (const item of section.items) {
      const sel = af[item.key]
      if (sel?.length) {
        const sep = (lg[item.key] === 'and') ? '&' : '+'
        parts.push(`${item.label}：${sel.join(sep)}`)
      }
    }
  }
  if (af.ym_min || af.ym_max) {
    const from = af.ym_min ? af.ym_min.replace('/', '年') + '月' : '最早'
    const to = af.ym_max ? af.ym_max.replace('/', '年') + '月' : '最晚'
    parts.push(`終結年月：${from}～${to}`)
  }
  return parts.length ? '所選條件：' + parts.join('，') : '所選條件：全部案件'
})

// ═══════════════════════════════════════════════════════════
//  Section 7 — API Calls
// ═══════════════════════════════════════════════════════════
async function loadTypes() {
  try {
    availableTypes.value = await api('/api/types')
    // Auto-select first available
    const first = availableTypes.value.find(t => t.available)
    if (first) {
      activeType.value = first.key
      activeCat.value = CASE_TYPES[first.key]?.category || 'criminal'
    }
  } catch (e) { error.value = '無法載入案件類型：' + e.message }
}

async function loadOptions() {
  try {
    filterOptions.value = await api(`/api/${activeType.value}/options`)
  } catch (e) { error.value = '無法載入篩選選項：' + e.message }
}

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const params = {}
    const af = appliedFilters.value || {}
    // Build query params from applied filters
    for (const [k, v] of Object.entries(af)) {
      if (k === 'ym_min' || k === 'ym_max') {
        if (v) params[k] = v
      } else if (Array.isArray(v) && v.length) {
        params[k] = v.join(',')
      }
    }
    // Logic modes for toggleable filters
    const lg = appliedLogic.value || {}
    const logicParam = {}
    let hasLogic = false
    for (const [k, v] of Object.entries(lg)) {
      if (v === 'and') { logicParam[k] = 'and'; hasLogic = true }
    }
    if (hasLogic) params.logic = JSON.stringify(logicParam)
    params.page = pg.value
    params.page_size = PG
    dashData.value = await api(`/api/${activeType.value}/data`, params)
  } catch (e) {
    error.value = '無法載入資料：' + e.message
  } finally {
    loading.value = false
  }
}

function handleSubmit() {
  // Snapshot current filters
  appliedFilters.value = JSON.parse(JSON.stringify({
    ...filters.value,
    ym_min: filters.value.ym_min || '',
    ym_max: filters.value.ym_max || '',
  }))
  appliedLogic.value = JSON.parse(JSON.stringify(logicModes.value))
  pg.value = 0
  sideOpen.value = false
  loadData()
}

function handleDL() {
  if (!dashData.value?.judgments?.items?.length) return
  const items = dashData.value.judgments.items
  const jids = items.map(i => i.jid)
  const csv = '\uFEFF裁判書ID,裁判書全文網址\n' + jids.map(id => `"${id}","${JURL}${id}"`).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a'); a.href = url; a.download = `判決清單_${activeType.value}.csv`; a.click(); URL.revokeObjectURL(url)
}

// ═══════════════════════════════════════════════════════════
//  Section 8 — SVG Chart Builders (from API data)
// ═══════════════════════════════════════════════════════════

// Heatmap renderer (used for all heatmap chart types)
// Input: { xLabels, yLabels, matrix, max }
function heatmapColor(val, maxVal, baseColor = '79,134,247') {
  const ratio = val / (maxVal || 1)
  return `rgba(${baseColor},${0.08 + ratio * 0.82})`
}

// Stacked bar SVG builder (from API data: { data, segments })
function stackedBarSvg(chartData) {
  if (!chartData?.data?.length || !chartData?.segments?.length) return null
  const segments = chartData.segments
  const data = chartData.data
  const LM = 130, RM = 20, TM = 10, rowH = 32
  const W = 600, H = TM + rowH * data.length + 30
  const barW = W - LM - RM
  const rows = data.map((d, idx) => {
    const y = TM + rowH * idx
    let accX = LM
    const bars = segments.map((seg, si) => {
      const tenths = d[seg] || 0
      const w = (tenths / 1000) * barW
      const x = accX; accX += w
      return { x, w, y: y + 4, h: rowH - 8, fill: PALETTE[si % PALETTE.length], seg, tenths, count: d.__counts?.[seg] || 0 }
    })
    return { name: d.name, y, bars, labelLines: wrapTextLines(d.name, 9, 2) }
  })
  return { W, H, rows, LM, barW, segments }
}

// Violin SVG builder (from API data: array of { name, values, mean, median, n })
function violinSvgData(violinData) {
  if (!violinData?.length) return null
  const LM = 210, RM = 78, TM = 28, BM = 76, rowH = 104, W = 860
  const H = TM + BM + rowH * violinData.length; const plotW = W - LM - RM
  const allV = violinData.flatMap(d => d.values)
  const gMin = Math.min(...allV), gMax = Math.max(...allV), rawRange = gMax - gMin || 1
  const { ticks, start, end } = buildRangeTicks(gMin, gMax, 'imprisonment', 6)
  const domain = Math.max(1, end - start)
  const xS = v => LM + ((v - start) / domain) * plotW
  function densityBins(values) {
    const bins = Array(16).fill(0); const step = rawRange / 16 || 1
    values.forEach(v => { let idx = Math.floor((v - gMin) / step); if (idx < 0) idx = 0; if (idx >= 16) idx = 15; bins[idx]++ })
    return bins.map((c, i) => ({ cx: gMin + step * (i + 0.5), c }))
  }
  const rows = violinData.map((d, idx) => {
    const y = TM + rowH * idx + rowH / 2; const bins = densityBins(d.values); const maxC = Math.max(...bins.map(b => b.c), 1); const halfW = 24
    const pts = bins.map(b => ({ x: xS(b.cx), hw: (b.c / maxC) * halfW }))
    const up = pts.map(p => `${p.x},${y - p.hw}`).join(' L ')
    const dn = [...pts].reverse().map(p => `${p.x},${y + p.hw}`).join(' L ')
    const path = `M ${pts[0].x},${y} L ${up} L ${pts[pts.length - 1].x},${y} L ${dn} Z`
    const meanX = xS(d.mean), medianX = xS(d.median)
    return { name: d.name, y, path, meanX, medianX, meanNR: meanX > W - RM - 92, medNR: medianX > W - RM - 92, n: d.n, meanLabel: formatMetricValue(d.mean, 'imprisonment', 1), medLabel: formatMetricValue(d.median, 'imprisonment', 1), labelLines: wrapTextLines(d.name, 8, 3) }
  })
  const tickData = ticks.filter(t => { const x = xS(t); return x >= LM - 2 && x <= W - RM + 2 }).map(t => ({ x: xS(t), label: formatMetricValue(t, 'imprisonment', 1) }))
  return { W, H, LM, RM, TM, BM, rows, tickData, axisLabel: '刑期（月）' }
}

// Box-whisker SVG builder (from API data: array of { law, n, dominant, q1, median, q3, iqr, whiskerLow, whiskerHigh, outliers, min, max })
function boxSvgData(boxData) {
  if (!boxData?.length) return null
  const LM = 210, RM = 22, TM = 28, BM = 110, rowH = 104, W = 860
  const H = TM + BM + rowH * boxData.length; const plotW = W - LM - RM
  const safeMax = Math.max(1, ...boxData.map(d => Math.max(d.whiskerHigh, ...(d.outliers || []), d.q3)))
  const { ticks, maxTick } = buildNiceTicks(safeMax, 'imprisonment', 6)
  const xS = v => LM + (Math.max(0, v) / maxTick) * plotW
  const rows = boxData.map((d, idx) => {
    const y = TM + rowH * idx + rowH / 2
    const q1X = xS(d.q1), medianX = xS(d.median), q3X = xS(d.q3), wlX = xS(d.whiskerLow), whX = xS(d.whiskerHigh)
    const noteX = Math.min(W - RM - 6, q3X + 12), noteAnc = noteX >= W - RM - 30 ? 'end' : 'start'
    const color = AG_MIT_COLORS[d.dominant] || '#4F86F7'
    return { law: d.law, y, q1X, medianX, q3X, wlX, whX, color, noteX, noteAnc, n: d.n, medLabel: formatMetricValue(d.median, 'imprisonment', 1), iqrLabel: formatMetricValue(d.iqr, 'imprisonment', 1), outlierPts: (d.outliers || []).map(v => ({ cx: xS(v) })), labelLines: wrapTextLines(d.law, 8, 3), boxW: Math.max(2, q3X - q1X) }
  })
  const tickData = ticks.map(t => ({ x: xS(t), label: formatMetricValue(t, 'imprisonment', 1) }))
  const legend = AG_MIT_CATS.map(c => ({ label: c, color: AG_MIT_COLORS[c] }))
  return { W, H, LM, RM, TM, BM, rows, tickData, axisLabel: '刑期（月）', legend }
}

// ═══════════════════════════════════════════════════════════
//  Section 9 — Computed Chart Data
// ═══════════════════════════════════════════════════════════
const charts = computed(() => dashData.value?.charts || {})
const stats = computed(() => dashData.value?.stats || {})
const judgments = computed(() => dashData.value?.judgments || { items: [], total: 0, totalPages: 1 })
const filteredRows = computed(() => dashData.value?.filteredRows || 0)

// Criminal chart computeds
const c2svg = computed(() => {
  if (!charts.value.lawStack) return null
  return stackedBarSvg(charts.value.lawStack)
})
const vSvg = computed(() => {
  if (!charts.value.violin) return null
  return violinSvgData(charts.value.violin)
})
const bSvg = computed(() => {
  if (!charts.value.boxWhisker) return null
  return boxSvgData(charts.value.boxWhisker)
})

// Civil / Nonlitig / Family stacked bar computeds
const stackSvg1 = computed(() => {
  // First stacked bar in non-criminal types
  const ct = activeType.value
  if (ct === 'civil_litigation') return stackedBarSvg(charts.value.lawyerEndingStack)
  if (ct === 'civil_nonlitig') return stackedBarSvg(charts.value.courtActionStack)
  if (ct === 'family_litigation') return stackedBarSvg(charts.value.lawyerCauseStack)
  return null
})
const stackSvg2 = computed(() => {
  if (activeType.value === 'civil_nonlitig') return stackedBarSvg(charts.value.causeEndingStack)
  return null
})

// ═══════════════════════════════════════════════════════════
//  Section 10 — Stats Card Definitions per Type
// ═══════════════════════════════════════════════════════════
const statCards = computed(() => {
  const s = stats.value
  const ct = activeType.value
  if (ct === 'criminal_litigation') return [
    { l: '裁判書篇數', v: s.judgmentCount, a: '#4F86F7' },
    { l: '被告人數', v: s.defendantCount, a: '#F28C52' },
    { l: '犯罪筆數', v: s.crimeCount, a: '#D9A93A' },
    { l: '犯罪法條數', v: s.uniqueLawCount, a: '#35B679' },
  ]
  if (ct === 'civil_litigation') return [
    { l: '裁判書篇數', v: s.judgmentCount, a: '#4F86F7' },
    { l: '律師代理率', v: s.lawyerRate != null ? s.lawyerRate + '%' : '-', a: '#F28C52', raw: true },
  ]
  if (ct === 'civil_nonlitig') return [
    { l: '裁判書篇數', v: s.judgmentCount, a: '#4F86F7' },
  ]
  if (ct === 'family_litigation') return [
    { l: '裁判書篇數', v: s.judgmentCount, a: '#4F86F7' },
    { l: '律師代理率', v: s.lawyerRate != null ? s.lawyerRate + '%' : '-', a: '#F28C52', raw: true },
    { l: '離婚案占比', v: s.divorceRate != null ? s.divorceRate + '%' : '-', a: '#D9A93A', raw: true },
  ]
  return []
})

// ═══════════════════════════════════════════════════════════
//  Section 11 — Chart Layout Definitions per Type
// ═══════════════════════════════════════════════════════════
const chartLayout = computed(() => {
  const ct = activeType.value
  if (ct === 'criminal_litigation') return [
    { type: 'heatmap', key: 'caseHeatmap', title: '案件結構熱度圖', sub: '案件分類 × 終結情形' },
    { type: 'stackedBar', key: 'lawStack', title: '法條量刑結構堆疊圖', sub: '適用加重減輕類型分布' },
    { type: 'violin', key: 'violin', title: '法條有期徒刑分布小提琴圖', sub: '刑期分布、平均值與中位數' },
    { type: 'boxWhisker', key: 'boxWhisker', title: '法條有期徒刑盒鬚圖', sub: '中位數、四分位距與離群值' },
  ]
  if (ct === 'civil_litigation') return [
    { type: 'heatmap', key: 'courtSubjectHeatmap', title: '法院×案由標的熱度圖', sub: '各法院案由標的分布' },
    { type: 'heatmap', key: 'actionSubjectHeatmap', title: '案由動作×標的交叉', sub: '動作與標的交叉分析' },
    { type: 'heatmap', key: 'amountLawyerHeatmap', title: '標的金額×律師代理交叉', sub: '金額級距與律師代理情形' },
    { type: 'stackedBar', key: 'lawyerEndingStack', title: '律師代理×終結堆疊圖', sub: '律師代理情形與終結情形' },
  ]
  if (ct === 'civil_nonlitig') return [
    { type: 'stackedBar', key: 'courtActionStack', title: '法院×案由動作堆疊圖', sub: '各法院案由動作分布' },
    { type: 'heatmap', key: 'actionSubjectHeatmap', title: '動作×標的交叉', sub: '案由動作與標的交叉分析' },
    { type: 'heatmap', key: 'courtEndingHeatmap', title: '法院×終結熱度圖', sub: '各法院終結情形分布' },
    { type: 'stackedBar', key: 'causeEndingStack', title: '案由×終結', sub: '案由大分類與終結情形' },
  ]
  if (ct === 'family_litigation') return [
    { type: 'heatmap', key: 'courtCauseHeatmap', title: '法院×案由熱度圖', sub: '各法院案由分布' },
    { type: 'divorceAnalysis', key: 'divorceAnalysis', title: '離婚案件分析', sub: '離婚原因、主動方與終結情形' },
    { type: 'inheritAnalysis', key: 'inheritAnalysis', title: '繼承案件分析', sub: '繼承案件終結情形分布' },
    { type: 'stackedBar', key: 'lawyerCauseStack', title: '律師×案由堆疊圖', sub: '律師代理情形與案由' },
  ]
  return []
})

// ═══════════════════════════════════════════════════════════
//  Section 12 — Lifecycle
// ═══════════════════════════════════════════════════════════
onMounted(async () => {
  await loadTypes()
  await loadOptions()
  await loadData()
})

watch(activeType, async () => {
  allClear()
  dashData.value = null
  filterOptions.value = {}
  await loadOptions()
  await loadData()
})

watch(pg, () => { loadData() })

function switchType(type) {
  if (type === activeType.value) return
  activeType.value = type
  activeCat.value = CASE_TYPES[type]?.category || 'criminal'
}

// Filter section definitions (computed based on active type)
const filterDefs = computed(() => getFilterDefs(activeType.value))
</script>

<template>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet" />

  <div class="dashboard">
    <!-- Sidebar toggle tab -->
    <div @click="sideOpen = !sideOpen" class="sidebar-tab" :class="{ open: sideOpen }">
      {{ sideOpen ? '◀ 收 起' : '篩 選 ▶' }}
    </div>

    <!-- ██ Sidebar ██ -->
    <div class="sidebar" :style="{ width: sideOpen ? '320px' : '0', minWidth: sideOpen ? '320px' : '0' }">
      <div class="sidebar-inner">
        <!-- Sticky header -->
        <div class="sidebar-header">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
            <h2 style="font-size:15px;font-weight:700;margin:0;color:#111827">篩選條件</h2>
            <button @click="showFilterTip = !showFilterTip" class="btn-sm">{{ showFilterTip ? '收合' : '？ 說明' }}</button>
          </div>
          <div v-if="showFilterTip" class="filter-tip">
            <strong>篩選邏輯說明</strong><br/>
            ・「+」聯集：符合任一條件即匹配<br/>
            ・「&amp;」交集：須同時符合所有條件<br/>
            ・帶有<span class="locked-star">*</span>的篩選項僅支援聯集(+)<br/>
            ・未顯示之選項表示資料中無此適用
          </div>
          <div style="display:flex;gap:8px">
            <button @click="handleSubmit" class="btn-submit">送出篩選</button>
            <button @click="allClear(); loadData()" class="btn-reset">重置</button>
          </div>
        </div>

        <!-- Scrollable filters -->
        <div class="sidebar-scroll">
          <!-- 終結年月 -->
          <div class="filter-group" v-if="filterOptions.ym?.length">
            <div class="filter-label">終結年月（區間）</div>
            <div style="display:flex;gap:6px;align-items:center">
              <select :value="filters.ym_min || ''" @change="setFilter('ym_min', $event.target.value)" class="sel">
                <option value="">最早</option>
                <option v-for="y in filterOptions.ym" :key="y" :value="y">{{ y.replace('/', '年') + '月' }}</option>
              </select>
              <span style="color:#9ca3af;font-size:11px">～</span>
              <select :value="filters.ym_max || ''" @change="setFilter('ym_max', $event.target.value)" class="sel">
                <option value="">最晚</option>
                <option v-for="y in filterOptions.ym" :key="y" :value="y">{{ y.replace('/', '年') + '月' }}</option>
              </select>
            </div>
          </div>

          <!-- Dynamic filter sections -->
          <div class="acc-group" v-for="section in filterDefs" :key="section.title">
            <div class="section-title" :class="section.color">{{ section.title }}</div>
            <div class="acc-border">
              <template v-for="item in section.items" :key="item.key">
                <div class="acc-item" v-if="filterOptions[item.optsKey]?.length">
                  <div @click="toggleAcc(item.key)" class="acc-trigger">
                    <div style="display:flex;align-items:center;gap:6px">
                      <span class="acc-arrow" :class="{ open: openAcc === item.key }">▶</span>
                      <span class="acc-title">{{ item.label }}</span>
                    </div>
                    <span v-if="getFilter(item.key).length" class="acc-badge">{{ getFilter(item.key).length }}</span>
                  </div>
                  <div v-if="openAcc === item.key" class="acc-body">
                    <div class="filter-label-row">
                      <span class="filter-label">{{ item.label }}</span>
                      <div style="display:flex;align-items:center;gap:4px">
                        <input v-if="filterOptions[item.optsKey].length > 10" type="text" placeholder="搜尋…" :value="getSearch(item.key)" @input="setSearch(item.key, $event.target.value)" class="search-input" />
                        <template v-if="item.canToggle">
                          <div class="logic-switch">
                            <button @click="setLogicMode(item.key, 'or')" :class="{ active: getLogicMode(item.key) === 'or' }" class="logic-or">聯集(+)</button>
                            <button @click="setLogicMode(item.key, 'and')" :class="{ active: getLogicMode(item.key) === 'and' }" class="logic-and">交集(&amp;)</button>
                          </div>
                        </template>
                        <span v-else class="locked-badge" title="此項目僅支援聯集">聯集(+)<span class="locked-star">*</span></span>
                      </div>
                    </div>
                    <div :class="['chip-wrap', { scrollable: filterOptions[item.optsKey].length > 10 }]">
                      <button v-for="o in filteredOptions(filterOptions[item.optsKey], item.key)" :key="o.val"
                        @click="setFilter(item.key, toggleChip(getFilter(item.key), o.val))"
                        :class="['chip', { active: getFilter(item.key).includes(o.val) }]">
                        {{ o.val }} <span class="chip-count">({{ o.count }})</span>
                      </button>
                      <span v-if="filterOptions[item.optsKey].length > 10 && filteredOptions(filterOptions[item.optsKey], item.key).length === 0"
                        style="font-size:10px;color:#9ca3af">無符合的選項</span>
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
      <!-- Header with type tabs -->
      <div class="main-header">
        <h1 style="font-size:22px;font-weight:700;margin:0;color:#0f172a">⚖️ 裁判書量化實證研究平台</h1>
        <div style="display:flex;gap:8px;align-items:center">
          <button @click="handleDL" :disabled="!dashData?.judgments?.items?.length" class="btn-dl">⬇ 下載判決清單</button>
        </div>
      </div>

      <!-- Case type tabs -->
      <div class="type-tabs">
        <template v-for="cat in CATEGORIES" :key="cat.key">
          <template v-for="t in availableTypes.filter(at => CASE_TYPES[at.key]?.category === cat.key)" :key="t.key">
            <button @click="switchType(t.key)" :class="['type-tab', { active: activeType === t.key }]">
              {{ CASE_TYPES[t.key]?.icon }} {{ CASE_TYPES[t.key]?.label }}
              <span class="tab-count">({{ t.rowCount?.toLocaleString() }})</span>
            </button>
          </template>
        </template>
      </div>

      <!-- Filter summary -->
      <div class="filter-summary">🔍 {{ filterSummary }}</div>

      <!-- Loading -->
      <div v-if="loading" class="loading-overlay">載入中…</div>
      <div v-if="error" class="error-bar">{{ error }}</div>

      <!-- Stats -->
      <div class="stats-grid" v-if="dashData">
        <div v-for="s in statCards" :key="s.l" class="stat-card">
          <div class="stat-accent" :style="{ background: s.a }"></div>
          <div class="stat-label">{{ s.l }}</div>
          <div class="stat-value">{{ s.raw ? s.v : (typeof s.v === 'number' ? s.v.toLocaleString() : (s.v ?? '-')) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-accent" style="background:#9ca3af"></div>
          <div class="stat-label">篩選後資料筆數</div>
          <div class="stat-value">{{ filteredRows.toLocaleString() }}</div>
        </div>
      </div>

      <!-- Charts 2x2 grid -->
      <div class="chart-grid" v-if="dashData">
        <template v-for="ch in chartLayout" :key="ch.key">
          <!-- Heatmap -->
          <div class="chart-card" v-if="ch.type === 'heatmap'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <div v-if="!charts[ch.key]?.xLabels?.length" class="no-data">無資料</div>
            <div v-else style="overflow-x:auto">
              <table class="heatmap">
                <thead><tr><th style="width:100px"></th><th v-for="x in charts[ch.key].xLabels" :key="x">{{ x }}</th></tr></thead>
                <tbody><tr v-for="(y, yi) in charts[ch.key].yLabels" :key="y">
                  <td class="hm-label">{{ y }}</td>
                  <td v-for="(x, xi) in charts[ch.key].xLabels" :key="x"
                    :title="`${y} × ${x}：${charts[ch.key].matrix[yi][xi]} 件`"
                    :style="{ background: heatmapColor(charts[ch.key].matrix[yi][xi], charts[ch.key].max), color: (charts[ch.key].matrix[yi][xi] / (charts[ch.key].max || 1)) > 0.5 ? '#fff' : '#111827' }"
                    class="hm-cell">{{ charts[ch.key].matrix[yi][xi] }}</td>
                </tr></tbody>
              </table>
            </div>
          </div>

          <!-- Stacked Bar -->
          <div class="chart-card" v-if="ch.type === 'stackedBar'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <template v-if="charts[ch.key]?.data?.length">
              <svg v-if="stackedBarSvg(charts[ch.key])" :viewBox="`0 0 ${stackedBarSvg(charts[ch.key]).W} ${stackedBarSvg(charts[ch.key]).H}`" width="100%" preserveAspectRatio="xMinYMin meet">
                <template v-for="(row, ri) in stackedBarSvg(charts[ch.key]).rows" :key="ri">
                  <text :x="stackedBarSvg(charts[ch.key]).LM - 6" :y="row.y + 20" text-anchor="end" font-size="11" fill="#111827" font-weight="500">
                    <tspan v-for="(line, li) in row.labelLines" :key="li" :x="stackedBarSvg(charts[ch.key]).LM - 6" :dy="li === 0 ? 0 : 13">{{ line }}</tspan>
                  </text>
                  <rect v-for="b in row.bars" :key="b.seg" :x="b.x" :y="b.y" :width="Math.max(0, b.w)" :height="b.h" :fill="b.fill" rx="2">
                    <title>{{ b.seg }}：{{ fmtPctTenths(b.tenths) }}（{{ b.count }} 件）</title>
                  </rect>
                </template>
                <text v-for="p in [0, 25, 50, 75, 100]" :key="p" :x="stackedBarSvg(charts[ch.key]).LM + (p / 100) * stackedBarSvg(charts[ch.key]).barW" :y="stackedBarSvg(charts[ch.key]).H - 6" text-anchor="middle" font-size="10" fill="#6b7280">{{ p }}%</text>
              </svg>
              <div class="legend-row">
                <div v-for="(seg, si) in charts[ch.key].segments" :key="seg" class="legend-item">
                  <span class="legend-dot" :style="{ background: PALETTE[si % PALETTE.length] }"></span>{{ seg }}
                </div>
              </div>
            </template>
            <div v-else class="no-data">無資料</div>
          </div>

          <!-- Violin (criminal only) -->
          <div class="chart-card" v-if="ch.type === 'violin'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <div v-if="!vSvg" class="no-data">無資料</div>
            <div v-else style="width:100%;overflow-x:auto">
              <svg width="100%" :viewBox="`0 0 ${vSvg.W} ${vSvg.H}`" preserveAspectRatio="xMinYMin meet">
                <template v-for="(t, ti) in vSvg.tickData" :key="ti">
                  <line :x1="t.x" :x2="t.x" :y1="vSvg.TM - 6" :y2="vSvg.H - vSvg.BM + 12" stroke="#e5e7eb" stroke-dasharray="3 3" />
                  <text :x="t.x" :y="vSvg.H - vSvg.BM + 34" text-anchor="middle" font-size="16" fill="#374151" font-weight="600">{{ t.label }}</text>
                </template>
                <text :x="(vSvg.LM + vSvg.W - vSvg.RM) / 2" :y="vSvg.H - 14" text-anchor="middle" font-size="16" fill="#6b7280" font-weight="600">{{ vSvg.axisLabel }}</text>
                <template v-for="d in vSvg.rows" :key="d.name">
                  <text :x="vSvg.LM - 10" :y="d.y" text-anchor="end" font-size="18" fill="#111827" font-weight="600">
                    <tspan v-for="(line, li) in d.labelLines" :key="li" :x="vSvg.LM - 10" :dy="li === 0 ? -14 : 18">{{ line }}</tspan>
                  </text>
                  <line :x1="vSvg.LM" :x2="vSvg.W - vSvg.RM" :y1="d.y" :y2="d.y" stroke="#f1f5f9" />
                  <path :d="d.path" fill="rgba(79,134,247,0.22)" stroke="rgba(79,134,247,0.90)" stroke-width="1.5" />
                  <line :x1="d.medianX" :x2="d.medianX" :y1="d.y - 22" :y2="d.y + 22" stroke="#D9A93A" stroke-width="2.4" />
                  <circle :cx="d.meanX" :cy="d.y" r="4.8" fill="#35B679" stroke="#fff" stroke-width="1.8" />
                  <text :x="d.meanNR ? vSvg.W - vSvg.RM - 6 : Math.min(vSvg.W - vSvg.RM - 6, d.meanX + 10)" :y="d.y - 12" :text-anchor="d.meanNR ? 'end' : 'start'" font-size="15" fill="#059669" font-weight="700">平均 {{ d.meanLabel }}</text>
                  <text :x="d.medNR ? vSvg.W - vSvg.RM - 6 : Math.min(vSvg.W - vSvg.RM - 6, d.medianX + 10)" :y="d.y + 22" :text-anchor="d.medNR ? 'end' : 'start'" font-size="15" fill="#B8860B" font-weight="700">中位 {{ d.medLabel }}</text>
                  <text :x="vSvg.W - vSvg.RM + 8" :y="d.y + 6" text-anchor="start" font-size="15" fill="#374151" font-weight="600">n={{ d.n }}</text>
                </template>
              </svg>
            </div>
          </div>

          <!-- Box-Whisker (criminal only) -->
          <div class="chart-card" v-if="ch.type === 'boxWhisker'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <div v-if="!bSvg" class="no-data">無資料</div>
            <template v-else>
              <div style="width:100%;overflow-x:auto">
                <svg width="100%" :viewBox="`0 0 ${bSvg.W} ${bSvg.H}`" preserveAspectRatio="xMinYMin meet">
                  <template v-for="(t, ti) in bSvg.tickData" :key="ti">
                    <line :x1="t.x" :x2="t.x" :y1="bSvg.TM" :y2="bSvg.H - bSvg.BM + 10" stroke="#e5e7eb" stroke-dasharray="3 3" />
                    <text :x="t.x" :y="bSvg.H - bSvg.BM + 30" text-anchor="middle" font-size="16" fill="#374151" font-weight="600">{{ t.label }}</text>
                  </template>
                  <line :x1="bSvg.LM" :x2="bSvg.W - bSvg.RM" :y1="bSvg.H - bSvg.BM + 10" :y2="bSvg.H - bSvg.BM + 10" stroke="#9ca3af" />
                  <text :x="(bSvg.LM + bSvg.W - bSvg.RM) / 2" :y="bSvg.H - 16" text-anchor="middle" font-size="16" fill="#6b7280" font-weight="600">{{ bSvg.axisLabel }}</text>
                  <template v-for="d in bSvg.rows" :key="d.law">
                    <line :x1="bSvg.LM" :x2="bSvg.W - bSvg.RM" :y1="d.y" :y2="d.y" stroke="#f1f5f9" />
                    <text :x="bSvg.LM - 10" :y="d.y" text-anchor="end" font-size="18" fill="#111827" font-weight="600">
                      <tspan v-for="(line, li) in d.labelLines" :key="li" :x="bSvg.LM - 10" :dy="li === 0 ? -14 : 18">{{ line }}</tspan>
                    </text>
                    <line :x1="d.wlX" :x2="d.whX" :y1="d.y" :y2="d.y" stroke="#111827" stroke-width="1.8" />
                    <line :x1="d.wlX" :x2="d.wlX" :y1="d.y - 10" :y2="d.y + 10" stroke="#111827" stroke-width="1.8" />
                    <line :x1="d.whX" :x2="d.whX" :y1="d.y - 10" :y2="d.y + 10" stroke="#111827" stroke-width="1.8" />
                    <rect :x="d.q1X" :y="d.y - 12" :width="d.boxW" height="24" rx="4" :fill="d.color" opacity="0.88" stroke="#111827" stroke-width="1" />
                    <line :x1="d.medianX" :x2="d.medianX" :y1="d.y - 12" :y2="d.y + 12" stroke="#111827" stroke-width="2.4" />
                    <circle v-for="(ol, oi) in d.outlierPts" :key="oi" :cx="ol.cx" :cy="d.y" r="4.5" fill="#fff" stroke="#111827" stroke-width="1.6" />
                    <text :x="d.noteX" :y="d.y - 12" :text-anchor="d.noteAnc" font-size="15" fill="#111827" font-weight="700">中位 {{ d.medLabel }}</text>
                    <text :x="d.noteX" :y="d.y + 22" :text-anchor="d.noteAnc" font-size="15" fill="#374151" font-weight="700">IQR {{ d.iqrLabel }}</text>
                  </template>
                </svg>
              </div>
              <div v-if="bSvg.legend?.length" class="legend-row" style="margin-top:10px">
                <div v-for="it in bSvg.legend" :key="it.label" class="legend-item"><span class="legend-dot" :style="{ background: it.color }"></span>{{ it.label }}</div>
                <div class="legend-item"><span style="width:12px;height:2px;background:#111827;display:inline-block"></span>中位數</div>
                <div class="legend-item"><span style="width:9px;height:9px;border-radius:999px;border:1.6px solid #111827;background:#fff;display:inline-block"></span>離群值</div>
              </div>
            </template>
          </div>

          <!-- Divorce Analysis (family only) -->
          <div class="chart-card" v-if="ch.type === 'divorceAnalysis'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <div v-if="!charts.divorceAnalysis" class="no-data">無資料</div>
            <template v-else>
              <div style="display:flex;flex-wrap:wrap;gap:16px">
                <!-- Reason distribution -->
                <div v-if="charts.divorceAnalysis.reasonDist?.length" style="flex:1;min-width:200px">
                  <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:#374151">離婚原因</div>
                  <div v-for="item in charts.divorceAnalysis.reasonDist" :key="item.name" class="bar-item">
                    <div class="bar-label">{{ item.name }}</div>
                    <div class="bar-track"><div class="bar-fill" :style="{ width: Math.max(2, item.count / (charts.divorceAnalysis.reasonDist[0]?.count || 1) * 100) + '%' }"></div></div>
                    <div class="bar-count">{{ item.count }}</div>
                  </div>
                </div>
                <!-- Initiator distribution -->
                <div v-if="charts.divorceAnalysis.initiatorDist?.length" style="flex:1;min-width:200px">
                  <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:#374151">主動離婚者</div>
                  <div v-for="item in charts.divorceAnalysis.initiatorDist" :key="item.name" class="bar-item">
                    <div class="bar-label">{{ item.name }}</div>
                    <div class="bar-track"><div class="bar-fill orange" :style="{ width: Math.max(2, item.count / (charts.divorceAnalysis.initiatorDist[0]?.count || 1) * 100) + '%' }"></div></div>
                    <div class="bar-count">{{ item.count }}</div>
                  </div>
                </div>
                <!-- Ending distribution -->
                <div v-if="charts.divorceAnalysis.endingDist?.length" style="flex:1;min-width:200px">
                  <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:#374151">終結情形</div>
                  <div v-for="item in charts.divorceAnalysis.endingDist" :key="item.name" class="bar-item">
                    <div class="bar-label">{{ item.name }}</div>
                    <div class="bar-track"><div class="bar-fill green" :style="{ width: Math.max(2, item.count / (charts.divorceAnalysis.endingDist[0]?.count || 1) * 100) + '%' }"></div></div>
                    <div class="bar-count">{{ item.count }}</div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Inherit Analysis (family only) -->
          <div class="chart-card" v-if="ch.type === 'inheritAnalysis'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <div v-if="!charts.inheritAnalysis?.endingDist?.length" class="no-data">無資料</div>
            <template v-else>
              <div style="font-size:12px;color:#6b7280;margin-bottom:8px">共 {{ charts.inheritAnalysis.total }} 件繼承案件</div>
              <div v-for="item in charts.inheritAnalysis.endingDist" :key="item.name" class="bar-item">
                <div class="bar-label">{{ item.name }}</div>
                <div class="bar-track"><div class="bar-fill" :style="{ width: Math.max(2, item.count / (charts.inheritAnalysis.endingDist[0]?.count || 1) * 100) + '%' }"></div></div>
                <div class="bar-count">{{ item.count }}</div>
              </div>
            </template>
          </div>
        </template>
      </div>

      <!-- ██ Judgment Table ██ -->
      <div class="table-wrap" v-if="dashData">
        <div class="table-header">
          <div style="font-size:14px;font-weight:700;color:#111827">
            判決書列表
            <span style="font-weight:400;color:#6b7280;font-size:12px">
              共 {{ judgments.total?.toLocaleString() }} 篇，第 {{ pg + 1 }} / {{ judgments.totalPages || 1 }} 頁
            </span>
          </div>
          <div style="display:flex;gap:6px">
            <button :disabled="pg === 0" @click="pg--" class="btn-page">‹ 上一頁</button>
            <button :disabled="pg >= (judgments.totalPages || 1) - 1" @click="pg++" class="btn-page">下一頁 ›</button>
          </div>
        </div>
        <div class="table-col-header">
          <div>裁判書 ID</div>
          <div style="text-align:center">法院別</div>
          <div style="text-align:center">案由</div>
          <div style="text-align:center">終結情形</div>
          <div v-if="activeType === 'criminal_litigation'" style="text-align:center">分類</div>
        </div>
        <div v-if="!judgments.items?.length" style="padding:32px;text-align:center;color:#9ca3af;font-size:12px">無符合條件的判決書</div>
        <div v-for="j in judgments.items" :key="j.jid" class="table-row">
          <div class="table-jid"><a :href="JURL + j.jid" target="_blank" rel="noopener noreferrer" class="jid-link">{{ j.jid }}</a></div>
          <div style="font-size:10px;text-align:center">{{ j.court }}</div>
          <div class="table-reason">{{ j.cause }}</div>
          <div style="font-size:10px;text-align:center">{{ j.ending }}</div>
          <div v-if="activeType === 'criminal_litigation'" style="text-align:center;font-size:10px">{{ j.cls }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; margin: 0; padding: 0; }
.dashboard { display: flex; min-height: 100vh; background: #f8fafc; font-family: 'DM Sans','Noto Sans TC',sans-serif; color: #111827; }
.sidebar-tab { width: 28px; min-width: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border-right: 1px solid #d1d5db; transition: all 0.2s; z-index: 10; writing-mode: vertical-rl; font-size: 12px; font-weight: 600; user-select: none; letter-spacing: 3px; background: #1e40af; color: #fff; }
.sidebar-tab.open { background: #f1f5f9; color: #64748b; }
.sidebar-tab:hover { filter: brightness(1.1); }
.sidebar { overflow: hidden; transition: all 0.3s ease; border-right: 1px solid #e5e7eb; background: #fff; flex-shrink: 0; }
.sidebar-inner { width: 320px; height: 100vh; display: flex; flex-direction: column; }
.sidebar-header { padding: 14px 14px 12px; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; background: #fff; z-index: 5; box-shadow: 0 2px 4px rgba(0,0,0,0.03); }
.btn-sm { padding: 3px 10px; border-radius: 999px; border: 1px solid #d1d5db; background: #f9fafb; color: #4b5563; font-size: 10px; cursor: pointer; font-family: inherit; flex-shrink: 0; }
.filter-tip { margin-bottom: 10px; padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fefce8; color: #713f12; font-size: 10px; line-height: 1.6; }
.btn-submit { flex: 1; padding: 9px; border-radius: 8px; border: none; background: #2563eb; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; box-shadow: 0 1px 3px rgba(37,99,235,0.3); }
.btn-reset { padding: 9px 14px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; color: #4b5563; font-size: 13px; cursor: pointer; font-family: inherit; }
.sidebar-scroll { flex: 1; overflow-y: auto; padding: 10px 14px; }
.section-title { font-size: 11px; font-weight: 700; margin-bottom: 6px; padding-bottom: 4px; letter-spacing: 0.5px; border-bottom: 2px solid; margin-top: 10px; }
.section-title.blue { color: #2563eb; border-color: #dbeafe; }
.section-title.orange { color: #ea580c; border-color: #fed7aa; }
.section-title.green { color: #059669; border-color: #bbf7d0; }
.filter-group { margin-bottom: 8px; }
.filter-label-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; }
.filter-label { font-size: 11px; font-weight: 600; color: #374151; white-space: nowrap; }
.locked-badge { display: inline-flex; align-items: center; gap: 2px; padding: 2px 8px; font-size: 10px; border-radius: 999px; border: 1px solid #e5e7eb; background: #f9fafb; color: #9ca3af; cursor: help; flex-shrink: 0; user-select: none; }
.locked-star { color: #dc2626; font-weight: 700; }
.chip-wrap { display: flex; flex-wrap: wrap; gap: 4px; }
.chip-wrap.scrollable { max-height: 120px; overflow-y: auto; }
.chip { padding: 3px 8px; border-radius: 12px; font-size: 10px; cursor: pointer; font-family: inherit; border: 1px solid #d1d5db; background: #fff; color: #4b5563; }
.chip.active { border-color: #4F86F7; background: rgba(79,134,247,0.10); color: #2563eb; }
.chip-count { opacity: 0.55; }
.logic-switch { display: inline-flex; border: 1px solid #d1d5db; border-radius: 999px; overflow: hidden; background: #fff; flex-shrink: 0; }
.logic-switch button { padding: 2px 8px; font-size: 10px; border: none; cursor: pointer; font-family: inherit; background: #fff; color: #6b7280; font-weight: 500; }
.logic-or.active { background: #eff6ff; color: #2563eb; font-weight: 700; }
.logic-and { border-left: 1px solid #d1d5db; }
.logic-and.active { background: #fef3c7; color: #b45309; font-weight: 700; }
.search-input { padding: 2px 6px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; color: #111827; font-size: 10px; font-family: inherit; outline: none; width: 70px; }
.sel { padding: 4px 8px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; color: #111827; font-size: 11px; font-family: inherit; outline: none; width: 100%; }
.acc-group { margin-bottom: 8px; }
.acc-border { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
.acc-item { border-bottom: 1px solid #f1f5f9; }
.acc-item:last-child { border-bottom: none; }
.acc-trigger { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; cursor: pointer; user-select: none; background: #fafbfc; }
.acc-trigger:hover { background: #f1f5f9; }
.acc-arrow { font-size: 8px; color: #9ca3af; transition: transform 0.2s; display: inline-block; }
.acc-arrow.open { transform: rotate(90deg); }
.acc-title { font-size: 11px; font-weight: 600; color: #374151; }
.acc-badge { background: #2563eb; color: #fff; font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 999px; }
.acc-body { padding: 8px 10px; background: #fff; }
.main-area { flex: 1; overflow-y: auto; padding: 20px 24px; min-width: 0; }
.main-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.btn-dl { padding: 8px 16px; border-radius: 8px; border: 1px solid #93c5fd; background: #eff6ff; color: #2563eb; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
.btn-dl:disabled { opacity: 0.4; cursor: not-allowed; }
.type-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.type-tab { padding: 7px 16px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; color: #4b5563; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.2s; }
.type-tab.active { border-color: #2563eb; background: #eff6ff; color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
.type-tab:hover { border-color: #93c5fd; }
.tab-count { font-weight: 400; opacity: 0.6; font-size: 10px; }
.filter-summary { font-size: 11px; color: #4b5563; margin-bottom: 12px; padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; line-height: 1.5; }
.loading-overlay { padding: 40px; text-align: center; color: #6b7280; font-size: 16px; }
.error-bar { padding: 10px 14px; margin-bottom: 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #dc2626; font-size: 12px; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; margin-bottom: 16px; }
.stat-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; position: relative; overflow: hidden; }
.stat-accent { position: absolute; top: 0; left: 0; width: 4px; height: 100%; }
.stat-label { font-size: 10px; color: #6b7280; margin-bottom: 4px; }
.stat-value { font-size: 22px; font-weight: 700; color: #111827; }
.chart-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 14px; margin-bottom: 16px; }
.chart-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; }
.chart-title { font-size: 14px; font-weight: 700; color: #111827; }
.chart-sub { font-size: 11px; color: #6b7280; margin-bottom: 10px; }
.no-data { padding: 32px; text-align: center; color: #9ca3af; font-size: 12px; }
.heatmap { border-collapse: collapse; font-size: 10px; width: 100%; }
.heatmap th { padding: 4px 6px; text-align: center; font-weight: 600; color: #374151; white-space: nowrap; font-size: 9px; border-bottom: 1px solid #e5e7eb; }
.heatmap .hm-label { text-align: right; padding-right: 8px; font-weight: 600; color: #374151; white-space: nowrap; font-size: 10px; }
.heatmap .hm-cell { text-align: center; padding: 4px 2px; font-size: 10px; font-weight: 500; border: 1px solid rgba(255,255,255,0.3); min-width: 32px; }
.legend-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; justify-content: center; }
.legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #4b5563; }
.legend-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.table-wrap { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; }
.table-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
.table-col-header { display: grid; grid-template-columns: 2fr 1fr 2fr 1fr 1fr; padding: 8px 16px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; font-size: 10px; font-weight: 700; color: #6b7280; gap: 8px; }
.table-row { display: grid; grid-template-columns: 2fr 1fr 2fr 1fr 1fr; padding: 8px 16px; border-bottom: 1px solid #f1f5f9; font-size: 11px; gap: 8px; align-items: center; }
.table-row:hover { background: #f8fafc; }
.table-jid { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jid-link { color: #2563eb; text-decoration: none; font-size: 10px; font-weight: 500; }
.jid-link:hover { text-decoration: underline; }
.table-reason { font-size: 10px; color: #4b5563; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn-page { padding: 4px 10px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; color: #4b5563; font-size: 11px; cursor: pointer; font-family: inherit; }
.btn-page:disabled { opacity: 0.4; cursor: not-allowed; }
/* Bar chart items for divorce/inherit analysis */
.bar-item { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.bar-label { font-size: 10px; color: #374151; min-width: 80px; text-align: right; flex-shrink: 0; }
.bar-track { flex: 1; height: 14px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; background: #4F86F7; border-radius: 4px; transition: width 0.3s; }
.bar-fill.orange { background: #F28C52; }
.bar-fill.green { background: #35B679; }
.bar-count { font-size: 10px; color: #6b7280; min-width: 36px; }
</style>
</script>
