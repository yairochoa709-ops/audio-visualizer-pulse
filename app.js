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
        count: 220, radiusMult: 1.34, radiusMax: 1.50,
        elasticity: 0.20, friction: 0.85,
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
    constructor(index, bx, by, bz, maxRadius, vis, layer, isHalo = false) {
        this.vis       = vis;
        this.index     = index;
        this.layer     = layer;
        this.isHalo    = isHalo;
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
        // Ángulo polar en el plano frontal X-Y (para la corona)
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

        // Modulación para el anillo continuo de la corona
        this.waveHeight      = 0.5;

        // Pre-cálculo de jitter / flotación para halo (cero GC en loop)
        this.jitterPhase = Math.random() * Math.PI * 2;
        this.jitterFreq  = 0.8 + Math.random() * 1.4;
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

            const bassBump = isCore ? vis.normalizedBass * 0.12 : vis.normalizedMid * 0.08;
            const expandPulse = 1.0
                + bassBump
                + pseudoNoise(this.baseX, this.baseY, vis.globalTime) * 0.03
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
            // ── 2. ANILLO Y HALO EXTERIOR (CORONA) ────────────────────
            const a = this.ringAngle;

            // Rotación orbital frontal suave en el eje Z (giro como rueda de frente)
            const rotZ = vis.globalTime * 0.15 * (1.0 + vis.normalizedHigh * 0.6);
            // Balanceo 3D sutil en X e Y (máximo ~7-8° / ±0.12 rad), NUNCA giro de perfil
            const rotX = Math.sin(vis.globalTime * 0.45) * 0.10;
            const rotY = Math.cos(vis.globalTime * 0.35) * 0.10;

            if (!this.isHalo) {
                // ── A. ANILLO PRINCIPAL CONTINUO ("Hilo Luminoso", 80%) ───
                // 1. Múltiples armónicos orgánicos cruzados en distinta dirección y velocidad
                const waveHarmonic =
                    Math.sin(a * 5.0 + t * 2.2) * 0.35 +
                    Math.cos(a * 11.0 - t * 3.1) * 0.35 +
                    Math.sin(a * 19.0 + t * 4.5) * 0.30;

                // 2. Mapeo simétrico/espejado de bins FFT de agudos (106 a 340)
                let angleMod = a;
                while (angleMod < 0) angleMod += Math.PI * 2;
                angleMod = angleMod % (Math.PI * 2);
                const normAngle = Math.abs(angleMod - Math.PI) / Math.PI; // 0.0 en 0/2pi, 1.0 en pi (sin costuras)
                const fftBin = Math.floor(106 + normAngle * 220);
                const fftVal = vis.smoothedDataArray
                    ? (vis.smoothedDataArray[Math.min(fftBin, vis.smoothedDataArray.length - 1)] / 255.0)
                    : 0;

                // 3. Modulación con audio: brisa suave en reposo, crestas dinámicas con música
                const waveAmp = 0.015 + (vis.normalizedHigh * 0.18 + fftVal * 0.08);
                const combinedWave = (waveHarmonic * 0.55 + (fftVal * 2.0 - 0.5) * 0.45);

                // Normalizamos la altura de la onda para modular tamaño, opacidad y glow
                this.waveHeight = clamp(0.5 + combinedWave * 0.5 + vis.normalizedHigh * 0.25, 0, 1);

                const radialDisplacement = combinedWave * waveAmp + swRadial;
                const ringDist = Math.max(0.7, 1.0 + radialDisplacement);

                // audioPush alimenta currentSize con elasticidad
                audioPush = (0.25 + vis.normalizedHigh * 0.75) * this.waveHeight;
                if (this._shockGlow > 0) audioPush += this._shockGlow * 0.45;

                this.acceleration  = audioPush;
                this.velocity     += this.acceleration;
                this.velocity     += (0 - this.currentSize) * this.elasticity;
                this.velocity     *= this.friction;
                if (this.velocity > 2) this.velocity = 2;
                this.currentSize  += this.velocity;
                if (this.currentSize < 0) this.currentSize = 0;

                // Coordenadas en plano frontal con deformación radial multi-armónica
                const px = this.baseX * ringDist;
                const py = this.baseY * ringDist;
                const pz = this.baseZ;

                // Giro orbital en Z primero (frente al espectador)
                const x1 = px * Math.cos(rotZ) - py * Math.sin(rotZ);
                const y1 = py * Math.cos(rotZ) + px * Math.sin(rotZ);
                // Balanceo 3D sutil X e Y
                const x2 = x1 * Math.cos(rotY) - pz * Math.sin(rotY);
                const z1 = pz * Math.cos(rotY) + x1 * Math.sin(rotY);
                const y2 = y1 * Math.cos(rotX) - z1 * Math.sin(rotX);
                const z2 = z1 * Math.cos(rotX) + y1 * Math.sin(rotX);

                this.currentX = x2;
                this.currentY = y2;
                this.currentZ = z2;

            } else {
                // ── B. POLVO ESTELAR / HALO FLOTANTE (20%) ───────────
                const floatAngle = t * this.jitterFreq * 0.5 + this.jitterPhase;
                const floatRadius = 1.0 + (vis.normalizedHigh * 0.08) * Math.sin(floatAngle) + swRadial;

                audioPush = vis.normalizedHigh * 0.50 + vis.normalizedEnergy * 0.20;
                if (this._shockGlow > 0) audioPush += this._shockGlow * 0.30;

                this.acceleration  = audioPush;
                this.velocity     += this.acceleration;
                this.velocity     += (0 - this.currentSize) * this.elasticity;
                this.velocity     *= this.friction;
                if (this.velocity > 2) this.velocity = 2;
                this.currentSize  += this.velocity;
                if (this.currentSize < 0) this.currentSize = 0;

                const px = this.baseX * floatRadius;
                const py = this.baseY * floatRadius;
                const pz = this.baseZ + Math.sin(floatAngle) * (this.maxRadius * 0.05);

                const x1 = px * Math.cos(rotZ * 0.7) - py * Math.sin(rotZ * 0.7);
                const y1 = py * Math.cos(rotZ * 0.7) + px * Math.sin(rotZ * 0.7);
                const x2 = x1 * Math.cos(rotY) - pz * Math.sin(rotY);
                const z1 = pz * Math.cos(rotY) + x1 * Math.sin(rotY);
                const y2 = y1 * Math.cos(rotX) - z1 * Math.sin(rotX);
                const z2 = z1 * Math.cos(rotX) + y1 * Math.sin(rotX);

                this.currentX = x2;
                this.currentY = y2;
                this.currentZ = z2;
            }
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
            if (!this.isHalo) {
                // ── A. ANILLO PRINCIPAL CONTINUO: Trazo luminoso con perlas en crestas ──
                const wH = this.waveHeight;

                // GlowLevel: valles 2-3, crestas 7-9
                const baseGlow = Math.floor(lerp(2, 9, wH * (0.55 + 0.45 * vis.normalizedHigh)));
                energyIndex = clamp(baseGlow, 0, vis.glowLevels - 1);
                if (this._shockGlow > 0) {
                    energyIndex = clamp(energyIndex + Math.round(this._shockGlow * 3), 0, vis.glowLevels - 1);
                }

                // ColorVariant: sube en crestas hacia el tono más brillante
                colorVariantIdx = clamp(Math.floor(wH * (COLOR_VARIANTS - 1)), 0, COLOR_VARIANTS - 1);

                // Opacidad: valles 0.35 - 0.60, crestas 0.85 - 1.0
                alpha = lerp(0.38, 0.98, wH);
                if (vis.normalizedHigh > 0.4) {
                    alpha = clamp(alpha + vis.normalizedHigh * 0.15, 0, 1.0);
                }

                // Tamaño: trazo fino y nítido en valles (0.60), dilatado en crestas (1.30)
                const ringSizeMult = lerp(0.60, 1.30, wH);
                sizeFactor = ringSizeMult * layerSizeMult;

            } else {
                // ── B. POLVO ESTELAR / HALO FLOTANTE: Chispas parpadeantes ──
                const twinkle = Math.sin(vis.globalTime * this.jitterFreq * 2.0 + this.jitterPhase);
                energyIndex = clamp(Math.floor(vis.normalizedHigh * 7 + (twinkle > 0 ? 2 : 0)), 0, vis.glowLevels - 1);
                colorVariantIdx = clamp(Math.floor(this.currentSize * (COLOR_VARIANTS - 1)), 0, COLOR_VARIANTS - 1);

                // Opacidad tenue de chispa
                alpha = clamp(0.18 + (twinkle + 1) * 0.20 + vis.normalizedHigh * 0.35, 0.08, 0.85);
                sizeFactor = 0.55 * layerSizeMult;
            }

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

        // CAPA 3 – CORONA: Hilo Continuo (80%) + Halo Flotante (20%)
        const coronaTotal = LAYER.corona.count;
        const ringCount   = Math.floor(coronaTotal * 0.80); // ~176 partículas
        const haloCount   = coronaTotal - ringCount;        // ~44 partículas
        const ringRadius  = baseRadius * 1.38;              // Radio exacto continuo 1.38 * baseRadius

        // Anillo Principal continuo (80%): círculo perfecto y equidistante exacto
        for (let i = 0; i < ringCount; i++) {
            const angle = (i / ringCount) * Math.PI * 2;
            const bx = Math.cos(angle) * ringRadius;
            const by = Math.sin(angle) * ringRadius;
            const bz = 0;
            this.dots.push(new Dot(this.dots.length, bx, by, bz, baseRadius, this, "corona", false));
        }

        // Polvo Estelar / Halo Exterior (20%): chispas sueltas (1.20 a 1.62 * baseRadius)
        for (let i = 0; i < haloCount; i++) {
            const angle = i * 2.3999632; // golden angle para dispersión armónica
            const rNorm = Math.abs(((Math.sin(i * 12.9898) * 43758.5453) % 1));
            const r = baseRadius * (1.20 + rNorm * 0.42);
            const bx = Math.cos(angle) * r;
            const by = Math.sin(angle) * r;
            const bz = (Math.sin(angle * 3) * 0.08) * baseRadius;
            this.dots.push(new Dot(this.dots.length, bx, by, bz, baseRadius, this, "corona", true));
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

        // BEAT DETECTION
        this.detectBeats(nowMs);

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
