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

const COLOR_VARIANTS = 6;
const NUM_HUES = 12; // 12 Colores en bucle

// Función para convertir HSL a RGB para los sprites
function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l; 
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return { r: r * 255, g: g * 255, b: b * 255 };
}

// Función auxiliar para forzar tinte RGB hacia otra paleta
function mixColorsRGB(c1, c2, amt) {
    return {
        r: lerp(c1.r, c2.r, amt),
        g: lerp(c1.g, c2.g, amt),
        b: lerp(c1.b, c2.b, amt)
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

        if (this.vis.mode === 'diamond' || this.vis.mode === 'neural' || this.vis.mode === 'supernova') {
            // Modo "Marea Ecuatorial": Ondas basadas en longitud 
            const waveAmplitude = 0.2 + (this.vis.normalizedBass * 0.4);
            waveSine = waveAmplitude * Math.sin(this.vis.globalTime * 3 - this.lon * 5);
            audioPush = (audioVal * 0.4) + (this.vis.normalizedEnergy * 0.3) + Math.max(0, waveSine);

        } else if (this.vis.mode === 'chevron' || this.vis.mode === 'implosion') {
            // Modo "Pulsos Polares": Ondas basadas en latitud
            const waveAmplitude = 0.25 + (this.vis.normalizedBass * 0.3);
            waveSine = waveAmplitude * Math.sin(this.vis.globalTime * 3 - this.lat * 5);
            audioPush = (audioVal * 0.25) + (this.vis.normalizedEnergy * 0.4) + Math.max(0, waveSine);
        }

        // --- 1.5 Control Focal (Centro vs Bordes) ---
        // rad2D nos dice si el punto está dibujándose en el centro o en los bordes por la proyección 2D
        const rad2D = Math.sqrt(this.currentX * this.currentX + this.currentY * this.currentY);
        this.edgeFactor = Math.min(1.0, rad2D / this.maxRadius); // 0 = Centro, 1 = Borde
        const centerFactor = Math.max(0.0, 1.0 - this.edgeFactor); // 1 = Centro, 0 = Borde

        // --- 1.8 Efecto NCS (Topología Vectorial 3D de Desplazamiento) ---
        // Extraemos la frecuencia de audio Pura (bajos a agudos) guiada por el Index 
        // de este polvo cósmico particular para generar su Valle/Pico específico
        let audioTopo = (this.vis.smoothedDataArray[dataIndex] / 255.0); 

        // Atenuador de Frecuencias Medias (Voces): 
        // Si el punto está leyendo frecuencias entre bajos y agudos altos (aprox índices 15 a 70),
        // reducimos violentamente su sensibilidad en un 70%. Esto elimina el comportamiento "nervioso"
        // que provocan las vocales mantenidas en la tela de la esfera.
        if (dataIndex > 15 && dataIndex < 70) {
            audioTopo *= 0.3; 
        }

        // Aplicamos una curva exponencial. Solo un sonido fuerte generará verdaderos picos.
        // Los sonidos de fondo silencioso apenas moverán la superficie.
        audioTopo = Math.pow(audioTopo, 1.3);

        // Generamos un campo gravitacional que empuja fuera la coordenada tridimensional XYZ local.
        // Combinamos la física del "waveSine", la estática del "audioTopo" y un multiplicador
        let pushDisplacement = (audioTopo * 0.6) + (waveSine * 0.3);
        if (pushDisplacement < 0) pushDisplacement = 0;
        
        let displacementMagnitude = pushDisplacement * 1.5 * centerFactor;

        // --- Mutes y Altibajos según el Modo Especial Físico ---
        if (this.vis.mode === 'supernova') {
            // Gravedad Cero: Anillo focal destruido, explosión bruta a cámara
            displacementMagnitude = pushDisplacement * 3.5; 
            audioPush *= 1.5; 
        } else if (this.vis.mode === 'implosion') {
            // Agujero Negro: Inversión gravimétrica que traga la masa hacia el núcleo
            const suckPower = this.vis.normalizedBass * 1.8;
            displacementMagnitude = -suckPower * centerFactor;
            audioPush *= 0.1; // Se asfixian los destellos individuales
        } else {
            // Modos Regulares: Los nodos reducen su aceleración rítmica hasta un 20% al acercarse al centro
            audioPush *= (0.8 + 0.2 * this.edgeFactor);
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
        const rotY = this.vis.globalTime * 0.15; 
        const rotX = Math.sin(this.vis.globalTime * 0.1) * 0.15; 
        const rotZ = this.vis.globalTime * 0.05; 

        // Pulso de Escala Base Respiratoria "Oculto" 
        const expandPulse = 1.0 + (this.vis.normalizedBass * 0.15) + pseudoNoise(this.baseX, this.baseY, this.vis.globalTime) * 0.05;
        
        // Sumamos el desplazamiento gravitacional a la escala base y extendemos vectorialmente X, Y y Z
        // antes de rotarlos. ¡Esto altera físicamente la forma Base de la Rejilla!
        let finalDistortion = expandPulse + displacementMagnitude;
        if (finalDistortion < 0.01) finalDistortion = 0.01; // Restricción Anti-Materia (impide escalar a negativo)

        const px = this.baseX * finalDistortion;
        const py = this.baseY * finalDistortion;
        const pz = this.baseZ * finalDistortion;
        
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
        this.currentY = y2; // Eliminamos la ola Y "falsa" agregada en los pasos de rejilla 2D del pasado
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

        // Color-Shift Dinámico Local (La onda de bajo arrastra color)
        // El offset de color depende de la masa elástica actual del punto (currentSize)
        // Los puntos grandes (onda activa) cambian su tono hacia el rojo/blanco (variantes altas)
        let colorVariantIdx = Math.floor(this.currentSize * (COLOR_VARIANTS - 1));
        if (colorVariantIdx > COLOR_VARIANTS - 1) colorVariantIdx = COLOR_VARIANTS - 1;
        if (colorVariantIdx < 0) colorVariantIdx = 0;

        const depthNorm = (this.currentZ + this.maxRadius) / (this.maxRadius * 2); 
        
        let alpha = 0.05 + (depthNorm * 0.4) + (this.currentSize * 0.5);
        if (alpha > 1) alpha = 1;
        if (alpha < 0) alpha = 0;

        // Atenuar luminosidad hasta un 30% en el centro para resaltar las ondas(bordes) intensamente
        alpha *= (0.70 + 0.30 * this.edgeFactor);

        // Seleccionamos la paleta base del bucle (duración de 3 segundos por Hue, 12 Hues total)
        const progresoColor = Math.abs((this.vis.globalTime / 3.0) % NUM_HUES);
        let hueIdx1 = Math.floor(progresoColor);
        let hueIdx2 = (hueIdx1 + 1) % NUM_HUES;
        let blendFactor = progresoColor - hueIdx1; // De 0.0 a 1.0 (Transición)

        // Obtenemos los 2 Sprites correspondientes para Cross-Fade
        const sprite1 = this.vis.glowSprites[hueIdx1]?.[colorVariantIdx]?.[energyIndex];
        const sprite2 = this.vis.glowSprites[hueIdx2]?.[colorVariantIdx]?.[energyIndex];
        
        if (!sprite1 || !sprite2) return;
        
        // Encoger tamaño paulatinamente hasta un 75% de base a medida que los puntos se aproximan al centro de visión
        const sizeFactor = 0.75 + (0.25 * this.edgeFactor);
        const dimW = sprite1.width * this.scale * sizeFactor;
        const dimH = sprite1.height * this.scale * sizeFactor;

        // Dibujamos el primer sprite desvaneciéndose
        ctx.globalAlpha = alpha * (1.0 - blendFactor);
        ctx.drawImage(sprite1, this.x - dimW / 2, this.y - dimH / 2, dimW, dimH);

        // Dibujamos el segundo sprite apareciendo encima 
        ctx.globalAlpha = alpha * blendFactor;
        ctx.drawImage(sprite2, this.x - dimW / 2, this.y - dimH / 2, dimW, dimH);
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
        this.glowSprites = []; // Será Array 3D
        
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
        
        // Pre-renderizar toda la matriz de colores 3D intensivos (sólo se hace 1 vez)
        this.preRenderAllGlowSprites();

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
            const modosDisponibles = ['diamond', 'neural', 'chevron', 'implosion', 'supernova'];
            const currentIndex = modosDisponibles.indexOf(this.mode);
            this.mode = modosDisponibles[(currentIndex + 1) % modosDisponibles.length];
            
            this.lastBeatTime = nowMs;
            
            // "Pequeño destello global de cámara" - Truco visual extra opcional
            this.ctx.fillStyle = `rgba(255, 255, 255, 0.1)`;
            this.ctx.globalCompositeOperation = 'lighter';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    preRenderAllGlowSprites() {
        this.glowSprites = []; // Array 3D: [12 Hues][6 Variants][10 Levels]

        for (let h = 0; h < NUM_HUES; h++) {
            const arrVariants = [];
            // Hue de 0 a 1 (0 a 360 grados HSL)
            const hueBase = h / NUM_HUES;
            const baseColor = hslToRgb(hueBase, 1.0, 0.5); // Saturación 100%, Brillo 50%
            const peakColor = hslToRgb(hueBase, 1.0, 0.85); // Mismo tono, pero casi blanco (Brillantez 85%)
            
            for(let v = 0; v < COLOR_VARIANTS; v++) {
                const arrNiveles = [];
                // Mezclamos el color base hacia su versión brillante de energía (shiftAmt)
                const shiftAmt = v / (COLOR_VARIANTS - 1); // 0 a 1
                const maxShiftOpacity = 0.9;
                const varColor = mixColorsRGB(baseColor, peakColor, shiftAmt * maxShiftOpacity); 
                const varColorStr = `rgb(${Math.round(varColor.r)}, ${Math.round(varColor.g)}, ${Math.round(varColor.b)})`;

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
                        offCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                    } else {
                        // Ya no forzamos un '#ffffff' indiscriminado
                        // Usamos la variante de color brillante con intenso glow propio del HSL local
                        offCtx.fillStyle = varColorStr;
                        offCtx.shadowBlur = 5 + (intensity * 30);
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

    initGrid() {
        this.dots = [];
        
        // Se reduce drásticamente el número de puntos de 1500 a 700
        // Esto separa la cuadrícula permitiendo vislumbrar mejor las estelas de "vibración de ondas"
        const numDots = 700; 
        const radius = Math.min(this.canvas.width, this.canvas.height) * 0.45; 
        const phi = Math.PI * (3 - Math.sqrt(5)); 

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

        // --- EFECTO RED NEURAL TÉRMICA ---
        // Dibujamos líneas estilo constelación polygonal cuando el modo está activo
        if (this.mode === 'neural') {
            this.ctx.globalCompositeOperation = 'lighter';
            this.ctx.lineWidth = 1.0;
            
            // Calculamos color de línea incandescente sincronizado con el globo principal
            const progresoColor = Math.abs((this.globalTime / 3.0) % NUM_HUES);
            const hueBase = Math.floor(progresoColor) / NUM_HUES;
            const rgbLine = hslToRgb(hueBase, 1.0, 0.6);
            this.ctx.strokeStyle = `rgba(${Math.round(rgbLine.r)},${Math.round(rgbLine.g)},${Math.round(rgbLine.b)}, 0.4)`;
            
            this.ctx.beginPath();
            
            // Generamos las conexiones tejiendo puntos de Fibonacci
            for (let i = 0; i < this.dots.length; i++) {
                const dotA = this.dots[i];
                
                // Optimizador GFX: Solo renderizamos líneas para nodos frente a cámara
                if (dotA.currentZ < -dotA.maxRadius * 0.3) continue;

                // Conectar al siguiente punto inmediato de Fibonacci
                if (i + 1 < this.dots.length) {
                    const dotB = this.dots[i + 1];
                    // Trazamos el cordel umbilical únicamente si la gravedad geométrica los mantiene cerca
                    const dist = Math.sqrt(Math.pow(dotA.x - dotB.x, 2) + Math.pow(dotA.y - dotB.y, 2));
                    if (dist < 150) {
                        this.ctx.moveTo(dotA.x, dotA.y);
                        this.ctx.lineTo(dotB.x, dotB.y);
                    }
                }
                
                // Conectar al vecino de salto dorado profundo (Patrón Red)
                if (i + 34 < this.dots.length) {
                    const dotC = this.dots[i + 34];
                    const dist = Math.sqrt(Math.pow(dotA.x - dotC.x, 2) + Math.pow(dotA.y - dotC.y, 2));
                    if (dist < 150) {
                        this.ctx.moveTo(dotA.x, dotA.y);
                        this.ctx.lineTo(dotC.x, dotC.y);
                    }
                }
            }
            this.ctx.stroke();
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
