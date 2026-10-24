// ============================================================
//  AUDIO VISUALIZER PULSE  –  Multi-Layer 3D Sphere Engine
//  Arquitectura: 3 Capas Concéntricas + Shockwave + 3-Band EQ
//  Zero Dependencies  |  ES6+ OOP  |  Vanilla JS
// ============================================================

const startBtn = document.getElementById("start-btn");
const canvas   = document.getElementById("visualizer");
const ctx      = canvas.getContext("2d");

// ------------------------------------------------------------------
// UTILIDADES MATEMÁTICAS
// ------------------------------------------------------------------
function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }
function pseudoNoise(x, y, time) {
    return (Math.sin(x * 0.05 + time) + Math.sin(y * 0.05 + time * 1.5)) * 0.5;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ------------------------------------------------------------------
// PALETA DE COLORES  –  12 Hues x 6 Variantes x 10 Niveles de Glow
// ------------------------------------------------------------------
const COLOR_VARIANTS = 6;
const NUM_HUES       = 12;

function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return { r: r * 255, g: g * 255, b: b * 255 };
}
function mixColorsRGB(c1, c2, amt) {
    return { r: lerp(c1.r, c2.r, amt), g: lerp(c1.g, c2.g, amt), b: lerp(c1.b, c2.b, amt) };
}

// ------------------------------------------------------------------
// CONSTANTES DE CAPAS CONCENTRICAS
//   Ajusta aqui radios, conteos y fisicas por capa facilmente
// ------------------------------------------------------------------
const LAYER = {
    core: {
        count: 160, radiusMult: 0.42,
        elasticity: 0.26, friction: 0.76,
        hueOffset: 2,
        rotDirY: -1.5, rotDirX: -1.2, rotDirZ: 0.8,
    },
    mantle: {
        count: 540, radiusMult: 1.0,
        elasticity: 0.15, friction: 0.82,
        hueOffset: 0,
        rotDirY: 1.0, rotDirX: 1.0, rotDirZ: 1.0,
    },
    corona: {
        count: 220, radiusMult: 1.32, radiusMax: 1.52,
        elasticity: 0.20, friction: 0.85,
        hueOffset: 10,
        rotDirY: 1.3, rotDirX: 0.7, rotDirZ: -0.5,
        orbitTilt: 0.436, // 25 grados en radianes
    },
};

// Shockwave global (fuera de instancias para evitar GC)
let shockwavePhase  = 0.0;
let shockwaveActive = false;

// ------------------------------------------------------------------
// CLASE DOT  –  Particula Espacial 3D con capa asignada
// ------------------------------------------------------------------
class Dot {
    constructor(index, bx, by, bz, maxRadius, vis, layer) {
        this.vis       = vis;
        this.index     = index;
        this.layer     = layer;
        this.baseX     = bx;
        this.baseY     = by;
        this.baseZ     = bz;
        this.maxRadius = maxRadius; // radio del MANTO para referencia global

        this.currentX = bx; this.currentY = by; this.currentZ = bz;
        this.x = 0; this.y = 0; this.scale = 1;

        const baseR = Math.sqrt(bx*bx + by*by + bz*bz) || 1;
        this.lat = Math.asin(clamp(by / baseR, -1, 1));
        this.lon = Math.atan2(bz, bx);

        const cfg       = LAYER[layer];
        this.elasticity = cfg.elasticity;
        this.friction   = cfg.friction;
        this.hueOffset  = cfg.hueOffset;

        this.currentSize  = 0;
        this.velocity     = 0;
        this.acceleration = 0;
        this.edgeFactor   = 1.0;

        // Pre-calculo de jitter para corona (cero GC en loop)
        this.jitterPhase = Math.random() * Math.PI * 2;
        this.jitterFreq  = 0.8 + Math.random() * 1.4;
    }

    update() {
        const vis = this.vis;
        const cfg = LAYER[this.layer];
        const t   = vis.globalTime;

        // 1. SELECCION DE ENERGIA SEGUN CAPA
        let audioPush    = 0;
        let waveSine     = 0;
        let pushForLayer = 0;

        if (this.layer === "core") {
            const wA     = 0.3 + vis.normalizedBass * 0.6;
            waveSine     = wA * Math.sin(t * 4 - this.lon * 6);
            audioPush    = vis.normalizedBass * 0.8 + vis.normalizedEnergy * 0.2 + Math.max(0, waveSine);
            pushForLayer = vis.normalizedBass * 0.35;

        } else if (this.layer === "mantle") {
            const wA = 0.2 + vis.normalizedMid * 0.4;
            if (vis.mode === "diamond") {
                waveSine  = wA * Math.sin(t * 3 - this.lon * 5);
                audioPush = vis.normalizedMid * 0.45 + vis.normalizedEnergy * 0.25 + Math.max(0, waveSine);
            } else {
                waveSine  = wA * Math.sin(t * 3 - this.lat * 5);
                audioPush = vis.normalizedMid * 0.35 + vis.normalizedEnergy * 0.35 + Math.max(0, waveSine);
            }
            const organicWave = 0.08 * Math.sin(this.lon * 3 + t * 1.2) * Math.cos(this.lat * 2 + t * 0.7);
            pushForLayer = vis.normalizedMid * 0.20 + organicWave;

        } else { // corona
            const jitter = vis.normalizedHigh > 0.55
                ? 0.06 * Math.sin(t * this.jitterFreq + this.jitterPhase) : 0;
            waveSine  = (0.15 + vis.normalizedHigh * 0.5) * Math.sin(t * 5 - this.lon * 8);
            audioPush = vis.normalizedHigh * 0.55 + vis.normalizedEnergy * 0.15
                      + Math.max(0, waveSine) + jitter;
            pushForLayer = vis.normalizedHigh * 0.25 + jitter * 0.5;
        }

        // 2. SHOCKWAVE – viaja CORE -> MANTLE -> CORONA con desfases
        if (shockwaveActive) {
            const delay      = this.layer === "core" ? 0.0 : this.layer === "mantle" ? 0.15 : 0.35;
            const localPhase = clamp(shockwavePhase - delay, 0, 1);
            const wave       = localPhase < 0.3
                ? localPhase / 0.3
                : Math.exp(-6 * (localPhase - 0.3));
            audioPush    += wave * 0.9;
            pushForLayer += wave * 0.35;
        }

        // 3. TOPOGRAFIA NCS (desplazamiento vectorial 3D)
        const dataIndex = Math.floor((this.index / vis.dots.length) * 120);
        let audioTopo   = vis.smoothedDataArray
            ? vis.smoothedDataArray[Math.min(dataIndex, vis.smoothedDataArray.length - 1)] / 255.0 : 0;
        if (dataIndex > 15 && dataIndex < 70) audioTopo *= 0.3;
        audioTopo = Math.pow(audioTopo, 1.3);

        const rad2D = Math.sqrt(this.currentX * this.currentX + this.currentY * this.currentY);
        this.edgeFactor = clamp(rad2D / this.maxRadius, 0, 1);
        const centerFactor = 1.0 - this.edgeFactor;

        const pushDisp = clamp((audioTopo * 0.6) + (waveSine * 0.3), 0, Infinity);
        const dispMag  = (pushDisp * 1.5 * centerFactor) + pushForLayer;
        audioPush     *= (0.8 + 0.2 * this.edgeFactor);

        // 4. FISICA NEWTONIANA (Hook's Law + Damping)
        this.acceleration  = audioPush;
        this.velocity     += this.acceleration;
        this.velocity     += (0 - this.currentSize) * this.elasticity;
        this.velocity     *= this.friction;
        if (this.velocity > 2) this.velocity = 2;
        this.currentSize  += this.velocity;
        if (this.currentSize < 0) this.currentSize = 0;

        // 5. ROTACION 3D INDEPENDIENTE POR CAPA
        const rotY = vis.globalTime * 0.15  * cfg.rotDirY;
        const rotX = Math.sin(vis.globalTime * 0.1) * 0.15 * cfg.rotDirX;
        const rotZ = vis.globalTime * 0.05  * cfg.rotDirZ;

        const bassBump = this.layer === "core"   ? vis.normalizedBass
                       : this.layer === "mantle" ? vis.normalizedMid  * 0.6
                       :                           vis.normalizedHigh * 0.5;
        const expandPulse = 1.0 + bassBump * 0.15
                          + pseudoNoise(this.baseX, this.baseY, vis.globalTime) * 0.05;
        const finalDist = Math.max(0.01, expandPulse + dispMag);

        const px = this.baseX * finalDist;
        const py = this.baseY * finalDist;
        const pz = this.baseZ * finalDist;

        const x1 = px * Math.cos(rotZ) - py * Math.sin(rotZ);
        const y1 = py * Math.cos(rotZ) + px * Math.sin(rotZ);
        const x2 = x1 * Math.cos(rotY) - pz * Math.sin(rotY);
        const z1 = pz * Math.cos(rotY) + x1 * Math.sin(rotY);
        const y2 = y1 * Math.cos(rotX) - z1 * Math.sin(rotX);
        const z2 = z1 * Math.cos(rotX) + y1 * Math.sin(rotX);

        this.currentX = x2; this.currentY = y2; this.currentZ = z2;

        // 6. PROYECCION PERSPECTIVA 2D
        const fovPulse = shockwaveActive ? lerp(1000, 1080, Math.exp(-4 * shockwavePhase)) : 1000;
        const zProj    = 1500 + this.currentZ;
        this.scale     = fovPulse / zProj;

        this.x = this.vis.canvas.width  / 2 + this.currentX * this.scale;
        this.y = this.vis.canvas.height / 2 + this.currentY * this.scale;
    }

    draw(ctx) {
        const vis = this.vis;

        let energyIndex = clamp(Math.floor(this.currentSize * vis.glowLevels), 0, vis.glowLevels - 1);

        // Corona: twinkle adicional en picos agudos
        if (this.layer === "corona" && vis.normalizedHigh > 0.5) {
            const twinkle = Math.sin(vis.globalTime * this.jitterFreq + this.jitterPhase);
            energyIndex   = clamp(energyIndex + Math.round(twinkle * 2), 0, vis.glowLevels - 1);
        }

        let colorVariantIdx = clamp(Math.floor(this.currentSize * (COLOR_VARIANTS - 1)), 0, COLOR_VARIANTS - 1);

        const depthNorm = (this.currentZ + this.maxRadius) / (this.maxRadius * 2);
        let alpha = clamp(0.05 + depthNorm * 0.4 + this.currentSize * 0.5, 0, 1);
        alpha    *= (0.70 + 0.30 * this.edgeFactor);
        if (this.layer === "corona") alpha = clamp(alpha * (1 + vis.normalizedHigh), 0, 1);

        const progresoColor = Math.abs((vis.globalTime / 3.0) % NUM_HUES);
        const hueIdx1       = Math.floor(progresoColor);
        const blendFactor   = progresoColor - hueIdx1;
        const h1 = (hueIdx1 + this.hueOffset) % NUM_HUES;
        const h2 = (h1 + 1) % NUM_HUES;

        const sprite1 = vis.glowSprites[h1]?.[colorVariantIdx]?.[energyIndex];
        const sprite2 = vis.glowSprites[h2]?.[colorVariantIdx]?.[energyIndex];
        if (!sprite1 || !sprite2) return;

        const layerSizeMult = this.layer === "core" ? 1.15 : this.layer === "corona" ? 0.80 : 1.0;
        const sizeFactor    = (0.75 + 0.25 * this.edgeFactor) * layerSizeMult;
        const dimW = sprite1.width  * this.scale * sizeFactor;
        const dimH = sprite1.height * this.scale * sizeFactor;

        ctx.globalAlpha = alpha * (1.0 - blendFactor);
        ctx.drawImage(sprite1, this.x - dimW / 2, this.y - dimH / 2, dimW, dimH);
        ctx.globalAlpha = alpha * blendFactor;
        ctx.drawImage(sprite2, this.x - dimW / 2, this.y - dimH / 2, dimW, dimH);
    }
}

// ------------------------------------------------------------------
// CLASE AUDIOVISUALIZER  –  Motor Principal
// ------------------------------------------------------------------
class AudioVisualizer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx    = ctx;

        this.audioContext = null;
        this.analyser     = null;
        this.source       = null;
        this.dataArray    = null;
        this.smoothedDataArray = null;

        this.glowLevels  = 10;
        this.glowSprites = [];
        this.dots        = [];

        this.mode           = "diamond";
        this.globalTime     = 0;
        this.previousTimeMs = performance.now();

        // Energias normalizadas por banda (0..1)
        this.normalizedEnergy = 0;
        this.normalizedBass   = 0; // Sub-Bass / Kick
        this.normalizedMid    = 0; // Mids / Melodia
        this.normalizedHigh   = 0; // Highs / Brillo

        // Valores prev para LERP asimetrico
        this._prevBassRaw = 0;
        this._prevMidRaw  = 0;
        this._prevHighRaw = 0;

        this.bassHistory   = new Array(120).fill(0);
        this.historyIndex  = 0;
        this.lastBeatTime  = 0;
        this.BEAT_COOLDOWN = 1800;

        window.addEventListener("resize", this.resizeCanvas.bind(this));
        this.preRenderAllGlowSprites();
        this.resizeCanvas();
    }

    detectBeats(nowMs) {
        this.bassHistory[this.historyIndex] = this.normalizedBass;
        this.historyIndex = (this.historyIndex + 1) % this.bassHistory.length;
        let sum = 0;
        for (let j = 0; j < this.bassHistory.length; j++) sum += this.bassHistory[j];
        const avg = sum / this.bassHistory.length;

        if (this.normalizedBass > 0.15 &&
            this.normalizedBass > avg * 1.6 &&
            nowMs - this.lastBeatTime > this.BEAT_COOLDOWN) {

            const modos = ["diamond", "chevron"];
            this.mode = modos[(modos.indexOf(this.mode) + 1) % modos.length];
            this.lastBeatTime = nowMs;

            // Disparar shockwave
            shockwavePhase  = 0.0;
            shockwaveActive = true;

            this.ctx.fillStyle = "rgba(255,255,255,0.08)";
            this.ctx.globalCompositeOperation = "lighter";
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    preRenderAllGlowSprites() {
        this.glowSprites = [];
        for (let h = 0; h < NUM_HUES; h++) {
            const arrVariants = [];
            const hueBase     = h / NUM_HUES;
            const baseColor   = hslToRgb(hueBase, 1.0, 0.5);
            const peakColor   = hslToRgb(hueBase, 1.0, 0.85);
            for (let v = 0; v < COLOR_VARIANTS; v++) {
                const arrNiveles  = [];
                const varColor    = mixColorsRGB(baseColor, peakColor, (v / (COLOR_VARIANTS - 1)) * 0.9);
                const varColorStr = `rgb(${Math.round(varColor.r)},${Math.round(varColor.g)},${Math.round(varColor.b)})`;
                for (let i = 0; i < this.glowLevels; i++) {
                    const intensity  = i / (this.glowLevels - 1);
                    const offCanvas  = document.createElement("canvas");
                    const padding    = 40;
                    const maxRadius  = 3 + intensity * 4;
                    offCanvas.width  = maxRadius * 2 + padding * 2;
                    offCanvas.height = maxRadius * 2 + padding * 2;
                    const offCtx     = offCanvas.getContext("2d");
                    offCtx.beginPath();
                    offCtx.arc(offCanvas.width / 2, offCanvas.height / 2, maxRadius, 0, Math.PI * 2);
                    if (intensity === 0) {
                        offCtx.fillStyle = "rgba(255,255,255,0.4)";
                    } else {
                        offCtx.fillStyle   = varColorStr;
                        offCtx.shadowBlur  = 5 + intensity * 30;
                        offCtx.shadowColor = varColorStr;
                    }
                    offCtx.fill();
                    arrNiveles.push(offCanvas);
                }
                arrVariants.push(arrNiveles);
            }
            this.glowSprites.push(arrVariants);
        }
    }

    _fibonacciSphere(count) {
        const pts = [];
        const phi = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < count; i++) {
            const y = 1 - (i / (count - 1)) * 2;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const theta = phi * i;
            pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
        }
        return pts;
    }

    initGrid() {
        this.dots = [];
        const baseRadius = Math.min(this.canvas.width, this.canvas.height) * 0.45;

        // CAPA 1 – NUCLEO
        const coreR   = baseRadius * LAYER.core.radiusMult;
        const corePts = this._fibonacciSphere(LAYER.core.count);
        for (let i = 0; i < corePts.length; i++) {
            const p = corePts[i];
            this.dots.push(new Dot(this.dots.length, p.x * coreR, p.y * coreR, p.z * coreR,
                                   baseRadius, this, "core"));
        }

        // CAPA 2 – MANTO
        const mantlePts = this._fibonacciSphere(LAYER.mantle.count);
        for (let i = 0; i < mantlePts.length; i++) {
            const p = mantlePts[i];
            this.dots.push(new Dot(this.dots.length, p.x * baseRadius, p.y * baseRadius, p.z * baseRadius,
                                   baseRadius, this, "mantle"));
        }

        // CAPA 3 – CORONA
        const coronaTotal = LAYER.corona.count;
        const ringCount   = Math.floor(coronaTotal * 0.70);
        const haloCount   = coronaTotal - ringCount;
        const tilt        = LAYER.corona.orbitTilt;
        const cosTilt     = Math.cos(tilt);
        const sinTilt     = Math.sin(tilt);
        const rMin        = baseRadius * LAYER.corona.radiusMult;
        const rMax        = baseRadius * LAYER.corona.radiusMax;
        const rMid        = (rMin + rMax) * 0.5;

        // Anillo ecuatorial inclinado 25 grados
        for (let i = 0; i < ringCount; i++) {
            const angle = (i / ringCount) * Math.PI * 2;
            const bx0   = Math.cos(angle) * rMid;
            const bz0   = Math.sin(angle) * rMid;
            this.dots.push(new Dot(this.dots.length,
                bx0, -bz0 * sinTilt, bz0 * cosTilt,
                baseRadius, this, "corona"));
        }

        // Halo disperso (30%)
        const haloPts = this._fibonacciSphere(haloCount);
        for (let i = 0; i < haloPts.length; i++) {
            const p    = haloPts[i];
            const rRnd = rMin + (rMax - rMin) * (i / haloCount);
            this.dots.push(new Dot(this.dots.length,
                p.x * rRnd, p.y * rRnd, p.z * rRnd,
                baseRadius, this, "corona"));
        }
    }

    resizeCanvas() {
        this.canvas.width  = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.initGrid();
    }

    initAudio(stream) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser     = this.audioContext.createAnalyser();
        this.source       = this.audioContext.createMediaStreamSource(stream);
        this.source.connect(this.analyser);
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.2;
        const bufferLength       = this.analyser.frequencyBinCount;
        this.dataArray           = new Uint8Array(bufferLength);
        this.smoothedDataArray   = new Float32Array(bufferLength);
        this.draw();
    }

    draw() {
        requestAnimationFrame(this.draw.bind(this));
        const nowMs = performance.now();
        const dt    = (nowMs - this.previousTimeMs) / 1000.0;
        this.previousTimeMs = nowMs;

        if (this.analyser) this.analyser.getByteFrequencyData(this.dataArray);

        // TIME-SMOOTHING GLOBAL (LERP uniforme base)
        if (this.smoothedDataArray) {
            for (let i = 0; i < this.dataArray.length; i++) {
                this.smoothedDataArray[i] = lerp(this.smoothedDataArray[i], this.dataArray[i], 0.4);
            }
        }

        // ANALISIS ESPECTRAL DE 3 BANDAS
        //   Sub-Bass  Bins 1-6    (~20-140 Hz)
        //   Mids      Bins 7-105  (~150 Hz - 2.5 kHz)
        //   Highs     Bins 106-450 (~2.5 - 11 kHz)
        let rawBass = 0, rawMid = 0, rawHigh = 0, totalEnergy = 0;
        if (this.smoothedDataArray) {
            for (let i = 1; i < Math.min(this.smoothedDataArray.length, 451); i++) {
                const v = this.smoothedDataArray[i];
                totalEnergy += v;
                if      (i <= 6)   rawBass += v;
                else if (i <= 105) rawMid  += v;
                else               rawHigh += v;
            }
        }
        rawBass = clamp(rawBass  / (6   * 255), 0, 1);
        rawMid  = clamp(rawMid   / (99  * 255), 0, 1);
        rawHigh = clamp(rawHigh  / (345 * 255), 0, 1);

        // LERP ASIMETRICO POR BANDA
        //   Bass  -> attack 0.75 (punch), decay 0.12 (caida lenta)
        //   Mids  -> lerp fluido 0.35
        //   Highs -> lerp ultra-reactivo 0.65
        const bassAmt = rawBass > this._prevBassRaw ? 0.75 : 0.12;
        this.normalizedBass  = lerp(this._prevBassRaw, rawBass,  bassAmt);
        this.normalizedMid   = lerp(this._prevMidRaw,  rawMid,   0.35);
        this.normalizedHigh  = lerp(this._prevHighRaw, rawHigh,  0.65);
        this.normalizedEnergy = clamp(
            totalEnergy / (this.smoothedDataArray ? this.smoothedDataArray.length * 255 : 1), 0, 1);

        this._prevBassRaw = this.normalizedBass;
        this._prevMidRaw  = this.normalizedMid;
        this._prevHighRaw = this.normalizedHigh;

        // BEAT DETECTION
        this.detectBeats(nowMs);

        // AVANCE DEL SHOCKWAVE (~35 frames a 60fps = 0.58s de duracion)
        if (shockwaveActive) {
            shockwavePhase += dt / 0.58;
            if (shockwavePhase >= 1.0) { shockwavePhase = 0.0; shockwaveActive = false; }
        }

        // RELOJ GLOBAL (velocidad modulada por agudos)
        this.globalTime += dt * (1.0 + this.normalizedHigh * 12.0);

        // RENDER – limpiar canvas
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.fillStyle = "#000000";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // UPDATE DE PARTICULAS
        for (let i = 0; i < this.dots.length; i++) this.dots[i].update();

        // Z-SORTING GLOBAL (cubre las 3 capas juntas)
        const sortedDots = this.dots.slice().sort((a, b) => a.currentZ - b.currentZ);

        // MOTION BLUR
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.fillStyle = "rgba(0,0,0,0.35)";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // DIBUJO EN ORDEN Z con composicion lighter
        this.ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < sortedDots.length; i++) sortedDots[i].draw(this.ctx);

        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.globalAlpha = 1.0;
    }
}

// ------------------------------------------------------------------
// INICIALIZACION Y EVENTOS UI
// ------------------------------------------------------------------
const viz = new AudioVisualizer(canvas, ctx);

startBtn.addEventListener("click", async () => {
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(err => console.log("Fullscreen error:", err));
    }
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        startBtn.style.display = "none";
        viz.initAudio(stream);
    } catch (err) {
        console.error("Error al acceder al audio del sistema:", err);
        alert('No se pudo acceder al audio. Asegurate de compartir con la casilla "Compartir audio".');
    }
});

window.addEventListener("dblclick", () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(err => console.log("Fullscreen error:", err));
    } else {
        document.exitFullscreen?.();
    }
});
