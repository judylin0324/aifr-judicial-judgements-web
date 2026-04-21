<script setup>
import { ref, computed, watch, onMounted } from 'vue'

// ═══════════════════════════════════════════════════════════
//  Section 1 — API Configuration
// ═══════════════════════════════════════════════════════════
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
console.log('當前 API 連線位址:', API_BASE)

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
  family_litigation:   { label: '家事訴訟', category: 'family',   icon: '👨‍👩‍👧' },
}
const PALETTE = ['#4F86F7','#F28C52','#35B679','#D9A93A','#E45C5C','#8B5CF6','#06B6D4','#EC4899','#84CC16']
const PIE_COLORS = ['#4F86F7','#F28C52','#35B679','#D9A93A','#E45C5C','#8B5CF6']
const AG_MIT_CATS = ['無加重無減輕','僅有加重法條','僅有減輕法條','有加重有減輕']
const AG_MIT_COLORS = {'無加重無減輕':'#4F86F7','僅有加重法條':'#F28C52','僅有減輕法條':'#35B679','有加重有減輕':'#D9A93A'}
const JURL = 'https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id='

// Taiwan court positions on 400x560 viewBox
const COURT_POS = {
  '基隆地方法院': { x: 320, y: 72 },
  '臺北地方法院': { x: 278, y: 88 },
  '士林地方法院': { x: 290, y: 76 },
  '新北地方法院': { x: 264, y: 98 },
  '桃園地方法院': { x: 235, y: 118 },
  '新竹地方法院': { x: 222, y: 145 },
  '苗栗地方法院': { x: 204, y: 172 },
  '臺中地方法院': { x: 184, y: 208 },
  '南投地方法院': { x: 206, y: 242 },
  '彰化地方法院': { x: 162, y: 228 },
  '雲林地方法院': { x: 146, y: 262 },
  '嘉義地方法院': { x: 152, y: 292 },
  '臺南地方法院': { x: 142, y: 328 },
  '高雄地方法院': { x: 160, y: 368 },
  '橋頭地方法院': { x: 148, y: 352 },
  '屏東地方法院': { x: 178, y: 405 },
  '宜蘭地方法院': { x: 312, y: 126 },
  '花蓮地方法院': { x: 296, y: 218 },
  '臺東地方法院': { x: 256, y: 360 },
  '澎湖地方法院': { x: 58, y: 295 },
  '金門地方法院': { x: 34, y: 145 },
  '連江地方法院': { x: 34, y: 85 },
  '福建金門地方法院': { x: 34, y: 145 },
  '福建連江地方法院': { x: 34, y: 85 },
}

// Taiwan outline SVG path (detailed)
const TW_OUTLINE = "M295,52 C305,48 318,52 328,62 C335,70 332,82 328,92 C324,98 318,108 314,120 C310,132 306,148 302,165 C298,182 294,200 290,218 C286,236 280,254 272,272 C264,290 254,306 242,324 C230,342 218,358 206,374 C194,390 184,406 178,420 C172,434 170,446 168,456 C166,466 168,474 164,482 C160,488 152,486 146,476 C140,466 134,450 128,432 C122,414 118,396 116,376 C114,356 116,338 118,318 C120,298 126,278 132,258 C138,238 146,220 156,202 C166,184 178,168 192,154 C206,140 216,132 226,122 C236,112 246,100 256,88 C266,76 278,62 295,52 Z"
const TW_EAST = "M328,62 C334,72 330,86 326,98 L314,120 L306,148 L300,172 L294,200 L288,228 L280,256 L268,282 L254,308 L240,330 L224,352 L210,372 L198,390 L186,408"

// Heatmap color scale (green → yellow → orange → red)
function heatColor(ratio) {
  const r = Math.max(0, Math.min(1, ratio))
  if (r < 0.25) {
    const t = r / 0.25
    return `rgb(${Math.round(76 + t * 104)},${Math.round(175 + t * 55)},${Math.round(80 - t * 10)})`
  } else if (r < 0.5) {
    const t = (r - 0.25) / 0.25
    return `rgb(${Math.round(180 + t * 60)},${Math.round(230 - t * 50)},${Math.round(70 - t * 30)})`
  } else if (r < 0.75) {
    const t = (r - 0.5) / 0.25
    return `rgb(${Math.round(240 + t * 15)},${Math.round(180 - t * 60)},${Math.round(40 - t * 10)})`
  } else {
    const t = (r - 0.75) / 0.25
    return `rgb(${Math.round(255 - t * 30)},${Math.round(120 - t * 80)},${Math.round(30 + t * 10)})`
  }
}

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

// Pie chart arc path
function pieArc(cx, cy, r, startAngle, endAngle) {
  const s = startAngle - Math.PI / 2, e = endAngle - Math.PI / 2
  const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s)
  const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e)
  const large = endAngle - startAngle > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
}

// ═══════════════════════════════════════════════════════════
//  Section 4 — Filter Definitions per Case Type
// ═══════════════════════════════════════════════════════════
const LOCKED_OR_KEYS = new Set(['cls','court','ending','procedure','probation','cause','lawyer','initiator','divorce_reason','action','subject','lawsuit_type','amount_tier','national_comp','agency_type','comp_type','public_type','election_type'])

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
const filterOptions = ref({})
const dashData = ref(null)
const sideOpen = ref(true)
const openAcc = ref(null)
const searchStates = ref({})
const showFilterTip = ref(false)
function getSearch(key) { return searchStates.value[key] || '' }
function setSearch(key, val) { searchStates.value = { ...searchStates.value, [key]: val } }
function toggleAcc(key) { openAcc.value = openAcc.value === key ? null : key }
const filters = ref({})
const logicModes = ref({})
const appliedFilters = ref(null)
const appliedLogic = ref(null)
const pg = ref(0)
const PG = 10
const expandedJid = ref(null)
function toggleExpand(jid) { expandedJid.value = expandedJid.value === jid ? null : jid }
const mapTooltip = ref({ show: false, x: 0, y: 0, data: null })
// Family map toggle
const familyMapMode = ref('divorce')

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
  filters.value = {}; logicModes.value = {}; appliedFilters.value = null; appliedLogic.value = null
  pg.value = 0; showFilterTip.value = false; searchStates.value = {}; openAcc.value = null; expandedJid.value = null
  familyMapMode.value = 'divorce'
}

// ═══════════════════════════════════════════════════════════
//  Section 6 — Filter Summary
// ═══════════════════════════════════════════════════════════
const filterSummary = computed(() => {
  if (!appliedFilters.value) return '所選條件：全部案件'
  const parts = []
  const af = appliedFilters.value, lg = appliedLogic.value || {}
  for (const section of getFilterDefs(activeType.value)) {
    for (const item of section.items) {
      const sel = af[item.key]
      if (sel?.length) parts.push(`${item.label}：${sel.join((lg[item.key] === 'and') ? '&' : '+')}`)
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
    const first = availableTypes.value.find(t => t.available)
    if (first) { activeType.value = first.key; activeCat.value = CASE_TYPES[first.key]?.category || 'criminal' }
  } catch (e) { error.value = '無法載入案件類型：' + e.message }
}
async function loadOptions() {
  try { filterOptions.value = await api(`/api/${activeType.value}/options`) } catch (e) { error.value = '無法載入篩選選項：' + e.message }
}
async function loadData() {
  loading.value = true; error.value = null
  try {
    const params = {}; const af = appliedFilters.value || {}
    for (const [k, v] of Object.entries(af)) {
      if (k === 'ym_min' || k === 'ym_max') { if (v) params[k] = v }
      else if (Array.isArray(v) && v.length) { params[k] = v.join(',') }
    }
    const lg = appliedLogic.value || {}; const logicParam = {}; let hasLogic = false
    for (const [k, v] of Object.entries(lg)) { if (v === 'and') { logicParam[k] = 'and'; hasLogic = true } }
    if (hasLogic) params.logic = JSON.stringify(logicParam)
    params.page = pg.value; params.page_size = PG
    dashData.value = await api(`/api/${activeType.value}/data`, params)
  } catch (e) { error.value = '無法載入資料：' + e.message } finally { loading.value = false }
}
function handleSubmit() {
  appliedFilters.value = JSON.parse(JSON.stringify({ ...filters.value, ym_min: filters.value.ym_min || '', ym_max: filters.value.ym_max || '' }))
  appliedLogic.value = JSON.parse(JSON.stringify(logicModes.value))
  pg.value = 0; sideOpen.value = false; loadData()
}
function handleDL() {
  if (!dashData.value?.judgments?.items?.length) return
  const jids = dashData.value.judgments.items.map(i => i.jid)
  const csv = '\uFEFF裁判書ID,裁判書全文網址\n' + jids.map(id => `"${id}","${JURL}${id}"`).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a'); a.href = url; a.download = `判決清單_${activeType.value}.csv`; a.click(); URL.revokeObjectURL(url)
}

// ═══════════════════════════════════════════════════════════
//  Section 8 — SVG Chart Builders
// ═══════════════════════════════════════════════════════════
function heatmapColor(val, maxVal, baseColor = '79,134,247') {
  const ratio = val / (maxVal || 1)
  return `rgba(${baseColor},${0.08 + ratio * 0.82})`
}
function stackedBarSvg(chartData) {
  if (!chartData?.data?.length || !chartData?.segments?.length) return null
  const segments = chartData.segments, data = chartData.data
  const LM = 130, RM = 20, TM = 10, rowH = 32, W = 600, H = TM + rowH * data.length + 30, barW = W - LM - RM
  const rows = data.map((d, idx) => {
    const y = TM + rowH * idx; let accX = LM
    const bars = segments.map((seg, si) => {
      const tenths = d[seg] || 0; const w = (tenths / 1000) * barW; const x = accX; accX += w
      return { x, w, y: y + 4, h: rowH - 8, fill: PALETTE[si % PALETTE.length], seg, tenths, count: d.__counts?.[seg] || 0 }
    })
    return { name: d.name, y, bars, labelLines: wrapTextLines(d.name, 9, 2) }
  })
  return { W, H, rows, LM, barW, segments }
}
function dualAxisBarSvg(chartData) {
  if (!chartData?.data?.length || !chartData?.segments?.length) return null
  const data = chartData.data, segments = chartData.segments
  const LM = 100, RM = 40, TM = 20, BM = 50, groupW = 70, gap = 12
  const W = LM + data.length * (groupW + gap) + RM
  const maxCount = Math.max(...data.map(d => d.total), 1)
  const plotH = 260, H = TM + plotH + BM
  const step = Math.max(1, Math.ceil(maxCount / 5 / Math.pow(10, Math.floor(Math.log10(maxCount / 5 || 1)))) * Math.pow(10, Math.floor(Math.log10(maxCount / 5 || 1))))
  const yTicks = []; for (let t = 0; t <= maxCount * 1.1; t += step) yTicks.push(t)
  const yMax = yTicks[yTicks.length - 1] || maxCount
  const yS = v => TM + plotH - (v / yMax) * plotH
  const pctS = v => TM + plotH - (v / 100) * plotH
  const groups = data.map((d, gi) => {
    const gx = LM + gi * (groupW + gap); const segW = groupW / segments.length
    const bars = segments.map((seg, si) => {
      const count = d[seg] || 0; const h = (count / yMax) * plotH
      return { x: gx + si * segW, y: TM + plotH - h, w: Math.max(1, segW - 1), h, fill: PALETTE[si % PALETTE.length], seg, count }
    })
    return { name: d.name, gx, bars, lineX: gx + groupW / 2, lineY: pctS(d.pct), total: d.total, pct: d.pct }
  })
  const linePoints = groups.map(g => `${g.lineX},${g.lineY}`).join(' L ')
  const linePath = groups.length > 1 ? `M ${linePoints}` : ''
  return { W, H, LM, RM, TM, BM, plotH, groups, yTicks, yMax, yS, pctS, segments, linePath }
}
function violinSvgData(violinData) {
  if (!violinData?.length) return null
  const LM = 210, RM = 78, TM = 28, BM = 76, rowH = 104, W = 860
  const H = TM + BM + rowH * violinData.length; const plotW = W - LM - RM
  const allV = violinData.flatMap(d => d.values)
  const gMin = Math.min(...allV), gMax = Math.max(...allV), rawRange = gMax - gMin || 1
  const { ticks, start, end } = buildRangeTicks(gMin, gMax, 'imprisonment', 6)
  const domain = Math.max(1, end - start); const xS = v => LM + ((v - start) / domain) * plotW
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
function boxSvgData(boxData) {
  if (!boxData?.length) return null
  const LM = 210, RM = 22, TM = 28, BM = 110, rowH = 104, W = 860
  const H = TM + BM + rowH * boxData.length; const plotW = W - LM - RM
  const safeMax = Math.max(1, ...boxData.map(d => Math.max(d.whiskerHigh, ...(d.outliers || []), d.q3)))
  const { ticks, maxTick } = buildNiceTicks(safeMax, 'imprisonment', 6); const xS = v => LM + (Math.max(0, v) / maxTick) * plotW
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
const vSvg = computed(() => violinSvgData(charts.value.violin))
const bSvg = computed(() => boxSvgData(charts.value.boxWhisker))

const statCards = computed(() => {
  const s = stats.value, ct = activeType.value
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
  if (ct === 'family_litigation') return [
    { l: '裁判書篇數', v: s.judgmentCount, a: '#4F86F7' },
    { l: '律師代理率', v: s.lawyerRate != null ? s.lawyerRate + '%' : '-', a: '#F28C52', raw: true },
    { l: '離婚案占比', v: s.divorceRate != null ? s.divorceRate + '%' : '-', a: '#D9A93A', raw: true },
  ]
  return []
})

const chartLayout = computed(() => {
  const ct = activeType.value
  if (ct === 'criminal_litigation') return [
    { type: 'heatmap', key: 'caseHeatmap', title: '案件結構熱度圖', sub: '' },
    { type: 'stackedBar', key: 'lawStack', title: '法條量刑結構堆疊圖', sub: '適用加重減輕類型分布' },
    { type: 'violin', key: 'violin', title: '法條有期徒刑分布小提琴圖', sub: '刑期分布、平均值與中位數' },
    { type: 'boxWhisker', key: 'boxWhisker', title: '法條有期徒刑盒鬚圖', sub: '中位數、四分位距與離群值' },
  ]
  if (ct === 'civil_litigation') return [
    { type: 'dualAxisBar', key: 'lawyerEndingBar', title: '律師代理×終結情形', sub: '各律師代理情形案件數與占比' },
    { type: 'taiwanMap', key: 'courtMap', title: '法院案件地圖', sub: '各法院前五案由、律師代理率' },
    { type: 'heatmap', key: 'amountLawyerHeatmap', title: '標的金額×律師代理交叉', sub: '金額級距與律師代理情形' },
    { type: 'heatmap', key: 'actionSubjectHeatmap', title: '案由動作×標的交叉', sub: '動作與標的交叉分析' },
  ]
  if (ct === 'family_litigation') return [
    { type: 'dualAxisBar', key: 'lawyerCauseBar', title: '律師代理×案由', sub: '各律師代理情形案件數與占比' },
    { type: 'causeDist', key: 'causeDist', title: '案件案由分布', sub: '各案由類別案件數' },
    { type: 'familyMap', key: 'courtMap', title: '法院案件地圖', sub: '' },
    { type: 'divorceAnalysis', key: 'divorceAnalysis', title: '離婚案件分析', sub: '主動離婚者與離婚原因交叉' },
  ]
  return []
})

// ═══════════════════════════════════════════════════════════
//  Section 10 — Map Tooltip & Lifecycle
// ═══════════════════════════════════════════════════════════
function showMapTooltip(evt, courtData) {
  const rect = evt.currentTarget.closest('.map-container').getBoundingClientRect()
  mapTooltip.value = { show: true, x: evt.clientX - rect.left + 15, y: evt.clientY - rect.top - 10, data: courtData }
}
function hideMapTooltip() { mapTooltip.value = { show: false, x: 0, y: 0, data: null } }

onMounted(async () => { await loadTypes(); await loadOptions(); await loadData() })
watch(activeType, async () => { allClear(); dashData.value = null; filterOptions.value = {}; await loadOptions(); await loadData() })
watch(pg, () => { loadData() })
function switchType(type) { if (type === activeType.value) return; activeType.value = type; activeCat.value = CASE_TYPES[type]?.category || 'criminal' }
const filterDefs = computed(() => getFilterDefs(activeType.value))
const heatmapTitle = computed(() => charts.value?.caseHeatmap?.heatmapTitle || '案件分類 × 終結情形')

// Computed map data for family toggle
const familyActiveMapData = computed(() => {
  if (familyMapMode.value === 'inherit') return charts.value.inheritCourtMap || []
  return charts.value.divorceCourtMap || []
})
const familyActiveMapTitle = computed(() => familyMapMode.value === 'inherit' ? '繼承案件法院分布' : '離婚案件法院分布')
</script>

<template>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet" />
  <div class="dashboard">
    <div @click="sideOpen = !sideOpen" class="sidebar-tab" :class="{ open: sideOpen }">{{ sideOpen ? '◀ 收 起' : '篩 選 ▶' }}</div>
    <!-- ██ Sidebar ██ -->
    <div class="sidebar" :style="{ width: sideOpen ? '320px' : '0', minWidth: sideOpen ? '320px' : '0' }">
      <div class="sidebar-inner">
        <div class="sidebar-header">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
            <h2 style="font-size:15px;font-weight:700;margin:0;color:#111827">篩選條件</h2>
            <button @click="showFilterTip = !showFilterTip" class="btn-sm">{{ showFilterTip ? '收合' : '？ 說明' }}</button>
          </div>
          <div v-if="showFilterTip" class="filter-tip"><strong>篩選邏輯說明</strong><br/>・「+」聯集：符合任一條件即匹配<br/>・「&amp;」交集：須同時符合所有條件<br/>・帶有<span class="locked-star">*</span>的篩選項僅支援聯集(+)</div>
          <div style="display:flex;gap:8px">
            <button @click="handleSubmit" class="btn-submit">送出篩選</button>
            <button @click="allClear(); loadData()" class="btn-reset">重置</button>
          </div>
        </div>
        <div class="sidebar-scroll">
          <div class="filter-group" v-if="filterOptions.ym?.length">
            <div class="filter-label">終結年月（區間）</div>
            <div style="display:flex;gap:6px;align-items:center">
              <select :value="filters.ym_min || ''" @change="setFilter('ym_min', $event.target.value)" class="sel"><option value="">最早</option><option v-for="y in filterOptions.ym" :key="y" :value="y">{{ y.replace('/', '年') + '月' }}</option></select>
              <span style="color:#9ca3af;font-size:11px">～</span>
              <select :value="filters.ym_max || ''" @change="setFilter('ym_max', $event.target.value)" class="sel"><option value="">最晚</option><option v-for="y in filterOptions.ym" :key="y" :value="y">{{ y.replace('/', '年') + '月' }}</option></select>
            </div>
          </div>
          <div class="acc-group" v-for="section in filterDefs" :key="section.title">
            <div class="section-title" :class="section.color">{{ section.title }}</div>
            <div class="acc-border">
              <template v-for="item in section.items" :key="item.key">
                <div class="acc-item" v-if="filterOptions[item.optsKey]?.length">
                  <div @click="toggleAcc(item.key)" class="acc-trigger">
                    <div style="display:flex;align-items:center;gap:6px"><span class="acc-arrow" :class="{ open: openAcc === item.key }">▶</span><span class="acc-title">{{ item.label }}</span></div>
                    <span v-if="getFilter(item.key).length" class="acc-badge">{{ getFilter(item.key).length }}</span>
                  </div>
                  <div v-if="openAcc === item.key" class="acc-body">
                    <div class="filter-label-row">
                      <span class="filter-label">{{ item.label }}</span>
                      <div style="display:flex;align-items:center;gap:4px">
                        <input v-if="filterOptions[item.optsKey].length > 10" type="text" placeholder="搜尋…" :value="getSearch(item.key)" @input="setSearch(item.key, $event.target.value)" class="search-input" />
                        <template v-if="item.canToggle"><div class="logic-switch"><button @click="setLogicMode(item.key, 'or')" :class="{ active: getLogicMode(item.key) === 'or' }" class="logic-or">聯集(+)</button><button @click="setLogicMode(item.key, 'and')" :class="{ active: getLogicMode(item.key) === 'and' }" class="logic-and">交集(&amp;)</button></div></template>
                        <span v-else class="locked-badge" title="此項目僅支援聯集">聯集(+)<span class="locked-star">*</span></span>
                      </div>
                    </div>
                    <div :class="['chip-wrap', { scrollable: filterOptions[item.optsKey].length > 10 }]">
                      <button v-for="o in filteredOptions(filterOptions[item.optsKey], item.key)" :key="o.val" @click="setFilter(item.key, toggleChip(getFilter(item.key), o.val))" :class="['chip', { active: getFilter(item.key).includes(o.val) }]">{{ o.val }} <span class="chip-count">({{ o.count }})</span></button>
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
      <div class="main-header">
        <h1 style="font-size:22px;font-weight:700;margin:0;color:#0f172a">裁判書量化實證研究平台</h1>
        <button @click="handleDL" :disabled="!dashData?.judgments?.items?.length" class="btn-dl">下載判決清單</button>
      </div>
      <div class="type-tabs">
        <template v-for="cat in CATEGORIES" :key="cat.key">
          <template v-for="t in availableTypes.filter(at => CASE_TYPES[at.key]?.category === cat.key)" :key="t.key">
            <button @click="switchType(t.key)" :class="['type-tab', { active: activeType === t.key }]">{{ CASE_TYPES[t.key]?.icon }} {{ CASE_TYPES[t.key]?.label }} <span class="tab-count">({{ t.rowCount?.toLocaleString() }})</span></button>
          </template>
        </template>
      </div>
      <div class="filter-summary">{{ filterSummary }}</div>
      <div v-if="loading" class="loading-overlay">載入中…</div>
      <div v-if="error" class="error-bar">{{ error }}</div>

      <!-- Stats -->
      <div class="stats-grid" v-if="dashData">
        <div v-for="s in statCards" :key="s.l" class="stat-card"><div class="stat-accent" :style="{ background: s.a }"></div><div class="stat-label">{{ s.l }}</div><div class="stat-value">{{ s.raw ? s.v : (typeof s.v === 'number' ? s.v.toLocaleString() : (s.v ?? '-')) }}</div></div>
      </div>

      <!-- Charts -->
      <div :class="['chart-grid', { 'chart-grid-2col': activeType === 'criminal_litigation' }]" v-if="dashData">
        <template v-for="ch in chartLayout" :key="ch.key">

          <!-- ══ Heatmap ══ -->
          <div class="chart-card" v-if="ch.type === 'heatmap'">
            <div class="chart-title">{{ ch.key === 'caseHeatmap' ? heatmapTitle : ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <div v-if="!charts[ch.key]?.xLabels?.length" class="no-data">無資料</div>
            <div v-else style="overflow-x:auto">
              <table class="heatmap">
                <thead><tr><th style="width:100px"></th><th v-for="x in charts[ch.key].xLabels" :key="x" class="hm-col-header">{{ x }}</th></tr></thead>
                <tbody><tr v-for="(y, yi) in charts[ch.key].yLabels" :key="y">
                  <td class="hm-label">{{ y }}</td>
                  <td v-for="(x, xi) in charts[ch.key].xLabels" :key="x" :title="`${y} × ${x}：${charts[ch.key].matrix[yi][xi]} 件`"
                    :style="{ background: heatmapColor(charts[ch.key].matrix[yi][xi], charts[ch.key].max), color: (charts[ch.key].matrix[yi][xi] / (charts[ch.key].max || 1)) > 0.5 ? '#fff' : '#111827' }"
                    class="hm-cell">{{ charts[ch.key].matrix[yi][xi] }}</td>
                </tr></tbody>
              </table>
            </div>
          </div>

          <!-- ══ Stacked Bar ══ -->
          <div class="chart-card" v-if="ch.type === 'stackedBar'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <template v-if="charts[ch.key]?.data?.length">
              <svg v-if="stackedBarSvg(charts[ch.key])" :viewBox="`0 0 ${stackedBarSvg(charts[ch.key]).W} ${stackedBarSvg(charts[ch.key]).H}`" width="100%" preserveAspectRatio="xMinYMin meet">
                <template v-for="(row, ri) in stackedBarSvg(charts[ch.key]).rows" :key="ri">
                  <text :x="stackedBarSvg(charts[ch.key]).LM - 6" :y="row.y + 20" text-anchor="end" font-size="11" fill="#111827" font-weight="500"><tspan v-for="(line, li) in row.labelLines" :key="li" :x="stackedBarSvg(charts[ch.key]).LM - 6" :dy="li === 0 ? 0 : 13">{{ line }}</tspan></text>
                  <rect v-for="b in row.bars" :key="b.seg" :x="b.x" :y="b.y" :width="Math.max(0, b.w)" :height="b.h" :fill="b.fill" rx="2"><title>{{ b.seg }}：{{ fmtPctTenths(b.tenths) }}（{{ b.count }} 件）</title></rect>
                </template>
                <text v-for="p in [0, 25, 50, 75, 100]" :key="p" :x="stackedBarSvg(charts[ch.key]).LM + (p / 100) * stackedBarSvg(charts[ch.key]).barW" :y="stackedBarSvg(charts[ch.key]).H - 6" text-anchor="middle" font-size="10" fill="#6b7280">{{ p }}%</text>
              </svg>
              <div class="legend-row"><div v-for="(seg, si) in charts[ch.key].segments" :key="seg" class="legend-item"><span class="legend-dot" :style="{ background: PALETTE[si % PALETTE.length] }"></span>{{ seg }}</div></div>
            </template>
            <div v-else class="no-data">無資料</div>
          </div>

          <!-- ══ Dual-Axis Bar ══ -->
          <div class="chart-card" v-if="ch.type === 'dualAxisBar'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <template v-if="charts[ch.key]?.data?.length">
              <div style="width:100%;overflow-x:auto" v-if="dualAxisBarSvg(charts[ch.key])">
                <svg width="100%" :viewBox="`0 0 ${dualAxisBarSvg(charts[ch.key]).W} ${dualAxisBarSvg(charts[ch.key]).H}`" preserveAspectRatio="xMinYMin meet">
                  <template v-for="(t, ti) in dualAxisBarSvg(charts[ch.key]).yTicks" :key="'yt'+ti">
                    <line :x1="dualAxisBarSvg(charts[ch.key]).LM" :x2="dualAxisBarSvg(charts[ch.key]).W - dualAxisBarSvg(charts[ch.key]).RM" :y1="dualAxisBarSvg(charts[ch.key]).yS(t)" :y2="dualAxisBarSvg(charts[ch.key]).yS(t)" stroke="#e5e7eb" stroke-dasharray="3 3" />
                    <text :x="dualAxisBarSvg(charts[ch.key]).LM - 8" :y="dualAxisBarSvg(charts[ch.key]).yS(t) + 4" text-anchor="end" font-size="10" fill="#6b7280">{{ t.toLocaleString() }}</text>
                  </template>
                  <template v-for="(g, gi) in dualAxisBarSvg(charts[ch.key]).groups" :key="'g'+gi">
                    <rect v-for="b in g.bars" :key="b.seg" :x="b.x" :y="b.y" :width="b.w" :height="b.h" :fill="b.fill" rx="2"><title>{{ g.name }} - {{ b.seg }}：{{ b.count.toLocaleString() }} 件</title></rect>
                    <text :x="g.gx + 35" :y="dualAxisBarSvg(charts[ch.key]).TM + dualAxisBarSvg(charts[ch.key]).plotH + 16" text-anchor="middle" font-size="10" fill="#374151" font-weight="500"><tspan v-for="(line, li) in wrapTextLines(g.name, 6, 2)" :key="li" :x="g.gx + 35" :dy="li === 0 ? 0 : 12">{{ line }}</tspan></text>
                  </template>
                  <path v-if="dualAxisBarSvg(charts[ch.key]).linePath" :d="dualAxisBarSvg(charts[ch.key]).linePath" fill="none" stroke="#E45C5C" stroke-width="2.5" stroke-linejoin="round" />
                  <template v-for="(g, gi) in dualAxisBarSvg(charts[ch.key]).groups" :key="'dot'+gi">
                    <circle :cx="g.lineX" :cy="g.lineY" r="4" fill="#E45C5C" stroke="#fff" stroke-width="1.5" />
                    <text :x="g.lineX" :y="g.lineY - 8" text-anchor="middle" font-size="9" fill="#E45C5C" font-weight="700">{{ g.pct }}%</text>
                  </template>
                </svg>
              </div>
              <div class="legend-row">
                <div v-for="(seg, si) in charts[ch.key].segments" :key="seg" class="legend-item"><span class="legend-dot" :style="{ background: PALETTE[si % PALETTE.length] }"></span>{{ seg }}</div>
                <div class="legend-item"><span style="width:16px;height:3px;background:#E45C5C;display:inline-block;border-radius:2px"></span> 占比線</div>
              </div>
            </template>
            <div v-else class="no-data">無資料</div>
          </div>

          <!-- ══ Taiwan Map (civil) ══ -->
          <div class="chart-card" v-if="ch.type === 'taiwanMap'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <div v-if="!charts[ch.key]?.length" class="no-data">無資料</div>
            <div v-else class="map-container">
              <svg viewBox="0 0 400 520" width="100%" style="max-width:480px;margin:0 auto;display:block">
                <defs>
                  <filter id="shadow"><feDropShadow dx="1" dy="1" stdDeviation="2" flood-opacity="0.15"/></filter>
                  <linearGradient id="seaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e8f4fd"/><stop offset="100%" stop-color="#d0e8f8"/></linearGradient>
                </defs>
                <rect width="400" height="520" fill="url(#seaGrad)" rx="12"/>
                <path :d="TW_OUTLINE" fill="#f0f4e8" stroke="#8faa7a" stroke-width="1.8" filter="url(#shadow)"/>
                <template v-for="court in charts[ch.key]" :key="court.court">
                  <g v-if="COURT_POS[court.court]" @mouseenter="showMapTooltip($event, court)" @mouseleave="hideMapTooltip" style="cursor:pointer">
                    <circle :cx="COURT_POS[court.court].x" :cy="COURT_POS[court.court].y" :r="Math.max(8, Math.min(26, Math.sqrt(court.pct) * 7))"
                      :fill="heatColor(court.pct / Math.max(...charts[ch.key].map(c => c.pct)))" :stroke="heatColor(Math.min(1, court.pct / Math.max(...charts[ch.key].map(c => c.pct)) + 0.2))" stroke-width="2" opacity="0.85"/>
                    <text :x="COURT_POS[court.court].x" :y="COURT_POS[court.court].y + Math.max(8, Math.min(26, Math.sqrt(court.pct) * 7)) + 12" text-anchor="middle" font-size="9" fill="#374151" font-weight="600">{{ court.court.replace('地方法院','') }}</text>
                  </g>
                </template>
              </svg>
              <!-- Color legend -->
              <div class="map-legend">
                <span style="font-size:9px;color:#6b7280">少</span>
                <div class="map-legend-bar"></div>
                <span style="font-size:9px;color:#6b7280">多</span>
              </div>
              <!-- Tooltip -->
              <div v-if="mapTooltip.show && mapTooltip.data" class="map-tooltip" :style="{ left: mapTooltip.x + 'px', top: mapTooltip.y + 'px' }">
                <div class="tooltip-title">{{ mapTooltip.data.court }}</div>
                <div class="tooltip-row">案件數：{{ mapTooltip.data.count.toLocaleString() }}（{{ mapTooltip.data.pct }}%）</div>
                <div v-if="mapTooltip.data.lawyerRate !== undefined" class="tooltip-row">律師代理率：{{ mapTooltip.data.lawyerRate }}%</div>
                <div v-if="mapTooltip.data.topCats?.length" class="tooltip-cats">
                  <div class="tooltip-cat-title">主要案由：</div>
                  <div v-for="cat in mapTooltip.data.topCats" :key="cat.name" class="tooltip-cat">{{ cat.name }}：{{ cat.count }}（{{ cat.pct }}%）</div>
                </div>
              </div>
            </div>
          </div>

          <!-- ══ Family Map (divorce/inherit toggle) ══ -->
          <div class="chart-card" v-if="ch.type === 'familyMap'">
            <div class="chart-title">{{ familyActiveMapTitle }}</div>
            <div style="display:flex;gap:6px;margin-bottom:8px">
              <button @click="familyMapMode = 'divorce'" :class="['map-toggle-btn', { active: familyMapMode === 'divorce' }]">離婚案件</button>
              <button @click="familyMapMode = 'inherit'" :class="['map-toggle-btn', { active: familyMapMode === 'inherit' }]">繼承案件</button>
            </div>
            <div v-if="!familyActiveMapData?.length" class="no-data">無資料</div>
            <div v-else class="map-container">
              <svg viewBox="0 0 400 520" width="100%" style="max-width:480px;margin:0 auto;display:block">
                <defs><filter id="shadow2"><feDropShadow dx="1" dy="1" stdDeviation="2" flood-opacity="0.15"/></filter><linearGradient id="seaGrad2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e8f4fd"/><stop offset="100%" stop-color="#d0e8f8"/></linearGradient></defs>
                <rect width="400" height="520" fill="url(#seaGrad2)" rx="12"/>
                <path :d="TW_OUTLINE" fill="#f0f4e8" stroke="#8faa7a" stroke-width="1.8" filter="url(#shadow2)"/>
                <template v-for="court in familyActiveMapData" :key="court.court">
                  <g v-if="COURT_POS[court.court]" @mouseenter="showMapTooltip($event, court)" @mouseleave="hideMapTooltip" style="cursor:pointer">
                    <circle :cx="COURT_POS[court.court].x" :cy="COURT_POS[court.court].y" :r="Math.max(8, Math.min(26, Math.sqrt(court.pct) * 7))"
                      :fill="heatColor(court.pct / Math.max(...familyActiveMapData.map(c => c.pct)))" stroke-width="2" :stroke="heatColor(Math.min(1, court.pct / Math.max(...familyActiveMapData.map(c => c.pct)) + 0.2))" opacity="0.85"/>
                    <text :x="COURT_POS[court.court].x" :y="COURT_POS[court.court].y + Math.max(8, Math.min(26, Math.sqrt(court.pct) * 7)) + 12" text-anchor="middle" font-size="9" fill="#374151" font-weight="600">{{ court.court.replace('地方法院','') }}</text>
                  </g>
                </template>
              </svg>
              <div class="map-legend"><span style="font-size:9px;color:#6b7280">少</span><div class="map-legend-bar"></div><span style="font-size:9px;color:#6b7280">多</span></div>
              <div v-if="mapTooltip.show && mapTooltip.data" class="map-tooltip" :style="{ left: mapTooltip.x + 'px', top: mapTooltip.y + 'px' }">
                <div class="tooltip-title">{{ mapTooltip.data.court }}</div>
                <div class="tooltip-row">案件數：{{ mapTooltip.data.count.toLocaleString() }}（{{ mapTooltip.data.pct }}%）</div>
                <div v-if="mapTooltip.data.lawyerRate !== undefined" class="tooltip-row">律師代理率：{{ mapTooltip.data.lawyerRate }}%</div>
                <!-- Divorce: initiator lawyer rates -->
                <template v-if="familyMapMode === 'divorce' && mapTooltip.data.initiatorLawyerRates">
                  <div class="tooltip-cat-title" style="margin-top:4px">主動離婚者請律師比率：</div>
                  <div v-for="(rate, init) in mapTooltip.data.initiatorLawyerRates" :key="init" class="tooltip-cat">{{ init }}：{{ rate }}%</div>
                </template>
              </div>
            </div>
          </div>

          <!-- ══ Cause Distribution (family) ══ -->
          <div class="chart-card" v-if="ch.type === 'causeDist'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <div v-if="!charts.causeDist?.length" class="no-data">無資料</div>
            <template v-else>
              <div v-for="(item, idx) in charts.causeDist" :key="item.name" class="bar-item">
                <div class="bar-label">{{ item.name }}</div>
                <div class="bar-track"><div class="bar-fill" :style="{ width: Math.max(2, item.count / (charts.causeDist[0]?.count || 1) * 100) + '%', background: PALETTE[idx % PALETTE.length] }"></div></div>
                <div class="bar-count">{{ item.count.toLocaleString() }}</div>
              </div>
            </template>
          </div>

          <!-- ══ Violin ══ -->
          <div class="chart-card" v-if="ch.type === 'violin'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <div v-if="!vSvg" class="no-data">無資料</div>
            <div v-else style="width:100%;overflow-x:auto">
              <svg width="100%" :viewBox="`0 0 ${vSvg.W} ${vSvg.H}`" preserveAspectRatio="xMinYMin meet">
                <template v-for="(t, ti) in vSvg.tickData" :key="ti"><line :x1="t.x" :x2="t.x" :y1="vSvg.TM - 6" :y2="vSvg.H - vSvg.BM + 12" stroke="#e5e7eb" stroke-dasharray="3 3" /><text :x="t.x" :y="vSvg.H - vSvg.BM + 34" text-anchor="middle" font-size="16" fill="#374151" font-weight="600">{{ t.label }}</text></template>
                <text :x="(vSvg.LM + vSvg.W - vSvg.RM) / 2" :y="vSvg.H - 14" text-anchor="middle" font-size="16" fill="#6b7280" font-weight="600">{{ vSvg.axisLabel }}</text>
                <template v-for="d in vSvg.rows" :key="d.name">
                  <text :x="vSvg.LM - 10" :y="d.y" text-anchor="end" font-size="18" fill="#111827" font-weight="600"><tspan v-for="(line, li) in d.labelLines" :key="li" :x="vSvg.LM - 10" :dy="li === 0 ? -14 : 18">{{ line }}</tspan></text>
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

          <!-- ══ Box-Whisker ══ -->
          <div class="chart-card" v-if="ch.type === 'boxWhisker'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <div v-if="!bSvg" class="no-data">無資料</div>
            <template v-else>
              <div style="width:100%;overflow-x:auto">
                <svg width="100%" :viewBox="`0 0 ${bSvg.W} ${bSvg.H}`" preserveAspectRatio="xMinYMin meet">
                  <template v-for="(t, ti) in bSvg.tickData" :key="ti"><line :x1="t.x" :x2="t.x" :y1="bSvg.TM" :y2="bSvg.H - bSvg.BM + 10" stroke="#e5e7eb" stroke-dasharray="3 3" /><text :x="t.x" :y="bSvg.H - bSvg.BM + 30" text-anchor="middle" font-size="16" fill="#374151" font-weight="600">{{ t.label }}</text></template>
                  <line :x1="bSvg.LM" :x2="bSvg.W - bSvg.RM" :y1="bSvg.H - bSvg.BM + 10" :y2="bSvg.H - bSvg.BM + 10" stroke="#9ca3af" />
                  <text :x="(bSvg.LM + bSvg.W - bSvg.RM) / 2" :y="bSvg.H - 16" text-anchor="middle" font-size="16" fill="#6b7280" font-weight="600">{{ bSvg.axisLabel }}</text>
                  <template v-for="d in bSvg.rows" :key="d.law">
                    <line :x1="bSvg.LM" :x2="bSvg.W - bSvg.RM" :y1="d.y" :y2="d.y" stroke="#f1f5f9" />
                    <text :x="bSvg.LM - 10" :y="d.y" text-anchor="end" font-size="18" fill="#111827" font-weight="600"><tspan v-for="(line, li) in d.labelLines" :key="li" :x="bSvg.LM - 10" :dy="li === 0 ? -14 : 18">{{ line }}</tspan></text>
                    <line :x1="d.wlX" :x2="d.whX" :y1="d.y" :y2="d.y" stroke="#111827" stroke-width="1.8" /><line :x1="d.wlX" :x2="d.wlX" :y1="d.y - 10" :y2="d.y + 10" stroke="#111827" stroke-width="1.8" /><line :x1="d.whX" :x2="d.whX" :y1="d.y - 10" :y2="d.y + 10" stroke="#111827" stroke-width="1.8" />
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

          <!-- ══ Divorce Analysis (family) ══ -->
          <div class="chart-card" v-if="ch.type === 'divorceAnalysis'">
            <div class="chart-title">{{ ch.title }}</div>
            <div class="chart-sub">{{ ch.sub }}</div>
            <div v-if="!charts.divorceAnalysis" class="no-data">無資料</div>
            <template v-else>
              <!-- Pie chart: initiator distribution -->
              <div v-if="charts.divorceAnalysis.initiatorDist?.length" style="display:flex;align-items:center;gap:20px;margin-bottom:16px;flex-wrap:wrap">
                <svg width="160" height="160" viewBox="0 0 160 160">
                  <template v-for="(item, idx) in charts.divorceAnalysis.initiatorDist" :key="item.name">
                    <path :d="pieArc(80, 80, 70,
                      charts.divorceAnalysis.initiatorDist.slice(0, idx).reduce((a, b) => a + b.count, 0) / charts.divorceAnalysis.initiatorDist.reduce((a, b) => a + b.count, 0) * Math.PI * 2,
                      charts.divorceAnalysis.initiatorDist.slice(0, idx + 1).reduce((a, b) => a + b.count, 0) / charts.divorceAnalysis.initiatorDist.reduce((a, b) => a + b.count, 0) * Math.PI * 2)"
                      :fill="PIE_COLORS[idx % PIE_COLORS.length]" stroke="#fff" stroke-width="2" opacity="0.85">
                      <title>{{ item.name }}：{{ item.count }} 件</title>
                    </path>
                  </template>
                  <text x="80" y="78" text-anchor="middle" font-size="11" fill="#374151" font-weight="700">主動</text>
                  <text x="80" y="92" text-anchor="middle" font-size="11" fill="#374151" font-weight="700">離婚者</text>
                </svg>
                <div>
                  <div v-for="(item, idx) in charts.divorceAnalysis.initiatorDist" :key="item.name" style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                    <span class="legend-dot" :style="{ background: PIE_COLORS[idx % PIE_COLORS.length] }"></span>
                    <span style="font-size:12px;color:#374151;font-weight:600">{{ item.name }}</span>
                    <span style="font-size:11px;color:#6b7280">{{ item.count }} 件（{{ (item.count / charts.divorceAnalysis.initiatorDist.reduce((a, b) => a + b.count, 0) * 100).toFixed(1) }}%）</span>
                  </div>
                </div>
              </div>
              <!-- Cross analysis: for each initiator, stacked bar of reason × ending -->
              <div v-if="charts.divorceAnalysis.crossAnalysis?.length">
                <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:8px">主動離婚者 × 離婚原因 × 終結情形</div>
                <div v-for="cross in charts.divorceAnalysis.crossAnalysis" :key="cross.initiator" style="margin-bottom:12px">
                  <div style="font-size:11px;font-weight:700;color:#2563eb;margin-bottom:4px">{{ cross.initiator }}</div>
                  <template v-if="cross.stack?.data?.length">
                    <svg v-if="stackedBarSvg(cross.stack)" :viewBox="`0 0 ${stackedBarSvg(cross.stack).W} ${stackedBarSvg(cross.stack).H}`" width="100%" preserveAspectRatio="xMinYMin meet">
                      <template v-for="(row, ri) in stackedBarSvg(cross.stack).rows" :key="ri">
                        <text :x="stackedBarSvg(cross.stack).LM - 6" :y="row.y + 20" text-anchor="end" font-size="10" fill="#111827" font-weight="500"><tspan v-for="(line, li) in row.labelLines" :key="li" :x="stackedBarSvg(cross.stack).LM - 6" :dy="li === 0 ? 0 : 12">{{ line }}</tspan></text>
                        <rect v-for="b in row.bars" :key="b.seg" :x="b.x" :y="b.y" :width="Math.max(0, b.w)" :height="b.h" :fill="b.fill" rx="2"><title>{{ b.seg }}：{{ fmtPctTenths(b.tenths) }}（{{ b.count }} 件）</title></rect>
                      </template>
                    </svg>
                  </template>
                </div>
                <div class="legend-row" v-if="charts.divorceAnalysis.crossAnalysis[0]?.stack?.segments">
                  <div v-for="(seg, si) in charts.divorceAnalysis.crossAnalysis[0].stack.segments" :key="seg" class="legend-item"><span class="legend-dot" :style="{ background: PALETTE[si % PALETTE.length] }"></span>{{ seg }}</div>
                </div>
              </div>
            </template>
          </div>

        </template>
      </div>

      <!-- ██ Judgment Table ██ -->
      <div class="table-wrap" v-if="dashData">
        <div class="table-header">
          <div style="font-size:14px;font-weight:700;color:#111827">判決書列表 <span style="font-weight:400;color:#6b7280;font-size:12px">共 {{ judgments.total?.toLocaleString() }} 篇，第 {{ pg + 1 }} / {{ judgments.totalPages || 1 }} 頁</span></div>
          <div style="display:flex;gap:6px"><button :disabled="pg === 0" @click="pg--" class="btn-page">‹ 上一頁</button><button :disabled="pg >= (judgments.totalPages || 1) - 1" @click="pg++" class="btn-page">下一頁 ›</button></div>
        </div>
        <div :class="['table-col-header', activeType === 'criminal_litigation' ? 'grid-criminal' : 'grid-civil']">
          <div>裁判書 ID</div><div style="text-align:center">法院別</div><div style="text-align:center">案由</div><div style="text-align:center">終結情形</div>
          <div v-if="activeType === 'criminal_litigation'" style="text-align:center">分類</div>
          <div v-if="activeType !== 'criminal_litigation'" style="text-align:center">律師</div>
        </div>
        <div v-if="!judgments.items?.length" style="padding:32px;text-align:center;color:#9ca3af;font-size:12px">無符合條件的判決書</div>
        <template v-for="j in judgments.items" :key="j.jid">
          <div :class="['table-row', activeType === 'criminal_litigation' ? 'grid-criminal' : 'grid-civil', { expanded: expandedJid === j.jid }]" @click="toggleExpand(j.jid)" style="cursor:pointer">
            <div class="table-jid"><span class="expand-icon">{{ expandedJid === j.jid ? '▼' : '▶' }}</span><a :href="JURL + j.jid" target="_blank" rel="noopener noreferrer" class="jid-link" @click.stop>{{ j.jid }}</a></div>
            <div style="font-size:10px;text-align:center">{{ j.court }}</div><div class="table-reason">{{ j.cause }}</div><div style="font-size:10px;text-align:center">{{ j.ending }}</div>
            <div v-if="activeType === 'criminal_litigation'" style="text-align:center;font-size:10px">{{ j.cls }}</div>
            <div v-if="activeType !== 'criminal_litigation'" style="text-align:center;font-size:10px">{{ j.lawyer }}</div>
          </div>
          <div v-if="expandedJid === j.jid" class="detail-row">
            <template v-if="activeType === 'criminal_litigation'">
              <div class="detail-grid">
                <div class="detail-item" v-if="j.law"><span class="detail-key">定罪法條</span><span class="detail-val">{{ j.law }}</span></div>
                <div class="detail-item" v-if="j.result"><span class="detail-key">裁判結果</span><span class="detail-val">{{ j.result }}</span></div>
                <div class="detail-item" v-if="j.sentence"><span class="detail-key">宣告刑期</span><span class="detail-val">{{ j.sentence }}</span></div>
                <div class="detail-item"><span class="detail-key">緩刑</span><span class="detail-val">{{ j.probation ? '有' : '無' }}</span></div>
                <div class="detail-item" v-if="j.defense"><span class="detail-key">辯護代理</span><span class="detail-val">{{ j.defense }}</span></div>
                <div class="detail-item" v-if="j.defendants"><span class="detail-key">被告人數</span><span class="detail-val">{{ j.defendants }}</span></div>
              </div>
              <div v-if="j.tags?.length" class="detail-tags"><span v-for="tag in j.tags" :key="tag" class="detail-tag">{{ tag }}</span></div>
            </template>
            <template v-else-if="activeType === 'civil_litigation'">
              <div class="detail-grid">
                <div class="detail-item" v-if="j.causeCat"><span class="detail-key">案由分類</span><span class="detail-val">{{ j.causeCat }}</span></div>
                <div class="detail-item" v-if="j.lawyer"><span class="detail-key">律師代理</span><span class="detail-val">{{ j.lawyer }}</span></div>
                <div class="detail-item" v-if="j.amountTier"><span class="detail-key">標的金額級距</span><span class="detail-val">{{ j.amountTier }}</span></div>
                <div class="detail-item" v-if="j.amount"><span class="detail-key">標的金額</span><span class="detail-val">{{ j.amount }}</span></div>
              </div>
            </template>
            <template v-else-if="activeType === 'family_litigation'">
              <div class="detail-grid">
                <div class="detail-item" v-if="j.causeCat"><span class="detail-key">案由分類</span><span class="detail-val">{{ j.causeCat }}</span></div>
                <div class="detail-item" v-if="j.lawyer"><span class="detail-key">律師代理</span><span class="detail-val">{{ j.lawyer }}</span></div>
                <div class="detail-item" v-if="j.initiator"><span class="detail-key">主動離婚者</span><span class="detail-val">{{ j.initiator }}</span></div>
                <div class="detail-item" v-if="j.divorceReason"><span class="detail-key">離婚原因</span><span class="detail-val">{{ j.divorceReason }}</span></div>
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; margin: 0; padding: 0; }
.dashboard { display: flex; min-height: 100vh; background: #f8fafc; font-family: 'DM Sans','Noto Sans TC',sans-serif; color: #111827; }
.sidebar-tab { width: 28px; min-width: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border-right: 1px solid #d1d5db; transition: all 0.2s; z-index: 10; writing-mode: vertical-rl; font-size: 12px; font-weight: 600; user-select: none; letter-spacing: 3px; background: #1e40af; color: #fff; }
.sidebar-tab.open { background: #f1f5f9; color: #64748b; }
.sidebar { overflow: hidden; transition: all 0.3s ease; border-right: 1px solid #e5e7eb; background: #fff; flex-shrink: 0; }
.sidebar-inner { width: 320px; height: 100vh; display: flex; flex-direction: column; }
.sidebar-header { padding: 14px 14px 12px; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; background: #fff; z-index: 5; box-shadow: 0 2px 4px rgba(0,0,0,0.03); }
.btn-sm { padding: 3px 10px; border-radius: 999px; border: 1px solid #d1d5db; background: #f9fafb; color: #4b5563; font-size: 10px; cursor: pointer; font-family: inherit; }
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
.locked-badge { display: inline-flex; align-items: center; gap: 2px; padding: 2px 8px; font-size: 10px; border-radius: 999px; border: 1px solid #e5e7eb; background: #f9fafb; color: #9ca3af; cursor: help; flex-shrink: 0; }
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
.chart-grid-2col { grid-template-columns: repeat(2, 1fr); }
@media (max-width: 900px) { .chart-grid-2col { grid-template-columns: 1fr; } }
.chart-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; }
.chart-title { font-size: 14px; font-weight: 700; color: #111827; }
.chart-sub { font-size: 11px; color: #6b7280; margin-bottom: 10px; }
.no-data { padding: 32px; text-align: center; color: #9ca3af; font-size: 12px; }
.heatmap { border-collapse: collapse; font-size: 10px; width: 100%; table-layout: auto; }
.heatmap th { padding: 4px 6px; text-align: center; font-weight: 600; color: #374151; font-size: 9px; border-bottom: 1px solid #e5e7eb; }
.hm-col-header { white-space: normal; word-break: break-all; max-width: 60px; min-width: 36px; line-height: 1.3; }
.heatmap .hm-label { text-align: right; padding-right: 8px; font-weight: 600; color: #374151; white-space: nowrap; font-size: 10px; }
.heatmap .hm-cell { text-align: center; padding: 4px 2px; font-size: 10px; font-weight: 500; border: 1px solid rgba(255,255,255,0.3); min-width: 32px; }
.legend-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; justify-content: center; }
.legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #4b5563; }
.legend-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.table-wrap { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; max-width: 1000px; margin: 0 auto; }
.table-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
.table-col-header { display: grid; padding: 8px 16px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; font-size: 10px; font-weight: 700; color: #6b7280; gap: 8px; }
.grid-criminal { grid-template-columns: 2.5fr 1fr 2fr 1fr 0.8fr; }
.grid-civil { grid-template-columns: 2.5fr 1fr 2fr 1fr 1fr; }
.table-row { display: grid; padding: 8px 16px; border-bottom: 1px solid #f1f5f9; font-size: 11px; gap: 8px; align-items: center; }
.table-row:hover { background: #f8fafc; }
.table-row.expanded { background: #eff6ff; }
.table-jid { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 4px; }
.expand-icon { font-size: 8px; color: #9ca3af; flex-shrink: 0; width: 10px; }
.jid-link { color: #2563eb; text-decoration: none; font-size: 10px; font-weight: 500; }
.jid-link:hover { text-decoration: underline; }
.table-reason { font-size: 10px; color: #4b5563; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.btn-page { padding: 4px 10px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; color: #4b5563; font-size: 11px; cursor: pointer; font-family: inherit; }
.btn-page:disabled { opacity: 0.4; cursor: not-allowed; }
.detail-row { padding: 10px 16px 10px 32px; background: #f0f7ff; border-bottom: 1px solid #dbeafe; }
.detail-grid { display: flex; flex-wrap: wrap; gap: 8px 20px; }
.detail-item { display: flex; align-items: center; gap: 4px; }
.detail-key { font-size: 10px; color: #6b7280; font-weight: 600; }
.detail-val { font-size: 10px; color: #111827; }
.detail-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.detail-tag { padding: 2px 8px; border-radius: 999px; font-size: 9px; background: #dbeafe; color: #1e40af; font-weight: 600; }
.map-container { position: relative; }
.map-tooltip { position: absolute; z-index: 100; background: #fff; border: 1px solid #d1d5db; border-radius: 10px; padding: 10px 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); pointer-events: none; min-width: 200px; max-width: 300px; }
.tooltip-title { font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 4px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
.tooltip-row { font-size: 11px; color: #374151; margin-bottom: 2px; }
.tooltip-cats { margin-top: 6px; }
.tooltip-cat-title { font-size: 10px; font-weight: 700; color: #6b7280; margin-bottom: 2px; }
.tooltip-cat { font-size: 10px; color: #374151; margin-bottom: 1px; }
.map-legend { display: flex; align-items: center; gap: 6px; justify-content: center; margin-top: 8px; }
.map-legend-bar { width: 120px; height: 10px; border-radius: 5px; background: linear-gradient(to right, rgb(76,175,80), rgb(240,230,60), rgb(255,120,40), rgb(220,40,40)); }
.map-toggle-btn { padding: 4px 14px; border-radius: 999px; border: 1px solid #d1d5db; background: #fff; color: #6b7280; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.2s; }
.map-toggle-btn.active { border-color: #2563eb; background: #eff6ff; color: #2563eb; }
.bar-item { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.bar-label { font-size: 10px; color: #374151; min-width: 80px; text-align: right; flex-shrink: 0; }
.bar-track { flex: 1; height: 16px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
.bar-count { font-size: 10px; color: #6b7280; min-width: 50px; }
</style>
