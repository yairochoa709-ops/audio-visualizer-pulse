// ============================================================
//  AUDIO VISUALIZER PULSE  –  Multi-Layer 3D Sphere Engine
//  Arquitectura: 3 Capas Concéntricas + Contrast Lock + 3-Band EQ
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
// CONSTANTES DE CAPAS CONCÉNTRICAS
//   Ajusta aquí radios, conteos y físicas por capa fácilmente
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
        count: 220, radiusMult: 1.42, radiusMax: 1.42,
        elasticity: 0.22, friction: 0.82,
        hueOffset: 10,
        rotDirY: 0.0, rotDirX: 0.0, rotDirZ: 1.0,
    },
};

// Shockwave global (fuera de instancias para evitar GC)
let shockwavePhase  = 0.0;
let shockwaveActive = false;

// ------------------------------------------------------------------
// CLASE DOT  –  Partícula Espacial 3D con capa asignada
// ------------------------------------------------------------------
class Dot {
    constructor(index, bx, by, bz, maxRadius, vis, layer) {
        this.vis       = vis;
        this.index     = index;
        this.layer     = layer;
        this.ringIndex = 0;         // Índice secuencial para anillo corona (0 a 219)
        this.baseX     = bx;
        this.baseY     = by;
        this.baseZ     = bz;
        this.maxRadius = maxRadius; // radio del MANTO para referencia global

        this.currentX = bx;
        this.currentY = by;
        this.currentZ = bz;
        this.x = 0;
        this.y = 0;
        this.scale = 1;

        const baseR = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
        this.lat = Math.asin(clamp(by / baseR, -1, 1));
        this.lon = Math.atan2(bz, bx);
        this.ringAngle = Math.atan2(by, bx);

        const cfg       = LAYER[layer];
        this.elasticity = cfg.elasticity;
        this.friction   = cfg.friction;
        this.hueOffset  = cfg.hueOffset;

        this.currentSize  = 0;
        this.velocity     = 0;
        this.acceleration = 0;
        this.edgeFactor   = 1.0;

        // Estado del patrón geométrico (Contrast Lock para mantle/core)
        this.patternMask     = 0.5;
        this.isActivePattern = false;
        this._shockGlow      = 0;

        // Modulación de altura de pico para el anillo único de corona
        this.waveHeight      = 0.0;
    }

    update() {
        const vis = this.vis;
        const cfg = LAYER[this.layer];
        const t   = vis.globalTime;

        // Factor de centro vs borde en proyección 2D
        const rad2D = Math.sqrt(this.currentX * this.currentX + this.currentY * this.currentY);
        this.edgeFactor = clamp(rad2D / this.maxRadius, 0, 1);
        const centerFactor = 1.0 - this.edgeFactor;

        // Shockwave simétrico global (onda de luz)
        this._shockGlow = 0;
        if (shockwaveActive) {
            const delay      = this.layer === "core" ? 0.0 : this.layer === "mantle" ? 0.18 : 0.38;
            const localPhase = clamp(shockwavePhase - delay, 0, 1);
            const wave       = localPhase < 0.3
                ? localPhase / 0.3
                : Math.exp(-6 * (localPhase - 0.3));
            this._shockGlow  = wave;
        }
        const swRadial = this._shockGlow * 0.06;

        let audioPush = 0;
        let dispMag   = 0;

        // ── 1. PATRONES GEOMÉTRICOS & CONTRAST LOCK (CORE & MANTLE) ──
        if (this.layer === "core" || this.layer === "mantle") {
            const isCore = (this.layer === "core");

            // Manto usa el modo actual; Núcleo usa el modo complementario
            const modeToUse = isCore
                ? (vis.mode === "diamond" ? "chevron" : "diamond")
                : vis.mode;

            // En el núcleo invertimos el tiempo para acoplar con su rotación inversa
            const patternTime = isCore ? -t * 1.2 : t * 1.5;

            // Evaluación de patrón matemático simétrico puro (0.0 a 1.0)
            let rawPattern = 0;
            if (modeToUse === "diamond") {
                // Malla simétrica de rombos / diamantes
                const wave = Math.sin(this.lon * 5.0 - patternTime) * Math.cos(this.lat * 5.0);
                rawPattern = (wave + 1.0) * 0.5;
            } else {
                // Modo Chevron: arcos polares simétricos en V
                const wave = Math.cos(Math.abs(this.lat) * 6.5 - Math.abs(this.lon) * 1.5 - patternTime);
                rawPattern = (wave + 1.0) * 0.5;
            }

            // Para el Núcleo: doble diferenciación -> máscara complementaria inversa
            if (isCore) {
                rawPattern = 1.0 - rawPattern;
            }

            // Curva de contraste exponencial para ensanchar valles (espacio negativo)
            this.patternMask = Math.pow(clamp(rawPattern, 0, 1), 1.6);

            // CONTRAST LOCK EN MOVIMIENTO:
            const energy = isCore ? vis.normalizedBass : vis.normalizedMid;

            if (this.patternMask <= 0.45) {
                // VALLE / ESPACIO NEGATIVO:
                // Permanece atenuado incluso durante picos y drops fuertes
                this.isActivePattern = false;
                audioPush = 0.02 * vis.normalizedEnergy;
                dispMag   = 0;
            } else {
                // ZONA ACTIVA DEL PATRÓN:
                this.isActivePattern = true;
                const activeFactor = (this.patternMask - 0.45) / 0.55;

                if (isCore) {
                    // Núcleo: 100% impulso rítmico de bajos (bassEnergy)
                    audioPush = (energy * 1.05 + vis.normalizedEnergy * 0.25) * activeFactor;
                    // Expansión radial controlada (máx +8% para no colisionar con manto)
                    dispMag   = 0.08 * activeFactor * energy;
                } else {
                    // Manto: 100% impulso rítmico de medios (midEnergy)
                    audioPush = (energy * 0.90 + vis.normalizedEnergy * 0.25) * activeFactor;
                    // Expansión radial controlada (máx +10% de radio para mantener redondez)
                    dispMag   = 0.10 * activeFactor * energy * centerFactor;
                }
            }

            // Impulso de shockwave en partículas activas
            if (this._shockGlow > 0 && this.isActivePattern) {
                audioPush += this._shockGlow * 0.50;
            }

            // Física Newtoniana elástica
            this.acceleration  = audioPush;
            this.velocity     += this.acceleration;
            this.velocity     += (0 - this.currentSize) * this.elasticity;
            this.velocity     *= this.friction;
            if (this.velocity > 2) this.velocity = 2;
            this.currentSize  += this.velocity;
            if (this.currentSize < 0) this.currentSize = 0;

            // Rotación 3D independiente por capa
            const rotY = vis.globalTime * 0.15 * cfg.rotDirY;
            const rotX = Math.sin(vis.globalTime * 0.1) * 0.15 * cfg.rotDirX;
            const rotZ = vis.globalTime * 0.05 * cfg.rotDirZ;

            // CORE JUMP: Efecto salto elástico pronunciado exclusivo del núcleo (hasta +42%)
            // Mantiene la forma 100% esférica de Fibonacci mediante expansión radial isótropa
            const coreJump = isCore
                ? (vis.coreJumpOffset * 0.42 + vis.normalizedBass * 0.08)
                : (vis.normalizedMid * 0.06);

            const expandPulse = 1.0
                + coreJump
                + pseudoNoise(this.baseX, this.baseY, vis.globalTime) * (isCore ? 0.01 : 0.03)
                + swRadial;

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

            this.currentX = x2;
            this.currentY = y2;
            this.currentZ = z2;

        } else {
            // ── 2. ANILLO ÚNICO FRONTAL CORONA (PLANO X-Y PURO, Z = 0 FIJO) ─────────
            // 1. Desplazamiento radial suave desde el espectro espacial pre-suavizado
            const peakVal = (vis.coronaPeakHeights && this.ringIndex !== undefined)
                ? vis.coronaPeakHeights[this.ringIndex]
                : 0;

            // En reposo: desplazamiento = 0 -> círculo perfecto de una sola línea
            // Con música: picos suaves y limpios hacia afuera (sin desdoblamientos)
            const peakDisplacement = peakVal * (0.04 + vis.normalizedHigh * 0.32);
            this.waveHeight = clamp(peakVal * (0.6 + vis.normalizedHigh * 0.6), 0, 1);

            const ringDist = 1.0 + peakDisplacement + swRadial;

            // Física elástica idéntica y uniforme para todas las partículas del anillo
            audioPush = peakVal * (0.35 + vis.normalizedHigh * 0.65);
            if (this._shockGlow > 0) audioPush += this._shockGlow * 0.40;

            this.acceleration  = audioPush;
            this.velocity     += this.acceleration;
            this.velocity     += (0 - this.currentSize) * this.elasticity;
            this.velocity     *= this.friction;
            if (this.velocity > 2) this.velocity = 2;
            this.currentSize  += this.velocity;
            if (this.currentSize < 0) this.currentSize = 0;

            // Coordenadas base en el plano X-Y
            const px = this.baseX * ringDist;
            const py = this.baseY * ringDist;

            // Rotación orbital lenta estrictamente sobre el eje Z (giro de rueda frontal 2D)
            const rotZ = vis.globalTime * 0.12 * (1.0 + vis.normalizedHigh * 0.4);
            const x1 = px * Math.cos(rotZ) - py * Math.sin(rotZ);
            const y1 = py * Math.cos(rotZ) + px * Math.sin(rotZ);

            this.currentX = x1;
            this.currentY = y1;
            this.currentZ = 0; // BLOQUEO ESTRICTO EN Z = 0 (cero desdoblamiento de perspectiva)
        }

        // ── 3. PROYECCIÓN PERSPECTIVA 2D ─────────────────────────────
        const fovPulse = 1000 + this._shockGlow * 60;
        const zProj    = 1500 + this.currentZ;
        this.scale     = fovPulse / zProj;

        this.x = this.vis.canvas.width  / 2 + this.currentX * this.scale;
        this.y = this.vis.canvas.height / 2 + this.currentY * this.scale;
    }

    draw(ctx) {
        const vis = this.vis;
        const depthNorm = (this.currentZ + this.maxRadius) / (this.maxRadius * 2);
        const layerSizeMult = this.layer === "core" ? 1.15 : this.layer === "corona" ? 0.85 : 1.0;

        let energyIndex     = 0;
        let colorVariantIdx = 0;
        let alpha           = 0;
        let sizeFactor      = 1.0;

        if (this.layer === "corona") {
            // ANILLO CONTINUO ÚNICO (Línea continua con picos rítmicos limpios)
            const wH = this.waveHeight;

            // GlowLevel: valles 2-3, picos 7-9
            const baseGlow = Math.floor(lerp(2, 9, wH * (0.55 + 0.45 * vis.normalizedHigh)));
            energyIndex = clamp(baseGlow, 0, vis.glowLevels - 1);
            if (this._shockGlow > 0) {
                energyIndex = clamp(energyIndex + Math.round(this._shockGlow * 3), 0, vis.glowLevels - 1);
            }

            // ColorVariant: sube en picos hacia el tono más brillante
            colorVariantIdx = clamp(Math.floor(wH * (COLOR_VARIANTS - 1)), 0, COLOR_VARIANTS - 1);

            // Opacidad: base 0.50 - 0.65, picos 0.90 - 1.0
            alpha = lerp(0.50, 0.98, wH);
            if (vis.normalizedHigh > 0.4) {
                alpha = clamp(alpha + vis.normalizedHigh * 0.15, 0, 1.0);
            }

            // Tamaño del sprite: fino y nítido en valles (0.65), dilatado en crestas (1.25)
            const ringSizeMult = lerp(0.65, 1.25, wH);
            sizeFactor = ringSizeMult * layerSizeMult;

        } else {
            // CORE & MANTLE: CONTRAST LOCK ESTRICTO
            const isCore = (this.layer === "core");
            const energy = isCore ? vis.normalizedBass : vis.normalizedMid;

            if (!this.isActivePattern) {
                // VALLE / ESPACIO NEGATIVO:
                // Sin Glow, tamaño mínimo, opacidad muy tenue (0.06 a 0.16)
                energyIndex     = 0;
                colorVariantIdx = 0;
                alpha = lerp(0.06, 0.16, this.patternMask / 0.45);
                if (!isCore) {
                    // Depth clarity en el manto
                    alpha *= (0.35 + 0.65 * depthNorm);
                }
                sizeFactor = 0.50 * layerSizeMult;

            } else {
                // PARTÍCULAS ACTIVAS DEL PATRÓN:
                const activeFactor = (this.patternMask - 0.45) / 0.55;

                // Nivel de Glow intenso en crestas
                energyIndex = clamp(
                    Math.floor(this.currentSize * vis.glowLevels * (0.6 + 0.4 * activeFactor)),
                    0, vis.glowLevels - 1
                );
                if (this._shockGlow > 0) {
                    energyIndex = clamp(energyIndex + Math.round(this._shockGlow * 3), 0, vis.glowLevels - 1);
                }

                colorVariantIdx = clamp(
                    Math.floor(this.currentSize * (COLOR_VARIANTS - 1) * activeFactor),
                    0, COLOR_VARIANTS - 1
                );

                // Opacidad alta (0.72 a 1.0)
                alpha = lerp(0.72, 1.0, activeFactor * (0.4 + 0.6 * energy));
                if (!isCore) {
                    // Depth clarity en el manto: partículas frontales nítidas
                    alpha *= (0.40 + 0.60 * depthNorm);
                }

                // Sprite expandido en zonas activas
                sizeFactor = (0.75 + 0.45 * activeFactor * (0.4 + 0.6 * energy)) * layerSizeMult;
            }
        }

        const progresoColor = Math.abs((vis.globalTime / 3.0) % NUM_HUES);
        const hueIdx1       = Math.floor(progresoColor);
        const blendFactor   = progresoColor - hueIdx1;
        const h1 = (hueIdx1 + this.hueOffset) % NUM_HUES;
        const h2 = (h1 + 1) % NUM_HUES;

        const sprite1 = vis.glowSprites[h1]?.[colorVariantIdx]?.[energyIndex];
        const sprite2 = vis.glowSprites[h2]?.[colorVariantIdx]?.[energyIndex];
        if (!sprite1 || !sprite2) return;

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

        // Energías normalizadas por banda (0..1)
        this.normalizedEnergy = 0;
        this.normalizedBass   = 0; // Sub-Bass / Kick
        this.normalizedMid    = 0; // Mids / Melodía
        this.normalizedHigh   = 0; // Highs / Brillo

        // Valores prev para LERP asimétrico
        this._prevBassRaw = 0;
        this._prevMidRaw  = 0;
        this._prevHighRaw = 0;

        // Impulso y Decay elástico para el Core Jump (+35% a +45% en golpes)
        this.coreJumpOffset    = 0.0;
        this._prevBassForJump  = 0.0;

        // Espectro espacial pre-calculado para el anillo único de corona (220 puntos, cero GC)
        this.coronaPeakHeights = new Float32Array(220);

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

            // Salto elástico máximo en el núcleo en cada beat detectado
            this.coreJumpOffset = 0.45;

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

        // CAPA 1 – NÚCLEO (Esfera Fibonacci interna)
        const coreR   = baseRadius * LAYER.core.radiusMult;
        const corePts = this._fibonacciSphere(LAYER.core.count);
        for (let i = 0; i < corePts.length; i++) {
            const p = corePts[i];
            this.dots.push(new Dot(this.dots.length, p.x * coreR, p.y * coreR, p.z * coreR,
                                   baseRadius, this, "core"));
        }

        // CAPA 2 – MANTO (Esfera Fibonacci principal)
        const mantlePts = this._fibonacciSphere(LAYER.mantle.count);
        for (let i = 0; i < mantlePts.length; i++) {
            const p = mantlePts[i];
            this.dots.push(new Dot(this.dots.length, p.x * baseRadius, p.y * baseRadius, p.z * baseRadius,
                                   baseRadius, this, "mantle"));
        }

        // CAPA 3 – CORONA (Anillo Frontal Único y Continuo, 100% de partículas)
        const coronaTotal = LAYER.corona.count; // 220 partículas
        const ringRadius  = baseRadius * 1.42;  // 1.42 * sphereBaseRadius exacto

        for (let i = 0; i < coronaTotal; i++) {
            const angle = (i / coronaTotal) * Math.PI * 2;
            const bx = Math.cos(angle) * ringRadius;
            const by = Math.sin(angle) * ringRadius;
            const bz = 0; // Z = 0 estricto
            const dot = new Dot(this.dots.length, bx, by, bz, baseRadius, this, "corona");
            dot.ringIndex = i; // Índice secuencial para mapeo espectral suave de una sola línea
            this.dots.push(dot);
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

        // ANÁLISIS ESPECTRAL DE 3 BANDAS
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

        // LERP ASIMÉTRICO POR BANDA
        //   Bass  -> attack 0.75 (punch), decay 0.12 (caída lenta)
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

        // DECAY ELÁSTICO RÁPIDO DEL CORE JUMP
        this.coreJumpOffset *= 0.80;

        // ATTACK INSTANTÁNEO EN GOLPES DE BOMBO/BAJO PARA EL CORE JUMP
        const bassDelta = this.normalizedBass - this._prevBassForJump;
        if (bassDelta > 0.07) {
            const impulse = Math.min(0.45, bassDelta * 3.0 + this.normalizedBass * 0.25);
            if (impulse > this.coreJumpOffset) {
                this.coreJumpOffset = impulse;
            }
        }
        this._prevBassForJump = this.normalizedBass;

        // BEAT DETECTION
        this.detectBeats(nowMs);

        // --- SUAVIZADO ESPACIAL DE PICOS DEL ANILLO (SINGLE-LINE PEAK SMOOTHING) ---
        const numCorona = 220;
        const halfCorona = 110;
        if (this.smoothedDataArray) {
            // 1. Muestrear simétricamente de 0 a pi y reflejar en pi a 2pi (cero costuras)
            for (let i = 0; i <= halfCorona; i++) {
                const norm = i / halfCorona;
                // Muestrear agudos y medios altos (bins 20 a 360)
                const binIdx = Math.floor(20 + norm * 320);
                const fftVal = this.smoothedDataArray[Math.min(binIdx, this.smoothedDataArray.length - 1)] / 255.0;
                
                // Picos limpios guiados por FFT y agudos
                const rawVal = Math.max(0, (fftVal - 0.15) * 1.4);
                this.coronaPeakHeights[i] = rawVal;
                if (i > 0 && i < halfCorona) {
                    this.coronaPeakHeights[numCorona - i] = rawVal;
                }
            }
            // 2. Filtro espacial 3-tap circular (1-2-1) para que los vecinos formen una sola línea continua
            let prevH = this.coronaPeakHeights[numCorona - 1];
            for (let i = 0; i < numCorona; i++) {
                const currH = this.coronaPeakHeights[i];
                const nextH = this.coronaPeakHeights[(i + 1) % numCorona];
                this.coronaPeakHeights[i] = (prevH * 0.25 + currH * 0.50 + nextH * 0.25);
                prevH = currH;
            }
        }

        // AVANCE DEL SHOCKWAVE (~35 frames a 60fps = 0.58s de duración)
        if (shockwaveActive) {
            shockwavePhase += dt / 0.58;
            if (shockwavePhase >= 1.0) { shockwavePhase = 0.0; shockwaveActive = false; }
        }

        // RELOJ GLOBAL (velocidad modulada por agudos)
        this.globalTime += dt * (1.0 + this.normalizedHigh * 12.0);

        // RENDER – limpiar canvas en negro absoluto
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.fillStyle = "#000000";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // UPDATE DE PARTÍCULAS
        for (let i = 0; i < this.dots.length; i++) this.dots[i].update();

        // Z-SORTING GLOBAL (cubre las 3 capas juntas para oclusión 3D exacta)
        const sortedDots = this.dots.slice().sort((a, b) => a.currentZ - b.currentZ);

        // MOTION BLUR CON TINT NEGRO
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.fillStyle = "rgba(0,0,0,0.35)";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // DIBUJO EN ORDEN Z con composición lighter
        this.ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < sortedDots.length; i++) sortedDots[i].draw(this.ctx);

        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.globalAlpha = 1.0;
    }
}

// ------------------------------------------------------------------
// INICIALIZACIÓN Y EVENTOS UI
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
        alert('No se pudo acceder al audio. Asegúrate de compartir con la casilla "Compartir audio".');
    }
});

window.addEventListener("dblclick", () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(err => console.log("Fullscreen error:", err));
    } else {
        document.exitFullscreen?.();
    }
});
