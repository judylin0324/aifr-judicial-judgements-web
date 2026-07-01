import { useState, useEffect, useMemo, useRef } from 'react'
import TaiwanCourtBubbleMap from './TaiwanCourtBubbleMap.jsx'
import './styles.css'

// ═══════════ API ═══════════
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
async function api(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v)
  })
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ═══════════ Constants ═══════════
const CATEGORIES = [
  { key: 'criminal', label: '刑事' },
  { key: 'civil', label: '民事' },
  { key: 'family', label: '家事' },
]
const CASE_TYPES = {
  criminal_litigation: { label: '刑事訴訟', category: 'criminal', icon: '⚖️' },
  civil_litigation: { label: '民事訴訟', category: 'civil', icon: '📋' },
  family_litigation: { label: '家事訴訟', category: 'family', icon: '👨‍👩‍👧' },
}
const PALETTE = ['#4F86F7', '#F28C52', '#35B679', '#D9A93A', '#E45C5C', '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16']
const PASTEL = ['#93C5FD', '#FCA5A5', '#86EFAC', '#FDE68A', '#C4B5FD', '#67E8F9', '#FBCFE8', '#BEF264']
const FAMILY_BAR_COLORS = ['#F59E0B', '#FB923C', '#FBBF24', '#F97316', '#FCD34D']
const INITIATOR_LINE_COLORS = {
  '不同性別-男方': '#3B82F6', '不同性別-女方': '#EC4899', '雙方': '#8B5CF6', '相同性別-一方': '#14B8A6',
  '男方': '#3B82F6', '女方': '#EC4899',
}
const INITIATOR_FALLBACK = ['#14B8A6', '#F59E0B', '#6366F1', '#10B981', '#0EA5E9']
function initColor(name, idx = 0) { return INITIATOR_LINE_COLORS[name] || INITIATOR_FALLBACK[idx % INITIATOR_FALLBACK.length] }
function linePt(v) { if (v == null) return null; return typeof v === 'number' ? { rate: v, n: null, withL: null } : v }
const JURL = 'https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id='

// ═══════════ Utilities ═══════════
function fmtPctTenths(t) { const n = Number(t || 0); return n % 10 === 0 ? `${n / 10}%` : `${(n / 10).toFixed(1)}%` }
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
function getMetricBaseStep(mode, maxVal) { const safe = Math.max(1, maxVal || 1); if (mode === 'imprisonment') return 12; if (mode === 'detention') return 5; if (mode === 'fine') { if (safe <= 2000) return 100; if (safe <= 20000) return 1000; if (safe <= 200000) return 10000; return 50000 } return 1 }
function buildRangeTicks(minVal, maxVal, mode, target = 6) { const safeMin = Math.max(0, minVal ?? 0), safeMax = Math.max(safeMin + 1, maxVal ?? 1); const base = getMetricBaseStep(mode, safeMax); const step = Math.max(base, Math.ceil(Math.max(safeMax - safeMin, safeMax) / target / base) * base); let start = Math.floor(safeMin / step) * step, end = Math.ceil(safeMax / step) * step; if (start === end) end = start + step; const ticks = []; for (let t = start; t <= end + 1e-9; t += step) ticks.push(Number(t.toFixed(10))); return { ticks, start, end, step } }
function pieArc(cx, cy, r, startAngle, endAngle) {
  const s = startAngle - Math.PI / 2, e = endAngle - Math.PI / 2
  const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s)
  const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e)
  const large = endAngle - startAngle > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
}
function simpleBarMax(data) { return Math.max(...data.map(d => d.total), 1) }
function simpleBarTicks(data, mult, target = 4) {
  const maxT = Math.max(...data.map(d => d.total), 1)
  const step = Math.max(1, Math.ceil(maxT / target / Math.pow(10, Math.floor(Math.log10(maxT / target || 1)))) * Math.pow(10, Math.floor(Math.log10(maxT / target || 1))))
  const ticks = []; for (let t = 0; t <= maxT * mult; t += step) ticks.push(t)
  return ticks
}

// ═══════════ Filter definitions ═══════════
const LOCKED_OR_KEYS = new Set(['cls', 'court', 'case_char', 'ending', 'procedure', 'probation', 'cause', 'lawyer', 'initiator', 'divorce_reason', 'action', 'subject', 'suit_type', 'lawsuit_type', 'amount_tier', 'national_comp', 'agency_type', 'comp_type', 'public_type', 'election_type'])
function getFilterDefs(caseType) {
  if (caseType === 'criminal_litigation') return [
    { title: '案件資訊', color: 'blue', items: [{ key: 'cls', label: '案件分類', optsKey: 'classes' }, { key: 'court', label: '法院別', optsKey: 'courts' }, { key: 'case_char', label: '案號字別', optsKey: 'caseChars' }, { key: 'ending', label: '全案終結情形', optsKey: 'endings' }] },
    { title: '被告資訊', color: 'orange', items: [{ key: 'defense', label: '辯護及代理', optsKey: 'defs' }, { key: 'security', label: '保安處分', optsKey: 'security', canToggle: true }, { key: 'procedure', label: '裁判程序', optsKey: 'procs' }, { key: 'compensation', label: '賠償對象', optsKey: 'compensation', canToggle: true }, { key: 'confiscation', label: '沒收', optsKey: 'confiscation', canToggle: true }, { key: 'probation', label: '宣告緩刑', optsKey: 'probs' }, { key: 'probcond', label: '緩刑條件', optsKey: 'probcond', canToggle: true }, { key: 'dv', label: '家暴相關', optsKey: 'dv', canToggle: true }] },
    { title: '罪刑資訊', color: 'green', items: [{ key: 'article', label: '定罪法條', optsKey: 'articles', canToggle: true }, { key: 'crime_flags', label: '罪犯類型', optsKey: 'crimeFlags', canToggle: true }, { key: 'aggravation', label: '量刑加重事由', optsKey: 'aggr', canToggle: true }, { key: 'mitigation', label: '量刑減輕事由', optsKey: 'miti', canToggle: true }, { key: 'result', label: '罪名裁判結果', optsKey: 'results', canToggle: true }] },
  ]
  if (caseType === 'civil_litigation') return [
    { title: '案件資訊', color: 'blue', items: [{ key: 'court', label: '法院別', optsKey: 'courts' }, { key: 'case_char', label: '案號字別', optsKey: 'caseChars' }, { key: 'ending', label: '終結情形', optsKey: 'endings' }, { key: 'suit_type', label: '案由（訴訟種類）', optsKey: 'suitTypes' }, { key: 'lawsuit_type', label: '訴訟標的類別', optsKey: 'lawsuitTypes' }, { key: 'amount_tier', label: '金額級距', optsKey: 'amountTiers' }] },
    { title: '當事人資訊', color: 'orange', items: [{ key: 'lawyer', label: '律師代理情形', optsKey: 'lawyers' }, { key: 'national_comp', label: '是否國賠事件', optsKey: 'nationalComp' }, { key: 'agency_type', label: '被請求機關類別', optsKey: 'agencyTypes' }, { key: 'comp_type', label: '賠償類別', optsKey: 'compTypes' }, { key: 'public_type', label: '公職類別', optsKey: 'publicTypes' }, { key: 'election_type', label: '選舉類別', optsKey: 'electionTypes' }] },
  ]
  if (caseType === 'family_litigation') return [
    { title: '案件資訊', color: 'blue', items: [{ key: 'court', label: '法院別', optsKey: 'courts' }, { key: 'case_char', label: '案號字別', optsKey: 'caseChars' }, { key: 'ending', label: '終結情形', optsKey: 'endings' }, { key: 'cause', label: '案由', optsKey: 'causes' }] },
    { title: '當事人資訊', color: 'orange', items: [{ key: 'lawyer', label: '律師代理情形', optsKey: 'lawyers' }, { key: 'initiator', label: '主動離婚者', optsKey: 'initiators' }, { key: 'divorce_reason', label: '離婚原因', optsKey: 'divorceReasons' }] },
  ]
  return []
}

// ═══════════ SVG chart builders ═══════════
function heatmapColor(val, maxVal, baseColor = '79,134,247') { const ratio = val / (maxVal || 1); return `rgba(${baseColor},${0.08 + ratio * 0.82})` }
function stackedBarSvg(chartData, matchH = 0) {
  if (!chartData?.data?.length || !chartData?.segments?.length) return null
  const segments = chartData.segments, data = chartData.data
  const LM = 210, RM = 78, TM = 28, BM = 76, W = 860
  const barW = W - LM - RM
  const H = matchH > 0 ? matchH : (TM + 104 * data.length + BM)
  const rowSpace = (H - TM - BM) / data.length
  const barH = Math.min(rowSpace * 0.6, 40)
  const rows = data.map((d) => {
    const yCenter = TM + rowSpace * data.indexOf(d) + rowSpace / 2
    const y = yCenter - barH / 2
    let accX = LM
    const bars = segments.map((seg, si) => {
      const tenths = d[seg] || 0; const w = (tenths / 1000) * barW; const x = accX; accX += w
      return { x, w, y, h: barH, fill: PALETTE[si % PALETTE.length], seg, tenths, count: d.__counts?.[seg] || 0 }
    })
    return { name: d.name, yCenter, bars, labelLines: wrapTextLines(d.name, 9, 2) }
  })
  return { W, H, rows, LM, RM, TM, BM, barW, segments }
}
function dualAxisBarSvg(chartData) {
  if (!chartData?.data?.length || !chartData?.segments?.length) return null
  const data = chartData.data, segments = chartData.segments
  const LM = 100, RM = 40, TM = 20, BM = 50, groupW = 70, gap = 12
  const W = LM + data.length * (groupW + gap) + RM
  const maxCount = Math.max(...data.flatMap(d => segments.map(seg => Number(d[seg]) || 0)), 1)
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
function arrMin(a) { let m = Infinity; for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return m }
function arrMax(a) { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m }
function violinSvgData(violinData) {
  if (!violinData?.length) return null
  const LM = 210, RM = 78, TM = 28, BM = 76, rowH = 104, W = 860
  const H = TM + BM + rowH * violinData.length; const plotW = W - LM - RM
  const allV = violinData.flatMap(d => d.values)
  if (!allV.length) return null
  const gMin = arrMin(allV), gMax = arrMax(allV)
  const { ticks, start, end } = buildRangeTicks(gMin, gMax, 'imprisonment', 6)
  const domain = Math.max(1, end - start); const xS = v => LM + ((v - start) / domain) * plotW
  function densityBins(values) {
    const vMin = arrMin(values), vMax = arrMax(values), vRange = vMax - vMin || 1
    const bins = Array(20).fill(0); const step = vRange / 20 || 1
    values.forEach(v => { let idx = Math.floor((v - vMin) / step); if (idx < 0) idx = 0; if (idx >= 20) idx = 19; bins[idx]++ })
    return bins.map((c, i) => ({ cx: vMin + step * (i + 0.5), c }))
  }
  const rows = violinData.map((d, idx) => {
    const y = TM + rowH * idx + rowH / 2; const bins = densityBins(d.values); const maxC = Math.max(...bins.map(b => b.c), 1); const halfW = 28
    const pts = bins.map(b => ({ x: xS(b.cx), hw: (b.c / maxC) * halfW }))
    const up = pts.map(p => `${p.x},${y - p.hw}`).join(' L ')
    const dn = [...pts].reverse().map(p => `${p.x},${y + p.hw}`).join(' L ')
    const path = `M ${pts[0].x},${y} L ${up} L ${pts[pts.length - 1].x},${y} L ${dn} Z`
    const meanX = xS(d.mean), medianX = xS(d.median)
    const outlierPts = (d.outliers || []).map(v => ({ cx: Math.max(LM + 2, Math.min(W - RM - 2, xS(v))), val: v }))
    const outlierCount = d.outlierCount || (d.outliers || []).length
    return { name: d.name, y, path, meanX, medianX, meanNR: meanX > W - RM - 92, medNR: medianX > W - RM - 92, n: d.n, meanLabel: formatMetricValue(d.mean, 'imprisonment', 1), medLabel: formatMetricValue(d.median, 'imprisonment', 1), labelLines: wrapTextLines(d.name, 8, 3), outlierPts, outlierCount }
  })
  const tickData = ticks.filter(t => { const x = xS(t); return x >= LM - 2 && x <= W - RM + 2 }).map(t => ({ x: xS(t), label: formatMetricValue(t, 'imprisonment', 1) }))
  return { W, H, LM, RM, TM, BM, rows, tickData, axisLabel: '刑期（月）' }
}

// ═══════════ Component ═══════════
export default function App() {
  const [activeCat, setActiveCat] = useState('criminal')
  const [activeType, setActiveType] = useState('criminal_litigation')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [availableTypes, setAvailableTypes] = useState([])
  const [filterOptions, setFilterOptions] = useState({})
  const [dashData, setDashData] = useState(null)
  const [sideOpen, setSideOpen] = useState(true)
  const [openAcc, setOpenAcc] = useState(null)
  const [searchStates, setSearchStates] = useState({})
  const [showFilterTip, setShowFilterTip] = useState(false)
  const [filters, setFilters] = useState({})
  const [logicModes, setLogicModes] = useState({})
  const [appliedFilters, setAppliedFilters] = useState(null)
  const [appliedLogic, setAppliedLogic] = useState(null)
  const [pg, setPg] = useState(0)
  const PG = 10
  const [expandedJid, setExpandedJid] = useState(null)
  const [familyMapMode, setFamilyMapMode] = useState('divorce')
  const [showDocs, setShowDocs] = useState(false)

  // ── filter helpers ──
  const getSearch = (key) => searchStates[key] || ''
  const setSearch = (key, val) => setSearchStates(s => ({ ...s, [key]: val }))
  const toggleAcc = (key) => setOpenAcc(o => (o === key ? null : key))
  const getFilter = (key) => filters[key] || []
  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val }))
  const toggleChip = (arr, val) => { const s = new Set(arr || []); s.has(val) ? s.delete(val) : s.add(val); return [...s] }
  const getLogicMode = (key) => (LOCKED_OR_KEYS.has(key) ? 'or' : (logicModes[key] || 'or'))
  const setLogicMode = (key, val) => setLogicModes(m => ({ ...m, [key]: LOCKED_OR_KEYS.has(key) ? 'or' : val }))
  function filteredOptions(options, searchKey) {
    if (!options?.length) return []
    const q = getSearch(searchKey)?.trim()?.toLowerCase()
    if (!q) return options
    return options.filter(o => o.val.toLowerCase().includes(q))
  }
  function selectAllMatching(optsKey, key) {
    const matching = filteredOptions(filterOptions[optsKey], key).map(o => o.val)
    if (!matching.length) return
    setFilter(key, [...new Set([...getFilter(key), ...matching])])
  }
  function allClear() {
    setFilters({}); setLogicModes({}); setAppliedFilters(null); setAppliedLogic(null)
    setPg(0); setShowFilterTip(false); setSearchStates({}); setOpenAcc(null); setExpandedJid(null); setFamilyMapMode('divorce')
  }

  // ── API ──
  async function loadTypes() {
    try {
      const types = await api('/api/types'); setAvailableTypes(types)
      const first = types.find(t => t.available)
      if (first) { setActiveType(first.key); setActiveCat(CASE_TYPES[first.key]?.category || 'criminal'); return first.key }
    } catch (e) { setError('無法載入案件類型：' + e.message) }
    return activeType
  }
  async function loadOptions(ct) { try { setFilterOptions(await api(`/api/${ct}/options`)) } catch (e) { setError('無法載入篩選選項：' + e.message) } }
  async function runLoad(ct, applied, appliedLg, page, opts = {}) {
    setLoading(true); setError(null)
    try {
      const params = {}; const af = applied || {}
      for (const [k, v] of Object.entries(af)) {
        if (k === 'ym_min' || k === 'ym_max') { if (v) params[k] = v }
        else if (Array.isArray(v) && v.length) params[k] = v.join(',')
      }
      const lg = appliedLg || {}; const logicParam = {}; let hasLogic = false
      for (const [k, v] of Object.entries(lg)) if (v === 'and') { logicParam[k] = 'and'; hasLogic = true }
      if (hasLogic) params.logic = JSON.stringify(logicParam)
      params.page = page; params.page_size = PG
      if (opts.auto) params.auto = 1
      setDashData(await api(`/api/${ct}/data`, params))
    } catch (e) { setError('無法載入資料：' + e.message) } finally { setLoading(false) }
  }

  // mount
  useEffect(() => {
    (async () => {
      const ct = await loadTypes()
      await loadOptions(ct)
      await runLoad(ct, null, null, 0, { auto: true })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit() {
    const af = { ...filters, ym_min: filters.ym_min || '', ym_max: filters.ym_max || '' }
    const lg = { ...logicModes }
    setAppliedFilters(af); setAppliedLogic(lg); setPg(0); setSideOpen(false)
    runLoad(activeType, af, lg, 0, {})
  }
  function handleReset() { allClear(); runLoad(activeType, null, null, 0, {}) }
  function handleDL() {
    if (!dashData?.judgments?.items?.length) return
    const jids = dashData.judgments.items.map(i => i.jid)
    const csv = '﻿裁判書ID,裁判書全文網址\n' + jids.map(id => `"${id}","${JURL}${id}"`).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a'); a.href = url; a.download = `判決清單_${activeType}.csv`; a.click(); URL.revokeObjectURL(url)
  }
  async function switchType(type) {
    if (type === activeType) return
    setActiveType(type); setActiveCat(CASE_TYPES[type]?.category || 'criminal'); setSideOpen(true)
    allClear(); setDashData(null); setFilterOptions({})
    await loadOptions(type); await runLoad(type, null, null, 0, {})
  }
  function goPage(np) { setPg(np); runLoad(activeType, appliedFilters, appliedLogic, np, {}) }
  const toggleExpand = (jid) => setExpandedJid(e => (e === jid ? null : jid))

  // ── derived ──
  const charts = useMemo(() => {
    if (!dashData?.charts) return {}
    const rawCharts = JSON.parse(JSON.stringify(dashData.charts))
    if (rawCharts.actionSubjectHeatmap && rawCharts.actionSubjectHeatmap.xLabels) {
      const hm = rawCharts.actionSubjectHeatmap
      const xIdx = hm.xLabels.indexOf('塗銷')
      if (xIdx > -1) { hm.xLabels.splice(xIdx, 1); hm.matrix.forEach(row => row.splice(xIdx, 1)) }
      const yIdx = hm.yLabels.indexOf('塗銷')
      if (yIdx > -1) { hm.yLabels.splice(yIdx, 1); hm.matrix.splice(yIdx, 1) }
      hm.max = hm.matrix.reduce((max, row) => Math.max(max, ...row), 0)
    }
    return rawCharts
  }, [dashData])

  const stats = dashData?.stats || {}
  const judgments = dashData?.judgments || { items: [], total: 0, totalPages: 1 }
  const vSvg = useMemo(() => violinSvgData(charts.violin), [charts])
  const filterDefs = getFilterDefs(activeType)

  const statCards = (() => {
    const s = stats, ct = activeType
    if (ct === 'criminal_litigation') return [{ l: '裁判書篇數', v: s.judgmentCount, a: '#4F86F7' }, { l: '被告人數', v: s.defendantCount, a: '#F28C52' }, { l: '犯罪筆數', v: s.crimeCount, a: '#D9A93A' }, { l: '犯罪法條數', v: s.uniqueLawCount, a: '#35B679' }]
    if (ct === 'civil_litigation') return [{ l: '裁判書篇數', v: s.judgmentCount, a: '#4F86F7' }, { l: '律師代理率', v: s.lawyerRate != null ? s.lawyerRate + '%' : '-', a: '#F28C52', raw: true }]
    if (ct === 'family_litigation') return [{ l: '裁判書篇數', v: s.judgmentCount, a: '#4F86F7' }, { l: '律師代理率', v: s.lawyerRate != null ? s.lawyerRate + '%' : '-', a: '#F28C52', raw: true }, { l: '離婚案占比', v: s.divorceRate != null ? s.divorceRate + '%' : '-', a: '#D9A93A', raw: true }]
    return []
  })()

  const chartLayout = (() => {
    const ct = activeType
    if (ct === 'criminal_litigation') return [
      { type: 'courtClassBar', key: 'courtClassBar', title: '案件分類 × 法院別', sub: '各法院案件分類堆疊分布圖（由北到南排序）' },
      { type: 'violin', key: 'violin', title: '定罪法條之刑期分布小提琴圖', sub: '刑期分布、平均值、中位數與離群值(超出 1.5×IQR)' },
      { type: 'stackedBar', key: 'lawStack', title: '量刑結構堆疊圖', sub: '適用加重減輕類型之分布' },
    ]
    if (ct === 'civil_litigation') return [
      { type: 'lawyerRateMap', key: 'lawyerRateMap', title: '各法院律師代理率分布', sub: '各地區法院案件之其律師代理率（非全體法院占比）' },
      { type: 'lawyerEndingAndAmount', key: 'lawyerEndingBar', title: '律師代理×終結情形', sub: '律師代理之終結情形與其占比' },
      { type: 'causeBar', key: 'causeSuitDist', title: '案由分布（訴訟種類）', sub: '依司法院統計處「地方法院民事第一審終結事件訴訟種類」分類' },
    ]
    if (ct === 'family_litigation') return [
      { type: 'dualAxisBar', key: 'lawyerCauseBar', title: '律師代理×案由', sub: '律師代理情形之案件分布' },
      { type: 'causeAndPie', key: 'causeDist', title: '案件案由分布', sub: '各案由類別案件數' },
      { type: 'familyCourtBar', key: 'divorceCourtBar', title: '各法院離婚案件分布', sub: '各法院離婚案件數與主動離婚者請律師代理率' },
    ]
    return []
  })()

  const familyActiveCourtBar = familyMapMode === 'inherit'
    ? (charts.inheritCourtBar || { courts: [], segments: [], data: [], lawyerLines: {} })
    : (charts.divorceCourtBar || { courts: [], segments: [], data: [], lawyerLines: {} })
  const familyActiveBarTitle = familyMapMode === 'inherit' ? '繼承案件法院分布' : '離婚案件法院分布'
  const familyActiveBarSub = familyMapMode === 'inherit' ? '各法院繼承案件數與律師代理率' : '各法院離婚案件數與主動離婚者律師代理率（男方/女方/雙方）'

  const filterSummary = (() => {
    if (!appliedFilters) return '所選條件：全部案件'
    const parts = []; const af = appliedFilters, lg = appliedLogic || {}
    for (const section of getFilterDefs(activeType)) {
      for (const item of section.items) {
        const sel = af[item.key]
        if (sel?.length) parts.push(`${item.label}：${sel.join(lg[item.key] === 'and' ? '&' : '+')}`)
      }
    }
    if (af.ym_min || af.ym_max) {
      const from = af.ym_min ? af.ym_min.replace('/', '年') + '月' : '最早'
      const to = af.ym_max ? af.ym_max.replace('/', '年') + '月' : '最晚'
      parts.push(`終結年月：${from}～${to}`)
    }
    return parts.length ? '所選條件：' + parts.join('，') : '所選條件：全部案件'
  })()

  // ═══════════ render ═══════════
  return (
    <div className={'dashboard' + (loading ? ' is-loading' : '')}>
      <div onClick={() => setSideOpen(o => !o)} className={'sidebar-tab' + (sideOpen ? ' open' : '')}>{sideOpen ? '◀ 收 起' : '篩 選 ▶'}</div>

      {/* Sidebar */}
      <div className="sidebar" style={{ width: sideOpen ? '320px' : '0', minWidth: sideOpen ? '320px' : '0' }}>
        <div className="sidebar-inner">
          {/* 第一層：案件類型 */}
          <div className="sidebar-header">
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', marginBottom: '8px', letterSpacing: '0.5px' }}>案件類型</div>
            <div className="side-type-tabs">
              {CATEGORIES.map(cat => availableTypes.filter(at => CASE_TYPES[at.key]?.category === cat.key).map(t => (
                <button key={t.key} onClick={() => switchType(t.key)} className={`type-tab tab-${cat.key}` + (activeType === t.key ? ' active' : '')}>{CASE_TYPES[t.key]?.icon} {CASE_TYPES[t.key]?.label} <span className="tab-count">({t.rowCount?.toLocaleString()})</span></button>
              )))}
            </div>
          </div>
          {/* 第二層：篩選條件 */}
          <div className="sidebar-scroll">
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>篩選條件</div>
            {filterOptions.ym?.length > 0 && (
              <div className="filter-group">
                <div className="filter-label-row">
                  <span className="filter-label">終結年月（區間）</span>
                  <button onClick={() => setShowFilterTip(t => !t)} className="btn-sm">{showFilterTip ? '收合' : '？ 說明'}</button>
                </div>
                {showFilterTip && (
                  <div className="filter-tip"><strong>篩選邏輯說明</strong><br />・「+」聯集：符合任一條件即匹配<br />・「&amp;」交集：須同時符合所有條件<br />・帶有<span className="locked-star">*</span>的篩選項僅支援聯集(+)</div>
                )}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <select value={filters.ym_min || ''} onChange={(e) => setFilter('ym_min', e.target.value)} className="sel"><option value="">最早</option>{filterOptions.ym.map(y => <option key={y} value={y}>{y.replace('/', '年') + '月'}</option>)}</select>
                  <span style={{ color: '#9ca3af', fontSize: '11px' }}>～</span>
                  <select value={filters.ym_max || ''} onChange={(e) => setFilter('ym_max', e.target.value)} className="sel"><option value="">最晚</option>{filterOptions.ym.map(y => <option key={y} value={y}>{y.replace('/', '年') + '月'}</option>)}</select>
                </div>
              </div>
            )}
            {filterDefs.map(section => (
              <div className="acc-group" key={section.title}>
                <div className={'section-title ' + section.color}>{section.title}</div>
                <div className="acc-border">
                  {section.items.map(item => (filterOptions[item.optsKey]?.length ? (
                    <div className="acc-item" key={item.key}>
                      <div onClick={() => toggleAcc(item.key)} className="acc-trigger">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span className={'acc-arrow' + (openAcc === item.key ? ' open' : '')}>▶</span><span className="acc-title">{item.label}</span></div>
                        {getFilter(item.key).length > 0 && <span className="acc-badge">{getFilter(item.key).length}</span>}
                      </div>
                      {openAcc === item.key && (
                        <div className="acc-body">
                          <div className="filter-label-row">
                            <span className="filter-label">{item.label}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {filterOptions[item.optsKey].length > 10 && <input type="text" placeholder="搜尋…" value={getSearch(item.key)} onChange={(e) => setSearch(item.key, e.target.value)} className="search-input" />}
                              {filterOptions[item.optsKey].length > 10 && getSearch(item.key).trim() && <button onClick={() => selectAllMatching(item.optsKey, item.key)} className="select-all-btn" title="全選目前符合搜尋的項目">全選</button>}
                              {item.canToggle ? (
                                <div className="logic-switch"><button onClick={() => setLogicMode(item.key, 'or')} className={'logic-or' + (getLogicMode(item.key) === 'or' ? ' active' : '')}>聯集(+)</button><button onClick={() => setLogicMode(item.key, 'and')} className={'logic-and' + (getLogicMode(item.key) === 'and' ? ' active' : '')}>交集(&amp;)</button></div>
                              ) : (
                                <span className="locked-badge" title="此項目僅支援聯集">聯集(+)<span className="locked-star">*</span></span>
                              )}
                            </div>
                          </div>
                          <div className={'chip-wrap' + (filterOptions[item.optsKey].length > 10 ? ' scrollable' : '')}>
                            {filteredOptions(filterOptions[item.optsKey], item.key).map(o => (
                              <button key={o.val} onClick={() => setFilter(item.key, toggleChip(getFilter(item.key), o.val))} className={'chip' + (getFilter(item.key).includes(o.val) ? ' active' : '')}>{o.val} <span className="chip-count">({o.count})</span></button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null))}
                </div>
              </div>
            ))}
          </div>
          {/* 第三層：送出／重置(固定置尾) */}
          <div className="sidebar-footer">
            <button onClick={handleSubmit} className="btn-submit">送出篩選</button>
            <button onClick={handleReset} className="btn-reset">重置</button>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className={'main-area bg-' + activeCat}>
        <div className="main-header">
          <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0, color: '#0f172a' }}>裁判書量化研究資料庫(測試版)－資料範圍113-114年地院判決</h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowDocs(d => !d)} className="btn-docs">{showDocs ? '← 返回資料' : '📄 技術說明文件'}</button>
            <button onClick={handleDL} disabled={!dashData?.judgments?.items?.length} className="btn-dl">下載判決清單</button>
          </div>
        </div>
        {showDocs ? <DocsPage /> : (<>
        <div className="filter-summary">{filterSummary}</div>
        {loading && <div className="loading-overlay"><span className="spinner"></span>載入中…</div>}
        {error && <div className="error-bar">{error}</div>}

        {dashData && (
          <div className="stats-grid">
            {statCards.map(s => (
              <div key={s.l} className="stat-card"><div className="stat-accent" style={{ background: s.a }}></div><div className="stat-label">{s.l}</div><div className="stat-value">{s.raw ? s.v : (typeof s.v === 'number' ? s.v.toLocaleString() : (s.v ?? '-'))}</div></div>
            ))}
          </div>
        )}

        {dashData && (
          <div className={'chart-grid' + ((activeType === 'criminal_litigation' || activeType === 'civil_litigation') ? ' chart-grid-2col' : '')}>
            {chartLayout.map(ch => <ChartCard key={ch.key} ch={ch} charts={charts} vSvg={vSvg} familyMapMode={familyMapMode} setFamilyMapMode={setFamilyMapMode} familyActiveCourtBar={familyActiveCourtBar} familyActiveBarTitle={familyActiveBarTitle} familyActiveBarSub={familyActiveBarSub} />)}
          </div>
        )}

        {/* Judgment table */}
        {dashData && (
          <div className="table-wrap">
            <div className="table-header">
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>判決書列表 <span style={{ fontWeight: 400, color: '#6b7280', fontSize: '12px' }}>共 {judgments.total?.toLocaleString()} 篇，第 {pg + 1} / {judgments.totalPages || 1} 頁</span></div>
              <div style={{ display: 'flex', gap: '6px' }}><button disabled={pg === 0} onClick={() => goPage(pg - 1)} className="btn-page">‹ 上一頁</button><button disabled={pg >= (judgments.totalPages || 1) - 1} onClick={() => goPage(pg + 1)} className="btn-page">下一頁 ›</button></div>
            </div>
            <div className={'table-col-header ' + (activeType === 'criminal_litigation' ? 'grid-criminal' : 'grid-civil')}>
              <div>裁判書 ID</div><div style={{ textAlign: 'center' }}>法院別</div><div style={{ textAlign: 'center' }}>案由</div><div style={{ textAlign: 'center' }}>終結情形</div>
              {activeType === 'criminal_litigation' && <div style={{ textAlign: 'center' }}>分類</div>}
              {activeType !== 'criminal_litigation' && <div style={{ textAlign: 'center' }}>律師</div>}
            </div>
            {!judgments.items?.length && <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>無符合條件的判決書</div>}
            {judgments.items.map(j => (
              <div key={j.jid}>
                <div className={'table-row ' + (activeType === 'criminal_litigation' ? 'grid-criminal' : 'grid-civil') + (expandedJid === j.jid ? ' expanded' : '')} onClick={() => toggleExpand(j.jid)} style={{ cursor: 'pointer' }}>
                  <div className="table-jid"><span className="expand-icon">{expandedJid === j.jid ? '▼' : '▶'}</span><a href={JURL + j.jid} target="_blank" rel="noopener noreferrer" className="jid-link" onClick={(e) => e.stopPropagation()}>{j.jid}</a></div>
                  <div style={{ fontSize: '10px', textAlign: 'center' }}>{j.court}</div><div className="table-reason">{j.cause}</div><div style={{ fontSize: '10px', textAlign: 'center' }}>{j.ending}</div>
                  {activeType === 'criminal_litigation' && <div style={{ textAlign: 'center', fontSize: '10px' }}>{j.cls}</div>}
                  {activeType !== 'criminal_litigation' && <div style={{ textAlign: 'center', fontSize: '10px' }}>{j.lawyer}</div>}
                </div>
                {expandedJid === j.jid && (
                  <div className="detail-row">
                    {activeType === 'criminal_litigation' && (
                      <>
                        <div className="detail-grid">
                          {j.law && <div className="detail-item"><span className="detail-key">定罪法條</span><span className="detail-val">{j.law}</span></div>}
                          {j.result && <div className="detail-item"><span className="detail-key">裁判結果</span><span className="detail-val">{j.result}</span></div>}
                          {j.sentence && <div className="detail-item"><span className="detail-key">宣告刑期</span><span className="detail-val">{j.sentence}</span></div>}
                          <div className="detail-item"><span className="detail-key">緩刑</span><span className="detail-val">{j.probation ? '有' : '無'}</span></div>
                          {j.defense && <div className="detail-item"><span className="detail-key">辯護代理</span><span className="detail-val">{j.defense}</span></div>}
                          {j.defendants && <div className="detail-item"><span className="detail-key">被告人數</span><span className="detail-val">{j.defendants}</span></div>}
                        </div>
                        {j.tags?.length > 0 && <div className="detail-tags">{j.tags.map(tag => <span key={tag} className="detail-tag">{tag}</span>)}</div>}
                      </>
                    )}
                    {activeType === 'civil_litigation' && (
                      <div className="detail-grid">
                        {j.causeCat && <div className="detail-item"><span className="detail-key">案由分類</span><span className="detail-val">{j.causeCat}</span></div>}
                        {j.lawyer && <div className="detail-item"><span className="detail-key">律師代理</span><span className="detail-val">{j.lawyer}</span></div>}
                        {j.amountTier && <div className="detail-item"><span className="detail-key">標的金額級距</span><span className="detail-val">{j.amountTier}</span></div>}
                        {j.amount && <div className="detail-item"><span className="detail-key">標的金額</span><span className="detail-val">{j.amount}</span></div>}
                      </div>
                    )}
                    {activeType === 'family_litigation' && (
                      <div className="detail-grid">
                        {j.causeCat && <div className="detail-item"><span className="detail-key">案由分類</span><span className="detail-val">{j.causeCat}</span></div>}
                        {j.lawyer && <div className="detail-item"><span className="detail-key">律師代理</span><span className="detail-val">{j.lawyer}</span></div>}
                        {j.initiator && <div className="detail-item"><span className="detail-key">主動離婚者</span><span className="detail-val">{j.initiator}</span></div>}
                        {j.divorceReason && <div className="detail-item"><span className="detail-key">離婚原因</span><span className="detail-val">{j.divorceReason}</span></div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        </>)}

        <footer className="site-footer">
          <div className="footer-inner">
            <span className="footer-contact">
              <div>聯絡我們：aifr.general@gmail.com</div>
              <div>意見回饋：<a href="https://forms.gle/iSS39HZGdT3x6NS67" target="_blank" rel="noreferrer">https://forms.gle/iSS39HZGdT3x6NS67</a></div>
            </span>
            <span className="footer-copy">&copy;copyright Artificial Intelligence for Fundamental Research (AIFR) Group</span>
            <div className="footer-logos">
              <img src="/img/logo_nthu.e807351d.png" width="200" height="40" alt="NTHU" loading="lazy" />
              <img src="/img/icon.65f461a6.png" width="80" height="45" alt="AIFR" loading="lazy" />
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}

// ═══════════ Chart card (per chartLayout entry) ═══════════
function ChartCard({ ch, charts, vSvg, familyMapMode, setFamilyMapMode, familyActiveCourtBar, familyActiveBarTitle, familyActiveBarSub }) {
  const cd = charts[ch.key]

  if (ch.type === 'heatmapWide') {
    return (
      <div className="chart-card" style={{ gridColumn: '1 / -1' }}>
        <div className="chart-title">{ch.title}</div>
        <div className="chart-sub">{ch.sub}</div>
        {!cd?.xLabels?.length ? <div className="no-data">無資料</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="heatmap">
              <thead><tr><th style={{ width: '100px' }}></th>{cd.xLabels.map(x => <th key={x} className="hm-col-header">{x}</th>)}</tr></thead>
              <tbody>{cd.yLabels.map((y, yi) => (
                <tr key={y}><td className="hm-label">{y}</td>{cd.xLabels.map((x, xi) => (
                  <td key={x} title={`${y} × ${x}：${cd.matrix[yi][xi]} 件`} style={{ background: heatmapColor(cd.matrix[yi][xi], cd.max), color: (cd.matrix[yi][xi] / (cd.max || 1)) > 0.5 ? '#fff' : '#111827' }} className="hm-cell">{cd.matrix[yi][xi]}</td>
                ))}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  if (ch.type === 'causeBar') {
    const list = cd || []
    const max = list[0]?.count || 1
    return (
      <div className="chart-card" style={{ gridColumn: '1 / -1' }}>
        <div className="chart-title">{ch.title}</div>
        <div className="chart-sub">{ch.sub}</div>
        {!list.length ? <div className="no-data">無資料</div> : list.map((item, idx) => (
          <div key={item.name} className="bar-item">
            <div className="bar-label" style={{ minWidth: '150px' }}>{item.name}</div>
            <div className="bar-track"><div className="bar-fill" style={{ width: Math.max(2, item.count / max * 100) + '%', background: PALETTE[idx % PALETTE.length] }}></div></div>
            <div className="bar-count">{item.count.toLocaleString()}</div>
          </div>
        ))}
      </div>
    )
  }

  if (ch.type === 'courtClassBar') {
    const title = cd?.mode === 'month' ? (cd?.courtName || '') + ' 終結年月 × 案件分類' : ch.title
    const sub = cd?.mode === 'month' ? '各月案件分類堆疊分布' : ch.sub
    if (!cd?.data?.length) return <div className="chart-card" style={{ gridColumn: '1 / -1' }}><div className="chart-title">{title}</div><div className="chart-sub">{sub}</div><div className="no-data">無資料</div></div>
    const vbW = Math.max(500, cd.data.length * 34 + 80)
    const maxScale = simpleBarMax(cd.data) * 1.1
    return (
      <div className="chart-card" style={{ gridColumn: '1 / -1' }}>
        <div className="chart-title">{title}</div>
        <div className="chart-sub">{sub}</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ flex: 1, overflowX: 'auto' }}>
            <svg width="100%" viewBox={`0 0 ${vbW} 240`} preserveAspectRatio="xMinYMin meet" style={{ minWidth: 0 }}>
              {simpleBarTicks(cd.data, 1.1).map((tick, ti) => (
                <g key={'gt' + ti}>
                  <line x1="52" x2={vbW - 10} y1={180 - (tick / maxScale) * 160} y2={180 - (tick / maxScale) * 160} stroke="#e5e7eb" strokeDasharray="3 3" />
                  <text x="48" y={184 - (tick / maxScale) * 160} textAnchor="end" fontSize="10" fill="#6b7280">{tick.toLocaleString()}</text>
                </g>
              ))}
              {cd.data.map((d, di) => (
                <g key={'cb' + di}>
                  {cd.segments.map((seg, si) => (
                    <rect key={seg} x={58 + di * 34} y={180 - cd.segments.slice(0, si + 1).reduce((a, s) => a + (d[s] || 0), 0) / maxScale * 160} width="26" height={Math.max(0, (d[seg] || 0) / maxScale * 160)} fill={PASTEL[si % PASTEL.length]} rx="2" stroke="#fff" strokeWidth="0.5"><title>{d.abbr} - {seg}：{(d[seg] || 0).toLocaleString()} 件</title></rect>
                  ))}
                  <text x={58 + di * 34 + 13} y="195" textAnchor="middle" fontSize="10" fill="#374151" fontWeight="600" writingMode="vertical-rl" style={{ letterSpacing: '1px' }}>{d.abbr}</text>
                </g>
              ))}
            </svg>
          </div>
          <div style={{ flexShrink: 0, paddingTop: '20px' }}>
            {cd.segments.map((seg, si) => <div key={seg} className="legend-item" style={{ marginBottom: '6px' }}><span className="legend-dot" style={{ background: PASTEL[si % PASTEL.length] }}></span>{seg}</div>)}
          </div>
        </div>
      </div>
    )
  }

  if (ch.type === 'stackedBar') {
    const svgData = stackedBarSvg(cd, vSvg?.H || 0)
    return (
      <div className="chart-card">
        <div className="chart-title">{ch.title}</div>
        <div className="chart-sub">{ch.sub}</div>
        {cd?.data?.length ? (
          <>
            {svgData && (
              <svg viewBox={`0 0 ${svgData.W} ${svgData.H}`} width="100%" preserveAspectRatio="xMinYMin meet">
                {svgData.rows.map((row, ri) => (
                  <g key={ri}>
                    <text x={svgData.LM - 10} y={row.yCenter} textAnchor="end" fontSize="18" fill="#111827" fontWeight="600" dominantBaseline="central">
                      {row.labelLines.map((line, li) => <tspan key={li} x={svgData.LM - 10} dy={li === 0 ? (row.labelLines.length === 1 ? 6 : -4) : 22}>{line}</tspan>)}
                    </text>
                    {row.bars.map(b => <rect key={b.seg} x={b.x} y={b.y} width={Math.max(0, b.w)} height={b.h} fill={b.fill} rx="2"><title>{b.seg}：{fmtPctTenths(b.tenths)}（{b.count} 件）</title></rect>)}
                  </g>
                ))}
                {[0, 25, 50, 75, 100].map(p => <text key={p} x={svgData.LM + (p / 100) * svgData.barW} y={svgData.H - svgData.BM + 24} textAnchor="middle" fontSize="16" fill="#374151" fontWeight="600">{p}%</text>)}
              </svg>
            )}
            <div className="legend-row">{cd.segments.map((seg, si) => <div key={seg} className="legend-item"><span className="legend-dot" style={{ background: PALETTE[si % PALETTE.length] }}></span>{seg}</div>)}</div>
          </>
        ) : <div className="no-data">無資料</div>}
      </div>
    )
  }

  if (ch.type === 'lawyerEndingAndAmount') {
    const svgData = dualAxisBarSvg(cd)
    const amt = charts.amountLawyerHeatmap
    return (
      <div className="chart-card">
        <div className="chart-title">{ch.title}</div>
        <div className="chart-sub">{ch.sub}</div>
        {cd?.data?.length ? (
          <>
            {svgData && <DualAxisSvg svgData={svgData} />}
            <div className="legend-row">
              {cd.segments.map((seg, si) => <div key={seg} className="legend-item"><span className="legend-dot" style={{ background: PALETTE[si % PALETTE.length] }}></span>{seg}</div>)}
              <div className="legend-item"><span style={{ width: '16px', height: '3px', background: '#E45C5C', display: 'inline-block', borderRadius: '2px' }}></span> 占比線</div>
            </div>
          </>
        ) : <div className="no-data">無資料</div>}
        {amt && (
          <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px dashed #cbd5e1' }}>
            <div className="chart-title" style={{ fontSize: '15px' }}>標的金額 × 律師代理</div>
            <div className="chart-sub" style={{ fontSize: '12px', marginBottom: '12px' }}>標的金額級距與律師代理情形之交叉分析</div>
            {!amt.xLabels?.length ? <div className="no-data">無資料</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="heatmap">
                  <thead><tr><th style={{ width: '100px' }}></th>{amt.xLabels.map(x => <th key={x} className="hm-col-header">{x}</th>)}</tr></thead>
                  <tbody>{amt.yLabels.map((y, yi) => (
                    <tr key={y}><td className="hm-label">{y}</td>{amt.xLabels.map((x, xi) => (
                      <td key={x} title={`${y} × ${x}：${amt.matrix[yi][xi]} 件`} style={{ background: heatmapColor(amt.matrix[yi][xi], Math.max(...amt.matrix[yi]), '234,179,8'), color: '#111827' }} className="hm-cell">{amt.matrix[yi][xi]}</td>
                    ))}</tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (ch.type === 'dualAxisBar') {
    const svgData = dualAxisBarSvg(cd)
    return (
      <div className="chart-card">
        <div className="chart-title">{ch.title}</div>
        <div className="chart-sub">{ch.sub}</div>
        {cd?.data?.length ? (
          <>
            {svgData && <DualAxisSvg svgData={svgData} />}
            <div className="legend-row">
              {cd.segments.map((seg, si) => <div key={seg} className="legend-item"><span className="legend-dot" style={{ background: PALETTE[si % PALETTE.length] }}></span>{seg}</div>)}
              <div className="legend-item"><span style={{ width: '16px', height: '3px', background: '#E45C5C', display: 'inline-block', borderRadius: '2px' }}></span> 占比線</div>
            </div>
          </>
        ) : <div className="no-data">無資料</div>}
      </div>
    )
  }

  if (ch.type === 'lawyerRateMap') {
    return (
      <div className="chart-card">
        {!cd?.length ? <div className="no-data">無資料</div> : <TaiwanCourtBubbleMap data={cd} metric="lawyerRate" title={ch.title} subtitle={ch.sub} />}
      </div>
    )
  }

  if (ch.type === 'causeAndPie') {
    const cause = charts.causeDist, init = charts.initiatorDist
    const initTotal = init?.reduce((a, b) => a + b.count, 0) || 1
    return (
      <div className="chart-card">
        <div className="chart-title">{ch.title}</div>
        <div className="chart-sub">{ch.sub}</div>
        {!cause?.length ? <div className="no-data">無資料</div> : (
          <>
            {cause.map((item, idx) => (
              <div key={item.name} className="bar-item">
                <div className="bar-label">{item.name}</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: Math.max(2, item.count / (cause[0]?.count || 1) * 100) + '%', background: PALETTE[idx % PALETTE.length] }}></div></div>
                <div className="bar-count">{item.count.toLocaleString()}</div>
              </div>
            ))}
            {init?.length > 0 && (
              <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#374151', marginBottom: '8px' }}>主動離婚者分布</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                  <svg width="140" height="140" viewBox="0 0 140 140">
                    {init.map((item, idx) => (
                      <path key={item.name} d={pieArc(70, 70, 60, init.slice(0, idx).reduce((a, b) => a + b.count, 0) / initTotal * Math.PI * 2, init.slice(0, idx + 1).reduce((a, b) => a + b.count, 0) / initTotal * Math.PI * 2)} fill={initColor(item.name, idx)} stroke="#fff" strokeWidth="2" opacity="0.85"><title>{item.name}：{item.count} 件</title></path>
                    ))}
                  </svg>
                  <div>
                    {init.map((item, idx) => (
                      <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <span className="legend-dot" style={{ background: initColor(item.name, idx) }}></span>
                        <span style={{ fontSize: '12px', color: '#374151', fontWeight: 600 }}>{item.name}</span>
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>{item.count} 件（{(item.count / initTotal * 100).toFixed(1)}%）</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  if (ch.type === 'familyCourtBar') {
    const fb = familyActiveCourtBar
    const vbW = Math.max(500, fb.data.length * 34 + 100)
    const maxScale = Math.max(...fb.data.map(d => d.total), 1) * 1.15
    const lineKeys = Object.keys(fb.lawyerLines || {})
    return (
      <div className="chart-card" style={{ gridColumn: '1 / -1' }}>
        <div className="chart-title">{familyActiveBarTitle}</div>
        <div className="chart-sub">{familyActiveBarSub}</div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          <button onClick={() => setFamilyMapMode('divorce')} className={'map-toggle-btn' + (familyMapMode === 'divorce' ? ' active' : '')}>離婚案件</button>
          <button onClick={() => setFamilyMapMode('inherit')} className={'map-toggle-btn' + (familyMapMode === 'inherit' ? ' active' : '')}>繼承案件</button>
        </div>
        {!fb?.data?.length ? <div className="no-data">無資料</div> : (
          <>
            <div style={{ width: '100%', overflowX: 'auto' }}>
              <svg width="100%" viewBox={`0 0 ${vbW} 280`} preserveAspectRatio="xMinYMin meet" style={{ minWidth: 0 }}>
                {simpleBarTicks(fb.data, 1.15).map((tick, ti) => (
                  <g key={'ft' + ti}>
                    <line x1="52" x2={vbW - 50} y1={200 - (tick / maxScale) * 170} y2={200 - (tick / maxScale) * 170} stroke="#e5e7eb" strokeDasharray="3 3" />
                    <text x="48" y={204 - (tick / maxScale) * 170} textAnchor="end" fontSize="10" fill="#6b7280">{tick}</text>
                  </g>
                ))}
                {[0, 25, 50, 75, 100].map(p => <text key={'rp' + p} x={vbW - 4} y={204 - (p / 100) * 170} textAnchor="end" fontSize="9" fill="#9ca3af">{p}%</text>)}
                {fb.data.map((d, di) => (
                  <g key={'fb' + di}>
                    <rect x={58 + di * 34} y={200 - (d.total / maxScale) * 170} width="26" height={Math.max(0, (d.total / maxScale) * 170)} fill={FAMILY_BAR_COLORS[0]} rx="2" opacity="0.75" stroke="#fff" strokeWidth="0.5"><title>{d.abbr}：{d.total} 件 / 律師代理率 {d.lawyerRate}%</title></rect>
                    <text x={58 + di * 34 + 13} y="218" textAnchor="middle" fontSize="10" fill="#374151" fontWeight="600" writingMode="vertical-rl" style={{ letterSpacing: '1px' }}>{d.abbr}</text>
                  </g>
                ))}
                {familyMapMode === 'divorce' && lineKeys.map((initK, ki) => (
                  <g key={'line' + initK}>
                    {fb.lawyerLines[initK]?.some(v => v != null) && (
                      <polyline points={fb.data.map((d, i) => { const pt = linePt(fb.lawyerLines[initK]?.[i]); return pt && pt.rate != null ? (58 + i * 34 + 13) + ',' + (200 - (pt.rate / 100) * 170) : '' }).filter(Boolean).join(' ')} fill="none" stroke={initColor(initK, ki)} strokeWidth="2" strokeLinejoin="round" strokeDasharray={(fb.initiatorTotals?.[initK] || 0) < 10 ? '6 4' : 'none'} />
                    )}
                    {fb.data.map((d, di) => {
                      const pt = linePt(fb.lawyerLines[initK]?.[di])
                      return pt && pt.rate != null ? (
                        <circle key={'dot' + initK + di} cx={58 + di * 34 + 13} cy={200 - (pt.rate / 100) * 170} r="3" fill={initColor(initK, ki)} stroke="#fff" strokeWidth="1"><title>{d.abbr}　{initK}主動方代理率：{pt.rate}%{pt.n != null ? `（主動提起 ${pt.n} 件，其中主動方有請律師 ${pt.withL} 件）` : ''}</title></circle>
                      ) : null
                    })}
                  </g>
                ))}
                {familyMapMode === 'inherit' && (
                  <>
                    <polyline points={fb.data.map((d, i) => (58 + i * 34 + 13) + ',' + (200 - ((d.lawyerRate || 0) / 100) * 170)).join(' ')} fill="none" stroke="#059669" strokeWidth="2" strokeLinejoin="round" />
                    {fb.data.map((d, di) => <circle key={'idot' + di} cx={58 + di * 34 + 13} cy={200 - ((d.lawyerRate || 0) / 100) * 170} r="3" fill="#059669" stroke="#fff" strokeWidth="1"><title>{d.abbr} 律師代理率：{d.lawyerRate}%</title></circle>)}
                  </>
                )}
              </svg>
            </div>
            <div className="legend-row">
              <div className="legend-item"><span className="legend-dot" style={{ background: FAMILY_BAR_COLORS[0] }}></span>案件數</div>
              {familyMapMode === 'divorce' ? lineKeys.map((k, ki) => (
                <div key={k} className="legend-item"><span style={{ width: '16px', height: (fb.initiatorTotals?.[k] || 0) < 10 ? '0' : '3px', display: 'inline-block', borderRadius: '2px', background: initColor(k, ki), borderTop: (fb.initiatorTotals?.[k] || 0) < 10 ? '2px dashed ' + initColor(k, ki) : 'none' }}></span>{k}代理率 (n={fb.initiatorTotals?.[k] || 0})</div>
              )) : <div className="legend-item"><span style={{ width: '16px', height: '3px', background: '#059669', display: 'inline-block', borderRadius: '2px' }}></span>律師代理率（%）</div>}
            </div>
          </>
        )}
      </div>
    )
  }

  if (ch.type === 'violin') {
    return (
      <div className="chart-card">
        <div className="chart-title">{ch.title}</div>
        <div className="chart-sub">{ch.sub}</div>
        {!vSvg ? <div className="no-data">無資料</div> : (
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <svg width="100%" viewBox={`0 0 ${vSvg.W} ${vSvg.H}`} preserveAspectRatio="xMinYMin meet">
              {vSvg.tickData.map((t, ti) => (
                <g key={ti}><line x1={t.x} x2={t.x} y1={vSvg.TM - 6} y2={vSvg.H - vSvg.BM + 12} stroke="#e5e7eb" strokeDasharray="3 3" /><text x={t.x} y={vSvg.H - vSvg.BM + 34} textAnchor="middle" fontSize="16" fill="#374151" fontWeight="600">{t.label}</text></g>
              ))}
              <text x={(vSvg.LM + vSvg.W - vSvg.RM) / 2} y={vSvg.H - 14} textAnchor="middle" fontSize="16" fill="#6b7280" fontWeight="600">{vSvg.axisLabel}</text>
              {vSvg.rows.map(d => (
                <g key={d.name}>
                  <text x={vSvg.LM - 10} y={d.y} textAnchor="end" fontSize="18" fill="#111827" fontWeight="600">{d.labelLines.map((line, li) => <tspan key={li} x={vSvg.LM - 10} dy={li === 0 ? -14 : 18}>{line}</tspan>)}</text>
                  <line x1={vSvg.LM} x2={vSvg.W - vSvg.RM} y1={d.y} y2={d.y} stroke="#f1f5f9" />
                  <path d={d.path} fill="rgba(79,134,247,0.22)" stroke="rgba(79,134,247,0.90)" strokeWidth="1.5" />
                  <line x1={d.medianX} x2={d.medianX} y1={d.y - 22} y2={d.y + 22} stroke="#D9A93A" strokeWidth="2.4" />
                  <circle cx={d.meanX} cy={d.y} r="4.8" fill="#35B679" stroke="#fff" strokeWidth="1.8" />
                  {d.outlierPts.map((ol, oi) => <circle key={'ol' + oi} cx={ol.cx} cy={d.y + (oi % 5 - 2) * 3} r="2.5" fill="#E45C5C" opacity="0.5" stroke="none"><title>離群值：{formatMetricValue(ol.val, 'imprisonment', 1)} 月</title></circle>)}
                  <text x={d.meanNR ? vSvg.W - vSvg.RM - 6 : Math.min(vSvg.W - vSvg.RM - 6, d.meanX + 10)} y={d.y - 12} textAnchor={d.meanNR ? 'end' : 'start'} fontSize="15" fill="#059669" fontWeight="700">平均 {d.meanLabel}</text>
                  <text x={d.medNR ? vSvg.W - vSvg.RM - 6 : Math.min(vSvg.W - vSvg.RM - 6, d.medianX + 10)} y={d.y + 22} textAnchor={d.medNR ? 'end' : 'start'} fontSize="15" fill="#B8860B" fontWeight="700">中位 {d.medLabel}</text>
                  <text x={vSvg.W - vSvg.RM + 8} y={d.y + 6} textAnchor="start" fontSize="15" fill="#374151" fontWeight="600">n={d.n}</text>
                  {d.outlierCount > 0 && <text x={vSvg.W - vSvg.RM + 8} y={d.y + 20} textAnchor="start" fontSize="11" fill="#E45C5C" fontWeight="500">{d.outlierCount}離群</text>}
                </g>
              ))}
            </svg>
          </div>
        )}
      </div>
    )
  }

  return null
}

function DualAxisSvg({ svgData }) {
  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${svgData.W} ${svgData.H}`} preserveAspectRatio="xMidYMin meet" style={{ maxWidth: `${svgData.W}px`, display: 'block', margin: '0 auto' }}>
        {svgData.yTicks.map((t, ti) => (
          <g key={'yt' + ti}><line x1={svgData.LM} x2={svgData.W - svgData.RM} y1={svgData.yS(t)} y2={svgData.yS(t)} stroke="#e5e7eb" strokeDasharray="3 3" /><text x={svgData.LM - 8} y={svgData.yS(t) + 4} textAnchor="end" fontSize="10" fill="#6b7280">{t.toLocaleString()}</text></g>
        ))}
        {svgData.groups.map((g, gi) => (
          <g key={'g' + gi}>
            {g.bars.map(b => <rect key={b.seg} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.fill} rx="2"><title>{g.name} - {b.seg}：{b.count.toLocaleString()} 件</title></rect>)}
            <text x={g.gx + 35} y={svgData.TM + svgData.plotH + 16} textAnchor="middle" fontSize="10" fill="#374151" fontWeight="500">{wrapTextLines(g.name, 6, 2).map((line, li) => <tspan key={li} x={g.gx + 35} dy={li === 0 ? 0 : 12}>{line}</tspan>)}</text>
          </g>
        ))}
        {svgData.linePath && <path d={svgData.linePath} fill="none" stroke="#E45C5C" strokeWidth="2.5" strokeLinejoin="round" />}
        {svgData.groups.map((g, gi) => (
          <g key={'dot' + gi}>
            <circle cx={g.lineX} cy={g.lineY} r="4" fill="#E45C5C" stroke="#fff" strokeWidth="1.5" />
            <text x={g.lineX} y={g.lineY - 8} textAnchor="middle" fontSize="9" fill="#E45C5C" fontWeight="700">{g.pct}%</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ═══════════ 資料處理說明頁 ═══════════
function DocsSection({ title, children }) {
  return (
    <section style={{ marginBottom: '26px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#1e40af', borderBottom: '2px solid #dbeafe', paddingBottom: '6px', marginBottom: '12px' }}>{title}</h2>
      {children}
    </section>
  )
}
const DP_TH = { textAlign: 'left', padding: '6px 10px', background: '#f1f5f9', fontWeight: 700, fontSize: '13px', color: '#334155', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }
const DP_TD = { padding: '6px 10px', fontSize: '13px', color: '#374151', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', lineHeight: 1.7 }
const DP_P = { fontSize: '14px', lineHeight: 1.9, color: '#374151', margin: '0 0 10px' }
const DP_TDC = { ...DP_TD, whiteSpace: 'nowrap', fontWeight: 700, color: '#0f172a', background: '#f8fafc', textAlign: 'center', verticalAlign: 'middle' }
function DocsPage() {
  return (
    <div className="docs-page">
      <p style={{ ...DP_P, color: '#64748b' }}>本平台以司法院資料開放平臺「司法院及所屬各級法院之終結案件資料」為基礎，將原始資料轉檔整理、分類並彙總後，以圖表方式呈現，目的是提供法律實務工作者、法學研究者以量化的角度來看這些裁判書，以此瞭解法律是如何實際被運用。</p>
      <p style={{ ...DP_P, color: '#64748b' }}>本文件說明有四：一、各篩選欄位分別來自原始資料或平台計算；二、每張圖表的判讀方式；三、網頁操作方式。</p>

      <DocsSection title="一、篩選欄位來源">
        <p style={{ ...DP_P, fontWeight: 700, color: '#0f172a' }}>(A) 直接來自原始「終結案件資料」的欄位</p>
        <p style={{ ...DP_P, margin: '0 0 8px' }}>以下欄位為原始資料既有的登載內容，平台未做加工，僅供篩選：</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6px' }}>
          <thead><tr><th style={DP_TH}>訴訟類別</th><th style={DP_TH}>欄位</th><th style={DP_TH}>簡要說明*</th></tr></thead>
          <tbody>
            <tr><td style={DP_TDC} rowSpan={5}>刑事／民事／家事</td><td style={DP_TD}>終結年月（區間）</td><td style={DP_TD}>目前僅涵蓋民國 113–114 年案件。</td></tr>
            <tr><td style={DP_TD}>法院別</td><td style={DP_TD}>所有原始資料有涵蓋之承審法院。</td></tr>
            <tr><td style={DP_TD}>案號字別</td><td style={DP_TD}>所有原始資料有涵蓋之案號字別。</td></tr>
            <tr><td style={DP_TD}>全案終結情形</td><td style={DP_TD}>所有原始資料有涵蓋之全案終結方式（判決、駁回等）。</td></tr>
            <tr><td style={DP_TD}>辯護及代理／律師代理情形</td><td style={DP_TD}>所有原始資料有涵蓋之辯護及代理／律師代理情形。</td></tr>
            <tr><td style={DP_TDC}>刑事</td><td style={DP_TD}>案件分類、辯護及代理、保安處分、裁判程序、沒收、宣告緩刑、家暴相關等</td><td style={DP_TD}>刑事訴訟被告資訊相關欄位，將原始資料多欄位合併為一欄位做篩選。</td></tr>
            <tr><td style={DP_TDC}>刑事</td><td style={DP_TD}>定罪法條、罪犯類型、加重／減輕事由、罪名裁判結果</td><td style={DP_TD}>刑事訴訟罪刑相關欄位，將原始資料多欄位合併為一欄做篩選。定罪法條第幾條以法條符號（§）代表。</td></tr>
            <tr><td style={DP_TDC}>民事</td><td style={DP_TD}>訴訟標的類別、是否國賠、被請求機關類別、賠償類別、公職／選舉類別</td><td style={DP_TD}>民事案件原始資訊欄位。</td></tr>
            <tr><td style={DP_TDC}>家事</td><td style={DP_TD}>主動離婚者、離婚原因</td><td style={DP_TD}>家事案件原始資訊欄位。</td></tr>
          </tbody>
        </table>
        <p style={{ ...DP_P, fontSize: '12px', color: '#94a3b8', margin: '0 0 4px' }}>*詳細欄位說明請參閱司法院資料開放平臺－司法院及所屬各級法院之終結案件資料與欄位說明。</p>
        <p style={{ ...DP_P, fontWeight: 700, color: '#0f172a', marginTop: '14px' }}>(B) 由平台計算／彙總後產生的欄位</p>
        <p style={{ ...DP_P, margin: '0 0 8px' }}>以下欄位為平台依原始資料再計算、分類或彙總而成：</p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={DP_TH}>訴訟類別</th><th style={DP_TH}>欄位（適用範圍）</th><th style={DP_TH}>如何產生／計算</th></tr></thead>
          <tbody>
            <tr><td style={DP_TDC}>刑事</td><td style={DP_TD}>案件分類</td><td style={DP_TD}>根據原始資料計算每一裁判書中的被告人數、犯罪筆數後做分類。</td></tr>
            <tr><td style={DP_TDC}>民事</td><td style={DP_TD}>案由（訴訟種類）</td><td style={DP_TD}>將原始案由文字以關鍵字對應到司法院統計處「地方法院民事第一審終結事件訴訟種類」（損害賠償—侵權行為／債務不履行、不當得利、返還借款、買賣、所有權、租賃、抵押權、票據、承攬、僱傭及勞動、保險、國家賠償、公司事件等）；無法歸類者列為「其他」。</td></tr>
            <tr><td style={DP_TDC}>民事</td><td style={DP_TD}>訴訟標的金額級距</td><td style={DP_TD}>由原始訴訟標的金額分為 未滿10萬／10–50萬／50–100萬／100–500萬／500萬–1000萬／1000萬以上。</td></tr>
            <tr><td style={DP_TDC}>民事</td><td style={DP_TD}>終結情形</td><td style={DP_TD}>將原始「勝訴／敗訴」一律改以「原告」角度標示，方便判讀結果。</td></tr>
          </tbody>
        </table>
      </DocsSection>

      <DocsSection title="二、圖表判讀方式">
        <p style={{ ...DP_P, fontWeight: 700, color: '#2563eb' }}>刑事訴訟</p>
        <ul style={{ ...DP_P, paddingLeft: '20px' }}>
          <li>案件分類 × 法院別：各法院不同案件分類的件數分布，看各法院受理案件的結構。</li>
          <li>刑期分布（小提琴圖）：橫向寬度代表該刑期附近案件的密度，愈寬表示落在該區間的案件愈多；可看刑度集中的區段與離群值。</li>
          <li>量刑結構堆疊圖：依判決是否含加重、減輕法條，組合為：無加重無減輕／僅有加重法條／僅有減輕法條／有加重有減輕。</li>
        </ul>
        <p style={{ ...DP_P, fontWeight: 700, color: '#059669' }}>民事訴訟</p>
        <ul style={{ ...DP_P, paddingLeft: '20px' }}>
          <li>各法院律師代理率（地圖）：各法院（或各分類）中「非『雙方無律師』」案件所占比率，氣泡顏色代表該法院的律師代理率（0–100%），可比較地區差異。</li>
          <li>律師代理 × 終結情形：比較有無律師代理下，各種終結結果的比例差異。</li>
          <li>標的金額 × 律師代理：不同金額級距下的律師代理情形，觀察金額高低與是否委任律師的關係。</li>
          <li>案由（訴訟種類）分布：依司法院統計處分類，案件數由多到少排列。</li>
        </ul>
        <p style={{ ...DP_P, fontWeight: 700, color: '#d97706' }}>家事訴訟</p>
        <ul style={{ ...DP_P, paddingLeft: '20px' }}>
          <li>律師代理 × 終結情形：比較有無律師代理下，各種終結結果的比例差異。</li>
          <li>離婚案件法院分布：各法院離婚案件件數。</li>
          <li>主動方（原告）律師代理率：主動提起離婚一方委任律師的比率。以主動離婚者（＝原告）為分母，計「僅原告有律師＋雙方有律師」÷ 該分類主動提起件數（排除僅被告有律師者）。</li>
        </ul>
      </DocsSection>

      <DocsSection title="三、網頁使用方式">
        <ol style={{ ...DP_P, paddingLeft: '20px' }}>
          <li>在左側第一層「案件類型」選擇 刑事／民事／家事，右側圖表與第二層篩選條件會隨之切換。</li>
          <li>在左側第二層做條件篩選，其中各欄位條件為交集或聯集亦可自行點選。</li>
          <li>設定完成後，點左側最下方（第三層）的「送出篩選」套用即可在右方看到該篩選條件後的圖表及判決書列表；若點選「重置」可清除全部條件。</li>
          <li>右上角「下載判決清單」可依目前篩選條件匯出符合案件的清單。</li>
          <li>右上角「技術說明文件」即本說明頁，可隨時查閱欄位定義與圖表判讀。</li>
          <li>如發現分類或數據疑義，歡迎透過頁尾的意見回饋問卷回報。</li>
        </ol>
      </DocsSection>
    </div>
  )
}
