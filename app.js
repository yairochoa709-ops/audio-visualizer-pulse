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

// --- Paleta de Colores Dinámica Ampliada ---
const colorRamp = [
    { threshold: 0.0, r: 0, g: 30, b: 255 },     // Azul Medianoche profundo (Quiet)
    { threshold: 0.15, r: 0, g: 150, b: 255 },   // Azul Cyan
    { threshold: 0.3, r: 0, g: 255, b: 150 },    // Verde Neón / Esmeralda
    { threshold: 0.45, r: 150, g: 255, b: 0 },   // Amarillo Lima
    { threshold: 0.6, r: 255, g: 200, b: 0 },    // Dorado
    { threshold: 0.75, r: 255, g: 50, b: 150 },  // Fucsia brillante (Build-up)
    { threshold: 0.9, r: 255, g: 0, b: 50 },     // Rojo Carmesí
    { threshold: 1.0, r: 255, g: 255, b: 255 }   // Blanco puro (Drop brutal)
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
// CLASE DOT (PARTÍCULA ESPACIAL 3D)
// ==========================================
class Dot {
    constructor(index, x, y, z, maxRadius, visualizer) {
        this.vis = visualizer; 
        this.index = index;
        
        // Coordenadas Base 3D Locales
        this.baseX = x;
        this.baseY = y;
        this.baseZ = z;
        this.maxRadius = maxRadius;
        
        // Coordenadas Actuales 3D Rotadas
        this.currentX = x;
        this.currentY = y;
        this.currentZ = z;
        
        // Coordenadas 2D Pantalla Proyectadas
        this.x = 0;
        this.y = 0;
        this.scale = 1;
        
        // Ángulos polares (para efectos matemáticos de onda)
        this.lat = Math.asin(this.baseY / maxRadius);
        this.lon = Math.atan2(this.baseZ, this.baseX);

        // Física Elástica (Damping & Elasticity)
        this.targetSize = 0;
        this.currentSize = 0;
        this.velocity = 0;         
        this.acceleration = 0;     
        this.friction = 0.82;      
        this.elasticity = 0.15;    
    }

    update() {
        // --- 1. Lógica Acústica y Modos Esféricos ---
        let audioPush = 0;
        let waveSine = 0;

        const dataIndex = Math.floor((this.index / this.vis.dots.length) * 100); 
        const audioVal = this.vis.smoothedDataArray[Math.min(dataIndex, 100)] / 255.0; 

        if (this.vis.mode === 'diamond') {
            // Modo "Marea Ecuatorial": Ondas basadas en longitud 
            const waveAmplitude = 0.3 + (this.vis.normalizedBass * 0.7);
            waveSine = waveAmplitude * Math.sin(this.vis.globalTime * 3 - this.lon * 5);
            audioPush = (audioVal * 0.7) + (this.vis.normalizedEnergy * 0.5) + Math.max(0, waveSine);

        } else if (this.vis.mode === 'chevron') {
            // Modo "Pulsos Polares": Ondas basadas en latitud
            const waveAmplitude = 0.4 + (this.vis.normalizedBass * 0.5);
            waveSine = waveAmplitude * Math.sin(this.vis.globalTime * 3 - this.lat * 5);
            audioPush = (audioVal * 0.4) + (this.vis.normalizedEnergy * 0.6) + Math.max(0, waveSine);
        }

        // --- 2. Física Newtoniana (Hooks Law + Damping) ---
        this.acceleration = audioPush;
        this.velocity += this.acceleration;
        const restoringForce = (0 - this.currentSize) * this.elasticity;
        this.velocity += restoringForce;
        this.velocity *= this.friction;
        if(this.velocity > 2) this.velocity = 2;
        
        this.currentSize += this.velocity;
        if(this.currentSize < 0) this.currentSize = 0; 

        // --- 3. Manipulación y Rotación 3D ---
        const rotY = this.vis.globalTime * 0.5; // Rotación en el eje vertical
        const rotX = Math.sin(this.vis.globalTime * 0.2) * 0.3; // Cabeceo leve
        const rotZ = this.vis.globalTime * 0.1;

        // Pulso de Escala (La esfera "respira" con los bajos)
        const expandPulse = 1.0 + (this.vis.normalizedBass * 0.3) + pseudoNoise(this.baseX, this.baseY, this.vis.globalTime) * 0.05;
        
        const px = this.baseX * expandPulse;
        const py = this.baseY * expandPulse;
        const pz = this.baseZ * expandPulse;
        
        // Rotar Z
        const x1 = px * Math.cos(rotZ) - py * Math.sin(rotZ);
        const y1 = py * Math.cos(rotZ) + px * Math.sin(rotZ);

        // Rotar Y
        const x2 = x1 * Math.cos(rotY) - pz * Math.sin(rotY);
        const z1 = pz * Math.cos(rotY) + x1 * Math.sin(rotY);
        
        // Rotar X
        const y2 = y1 * Math.cos(rotX) - z1 * Math.sin(rotX);
        const z2 = z1 * Math.cos(rotX) + y1 * Math.sin(rotX);
        
        this.currentX = x2;
        this.currentY = y2 + (waveSine * 5 * this.vis.normalizedTreble); 
        this.currentZ = z2;
        
        // --- 4. Proyección de Perspectiva 2D (Focal) ---
        const fov = 1000;
        const viewerDistance = 1500; 
        const zProj = viewerDistance + this.currentZ;
        
        this.scale = fov / zProj;
        
        const centerX = this.vis.canvas.width / 2;
        const centerY = this.vis.canvas.height / 2;
        
        this.x = centerX + this.currentX * this.scale;
        this.y = centerY + this.currentY * this.scale;
    }

    draw(ctx) {
        const energyIndex = Math.min(this.vis.glowLevels - 1, Math.floor(this.currentSize * this.vis.glowLevels));
        if (energyIndex < 0) return;

        // Efecto Parallax / Layering (Profundidad) 
        // Generamos un coeficiente de profundidad donde Z-negativo (lejos) es 0, y Z-positivo (cerca) es 1
        const depthNorm = (this.currentZ + this.maxRadius) / (this.maxRadius * 2); 
        
        // Los puntos lejanos son más tenues. Este es el efecto Parallax Inmersivo real 3D
        let alpha = 0.05 + (depthNorm * 0.4) + (this.currentSize * 0.5);
        if (alpha > 1) alpha = 1;
        if (alpha < 0) alpha = 0;

        const sprite = this.vis.glowSprites[energyIndex];
        if (!sprite) return;

        ctx.globalAlpha = alpha;
        
        // Escalar por perspectiva para que los puntos lejanos se vean más pequeños físicamente
        const dimW = sprite.width * this.scale;
        const dimH = sprite.height * this.scale;

        ctx.drawImage(sprite, this.x - dimW / 2, this.y - dimH / 2, dimW, dimH);
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
        
        // Estética y Rejilla/Esfera
        this.glowLevels = 10;
        this.glowSprites = [];
        this.lastRenderedColorStr = '';
        this.currentAmbientColor = { r: 0, g: 255, b: 255 };
        
        this.dots = [];
        
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
                // Color blanco o gris tenue para hacer visible la cuadrícula incluso sin música
                offCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
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
        
        // Mapeo Esférico basado en Secuencia de Fibonacci para distribuir puntos uniformemente
        const numDots = 1500; // Gran cantidad de puntos para una esfera fluida 3D
        // El radio es más o menos el 45% del tamaño más pequeño de la pantalla
        const radius = Math.min(this.canvas.width, this.canvas.height) * 0.45; 
        const phi = Math.PI * (3 - Math.sqrt(5)); // Golden angle

        for (let i = 0; i < numDots; i++) {
            // Y va de 1 a -1 (polo norte a polo sur)
            const y = 1 - (i / (numDots - 1)) * 2; 
            const r = Math.sqrt(1 - y * y); // Radio ajustado a la altura Y
            
            const theta = phi * i; // Golden angle ratio
            
            const x = Math.cos(theta) * r;
            const z = Math.sin(theta) * r;
            
            // Escalar al radio de pantalla requerido
            const px = x * radius;
            const py = y * radius;
            const pz = z * radius;
            
            this.dots.push(new Dot(i, px, py, pz, radius, this));
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

        // --- RENDERIZADO ALTO CONTRASTE (CERO GHOSTING) ---
        // Limpiar completamente la pantalla en negro puro por cada frame. Esto elimina la estela (desenfoque).
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.fillStyle = '#000000'; 
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

        // --- ACTUALIZACIÓN Y DIBUJO 3D ---
        const ctxGlobalAlphaCache = this.ctx.globalAlpha; 

        // Actualizar datos matemáticos
        for (let i = 0; i < this.dots.length; i++) {
            this.dots[i].update();
        }

        // --- ORDENAMIENTO EN PROFUNDIDAD (Z-SORTING) ---
        // Vital para la ilusión 3D: Los puntos lejanos deben dibujarse primero (atrás), los cercanos al final (frente).
        // Se hace un slice() para clonar temporalmente y no destruir el array original seguido de un sort()
        const sortedDots = this.dots.slice().sort((a, b) => a.currentZ - b.currentZ);

        // --- RENDERIZADO CON MOTION BLUR PARA MAYOR INMERSIÓN 3D ---
        // Volvemos a un ligero tint negro (0.35) para que no haya mareo pero las chispas de la esfera dejen una cola
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'; 
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Colores se suman digitalmente (Composición Lighter)
        this.ctx.globalCompositeOperation = 'lighter'; 

        // Trazado en orden de capas
        for (let i = 0; i < sortedDots.length; i++) {
            sortedDots[i].draw(this.ctx);
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
    // 1. Solicitamos pantalla completa INMEDIATAMENTE al hacer clic
    // (Si lo hacemos después de getDisplayMedia, el navegador lo bloquea por seguridad)
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(err => console.log("Fullscreen error:", err));
    }

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

// Toggle Interactivo: Alternar pantalla completa con Doble Clic en cualquier lado
window.addEventListener('dblclick', () => {
    if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(err => console.log("Fullscreen error:", err));
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
});
