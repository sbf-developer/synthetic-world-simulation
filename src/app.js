import { CITY, SECTORS, SyntheticEconomy } from "./simulation.js";

const $ = (selector) => document.querySelector(selector);
const sim = new SyntheticEconomy({ seed: 42 });
let state = sim.getState();
let running = false;
let timer = null;
let speed = 1;
let selectedDistrict = null;

const money = (value) => {
  if (!Number.isFinite(value)) return "$0";
  const sign = value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1000000) return `${sign}$${(absolute / 1000000).toFixed(2)}m`;
  if (absolute >= 1000) return `${sign}$${Math.round(absolute).toLocaleString()}`;
  return `${sign}$${Math.round(absolute)}`;
};
const percent = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));

function setRangeOutputs() {
  $("#population-output").textContent = Number($("#population-input").value).toLocaleString();
  $("#wage-floor-output").textContent = money(Number($("#wage-floor-input").value));
  $("#tax-output").textContent = `${$("#tax-input").value}%`;
  $("#benefit-output").textContent = `${$("#benefit-input").value}%`;
  $("#housing-output").textContent = $("#housing-input").value;
  $("#rate-output").textContent = `${$("#rate-input").value}%`;
}

function policyFromInputs() {
  return {
    population: Number($("#population-input").value),
    wageFloor: Number($("#wage-floor-input").value),
    incomeTax: Number($("#tax-input").value) / 100,
    unemploymentBenefit: Number($("#benefit-input").value) / 100,
    construction: Number($("#housing-input").value),
    baseRate: Number($("#rate-input").value) / 100,
  };
}

function syncInputsFromPolicy() {
  $("#population-input").value = state.policy.population;
  $("#wage-floor-input").value = state.policy.wageFloor;
  $("#tax-input").value = Math.round(state.policy.incomeTax * 100);
  $("#benefit-input").value = Math.round(state.policy.unemploymentBenefit * 100);
  $("#housing-input").value = state.policy.construction;
  $("#rate-input").value = state.policy.baseRate * 100;
  setRangeOutputs();
}

function renderMetrics() {
  const latest = state.latest;
  $("#phase-label").textContent = state.phase === "stable" ? "Stable" : state.phase;
  $("#stat-month").textContent = state.monthLabel;
  $("#stat-gdp").textContent = money(latest.gdp);
  $("#stat-unemployment").textContent = percent(latest.unemployment);
  $("#stat-unemployment-note").textContent = `${latest.employed.toLocaleString()} employed citizens`;
  $("#stat-trust").textContent = percent(latest.trust, 0);
  $("#stat-trust-note").textContent = `${percent(latest.wellbeing, 0)} average wellbeing`;
  $("#rent-burden-readout").textContent = percent(latest.rentBurden);
  $("#map-population").textContent = latest.population.toLocaleString();
  $("#map-housing").textContent = latest.housingUnits.toLocaleString();
  $("#map-households-count").textContent = `${latest.population.toLocaleString()} households`;
  $("#map-firms-count").textContent = `${latest.firms.toLocaleString()} firms`;
}

function renderLegend() {
  $("#sector-legend").innerHTML = state.sectors.map((sector) => `<span class="sector-chip"><i style="background:${sector.color}"></i>${sector.name} ${state.sectorCounts[sector.id]}</span>`).join("");
}

function colorForDistrict(district) {
  const intensity = Math.round(25 + Math.min(1, district.unemployment) * 105);
  return `rgba(255, 128, 107, ${intensity / 1000})`;
}

function renderMap() {
  const canvas = $("#world-canvas");
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(320, bounds.width);
  const height = Math.max(260, bounds.height);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#101322";
  context.fillRect(0, 0, width, height);

  const districtWidth = width / 4;
  const districtHeight = height / 3;
  state.districts.forEach((district) => {
    const x = district.x * districtWidth;
    const y = district.y * districtHeight;
    context.fillStyle = colorForDistrict(district);
    context.fillRect(x + 1, y + 1, districtWidth - 2, districtHeight - 2);
    context.strokeStyle = district.id === selectedDistrict ? "rgba(246,196,83,0.8)" : "rgba(202,213,255,0.12)";
    context.lineWidth = district.id === selectedDistrict ? 2 : 1;
    context.strokeRect(x + 5, y + 5, districtWidth - 10, districtHeight - 10);
    context.fillStyle = "rgba(202,213,255,0.38)";
    context.font = "10px Inter, system-ui, sans-serif";
    context.fillText(`DISTRICT ${district.x + district.y * 4 + 1}`, x + 14, y + 21);
    context.fillStyle = "rgba(246,244,238,0.7)";
    context.font = "11px Inter, system-ui, sans-serif";
    context.fillText(`${percent(district.unemployment, 0)} unemployed`, x + 14, y + 38);
  });

  const mapX = (x) => (x + 0.5) * width / CITY.columns;
  const mapY = (y) => (y + 0.5) * height / CITY.rows;
  for (const household of state.households) {
    context.beginPath();
    context.arc(mapX(household.x), mapY(household.y), household.employed ? 2.15 : 2.7, 0, Math.PI * 2);
    context.fillStyle = household.employed ? "rgba(134,168,255,0.78)" : "rgba(255,128,107,0.92)";
    context.fill();
  }
  for (const firm of state.firms) {
    const sector = state.sectors.find((item) => item.id === firm.sector);
    const x = mapX(firm.x);
    const y = mapY(firm.y);
    context.fillStyle = sector?.color || "#f6f4ee";
    context.fillRect(x - 4, y - 4, 8, 8);
    context.strokeStyle = "rgba(13,15,27,0.8)";
    context.lineWidth = 1;
    context.strokeRect(x - 4, y - 4, 8, 8);
  }
}

function renderDistrictInspector() {
  const inspector = $("#district-inspector");
  const district = state.districts.find((item) => item.id === selectedDistrict);
  if (!district) {
    inspector.innerHTML = "<strong>City view</strong><span>Click a neighborhood to inspect local conditions.</span>";
    return;
  }
  inspector.innerHTML = `<strong>District ${district.x + district.y * 4 + 1}</strong><span>${district.households} households · ${percent(district.unemployment)} unemployed · ${percent(district.rentBurden)} rent burden</span>`;
}

function renderChart(elementId, values, color, formatter, decimals = 1) {
  const svg = $(`#${elementId}`);
  const width = elementId === "gdp-chart" ? 640 : 420;
  const height = 180;
  const padding = { top: 13, right: 18, bottom: 27, left: 45 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const safeValues = values.length ? values : [0];
  const minValue = Math.min(...safeValues);
  const maxValue = Math.max(...safeValues);
  const spread = Math.max(0.0001, maxValue - minValue);
  const low = minValue - spread * 0.1;
  const high = maxValue + spread * 0.1;
  const x = (index) => padding.left + (safeValues.length === 1 ? plotWidth / 2 : index / (safeValues.length - 1) * plotWidth);
  const y = (value) => padding.top + (1 - (value - low) / Math.max(0.0001, high - low)) * plotHeight;
  const linePath = safeValues.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${x(safeValues.length - 1).toFixed(2)},${padding.top + plotHeight} L ${x(0).toFixed(2)},${padding.top + plotHeight} Z`;
  const ticks = [0, 0.5, 1].map((position) => {
    const value = low + (high - low) * (1 - position);
    const yPosition = padding.top + plotHeight * position;
    return `<line class="chart-grid" x1="${padding.left}" x2="${width - padding.right}" y1="${yPosition}" y2="${yPosition}"/><text class="chart-axis" x="${padding.left - 8}" y="${yPosition + 3}" text-anchor="end">${escapeHtml(formatter(value, decimals))}</text>`;
  }).join("");
  const last = safeValues[safeValues.length - 1];
  const label = formatter(last, decimals);
  svg.innerHTML = `<title>${escapeHtml(label)} current</title>${ticks}<path class="chart-area" fill="${color}" d="${areaPath}"/><path class="chart-line" stroke="${color}" d="${linePath}"/><circle class="chart-end" fill="${color}" cx="${x(safeValues.length - 1)}" cy="${y(last)}" r="4"/><text class="chart-value" x="${Math.min(width - padding.right - 12, x(safeValues.length - 1) + 8)}" y="${Math.max(padding.top + 12, y(last) - 8)}">${escapeHtml(label)}</text><text class="chart-axis" x="${padding.left}" y="${height - 5}">older</text><text class="chart-axis" x="${width - padding.right}" y="${height - 5}" text-anchor="end">now</text>`;
}

function renderCharts() {
  renderChart("gdp-chart", state.history.gdp, "#86a8ff", (value) => money(value));
  renderChart("unemployment-chart", state.history.unemployment, "#ff806b", (value) => percent(value));
  renderChart("rent-chart", state.history.rentBurden, "#f6c453", (value) => percent(value));
}

function renderEvents() {
  $("#event-feed").innerHTML = state.events.slice(0, 5).map((event, index) => `<div class="event-item"><span class="event-index">0${index + 1}</span><span>${escapeHtml(event.text)}</span></div>`).join("");
}

function render() {
  renderMetrics();
  renderMap();
  renderDistrictInspector();
  renderLegend();
  renderCharts();
  renderEvents();
}

function advance() {
  state = sim.step();
  render();
}

function setRunning(value) {
  running = value;
  $("#run-toggle").textContent = running ? "Pause simulation" : "Run simulation";
  $("#run-toggle").classList.toggle("button-primary", !running);
  $("#run-toggle").classList.toggle("button-secondary", running);
  if (timer) window.clearInterval(timer);
  timer = running ? window.setInterval(advance, 650 / speed) : null;
}

function applyPolicy() {
  setRunning(false);
  sim.setPolicy(policyFromInputs());
  sim.reset();
  selectedDistrict = null;
  state = sim.getState();
  render();
}

$("#run-toggle").addEventListener("click", () => setRunning(!running));
$("#step-button").addEventListener("click", () => { setRunning(false); advance(); });
$("#shock-button").addEventListener("click", () => { sim.addShock(); state = sim.getState(); render(); });
$("#apply-policy").addEventListener("click", applyPolicy);
$("#speed-select").addEventListener("change", (event) => { speed = Number(event.target.value); if (running) setRunning(true); });
document.querySelectorAll(".scenario-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".scenario-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    sim.applyScenario(button.dataset.scenario);
    state = sim.getState();
    render();
  });
});
document.querySelectorAll("input[type=range]").forEach((input) => input.addEventListener("input", setRangeOutputs));
$("#world-canvas").addEventListener("click", (event) => {
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = Math.floor(((event.clientX - bounds.left) / bounds.width) * 4);
  const y = Math.floor(((event.clientY - bounds.top) / bounds.height) * 3);
  selectedDistrict = `${Math.max(0, Math.min(3, x))}-${Math.max(0, Math.min(2, y))}`;
  renderMap();
  renderDistrictInspector();
});
window.addEventListener("resize", renderMap);

syncInputsFromPolicy();
render();
