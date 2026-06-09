let CANVAS_WIDTH = 1024;
let CANVAS_HEIGHT = 1024;
const canvas = document.querySelector("#editor");
const context = canvas.getContext("2d");
const artCanvas = document.createElement("canvas");
const artContext = artCanvas.getContext("2d");
const layerCanvas = document.createElement("canvas");
const layerContext = layerCanvas.getContext("2d");
const maskCanvas = document.createElement("canvas");
const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
const templateImage = new Image();

const state = {
  layers: [],
  selectedId: null,
  selectedScope: "all",
  models: [],
  currentModel: null,
  panels: [],
  canvasMode: "move",
  maskCache: {},
  dragging: false,
  interaction: "move",
  pointer: null,
  start: null,
  exportBlob: null,
  renderVersion: 0,
  achievements: new Set(),
  generationSize: "1024x1024",
  generationQuality: "medium",
  references: [],
  paintMode: "fill",
  activeMarkerId: null,
};

const ui = Object.fromEntries(
  [
    "download", "empty-state", "file-size", "flip", "generate", "idea",
    "output-details", "reset", "rotation", "rotation-value", "sample",
    "scale", "scale-value", "scope-picker", "status", "toast", "image-upload",
    "crop", "crop-value", "delete-layer", "backward", "layer-list", "layer-count",
    "canvas-mode", "canvas-help",
    "generation-size", "generation-quality", "reference-images", "reference-list",
    "fill-color", "hex-color", "add-color",
    "paint-mode", "marker-options", "marker-width", "marker-width-value",
    "marker-strength", "marker-strength-value", "new-marker-layer",
    "undo-marker",
    "ai-fab", "ai-dock", "ai-close", "ai-chat-log", "save-project",
    "model-select", "model-meta",
  ].map((id) => [id.replaceAll("-", "_"), document.querySelector(`#${id}`)]),
);

const selectedLayer = () => state.layers.find((layer) => layer.id === state.selectedId);
const scopeLabel = (scope) => scope === "all" ? "Whole car" : state.panels.find((panel) => panel.id === scope)?.label || scope;
function unlock(id, label) {
  if (state.achievements.has(id)) return;
  state.achievements.add(id);
  const badge = document.querySelector(`#badge-${id}`);
  badge.textContent = `★ ${label}`;
  badge.classList.add("unlocked");
  showToast(`Badge unlocked: ${label}!`);
}

function setStatus(message, type = "ready") {
  ui.status.textContent = message;
  ui.status.className = `status ${type}`;
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => ui.toast.classList.remove("show"), 2400);
}

function addChatMessage(text, sender = "bot") {
  const message = document.createElement("div");
  message.className = `ai-message ${sender}`;
  message.textContent = text;
  ui.ai_chat_log.append(message);
  ui.ai_chat_log.scrollTop = ui.ai_chat_log.scrollHeight;
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderReferences() {
  if (!state.references.length) {
    ui.reference_list.innerHTML = "<span>No references yet</span>";
    return;
  }
  ui.reference_list.innerHTML = "";
  state.references.forEach((reference, index) => {
    const button = document.createElement("button");
    button.title = "Remove reference";
    button.innerHTML = `<img src="${reference}" alt="Reference ${index + 1}">`;
    button.addEventListener("click", () => {
      state.references.splice(index, 1);
      renderReferences();
    });
    ui.reference_list.append(button);
  });
}

function resizeCanvases(width, height) {
  CANVAS_WIDTH = width;
  CANVAS_HEIGHT = height;
  [canvas, artCanvas, layerCanvas, maskCanvas].forEach((item) => {
    item.width = width;
    item.height = height;
  });
  document.querySelector(".canvas-wrap").style.aspectRatio = `${width} / ${height}`;
  ui.output_details.textContent = `PNG · ${width} × ${height} · Tesla-ready shape`;
}

function detectPanels() {
  maskContext.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  maskContext.drawImage(templateImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const imageData = maskContext.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const alpha = new Uint8ClampedArray(CANVAS_WIDTH * CANVAS_HEIGHT);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = imageData.data[index * 4 + 3];
  const seen = new Uint8Array(alpha.length);
  const panels = [];
  for (let y = 0; y < CANVAS_HEIGHT; y += 1) {
    for (let x = 0; x < CANVAS_WIDTH; x += 1) {
      const start = y * CANVAS_WIDTH + x;
      if (!alpha[start] || seen[start]) continue;
      const queue = [[x, y]];
      seen[start] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const [cx, cy] = queue[cursor];
        area += 1;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
          if (nx < 0 || nx >= CANVAS_WIDTH || ny < 0 || ny >= CANVAS_HEIGHT) continue;
          const index = ny * CANVAS_WIDTH + nx;
          if (!alpha[index] || seen[index]) continue;
          seen[index] = 1;
          queue.push([nx, ny]);
        }
      }
      panels.push({ id: `panel-${panels.length + 1}`, area, bbox: [minX, minY, maxX + 1, maxY + 1], seed: [x, y] });
    }
  }
  panels.sort((a, b) => b.area - a.area);
  panels.forEach((panel, index) => {
    panel.id = `panel-${index + 1}`;
    panel.label = `Panel ${index + 1}`;
  });
  state.panels = panels;
}

function renderScopeButtons() {
  if (state.selectedScope !== "all" && !state.panels.some((panel) => panel.id === state.selectedScope)) {
    state.selectedScope = "all";
  }
  ui.scope_picker.innerHTML = "";
  const buttons = [{ id: "all", label: "Whole car" }, ...state.panels.map(({ id, label }) => ({ id, label }))];
  for (const item of buttons) {
    const button = document.createElement("button");
    button.dataset.scope = item.id;
    button.textContent = item.label;
    button.classList.toggle("active", item.id === state.selectedScope);
    ui.scope_picker.append(button);
  }
}

async function loadModel(slug, { clearLayers = true } = {}) {
  const model = state.models.find((item) => item.slug === slug) || state.models[0];
  if (!model) return;
  state.currentModel = model;
  templateImage.src = model.template;
  await templateImage.decode();
  resizeCanvases(templateImage.naturalWidth, templateImage.naturalHeight);
  state.maskCache = {};
  detectPanels();
  state.selectedScope = "all";
  if (clearLayers) {
    state.layers = [];
    state.selectedId = null;
    state.activeMarkerId = null;
    ui.empty_state.classList.remove("hidden");
    ui.download.disabled = true;
    ui.save_project.disabled = true;
    ui.file_size.textContent = "No wrap yet";
  }
  renderScopeButtons();
  renderLayerList();
  syncControls();
  render();
  ui.model_meta.textContent = `${model.width}×${model.height} template · ${state.panels.length} sections`;
}

async function loadModels() {
  const response = await fetch("/assets/models/manifest.json");
  const manifest = await response.json();
  state.models = manifest.models;
  ui.model_select.innerHTML = state.models
    .map((model) => `<option value="${model.slug}">${model.name}</option>`)
    .join("");
  const defaultSlug = state.models.some((model) => model.slug === "modely-2025-premium")
    ? "modely-2025-premium"
    : state.models[0]?.slug;
  ui.model_select.value = defaultSlug;
  await loadModel(defaultSlug);
}

function createMask(scope) {
  if (scope !== "all" && !state.panels.some((panel) => panel.id === scope)) scope = "all";
  if (state.maskCache[scope]) return state.maskCache[scope];
  maskContext.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  maskContext.drawImage(templateImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const imageData = maskContext.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  if (scope !== "all") {
    const panel = state.panels.find((item) => item.id === scope);
    const [seedX, seedY] = panel?.seed || [0, 0];
    const sourceAlpha = new Uint8ClampedArray(CANVAS_WIDTH * CANVAS_HEIGHT);
    for (let index = 0; index < sourceAlpha.length; index += 1) sourceAlpha[index] = imageData.data[index * 4 + 3];
    const keep = new Uint8Array(CANVAS_WIDTH * CANVAS_HEIGHT);
    const queue = [[seedX, seedY]];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const [x, y] = queue[cursor];
      const index = y * CANVAS_WIDTH + x;
      if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT || keep[index] || !sourceAlpha[index]) continue;
      keep[index] = 1;
      queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
    }
    for (let index = 0; index < keep.length; index += 1) {
      if (!keep[index]) imageData.data[index * 4 + 3] = 0;
    }
  }
  const result = document.createElement("canvas");
  result.width = CANVAS_WIDTH;
  result.height = CANVAS_HEIGHT;
  result.getContext("2d").putImageData(imageData, 0, 0);
  state.maskCache[scope] = result;
  return result;
}

function drawEmptyTesla() {
  context.save();
  context.shadowColor = "rgba(74,58,126,.18)";
  context.shadowBlur = 14;
  context.drawImage(templateImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.globalCompositeOperation = "source-atop";
  context.fillStyle = "rgba(255,255,255,.9)";
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.restore();
}

function drawLayer(target, layer) {
  if (layer.type === "color") {
    target.fillStyle = layer.color;
    target.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    return;
  }
  if (layer.type === "marker") {
    target.save();
    target.strokeStyle = layer.color;
    target.globalAlpha = layer.strength;
    target.lineWidth = layer.width;
    target.lineCap = "round";
    target.lineJoin = "round";
    for (const stroke of layer.strokes) {
      if (stroke.length < 2) continue;
      target.beginPath();
      target.moveTo(stroke[0].x, stroke[0].y);
      for (const point of stroke.slice(1)) target.lineTo(point.x, point.y);
      target.stroke();
    }
    target.restore();
    return;
  }
  target.save();
  target.translate(layer.x, layer.y);
  target.rotate((layer.rotation * Math.PI) / 180);
  target.scale(layer.flip ? -1 : 1, 1);
  target.beginPath();
  target.rect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
  target.clip();

  const width = layer.image.width * layer.imageScale * layer.crop;
  const height = layer.image.height * layer.imageScale * layer.crop;
  target.drawImage(layer.image, -width / 2 + layer.cropX, -height / 2 + layer.cropY, width, height);
  target.restore();
}

function renderedImageSize(layer) {
  return {
    width: layer.image.width * layer.imageScale * layer.crop,
    height: layer.image.height * layer.imageScale * layer.crop,
  };
}

function clampCrop(layer) {
  const imageSize = renderedImageSize(layer);
  const maxX = Math.max(0, (imageSize.width - layer.width) / 2);
  const maxY = Math.max(0, (imageSize.height - layer.height) / 2);
  layer.cropX = Math.max(-maxX, Math.min(maxX, layer.cropX));
  layer.cropY = Math.max(-maxY, Math.min(maxY, layer.cropY));
}

function compositeLayers() {
  artContext.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  for (const layer of state.layers) {
    layerContext.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawLayer(layerContext, layer);
    layerContext.globalCompositeOperation = "destination-in";
    layerContext.drawImage(createMask(layer.scope), 0, 0);
    layerContext.globalCompositeOperation = "source-over";
    artContext.drawImage(layerCanvas, 0, 0);
  }
}

function corners(layer) {
  const angle = (layer.rotation * Math.PI) / 180;
  const rotate = ({ x, y }) => ({
    x: layer.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: layer.y + x * Math.sin(angle) + y * Math.cos(angle),
  });
  return {
    tl: rotate({ x: -layer.width / 2, y: -layer.height / 2 }),
    tr: rotate({ x: layer.width / 2, y: -layer.height / 2 }),
    br: rotate({ x: layer.width / 2, y: layer.height / 2 }),
    bl: rotate({ x: -layer.width / 2, y: layer.height / 2 }),
    rotate: rotate({ x: 0, y: -layer.height / 2 - 65 }),
  };
}

function drawSelection(layer) {
  if (layer.type !== "image") return;
  const points = corners(layer);
  context.save();
  context.strokeStyle = "#6c4df6";
  context.lineWidth = 5;
  context.setLineDash([12, 8]);
  context.beginPath();
  context.moveTo(points.tl.x, points.tl.y);
  context.lineTo(points.tr.x, points.tr.y);
  context.lineTo(points.br.x, points.br.y);
  context.lineTo(points.bl.x, points.bl.y);
  context.closePath();
  context.stroke();
  context.setLineDash([]);

  for (const point of [points.tl, points.tr, points.bl, points.br]) {
    context.fillStyle = "#6c4df6";
    context.strokeStyle = "#25233b";
    context.lineWidth = 3;
    context.fillRect(point.x - 14, point.y - 14, 28, 28);
    context.strokeRect(point.x - 14, point.y - 14, 28, 28);
  }
  context.strokeStyle = "#25233b";
  context.beginPath();
  context.moveTo((points.tl.x + points.tr.x) / 2, (points.tl.y + points.tr.y) / 2);
  context.lineTo(points.rotate.x, points.rotate.y);
  context.stroke();
  context.fillStyle = "#ffd84d";
  context.beginPath();
  context.arc(points.rotate.x, points.rotate.y, 18, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  if (state.canvasMode === "crop") {
    context.fillStyle = "rgba(37,35,59,.82)";
    context.fillRect(layer.x - 72, layer.y - 20, 144, 40);
    context.fillStyle = "white";
    context.font = "800 19px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("Drag to crop", layer.x, layer.y + 1);
  }
  context.restore();
}

function render() {
  state.renderVersion += 1;
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawEmptyTesla();
  compositeLayers();
  context.drawImage(artCanvas, 0, 0);
  if (selectedLayer()) drawSelection(selectedLayer());
  updateExport(state.renderVersion);
}

function canvasBlob(source) {
  return new Promise((resolve) => source.toBlob(resolve, "image/png"));
}

async function updateExport(version) {
  if (!state.layers.length) return;
  for (const scale of [1, 0.75, 0.5]) {
    const width = Math.round(CANVAS_WIDTH * scale);
    const height = Math.round(CANVAS_HEIGHT * scale);
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    output.getContext("2d").drawImage(artCanvas, 0, 0, width, height);
    const blob = await canvasBlob(output);
    if (version !== state.renderVersion || !blob) return;
    if (blob.size <= 1_000_000 || scale === 0.5) {
      state.exportBlob = blob;
      ui.file_size.textContent = `${Math.round(blob.size / 1024)} KB · ready`;
      ui.output_details.textContent = `PNG · ${width} × ${height} · Tesla-ready shape`;
      ui.save_project.disabled = false;
      return;
    }
  }
}

function syncControls() {
  const layer = selectedLayer();
  if (!layer) {
    [ui.scale, ui.rotation, ui.crop, ui.flip, ui.reset, ui.backward, ui.delete_layer]
      .forEach((control) => { control.disabled = true; });
    return;
  }
  [ui.backward, ui.delete_layer].forEach((control) => { control.disabled = false; });
  const disabled = layer.type !== "image";
  [ui.scale, ui.rotation, ui.crop, ui.flip, ui.reset].forEach((control) => { control.disabled = disabled; });
  if (disabled) {
    state.selectedScope = layer.scope;
    ui.scope_picker.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.scope === layer.scope));
    return;
  }
  ui.scale.value = Math.round((layer.width / layer.baseWidth) * 100);
  ui.scale_value.textContent = `${ui.scale.value}%`;
  ui.rotation.value = Math.round(layer.rotation);
  ui.rotation_value.textContent = `${ui.rotation.value}°`;
  ui.crop.value = Math.round(layer.crop * 100);
  ui.crop_value.textContent = `${ui.crop.value}%`;
  state.selectedScope = layer.scope;
  ui.scope_picker.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.scope === layer.scope);
  });
}

function renderLayerList() {
  ui.layer_count.textContent = state.layers.length;
  if (!state.layers.length) {
    ui.layer_list.innerHTML = '<span class="layer-empty">Add pictures to start.</span>';
    return;
  }
  ui.layer_list.innerHTML = "";
  [...state.layers].reverse().forEach((layer, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layer-item";
    button.classList.toggle("active", layer.id === state.selectedId);
    const content = layer.type === "color"
      ? `<span style="background:${layer.color};width:42px;height:34px;border-radius:6px"></span><span>${scopeLabel(layer.scope)} color</span>`
      : layer.type === "marker"
        ? `<span style="background:${layer.color};width:42px;height:34px;border-radius:6px;opacity:${layer.strength}"></span><span>${scopeLabel(layer.scope)} marker</span>`
      : `<img src="${layer.source}" alt=""><span>Sticker ${state.layers.length - index}</span>`;
    button.innerHTML = `<span class="layer-main">${content}</span><span class="layer-remove" aria-label="Remove layer">×</span>`;
    button.addEventListener("click", () => {
      if (state.selectedId === layer.id) deselectLayer();
      else selectLayer(layer.id);
    });
    button.querySelector(".layer-remove").addEventListener("click", (event) => {
      event.stopPropagation();
      removeLayer(layer.id);
    });
    ui.layer_list.append(button);
  });
}

function selectLayer(id) {
  state.selectedId = id;
  syncControls();
  renderLayerList();
  render();
}

function deselectLayer() {
  state.selectedId = null;
  syncControls();
  renderLayerList();
  render();
  setStatus("Nothing selected");
}

function removeLayer(id) {
  const index = state.layers.findIndex((layer) => layer.id === id);
  if (index < 0) return;
  state.layers.splice(index, 1);
  if (state.selectedId === id) state.selectedId = state.layers.at(-1)?.id || null;
  if (state.activeMarkerId === id) state.activeMarkerId = null;
  if (!state.layers.length) {
    ui.empty_state.classList.remove("hidden");
    ui.download.disabled = true;
    ui.save_project.disabled = true;
    ui.file_size.textContent = "No wrap yet";
  }
  renderLayerList();
  syncControls();
  render();
}

async function addArtwork(source) {
  try {
    const image = await loadImage(source);
    const ratio = image.width / image.height;
    const maxSize = Math.min(CANVAS_WIDTH, CANVAS_HEIGHT) * 0.42;
    const width = ratio >= 1 ? maxSize : maxSize * ratio;
    const height = ratio >= 1 ? maxSize / ratio : maxSize;
    const layer = {
      id: crypto.randomUUID(),
      type: "image",
      image,
      source,
      x: CANVAS_WIDTH / 2 + (state.layers.length % 4) * 28,
      y: CANVAS_HEIGHT / 2 + (state.layers.length % 4) * 28,
      width,
      height,
      baseWidth: width,
      baseHeight: height,
      baseImageScale: Math.max(width / image.width, height / image.height),
      imageScale: Math.max(width / image.width, height / image.height),
      crop: 1,
      cropX: 0,
      cropY: 0,
      rotation: 0,
      flip: false,
      scope: state.selectedScope,
    };
    state.layers.push(layer);
    ui.empty_state.classList.add("hidden");
    ui.download.disabled = false;
    setStatus("Sticker added!");
    unlock("art", "Art Maker");
    selectLayer(layer.id);
  } catch {
    showToast("That picture could not be opened.");
  }
}

function validHex(value) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function addColorLayer(color) {
  if (!validHex(color)) return showToast("Use a hex color like #6C4DF6.");
  const layer = {
    id: crypto.randomUUID(),
    type: "color",
    color,
    scope: state.selectedScope,
  };
  state.layers.push(layer);
  ui.empty_state.classList.add("hidden");
  ui.download.disabled = false;
  setStatus(`${state.selectedScope} painted!`);
  selectLayer(layer.id);
}

function addMarkerLayer() {
  const color = ui.hex_color.value;
  if (!validHex(color)) return showToast("Use a hex color like #6C4DF6.");
  const layer = {
    id: crypto.randomUUID(),
    type: "marker",
    color,
    width: Number(ui.marker_width.value),
    strength: Number(ui.marker_strength.value) / 100,
    scope: state.selectedScope,
    strokes: [],
  };
  state.layers.push(layer);
  state.activeMarkerId = layer.id;
  ui.empty_state.classList.add("hidden");
  ui.download.disabled = false;
  selectLayer(layer.id);
  setStatus("Marker ready. Draw on the Tesla!");
}

ui.image_upload.addEventListener("change", async () => {
  for (const file of ui.image_upload.files || []) {
    if (file.size <= 20_000_000) await addArtwork(await fileToDataUrl(file));
  }
  ui.image_upload.value = "";
});

ui.sample.addEventListener("click", () => {
  const sample = document.createElement("canvas");
  sample.width = 800;
  sample.height = 520;
  const sampleContext = sample.getContext("2d");
  sampleContext.fillStyle = "#ffd84d";
  sampleContext.fillRect(0, 0, 800, 520);
  ["#6c4df6", "#ff7f6e", "#68e5b7"].forEach((color, index) => {
    sampleContext.fillStyle = color;
    sampleContext.fillRect(index * 270 - 40, 0, 230, 520);
  });
  sampleContext.fillStyle = "white";
  sampleContext.font = "900 120px sans-serif";
  sampleContext.textAlign = "center";
  sampleContext.fillText("WOW!", 400, 310);
  addArtwork(sample.toDataURL());
});

ui.model_select.addEventListener("change", async () => {
  if (!ui.model_select) return;
  const nextModel = ui.model_select.value;
  const previousModel = state.currentModel?.slug;
  const shouldSwitch = !state.layers.length || confirm("Switching Tesla models clears the current design. Continue?");
  if (!shouldSwitch) {
    ui.model_select.value = previousModel;
    return;
  }
  setStatus("Loading Tesla template...", "busy");
  await loadModel(nextModel, { clearLayers: true });
  setStatus(`${state.currentModel.name} ready!`);
});

function setAiDock(open) {
  ui.ai_dock.hidden = !open;
  ui.ai_fab.setAttribute("aria-expanded", String(open));
  if (open) ui.idea.focus();
}

ui.ai_fab.addEventListener("click", () => setAiDock(ui.ai_dock.hidden));
ui.ai_close.addEventListener("click", () => setAiDock(false));

ui.generation_size.addEventListener("click", (event) => {
  const button = event.target.closest("[data-size]");
  if (!button) return;
  state.generationSize = button.dataset.size;
  ui.generation_size.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
});
ui.generation_quality.addEventListener("click", (event) => {
  const button = event.target.closest("[data-quality]");
  if (!button) return;
  state.generationQuality = button.dataset.quality;
  ui.generation_quality.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
});
ui.reference_images.addEventListener("change", async () => {
  const available = Math.max(0, 16 - state.references.length);
  const files = [...(ui.reference_images.files || [])].slice(0, available);
  for (const file of files) {
    if (file.size <= 20_000_000) state.references.push(await fileToDataUrl(file));
  }
  ui.reference_images.value = "";
  renderReferences();
});

function updateActiveMarkerColor(color) {
  const layer = selectedLayer();
  if (layer?.type === "marker") {
    layer.color = color;
    renderLayerList();
    render();
  }
}

ui.fill_color.addEventListener("input", () => {
  ui.hex_color.value = ui.fill_color.value;
  updateActiveMarkerColor(ui.fill_color.value);
});
ui.hex_color.addEventListener("input", () => {
  if (validHex(ui.hex_color.value)) {
    ui.fill_color.value = ui.hex_color.value;
    updateActiveMarkerColor(ui.hex_color.value);
  }
});
document.querySelectorAll("[data-color]").forEach((button) => {
  button.addEventListener("click", () => {
    ui.fill_color.value = button.dataset.color;
    ui.hex_color.value = button.dataset.color;
  });
});
ui.add_color.addEventListener("click", () => addColorLayer(ui.hex_color.value));
ui.paint_mode.addEventListener("click", (event) => {
  const button = event.target.closest("[data-paint-mode]");
  if (!button) return;
  state.paintMode = button.dataset.paintMode;
  ui.paint_mode.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  ui.marker_options.hidden = state.paintMode !== "marker";
  ui.add_color.hidden = state.paintMode === "marker";
  ui.canvas_help.textContent = state.paintMode === "marker"
    ? "Marker mode: draw directly on the Tesla. Lines stay inside the selected car section."
    : "Move mode: drag inside the rectangle to move it. Purple corners resize. Yellow dot rotates.";
  setStatus(state.paintMode === "marker" ? "Marker mode" : "Fill mode");
});
ui.marker_width.addEventListener("input", () => {
  ui.marker_width_value.textContent = `${ui.marker_width.value} px`;
  const layer = selectedLayer();
  if (layer?.type === "marker") layer.width = Number(ui.marker_width.value);
  render();
});
ui.marker_strength.addEventListener("input", () => {
  ui.marker_strength_value.textContent = `${ui.marker_strength.value}%`;
  const layer = selectedLayer();
  if (layer?.type === "marker") layer.strength = Number(ui.marker_strength.value) / 100;
  render();
});
ui.new_marker_layer.addEventListener("click", addMarkerLayer);
ui.undo_marker.addEventListener("click", () => {
  const layer = selectedLayer();
  if (layer?.type !== "marker" || !layer.strokes.length) return;
  layer.strokes.pop();
  render();
});

ui.generate.addEventListener("click", async () => {
  if (ui.idea.value.trim().length < 3) return showToast("Tell AI what to draw first.");
  ui.generate.disabled = true;
  addChatMessage(ui.idea.value.trim(), "user");
  setStatus("Making a new sticker...", "busy");
  addChatMessage(state.references.length ? "Using your references to make a new sticker..." : "Making a new sticker from your idea...");
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idea: ui.idea.value.trim(),
        size: state.generationSize,
        quality: state.generationQuality,
        references: state.references,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    await addArtwork(result.image);
    addChatMessage("Done! I added it as a new sticker.");
  } catch (error) {
    setStatus("Could not make art", "error");
    addChatMessage(error.message || "I could not make that image.");
    showToast(error.message);
  } finally {
    ui.generate.disabled = false;
  }
});

function deleteSelectedLayer() {
  if (state.selectedId) removeLayer(state.selectedId);
}

ui.scope_picker.addEventListener("click", (event) => {
  const button = event.target.closest("[data-scope]");
  if (!button) return;
  state.selectedScope = button.dataset.scope;
  const layer = selectedLayer();
  if (layer) layer.scope = state.selectedScope;
  ui.scope_picker.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  if (state.selectedScope !== "all") unlock("panel", "Panel Pro");
  render();
});

ui.scale.addEventListener("input", () => {
  const layer = selectedLayer();
  if (!layer || layer.type === "color") return;
  const factor = Number(ui.scale.value) / 100;
  layer.width = layer.baseWidth * factor;
  layer.height = layer.baseHeight * factor;
  layer.imageScale = layer.baseImageScale * factor;
  layer.cropX *= factor / (layer.lastScaleFactor || 1);
  layer.cropY *= factor / (layer.lastScaleFactor || 1);
  layer.lastScaleFactor = factor;
  clampCrop(layer);
  ui.scale_value.textContent = `${ui.scale.value}%`;
  render();
});
ui.rotation.addEventListener("input", () => {
  const layer = selectedLayer();
  if (!layer || layer.type === "color") return;
  layer.rotation = Number(ui.rotation.value);
  ui.rotation_value.textContent = `${ui.rotation.value}°`;
  render();
});
ui.crop.addEventListener("input", () => {
  const layer = selectedLayer();
  if (!layer || layer.type === "color") return;
  layer.crop = Number(ui.crop.value) / 100;
  clampCrop(layer);
  ui.crop_value.textContent = `${ui.crop.value}%`;
  render();
});
ui.flip.addEventListener("click", () => {
  const layer = selectedLayer();
  if (!layer || layer.type === "color") return;
  layer.flip = !layer.flip;
  unlock("remix", "Remix Master");
  render();
});
ui.reset.addEventListener("click", () => {
  const layer = selectedLayer();
  if (!layer || layer.type === "color") return;
  Object.assign(layer, { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, width: layer.baseWidth, height: layer.baseHeight, imageScale: layer.baseImageScale, lastScaleFactor: 1, crop: 1, cropX: 0, cropY: 0, rotation: 0, flip: false });
  syncControls();
  render();
});
ui.delete_layer.addEventListener("click", () => {
  deleteSelectedLayer();
});
ui.backward.addEventListener("click", () => {
  const index = state.layers.findIndex((layer) => layer.id === state.selectedId);
  if (index <= 0) return;
  [state.layers[index - 1], state.layers[index]] = [state.layers[index], state.layers[index - 1]];
  renderLayerList();
  render();
});

function canvasPoint(event) {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * CANVAS_WIDTH,
    y: ((event.clientY - box.top) / box.height) * CANVAS_HEIGHT,
  };
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function localPoint(point, layer) {
  const angle = (-layer.rotation * Math.PI) / 180;
  const dx = point.x - layer.x;
  const dy = point.y - layer.y;
  return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function hitLayer(point, layer) {
  if (layer.type !== "image") return false;
  const local = localPoint(point, layer);
  return Math.abs(local.x) <= layer.width / 2 && Math.abs(local.y) <= layer.height / 2;
}

ui.canvas_mode.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (!button) return;
  state.canvasMode = button.dataset.mode;
  ui.canvas_mode.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  ui.canvas_help.textContent = state.canvasMode === "crop"
    ? "Crop mode: drag purple corners to change the blue crop box. Drag inside to reposition the picture."
    : "Move mode: drag inside the rectangle to move it. Purple corners resize. Yellow dot rotates.";
  render();
});

canvas.addEventListener("pointerdown", (event) => {
  const point = canvasPoint(event);
  if (state.paintMode === "marker") {
    let marker = state.layers.find((layer) => layer.id === state.activeMarkerId);
    if (!marker || marker.type !== "marker" || marker.scope !== state.selectedScope) {
      addMarkerLayer();
      marker = selectedLayer();
    }
    marker.strokes.push([point]);
    state.dragging = true;
    state.interaction = "marker";
    state.pointer = point;
    canvas.setPointerCapture(event.pointerId);
    render();
    return;
  }
  let layer = selectedLayer();
  const currentCorners = layer?.type === "image" ? corners(layer) : null;
  const resizeHandle = layer
    && currentCorners
    ? Object.entries(currentCorners)
      .filter(([name]) => name !== "rotate")
      .find(([, corner]) => distance(point, corner) < 45)
    : null;
  if (layer && currentCorners && distance(point, currentCorners.rotate) < 42) state.interaction = "rotate";
  else if (resizeHandle) state.interaction = state.canvasMode === "crop" ? "crop-resize" : "resize";
  else {
    layer = [...state.layers].reverse().find((candidate) => hitLayer(point, candidate));
    if (!layer) {
      deselectLayer();
      return;
    }
    selectLayer(layer.id);
    state.interaction = state.canvasMode;
  }
  state.dragging = true;
  state.pointer = point;
  const opposite = { tl: "br", tr: "bl", br: "tl", bl: "tr" };
  state.start = {
    x: layer.x,
    y: layer.y,
    cropX: layer.cropX,
    cropY: layer.cropY,
    width: layer.width,
    height: layer.height,
    imageScale: layer.imageScale,
    rotation: layer.rotation,
    angle: Math.atan2(point.y - layer.y, point.x - layer.x),
    anchor: resizeHandle ? currentCorners[opposite[resizeHandle[0]]] : null,
  };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  const layer = selectedLayer();
  const point = canvasPoint(event);
  if (state.interaction === "marker") {
    const marker = state.layers.find((candidate) => candidate.id === state.activeMarkerId);
    marker?.strokes.at(-1)?.push(point);
  } else if (state.interaction === "move") {
    layer.x = state.start.x + point.x - state.pointer.x;
    layer.y = state.start.y + point.y - state.pointer.y;
  } else if (state.interaction === "crop") {
    const angle = (-layer.rotation * Math.PI) / 180;
    const dx = point.x - state.pointer.x;
    const dy = point.y - state.pointer.y;
    const flipDirection = layer.flip ? -1 : 1;
    layer.cropX = state.start.cropX + (dx * Math.cos(angle) - dy * Math.sin(angle)) * flipDirection;
    layer.cropY = state.start.cropY + dx * Math.sin(angle) + dy * Math.cos(angle);
    clampCrop(layer);
  } else if (state.interaction === "resize") {
    const startRadius = Math.hypot(state.start.width, state.start.height) / 2;
    const factor = Math.max(.2, Math.min(5, distance(point, { x: state.start.x, y: state.start.y }) / startRadius));
    layer.width = state.start.width * factor;
    layer.height = state.start.height * factor;
    layer.imageScale = state.start.imageScale * factor;
    layer.cropX = state.start.cropX * factor;
    layer.cropY = state.start.cropY * factor;
    clampCrop(layer);
  } else if (state.interaction === "crop-resize") {
    const anchor = state.start.anchor;
    const angle = (-state.start.rotation * Math.PI) / 180;
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const newWidth = Math.max(60, Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle)));
    const newHeight = Math.max(60, Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle)));
    const newX = (anchor.x + point.x) / 2;
    const newY = (anchor.y + point.y) / 2;
    const centerDx = state.start.x - newX;
    const centerDy = state.start.y - newY;
    const localCenterDx = centerDx * Math.cos(angle) - centerDy * Math.sin(angle);
    const localCenterDy = centerDx * Math.sin(angle) + centerDy * Math.cos(angle);
    layer.width = newWidth;
    layer.height = newHeight;
    layer.x = newX;
    layer.y = newY;
    layer.cropX = state.start.cropX + localCenterDx * (layer.flip ? -1 : 1);
    layer.cropY = state.start.cropY + localCenterDy;
    clampCrop(layer);
  } else {
    layer.rotation = state.start.rotation + ((Math.atan2(point.y - layer.y, point.x - layer.x) - state.start.angle) * 180) / Math.PI;
  }
  syncControls();
  render();
});
canvas.addEventListener("pointerup", () => { state.dragging = false; });
canvas.addEventListener("pointercancel", () => { state.dragging = false; });
document.addEventListener("keydown", (event) => {
  const tag = event.target.tagName;
  const isTyping = ["INPUT", "TEXTAREA"].includes(tag);
  if (event.key === "Escape" && !ui.ai_dock.hidden) {
    setAiDock(false);
    return;
  }
  if (event.key === "Escape") deselectLayer();
  if (!isTyping && ["Delete", "Backspace"].includes(event.key) && state.selectedId) {
    event.preventDefault();
    deleteSelectedLayer();
  }
});

ui.download.addEventListener("click", () => {
  if (!state.exportBlob) return;
  const link = document.createElement("a");
  link.download = "my_tesla_wrap.png";
  link.href = URL.createObjectURL(state.exportBlob);
  link.click();
  URL.revokeObjectURL(link.href);
});

function serializeDesign() {
  return {
    model: state.currentModel?.slug,
    selectedScope: state.selectedScope,
    layers: state.layers.map((layer) => {
      if (layer.type === "image") {
        const { image, ...rest } = layer;
        return rest;
      }
      return structuredClone(layer);
    }),
  };
}

async function saveProject() {
  if (!state.exportBlob) return;
  const name = prompt("Name this design:", `Wrap ${new Date().toLocaleDateString()}`) || "Untitled wrap";
  const preview = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(state.exportBlob);
  });
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, preview, design: serializeDesign() }),
  });
  const result = await response.json();
  if (!response.ok) return showToast(result.error || "Could not save.");
  showToast("Design saved!");
}

ui.save_project.addEventListener("click", saveProject);

async function hydrateDesign(design) {
  state.layers = [];
  state.selectedId = null;
  if (design.model && design.model !== state.currentModel?.slug) {
    ui.model_select.value = design.model;
    await loadModel(design.model, { clearLayers: true });
  }
  state.layers = [];
  state.selectedScope = design.selectedScope || "all";
  if (state.selectedScope !== "all" && !state.panels.some((panel) => panel.id === state.selectedScope)) {
    state.selectedScope = "all";
  }
  for (const savedLayer of design.layers || []) {
    if (savedLayer.type === "image") {
      state.layers.push({ ...savedLayer, image: await loadImage(savedLayer.source) });
    } else {
      state.layers.push(structuredClone(savedLayer));
    }
  }
  ui.empty_state.classList.toggle("hidden", state.layers.length > 0);
  ui.download.disabled = state.layers.length === 0;
  renderScopeButtons();
  renderLayerList();
  syncControls();
  render();
  setStatus("Saved design loaded!");
}

async function initialize() {
  await loadModels();
  renderReferences();
  const projectId = new URLSearchParams(location.search).get("project");
  if (projectId) {
    const response = await fetch(`/api/projects/${projectId}`);
    const result = await response.json();
    if (response.ok) await hydrateDesign(result.project.design);
  }
  setStatus("Ready!");
}

initialize().catch(() => setStatus("Template did not load", "error"));
