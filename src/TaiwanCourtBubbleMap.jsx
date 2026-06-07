import { useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { max as d3max, min as d3min } from "d3-array";
import { scaleSqrt, scaleSequential } from "d3-scale";
import { interpolateYlOrRd } from "d3-scale-chromatic";
import "./TaiwanCourtBubbleMap.css";

const DEFAULT_GEOJSON_URL =
  "https://cdn.jsdelivr.net/gh/g0v/twgeojson@master/json/twCounty2010.geo.json";
const ISLAND_COUNTIES = new Set(["澎湖縣", "金門縣", "連江縣"]);

function getCountyName(feature) {
  const p = (feature && feature.properties) || {};
  return p.COUNTYNAME || p.COUNTY_NAME || p.COUNTY || p.name || p.Name || p.NAME || p.C_Name || p.TOWNNAME || "";
}
function formatNumber(value) {
  return new Intl.NumberFormat("zh-TW").format(Number(value || 0));
}
function getMetricValue(d, metric) {
  const value = Number(d && d[metric]);
  if (Number.isFinite(value)) return value;
  return Number((d && (d.lawyerRate != null ? d.lawyerRate : d.pct)) || 0);
}
function topCategoryText(topCats = []) {
  if (!Array.isArray(topCats) || topCats.length === 0) return "無分類資料";
  return topCats.slice(0, 5).map((x) => `${x.name} ${formatNumber(x.count)} 件（${x.pct}%）`).join("、");
}

export default function TaiwanCourtBubbleMap({
  data = [],
  title = "法院案件分布地圖",
  subtitle = "氣泡大小代表案件量；顏色代表律師代理率或指定比例。",
  metric = "lawyerRate",
  geoJsonUrl = DEFAULT_GEOJSON_URL,
  height = 680,
  showLabels = true,
}) {
  const width = 560;
  const mainHeight = height - 28;
  const wrapRef = useRef(null);
  const tipEl = useRef(null);
  const [geoJson, setGeoJson] = useState(null);
  const [error, setError] = useState("");
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    let alive = true;
    setError("");
    fetch(geoJsonUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`GeoJSON 載入失敗：${res.status}`);
        return res.json();
      })
      .then((json) => { if (alive) setGeoJson(json); })
      .catch((err) => { if (alive) setError(err.message || "GeoJSON 載入失敗"); });
    return () => { alive = false; };
  }, [geoJsonUrl]);

  const safeData = useMemo(() =>
    (Array.isArray(data) ? data : [])
      .map((d) => ({ ...d, count: Number(d.count || 0), lat: Number(d.lat), lng: Number(d.lng) }))
      .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng) && d.count > 0),
  [data]);

  const chart = useMemo(() => {
    if (!geoJson || !geoJson.features || !geoJson.features.length) return null;
    const mainFeatures = geoJson.features.filter((f) => !ISLAND_COUNTIES.has(getCountyName(f)));
    const mainGeo = { type: "FeatureCollection", features: mainFeatures.length ? mainFeatures : geoJson.features };
    const projection = geoMercator().fitExtent([[42, 28], [width - 42, mainHeight - 34]], mainGeo);
    const path = geoPath(projection);
    const maxCount = d3max(safeData, (d) => d.count) || 1;
    const rScale = scaleSqrt().domain([0, maxCount]).range([4.5, 26]);
    // 顏色固定 0–100%，不隨資料縮放
    const colorScale = scaleSequential(interpolateYlOrRd).domain([0, 100]);
    return {
      mainGeo, projection, path, rScale, colorScale,
      mainPoints: safeData.filter((d) => !d.island),
      islandPoints: safeData.filter((d) => d.island),
      maxCount,
    };
  }, [geoJson, safeData, mainHeight]);

  function showTooltip(event, item) {
    const rect = wrapRef.current && wrapRef.current.getBoundingClientRect();
    if (!rect) { setTooltip({ x: 12, y: 12, item }); return; }
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const margin = 12;
    const tipW = (tipEl.current && tipEl.current.offsetWidth) || Math.min(320, rect.width - 24);
    const tipH = (tipEl.current && tipEl.current.offsetHeight) || 240;
    let left = cursorX + 16;
    if (left + tipW > rect.width - margin) left = cursorX - 16 - tipW;
    left = Math.max(margin, Math.min(left, rect.width - tipW - margin));
    let top = cursorY + 16;
    if (top + tipH > rect.height - margin) top = cursorY - 16 - tipH;
    top = Math.max(margin, Math.min(top, rect.height - tipH - margin));
    setTooltip({ x: left, y: top, item });
  }
  const hideTooltip = () => setTooltip(null);

  if (error) {
    return (
      <section className="tw-map-card">
        <div className="tw-map-header"><div><h3>{title}</h3><p>{subtitle}</p></div></div>
        <div className="tw-map-error">{error}</div>
      </section>
    );
  }
  if (!chart) {
    return (
      <section className="tw-map-card">
        <div className="tw-map-header"><div><h3>{title}</h3><p>{subtitle}</p></div></div>
        <div className="tw-map-loading">正在載入台灣地圖資料...</div>
      </section>
    );
  }

  const shortName = (d) => d.abbr || (d.court ? d.court.replace("地方法院", "") : "");

  return (
    <section className="tw-map-card" ref={wrapRef}>
      <div className="tw-map-header"><div><h3>{title}</h3><p>{subtitle}</p></div></div>

      <svg className="tw-map-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <defs>
          <filter id="bubbleShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.2" />
          </filter>
          <linearGradient id="metricGradient" x1="0%" x2="100%" y1="0%" y2="0%">
            <stop offset="0%" stopColor={chart.colorScale(0)} />
            <stop offset="50%" stopColor={chart.colorScale(50)} />
            <stop offset="100%" stopColor={chart.colorScale(100)} />
          </linearGradient>
        </defs>

        <g className="tw-map-basemap">
          {chart.mainGeo.features.map((feature, index) => (
            <path key={`county-${index}`} d={chart.path(feature) || ""} className="tw-map-county">
              <title>{getCountyName(feature)}</title>
            </path>
          ))}
        </g>

        <g className="tw-map-bubbles">
          {chart.mainPoints.map((d) => {
            const xy = chart.projection([d.lng, d.lat]);
            if (!xy) return null;
            const r = chart.rScale(d.count);
            return (
              <g key={d.court} className="tw-map-bubble-group" transform={`translate(${xy[0]}, ${xy[1]})`}
                 onMouseMove={(e) => showTooltip(e, d)} onMouseLeave={hideTooltip}>
                <circle r={r} fill={chart.colorScale(getMetricValue(d, metric))} className="tw-map-bubble" filter="url(#bubbleShadow)" />
                {showLabels && r >= 6 && (<text className="tw-map-label" x={r + 4} y="4">{shortName(d)}</text>)}
              </g>
            );
          })}
        </g>

        <g className="tw-map-inset" transform={`translate(${width - 164}, ${height - 156})`}>
          <rect width="132" height="122" rx="14" className="tw-map-inset-bg" />
          <text x="14" y="24" className="tw-map-inset-title">外島法院</text>
          {chart.islandPoints.map((d, index) => (
            <g key={`island-${d.court}`} transform={`translate(32, ${50 + index * 28})`}
               onMouseMove={(e) => showTooltip(e, d)} onMouseLeave={hideTooltip}>
              <circle r={chart.rScale(d.count)} fill={chart.colorScale(getMetricValue(d, metric))} className="tw-map-bubble" />
              <text className="tw-map-inset-label" x="22" y="4">{shortName(d)}</text>
            </g>
          ))}
        </g>

        <g className="tw-map-color-legend" transform={`translate(28, ${height - 40})`}>
          <text className="tw-map-legend-title" x="0" y="-22">顏色：該法院律師代理率</text>
          <rect x="0" y="-12" width="170" height="10" rx="5" fill="url(#metricGradient)" />
          <text className="tw-map-legend-text" x="0" y="16">0%</text>
          <text className="tw-map-legend-text" x="170" y="16" textAnchor="end">100%</text>
        </g>
      </svg>

      {tooltip && tooltip.item && (
        <div ref={tipEl} className="tw-map-tooltip" style={{ left: tooltip.x + "px", top: tooltip.y + "px" }}>
          <strong>{tooltip.item.court}</strong>
          <div className="tw-map-tooltip-row"><span>縣市</span><b>{tooltip.item.county || "—"}</b></div>
          <div className="tw-map-tooltip-row"><span>案件數</span><b>{formatNumber(tooltip.item.count)} 件</b></div>
          <div className="tw-map-tooltip-row"><span>案件占比</span><b>{tooltip.item.pct != null ? tooltip.item.pct : 0}%</b></div>
          {tooltip.item.lawyerRate !== undefined && (
            <div className="tw-map-tooltip-row"><span>律師代理率</span><b>{tooltip.item.lawyerRate}%</b></div>
          )}
          <div className="tw-map-tooltip-cats"><span>前幾大類別</span><p>{topCategoryText(tooltip.item.topCats)}</p></div>
        </div>
      )}
    </section>
  );
}
