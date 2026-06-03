<script setup>
// 真實台灣輪廓 + 法院氣泡地圖（Vue 3 版，由 React/D3 版本移植）
// tooltip 採卡片內夾擠定位，避免被邊界裁切
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { geoMercator, geoPath } from 'd3-geo'
import { max as d3max, min as d3min } from 'd3-array'
import { scaleSqrt, scaleSequential } from 'd3-scale'
import { interpolateYlOrRd } from 'd3-scale-chromatic'

const DEFAULT_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/g0v/twgeojson@master/json/twCounty2010.geo.json'

const ISLAND_COUNTIES = new Set(['澎湖縣', '金門縣', '連江縣'])

const props = defineProps({
  data: { type: Array, default: () => [] },
  title: { type: String, default: '法院案件分布地圖' },
  subtitle: {
    type: String,
    default: '氣泡大小代表案件量；顏色代表律師代理率或指定比例。',
  },
  metric: { type: String, default: 'lawyerRate' },
  geoJsonUrl: { type: String, default: DEFAULT_GEOJSON_URL },
  height: { type: Number, default: 680 },
  showLabels: { type: Boolean, default: true },
})

const width = 560
const mainHeight = computed(() => props.height - 28)

const wrapRef = ref(null)
const geoJson = ref(null)
const error = ref('')
const tooltip = ref(null)

function getCountyName(feature) {
  const p = (feature && feature.properties) || {}
  return (
    p.COUNTYNAME ||
    p.COUNTY_NAME ||
    p.COUNTY ||
    p.name ||
    p.Name ||
    p.NAME ||
    p.C_Name ||
    p.TOWNNAME ||
    ''
  )
}

function formatNumber(value) {
  const n = Number(value || 0)
  return new Intl.NumberFormat('zh-TW').format(n)
}

function metricLabel(metric) {
  if (metric === 'lawyerRate') return '律師代理率'
  if (metric === 'pct') return '案件占比'
  return '指標值'
}

function getMetricValue(d, metric) {
  const value = Number(d && d[metric])
  if (Number.isFinite(value)) return value
  return Number((d && (d.lawyerRate != null ? d.lawyerRate : d.pct)) || 0)
}

function topCategoryText(topCats = []) {
  if (!Array.isArray(topCats) || topCats.length === 0) return '無分類資料'
  return topCats
    .slice(0, 5)
    .map((x) => `${x.name} ${formatNumber(x.count)} 件（${x.pct}%）`)
    .join('、')
}

let alive = true
onMounted(() => {
  error.value = ''
  fetch(props.geoJsonUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`GeoJSON 載入失敗：${res.status}`)
      return res.json()
    })
    .then((json) => {
      if (alive) geoJson.value = json
    })
    .catch((err) => {
      if (alive) error.value = err.message || 'GeoJSON 載入失敗'
    })
})
onBeforeUnmount(() => {
  alive = false
})

const safeData = computed(() =>
  (Array.isArray(props.data) ? props.data : [])
    .map((d) => ({
      ...d,
      count: Number(d.count || 0),
      lat: Number(d.lat),
      lng: Number(d.lng),
    }))
    .filter(
      (d) => Number.isFinite(d.lat) && Number.isFinite(d.lng) && d.count > 0
    )
)

const chart = computed(() => {
  const gj = geoJson.value
  if (!gj || !gj.features || !gj.features.length) return null

  const mainFeatures = gj.features.filter(
    (feature) => !ISLAND_COUNTIES.has(getCountyName(feature))
  )
  const mainGeo = {
    type: 'FeatureCollection',
    features: mainFeatures.length ? mainFeatures : gj.features,
  }

  const projection = geoMercator().fitExtent(
    [
      [42, 28],
      [width - 42, mainHeight.value - 34],
    ],
    mainGeo
  )
  const path = geoPath(projection)

  const data = safeData.value
  const maxCount = d3max(data, (d) => d.count) || 1
  const maxMetric = d3max(data, (d) => getMetricValue(d, props.metric)) || 100
  const minMetric = d3min(data, (d) => getMetricValue(d, props.metric)) || 0

  const rScale = scaleSqrt().domain([0, maxCount]).range([4.5, 26])
  // 顏色固定 0–100%，不隨資料最小/最大值縮放
  const colorScale = scaleSequential(interpolateYlOrRd).domain([0, 100])

  return {
    mainGeo,
    projection,
    path,
    rScale,
    colorScale,
    mainPoints: data.filter((d) => !d.island),
    islandPoints: data.filter((d) => d.island),
    maxCount,
    minMetric,
    maxMetric,
  }
})

const totalCount = computed(() =>
  safeData.value.reduce((sum, d) => sum + d.count, 0)
)

const legendCounts = computed(() => {
  const c = chart.value
  if (!c) return []
  return [
    Math.max(1, Math.round(c.maxCount * 0.2)),
    Math.max(1, Math.round(c.maxCount * 0.55)),
    Math.max(1, Math.round(c.maxCount)),
  ]
})

// ── render helpers (取代 React inline 計算) ──
function pathD(feature) {
  const c = chart.value
  return (c && c.path(feature)) || ''
}
function bubbleXY(d) {
  const c = chart.value
  return c ? c.projection([d.lng, d.lat]) : null
}
function bubbleR(d) {
  const c = chart.value
  return c ? c.rScale(d.count) : 0
}
function bubbleFill(d) {
  const c = chart.value
  return c ? c.colorScale(getMetricValue(d, props.metric)) : '#ddd'
}
function legendR(value) {
  const c = chart.value
  return c ? c.rScale(value) : 0
}
function shortName(d) {
  return d.abbr || (d.court ? d.court.replace('地方法院', '') : '')
}

const tipEl = ref(null)

function showTooltip(event, item) {
  const rect = wrapRef.value && wrapRef.value.getBoundingClientRect()
  if (!rect) {
    tooltip.value = { x: 12, y: 12, item }
    return
  }
  const cursorX = event.clientX - rect.left
  const cursorY = event.clientY - rect.top
  const margin = 12
  // 用實際量到的尺寸（首次 hover 先用估計值，滑動時自動校正）
  const tipW = (tipEl.value && tipEl.value.offsetWidth) || Math.min(320, rect.width - 24)
  const tipH = (tipEl.value && tipEl.value.offsetHeight) || 240

  // 預設放游標右下方；若超出右緣改放左側，最後一律夾在卡片範圍內
  let left = cursorX + 16
  if (left + tipW > rect.width - margin) left = cursorX - 16 - tipW
  left = Math.max(margin, Math.min(left, rect.width - tipW - margin))

  let top = cursorY + 16
  if (top + tipH > rect.height - margin) top = cursorY - 16 - tipH
  top = Math.max(margin, Math.min(top, rect.height - tipH - margin))

  tooltip.value = { x: left, y: top, item }
}
function hideTooltip() {
  tooltip.value = null
}
</script>

<template>
  <section class="tw-map-card" ref="wrapRef">
    <div class="tw-map-header">
      <div>
        <h3>{{ title }}</h3>
        <p>{{ subtitle }}</p>
      </div>
    </div>

    <div v-if="error" class="tw-map-error">{{ error }}</div>
    <div v-else-if="!chart" class="tw-map-loading">正在載入台灣地圖資料...</div>

    <template v-else>
      <svg
        class="tw-map-svg"
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        :aria-label="title"
      >
        <defs>
          <filter id="bubbleShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.2" />
          </filter>
          <linearGradient id="metricGradient" x1="0%" x2="100%" y1="0%" y2="0%">
            <stop offset="0%" :stop-color="chart.colorScale(0)" />
            <stop offset="50%" :stop-color="chart.colorScale(50)" />
            <stop offset="100%" :stop-color="chart.colorScale(100)" />
          </linearGradient>
        </defs>

        <g class="tw-map-basemap">
          <path
            v-for="(feature, index) in chart.mainGeo.features"
            :key="`county-${index}`"
            :d="pathD(feature)"
            class="tw-map-county"
          >
            <title>{{ getCountyName(feature) }}</title>
          </path>
        </g>

        <g class="tw-map-bubbles">
          <g
            v-for="d in chart.mainPoints"
            :key="d.court"
            class="tw-map-bubble-group"
            :transform="bubbleXY(d) ? `translate(${bubbleXY(d)[0]}, ${bubbleXY(d)[1]})` : ''"
            @mousemove="showTooltip($event, d)"
            @mouseleave="hideTooltip"
          >
            <circle
              :r="bubbleR(d)"
              :fill="bubbleFill(d)"
              class="tw-map-bubble"
              filter="url(#bubbleShadow)"
            />
            <text
              v-if="showLabels && bubbleR(d) >= 6"
              class="tw-map-label"
              :x="bubbleR(d) + 4"
              y="4"
            >
              {{ shortName(d) }}
            </text>
          </g>
        </g>

        <g
          class="tw-map-inset"
          :transform="`translate(${width - 164}, ${height - 156})`"
        >
          <rect width="132" height="122" rx="14" class="tw-map-inset-bg" />
          <text x="14" y="24" class="tw-map-inset-title">外島法院</text>
          <g
            v-for="(d, index) in chart.islandPoints"
            :key="`island-${d.court}`"
            :transform="`translate(32, ${50 + index * 28})`"
            @mousemove="showTooltip($event, d)"
            @mouseleave="hideTooltip"
          >
            <circle :r="bubbleR(d)" :fill="bubbleFill(d)" class="tw-map-bubble" />
            <text class="tw-map-inset-label" x="22" y="4">{{ shortName(d) }}</text>
          </g>
        </g>

        <g class="tw-map-color-legend" :transform="`translate(28, ${height - 40})`">
          <text class="tw-map-legend-title" x="0" y="-22">
            顏色：該法院律師代理率
          </text>
          <rect x="0" y="-12" width="170" height="10" rx="5" fill="url(#metricGradient)" />
          <text class="tw-map-legend-text" x="0" y="16">0%</text>
          <text class="tw-map-legend-text" x="170" y="16" text-anchor="end">100%</text>
        </g>
      </svg>

      <div
        v-if="tooltip && tooltip.item"
        ref="tipEl"
        class="tw-map-tooltip"
        :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
      >
        <strong>{{ tooltip.item.court }}</strong>
        <div class="tw-map-tooltip-row">
          <span>縣市</span>
          <b>{{ tooltip.item.county || '—' }}</b>
        </div>
        <div class="tw-map-tooltip-row">
          <span>案件數</span>
          <b>{{ formatNumber(tooltip.item.count) }} 件</b>
        </div>
        <div class="tw-map-tooltip-row">
          <span>案件占比</span>
          <b>{{ tooltip.item.pct != null ? tooltip.item.pct : 0 }}%</b>
        </div>
        <div class="tw-map-tooltip-row" v-if="tooltip.item.lawyerRate !== undefined">
          <span>律師代理率</span>
          <b>{{ tooltip.item.lawyerRate }}%</b>
        </div>
        <div class="tw-map-tooltip-cats">
          <span>前幾大類別</span>
          <p>{{ topCategoryText(tooltip.item.topCats) }}</p>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.tw-map-card {
  position: relative;
  width: 100%;
  min-height: 620px;
  border: 1px solid #e5e7eb;
  border-radius: 22px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
  padding: 18px 18px 10px;
  overflow: hidden;
}

.tw-map-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 2px 4px 8px;
}

.tw-map-header h3 {
  margin: 0;
  color: #111827;
  font-size: 16px;
  line-height: 1.3;
  font-weight: 700;
}

.tw-map-header p {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}

.tw-map-svg {
  display: block;
  width: 100%;
  height: auto;
  max-height: 760px;
}

.tw-map-county {
  fill: #f1f5f9;
  stroke: #cbd5e1;
  stroke-width: 0.9;
  vector-effect: non-scaling-stroke;
  transition: fill 0.18s ease, stroke 0.18s ease;
}

.tw-map-county:hover {
  fill: #e2e8f0;
  stroke: #94a3b8;
}

.tw-map-bubble-group {
  cursor: pointer;
}

.tw-map-bubble {
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 1.6;
  opacity: 0.9;
  transition: opacity 0.15s ease, stroke-width 0.15s ease, transform 0.15s ease;
}

.tw-map-bubble-group:hover .tw-map-bubble,
.tw-map-inset g:hover .tw-map-bubble {
  opacity: 1;
  stroke-width: 2.4;
}

.tw-map-label,
.tw-map-inset-label {
  fill: #334155;
  font-size: 11px;
  font-weight: 750;
  paint-order: stroke;
  stroke: rgba(255, 255, 255, 0.86);
  stroke-width: 3px;
  stroke-linejoin: round;
  pointer-events: none;
}

.tw-map-inset-bg {
  fill: rgba(255, 255, 255, 0.86);
  stroke: #cbd5e1;
  stroke-width: 1;
}

.tw-map-inset-title,
.tw-map-legend-title {
  fill: #475569;
  font-size: 12px;
  font-weight: 800;
}

.tw-map-legend-circle {
  fill: rgba(148, 163, 184, 0.2);
  stroke: #94a3b8;
  stroke-width: 1.2;
}

.tw-map-legend-text {
  fill: #64748b;
  font-size: 11px;
  font-weight: 650;
}

.tw-map-tooltip {
  position: absolute;
  z-index: 20;
  width: min(320px, calc(100% - 28px));
  border: 1px solid rgba(203, 213, 225, 0.9);
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.94);
  color: white;
  padding: 12px 14px;
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.28);
  pointer-events: none;
  backdrop-filter: blur(10px);
}

.tw-map-tooltip strong {
  display: block;
  margin-bottom: 9px;
  font-size: 15px;
  line-height: 1.35;
}

.tw-map-tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  line-height: 1.8;
}

.tw-map-tooltip-row span,
.tw-map-tooltip-cats span {
  color: #cbd5e1;
}

.tw-map-tooltip-row b {
  color: #ffffff;
  font-weight: 800;
}

.tw-map-tooltip-cats {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(226, 232, 240, 0.18);
  font-size: 12px;
}

.tw-map-tooltip-cats p {
  margin: 4px 0 0;
  color: #f8fafc;
  line-height: 1.6;
}

.tw-map-loading,
.tw-map-error {
  display: grid;
  min-height: 420px;
  place-items: center;
  color: #64748b;
  font-size: 14px;
}

.tw-map-error {
  color: #b91c1c;
}

@media (max-width: 720px) {
  .tw-map-card {
    padding: 14px 12px 8px;
    border-radius: 18px;
  }

  .tw-map-header {
    flex-direction: column;
  }
}
</style>
