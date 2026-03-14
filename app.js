const startBtn = document.getElementById('start-btn');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

// --- Utilidades Matemáticas y Físicas ---
function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

// Pseudo-Perlin Noise muy simplificado utilizando suma de senos espaciales
function pseudoNoise(x, y, time) {
    return (Math.sin(x * 0.05 + time) + Math.sin(y * 0.05 + time * 1.5)) * 0.5;
}

// --- Paleta de Colores Dinámica ---
const colorRamp = [
    { threshold: 0.0, r: 0, g: 50, b: 255 },     // Azul profundo (Quiet)
    { threshold: 0.3, r: 0, g: 200, b: 255 },    // Cian suave
    { threshold: 0.6, r: 200, g: 0, b: 255 },    // Magenta / Morado (Build-up)
    { threshold: 0.8, r: 255, g: 20, b: 147 },   // Rosa eléctrico
    { threshold: 1.0, r: 255, g: 80, b: 0 }      // Oro/Naranja/Rojo (Drop)
];

function interpolateColor(energy) {
    let c1 = colorRamp[0];
    let c2 = colorRamp[colorRamp.length - 1];
    
    for (let i = 0; i < colorRamp.length - 1; i++) {
        if (energy >= colorRamp[i].threshold && energy <= colorRamp[i+1].threshold) {
            c1 = colorRamp[i];
            c2 = colorRamp[i+1];
            break;
        }
    }
    
    let range = c2.threshold - c1.threshold;
    let localAmt = range === 0 ? 0 : (energy - c1.threshold) / range;
    
    return {
        r: lerp(c1.r, c2.r, localAmt),
        g: lerp(c1.g, c2.g, localAmt),
        b: lerp(c1.b, c2.b, localAmt)
    };
}

// ==========================================
// CLASE DOT (PARTÍCULA CON FÍSICA ELÁSTICA)
// ==========================================
class Dot {
    constructor(col, row, x, y, maxDistance, visualizer) {
        this.vis = visualizer; // Referencia al orquestador visualizer
        this.col = col;
        this.row = row;
        
        // Coordenadas Base
        this.baseX = x;
        this.baseY = y;
        this.x = x;
        this.y = y;
        
        // Topología
        const centerX = this.vis.cols / 2;
        const centerY = this.vis.rows / 2;
        this.manhattanDist = Math.abs(col - centerX) + Math.abs(row - centerY);
        this.distFromCenterCol = Math.abs(this.col - centerX);

        // Física Elástica (Damping & Elasticity)
        this.targetSize = 0;
        this.currentSize = 0;
        this.velocity = 0;         // Velocidad de cambio de tamaño
        this.acceleration = 0;     // Aceleración provista por la música
        this.friction = 0.82;      // Qué tan rápido pierde velocidad (0-1)
        this.elasticity = 0.15;    // Qué tan fuerte busca regresar al tamaño base

        // Delay para el efecto ola/fluido
        this.phaseDelayDiamond = this.manhattanDist * 0.15;
        this.phaseDelayChevron = (this.distFromCenterCol + this.row) * 0.2;
    }

    update() {
        // --- 1. Lógica Acústica y Modos Espaciales ---
        let audioPush = 0;
        let waveSine = 0;

        if (this.vis.mode === 'diamond') {
            const normalizedDist = this.manhattanDist / this.vis.maxManhattan; 
            
            // MAPEO LOGARÍTMICO SIMULADO: Usamos una curva de potencia para buscar índices
            // Los puntos centrales buscan en frecuencias bajas (0-10), los alejados en altas
            const logIndexMap = Math.pow(normalizedDist, 1.5); 
            const dataIndex = Math.floor(logIndexMap * 100); 
            // Usamos el 'smoothedData' del visualizer (Time-Smoothing)
            const audioVal = this.vis.smoothedDataArray[Math.min(dataIndex, 100)] / 255.0; 
            
            // Onda dinámica
            const waveAmplitude = 0.3 + (this.vis.normalizedBass * 0.7);
            waveSine = waveAmplitude * Math.sin(this.vis.globalTime - this.phaseDelayDiamond);
            const centerBoost = Math.max(0, 1 - (this.manhattanDist / 10)); 
            
            // Impulso base
            audioPush = (audioVal * 0.6) + (this.vis.normalizedEnergy * centerBoost * 0.6) + Math.max(0, waveSine);

        } else if (this.vis.mode === 'chevron') {
            const waveIndex = (this.distFromCenterCol + this.row) % 40; 
            const audioVal = this.vis.smoothedDataArray[waveIndex] / 255.0;
            
            const waveAmplitude = 0.4 + (this.vis.normalizedBass * 0.5);
            waveSine = waveAmplitude * Math.sin(this.vis.globalTime - this.phaseDelayChevron);
            
            audioPush = (audioVal * 0.4) + (this.vis.normalizedEnergy * 0.4) + Math.max(0, waveSine);
        }

        // --- 2. Física Newtoniana (Hooks Law + Damping) ---
        // audioPush actúa como la fuerza/aceleración acústica
        this.acceleration = audioPush;
        
        // Sumar aceleración a la velocidad
        this.velocity += this.acceleration;
        
        // Hooke's Law (Elasticidad): Fuerza que empuja hacia el descanso (Size = 0)
        const restoringForce = (0 - this.currentSize) * this.elasticity;
        this.velocity += restoringForce;

        // Fricción: Aplicar amortiguamiento (Damping)
        this.velocity *= this.friction;

        // Limitar velocidad extrema de explosiones (Kicks potentes)
        if(this.velocity > 2) this.velocity = 2;
        
        // Actualizar tamaño final y evitar encogimientos negativos
        this.currentSize += this.velocity;
        if(this.currentSize < 0) this.currentSize = 0; 

        // --- 3. Posición Fluida (Pseudo Perlin Noise) ---
        // Movimiento serpenteante orgánico en BaseX/BaseY sin música
        const noiseX = pseudoNoise(this.col, this.row + this.vis.globalTime, this.vis.globalTime * 0.5);
        const noiseY = pseudoNoise(this.col + this.vis.globalTime, this.row, this.vis.globalTime * 0.5);
        
        // La oscilación incrementa la marea sutilmente
        this.x = this.baseX + (noiseX * 5) + (waveSine * 5);
        this.y = this.baseY + (noiseY * 5) + (waveSine * 10 * this.vis.normalizedBass); 
    }

    draw(ctx) {
        // En lugar de currentEnergy lineal, usamos nuestro volumen "elástico/amortiguado" (currentSize)
        const energyIndex = Math.min(this.vis.glowLevels - 1, Math.floor(this.currentSize * this.vis.glowLevels));
        if (energyIndex < 0) return;

        let alpha = 0.1 + (this.currentSize * 0.8);
        if (alpha > 1) alpha = 1;

        const sprite = this.vis.glowSprites[energyIndex];
        if (!sprite) return;

        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, this.x - sprite.width / 2, this.y - sprite.height / 2);
    }
}

// ==========================================
// CLASE VISUALIZER (ORQUESTADOR PRINCIPAL)
// ==========================================
class AudioVisualizer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
        
        // Contextos de Audio
        this.audioContext = null;
        this.analyser = null;
        this.source = null;
        this.dataArray = null;
        
        // Time-Smoothing Array
        this.smoothedDataArray = null;
        
        // Estética y Rejilla
        this.GRID_SPACING = 35;
        this.glowLevels = 10;
        this.glowSprites = [];
        this.lastRenderedColorStr = '';
        this.currentAmbientColor = { r: 0, g: 255, b: 255 };
        
        this.dots = [];
        this.cols = 0;
        this.rows = 0;
        this.maxManhattan = 0;
        
        // Rítmica y Física Global
        this.mode = 'diamond';
        this.globalTime = 0;
        this.previousTimeMs = performance.now();
        this.normalizedEnergy = 0;
        this.normalizedBass = 0;
        this.normalizedTreble = 0;

        // Historial Beat Detection (Últimos 2 segundos = ~120 frames a 60fps)
        this.bassHistory = new Array(120).fill(0);
        this.historyIndex = 0;
        this.lastBeatTime = 0;
        this.BEAT_COOLDOWN = 2000;

        // Listeners
        window.addEventListener('resize', this.resizeCanvas.bind(this));
        
        // Inicializar vacío
        this.resizeCanvas();
    }

    // Algoritmo de Energía Acumulada para Beat Detection (Alan Walker Style)
    detectBeats(nowMs) {
        // Guardamos el nivel de bajo actual en el buffer circular
        this.bassHistory[this.historyIndex] = this.normalizedBass;
        this.historyIndex = (this.historyIndex + 1) % this.bassHistory.length;

        // Calcular promedio histórico (últimos 2 segundos)
        let sumHistory = 0;
        for (let j = 0; j < this.bassHistory.length; j++) {
            sumHistory += this.bassHistory[j];
        }
        const avgHistory = sumHistory / this.bassHistory.length;

        const umbralMinimo = 0.15; // Evita disparar beats con ruido bajo
        
        // Tigger Kick si el RMS actual supera el promedio por un margen grande (1.5x a 1.8x)
        // Y respeta el Cooldown
        if (this.normalizedBass > umbralMinimo && 
            this.normalizedBass > (avgHistory * 1.6) && 
            (nowMs - this.lastBeatTime > this.BEAT_COOLDOWN)) {
            
            // BOOM! Beat detected!
            this.mode = this.mode === 'diamond' ? 'chevron' : 'diamond';
            this.lastBeatTime = nowMs;
            
            // "Pequeño destello global de cámara" - Truco visual extra opcional
            this.ctx.fillStyle = `rgba(255, 255, 255, 0.1)`;
            this.ctx.globalCompositeOperation = 'lighter';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    preRenderGlowSprites(colR, colG, colB) {
        this.glowSprites = [];
        const colorStr = `rgb(${colR}, ${colG}, ${colB})`;
        this.lastRenderedColorStr = colorStr;

        for (let i = 0; i < this.glowLevels; i++) {
            const intensity = i / (this.glowLevels - 1); 
            const offCanvas = document.createElement('canvas');
            const padding = 40; 
            const maxRadius = 3 + (intensity * 4); 
            
            offCanvas.width = maxRadius * 2 + padding * 2;
            offCanvas.height = maxRadius * 2 + padding * 2;
            const offCtx = offCanvas.getContext('2d');

            const cx = offCanvas.width / 2;
            const cy = offCanvas.height / 2;

            offCtx.beginPath();
            offCtx.arc(cx, cy, maxRadius, 0, Math.PI * 2);
            
            if (intensity === 0) {
                offCtx.fillStyle = 'rgba(50, 50, 50, 0.5)';
            } else {
                const isKick = intensity > 0.8;
                offCtx.fillStyle = isKick ? '#ffffff' : colorStr;
                offCtx.shadowBlur = 5 + (intensity * 30);
                offCtx.shadowColor = colorStr;
            }

            offCtx.fill();
            this.glowSprites.push(offCanvas);
        }
    }

    initGrid() {
        this.dots = [];
        this.cols = Math.floor(this.canvas.width / this.GRID_SPACING);
        this.rows = Math.floor(this.canvas.height / this.GRID_SPACING);

        const offsetX = (this.canvas.width - (this.cols * this.GRID_SPACING)) / 2 + (this.GRID_SPACING/2);
        const offsetY = (this.canvas.height - (this.rows * this.GRID_SPACING)) / 2 + (this.GRID_SPACING/2);

        const centerX = this.cols / 2;
        const centerY = this.rows / 2;
        this.maxManhattan = Math.abs(0 - centerX) + Math.abs(0 - centerY); 

        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const x = offsetX + col * this.GRID_SPACING;
                const y = offsetY + row * this.GRID_SPACING;
                this.dots.push(new Dot(col, row, x, y, this.maxManhattan, this));
            }
        }
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.initGrid();
        this.preRenderGlowSprites(0, 255, 255); 
    }

    initAudio(stream) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioContext.createAnalyser();
        
        this.source = this.audioContext.createMediaStreamSource(stream);
        this.source.connect(this.analyser);

        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.2; // Bajamos el smoothing nativo porque usamos Time-Smoothing LERP manual
        const bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(bufferLength);
        this.smoothedDataArray = new Float32Array(bufferLength);

        this.draw();
    }

    draw() {
        requestAnimationFrame(this.draw.bind(this));
        const nowMs = performance.now();
        const dt = (nowMs - this.previousTimeMs) / 1000.0; 
        this.previousTimeMs = nowMs;

        // Extraer audio en bruto
        this.analyser.getByteFrequencyData(this.dataArray);

        // --- TIME-SMOOTHING AVANZADO ---
        // Lerp entre el valor de frame anterior del bin y el nuevo, otorga caída física espesa a las frecuencias visuales
        for (let i = 0; i < this.dataArray.length; i++) {
            this.smoothedDataArray[i] = lerp(this.smoothedDataArray[i], this.dataArray[i], 0.4);
        }

        // --- ANÁLISIS ESPECTRAL LOGARÍTMICO & ENERGÍAS ---
        let totalEnergy = 0;
        let bassEnergy = 0;
        let trebleEnergy = 0;

        for (let i = 0; i < this.smoothedDataArray.length; i++) {
            const val = this.smoothedDataArray[i];
            totalEnergy += val;
            
            // Frecuencias separadas
            if (i < 15) bassEnergy += val; 
            if (i > 100 && i < 300) trebleEnergy += val; 
        }
        
        const avgEnergy = totalEnergy / this.smoothedDataArray.length;
        const avgBass = bassEnergy / 15;
        const avgTreble = trebleEnergy / 200;
        
        this.normalizedEnergy = Math.min(1.0, Math.max(0.0, avgEnergy / 128.0)); 
        this.normalizedBass = Math.min(1.0, Math.max(0.0, avgBass / 200.0)); 
        this.normalizedTreble = Math.min(1.0, Math.max(0.0, avgTreble / 100.0)); 

        // Algoritmo Inteligente de Beats
        this.detectBeats(nowMs);

        // --- RELOJ GLOBAL FLUIDO ---
        const timeSpeed = 1.0 + (this.normalizedTreble * 15.0);
        this.globalTime += dt * timeSpeed; 

        // --- RENDERIZADO CON MOTION BLUR ---
        // Enlazar el fondo negro pero con baja opacidad (0.15) para dejar estelas de luz "Motion Blur"
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'; 
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // --- MODO AMBIENTE DYNAMIC COLOR ---
        const targetColor = interpolateColor(this.normalizedEnergy);
        this.currentAmbientColor.r = lerp(this.currentAmbientColor.r, targetColor.r, 0.05);
        this.currentAmbientColor.g = lerp(this.currentAmbientColor.g, targetColor.g, 0.05);
        this.currentAmbientColor.b = lerp(this.currentAmbientColor.b, targetColor.b, 0.05);

        const rStr = Math.round(this.currentAmbientColor.r);
        const gStr = Math.round(this.currentAmbientColor.g);
        const bStr = Math.round(this.currentAmbientColor.b);
        
        const colorRep = `rgb(${rStr}, ${gStr}, ${bStr})`;
        if (colorRep !== this.lastRenderedColorStr) {
            this.preRenderGlowSprites(rStr, gStr, bStr);
        }

        // --- ACTUALIZACIÓN Y DIBUJO CON ADICIÓN DE LUZ (Lighter) ---
        const ctxGlobalAlphaCache = this.ctx.globalAlpha; 
        
        // Magia visual: Colores sobrepuestos se suman, emulando la física de pantallas LED intensas.
        this.ctx.globalCompositeOperation = 'lighter'; 

        for (let i = 0; i < this.dots.length; i++) {
            this.dots[i].update();
            this.dots[i].draw(this.ctx);
        }

        // Restaurar modo general para el próximo background clear
        this.ctx.globalCompositeOperation = 'source-over'; 
        this.ctx.globalAlpha = ctxGlobalAlphaCache; 
    }
}

// Inicializar el Visualizador como Objeto
const viz = new AudioVisualizer(canvas, ctx);

// --- INTERFAZ USUARIO ---
startBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
            video: true, 
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            } 
        });
        
        startBtn.style.display = 'none'; 
        viz.initAudio(stream);

    } catch (err) {
        console.error('Error al acceder al audio del sistema:', err);
        alert('No se pudo acceder al audio. Por favor, asegúrate de compatir con la casilla "Compartir audio".');
    }
});
