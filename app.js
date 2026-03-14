const startBtn = document.getElementById('start-btn');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

let audioContext;
let analyser;
let source;
let dataArray;
let animationId;

// --- Paleta de Colores Dinámica ---
let currentAmbientColor = { r: 0, g: 255, b: 255 }; // Empieza en cyan
const colorRamp = [
    { threshold: 0.0, r: 0, g: 50, b: 255 },     // Azul profundo (Quiet)
    { threshold: 0.3, r: 0, g: 200, b: 255 },    // Cian suave
    { threshold: 0.6, r: 200, g: 0, b: 255 },    // Magenta / Morado (Build-up)
    { threshold: 0.8, r: 255, g: 20, b: 147 },   // Rosa eléctrico
    { threshold: 1.0, r: 255, g: 80, b: 0 }      // Oro/Naranja/Rojo (Drop)
];

function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

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

// --- Configuración Rejilla Geométrica ---
const GRID_SPACING = 35;
let docs = [];
let cols = 0;
let rows = 0;
let mode = 'diamond'; // 'diamond' o 'chevron'
let modeTimer = 0;
const glowLevels = 10;
let glowSprites = []; // Array de canvases pre-renderizados
let lastRenderedColorStr = '';

class Dot {
    constructor(col, row, x, y, maxDistance) {
        this.col = col;
        this.row = row;
        this.x = x;
        this.y = y;
        
        // Calcular distancia Manhattan al centro para Modo Diamante
        const centerX = cols / 2;
        const centerY = rows / 2;
        this.manhattanDist = Math.abs(col - centerX) + Math.abs(row - centerY);
        this.maxManhattan = maxDistance;

        // Variables dinámicas
        this.targetEnergy = 0;
        this.currentEnergy = 0;
    }

    update(audioData, energyTotal, currentMode) {
        // En base al modo, decidimos cuánta atención le presta al audio
        let newTarget = 0;

        if (currentMode === 'diamond') {
            // Expansión desde el centro (Bass y medios en el centro, altos lejos)
            // Normalizar la distancia para mapear a los bins del audio
            const normalizedDist = this.manhattanDist / this.maxManhattan; // 0 (centro) a 1 (borde)
            
            // Queremos que el centro reaccione a bajos (índices 0-10) y los bordes a medios/altos
            const dataIndex = Math.floor(normalizedDist * 60); // Tomamos de los primeros 60 bins
            const audioVal = audioData[Math.min(dataIndex, audioData.length - 1)] / 255.0; // 0 a 1
            
            // El centro pulsa más con overall energy también
            const centerBoost = Math.max(0, 1 - (this.manhattanDist / 10)); // Boost para los 10 primeros anillos del rombo
            
            newTarget = (audioVal * 0.7) + (energyTotal * centerBoost * 0.8);

        } else if (currentMode === 'chevron') {
            // Modo Cheurón: Reacciones en V
            // Calculamos un valor en "V" basado en la columna respecto al centro
            const centerX = cols / 2;
            const distFromCenterCol = Math.abs(this.col - centerX);
            
            // La onda viaja hacia arriba/abajo (usamos la fila)
            // Índice basado en la V que forma la columna + fila
            const waveIndex = (distFromCenterCol + this.row) % 40; 
            const audioVal = audioData[waveIndex] / 255.0;
            
            newTarget = audioVal * (0.4 + energyTotal * 0.6);
        }

        this.targetEnergy = newTarget;
        
        // Fluidity: Lerp constante para que se vea como Samsung Ambient Mode (fluido, nunca instantáneo)
        this.currentEnergy = lerp(this.currentEnergy, this.targetEnergy, 0.15);
    }

    draw(ctx, sprites) {
        const energyIndex = Math.min(glowLevels - 1, Math.floor(this.currentEnergy * glowLevels));
        if (energyIndex < 0) return;

        // Opacidad general baja si está lejos (Atenuación estática de ambiente)
        // Pero sube si tiene mucha energía
        let alpha = 0.1 + (this.currentEnergy * 0.9);
        if (alpha > 1) alpha = 1;

        const sprite = sprites[energyIndex];
        if (!sprite) return;

        // Dibujar el punto pre-renderizado desde el offscreen canvas
        ctx.globalAlpha = alpha;
        // Restar la mitad del ancho del sprite para centrarlo exactamente en (x,y)
        ctx.drawImage(sprite, this.x - sprite.width / 2, this.y - sprite.height / 2);
    }
}

// Generar Sprites Offscreen para no destruir CPU con shadowBlur en cada frame
function preRenderGlowSprites(colR, colG, colB) {
    glowSprites = [];
    const colorStr = `rgb(${colR}, ${colG}, ${colB})`;
    lastRenderedColorStr = colorStr;

    for (let i = 0; i < glowLevels; i++) {
        // i=0 es la energía más baja, i=glowLevels-1 la más alta (Drop)
        const intensity = i / (glowLevels - 1); // 0 a 1
        
        // Canvas oculto temporal
        const offCanvas = document.createElement('canvas');
        const padding = 40; // Espacio necesario para no cortar el glow
        // El tamaño máximo del punto reaccionando
        const maxRadius = 3 + (intensity * 4); 
        
        offCanvas.width = maxRadius * 2 + padding * 2;
        offCanvas.height = maxRadius * 2 + padding * 2;
        const offCtx = offCanvas.getContext('2d');

        const cx = offCanvas.width / 2;
        const cy = offCanvas.height / 2;

        offCtx.beginPath();
        offCtx.arc(cx, cy, maxRadius, 0, Math.PI * 2);
        
        // Puntos apagados (intensidad=0) son grises oscuros
        if (intensity === 0) {
            offCtx.fillStyle = 'rgba(50, 50, 50, 0.5)';
        } else {
            // El color brilla más y se vuelve blanco en picos máximos
            const isKick = intensity > 0.8;
            offCtx.fillStyle = isKick ? '#ffffff' : colorStr;
            // Blur aumenta con la intensidad
            offCtx.shadowBlur = 5 + (intensity * 30);
            offCtx.shadowColor = colorStr;
        }

        offCtx.fill();
        glowSprites.push(offCanvas);
    }
}

function initGrid() {
    docs = [];
    cols = Math.floor(canvas.width / GRID_SPACING);
    rows = Math.floor(canvas.height / GRID_SPACING);

    const offsetX = (canvas.width - (cols * GRID_SPACING)) / 2 + (GRID_SPACING/2);
    const offsetY = (canvas.height - (rows * GRID_SPACING)) / 2 + (GRID_SPACING/2);

    const centerX = cols / 2;
    const centerY = rows / 2;
    const maxManhattan = Math.abs(0 - centerX) + Math.abs(0 - centerY); // Máxima distancia posible

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x = offsetX + col * GRID_SPACING;
            const y = offsetY + row * GRID_SPACING;
            docs.push(new Dot(col, row, x, y, maxManhattan));
        }
    }
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    initGrid();
    preRenderGlowSprites(0, 255, 255); // Inicial
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // Ajuste inicial

startBtn.addEventListener('click', async () => {
    try {
        // Pedimos capturar la pantalla/pestaña con el audio del sistema activado.
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
            video: true, // Se suele requerir pedir video para capturar sistema/pestaña
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            } 
        });
        
        startBtn.style.display = 'none'; // Ocultar botón al iniciar
        
        setupAudio(stream);
    } catch (err) {
        console.error('Error al acceder al audio del sistema:', err);
        alert('No se pudo acceder al audio. Por favor, asegúrate de compartir una pestaña o ventana y de marcar la casilla "Compartir audio".');
    }
});

function setupAudio(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    
    source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    draw();
}

function draw() {
    animationId = requestAnimationFrame(draw);

    analyser.getByteFrequencyData(dataArray);

    // Fondo OLED Negro puro, sin rastro (motion blur era genal para partículas, pero no para rejilla geométrica)
    ctx.fillStyle = '#000000'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // --- MODO AMBIENTE Y COLOR DINÁMICO ---

    // Calcular intensidad total (Energía RMS o promedio)
    let totalEnergy = 0;
    for (let i = 0; i < dataArray.length; i++) {
        totalEnergy += dataArray[i];
    }
    const avgEnergy = totalEnergy / dataArray.length;
    
    // Normalizar a 0-1 (usualmente 128 es un volumen bastante alto)
    const normalizedEnergy = Math.min(1.0, Math.max(0.0, avgEnergy / 128.0)); 

    // Obtener color objetivo y aplicar suavizado a currentAmbientColor
    const targetColor = interpolateColor(normalizedEnergy);
    // Interpolación muy suave para efecto chill/ambiente
    currentAmbientColor.r = lerp(currentAmbientColor.r, targetColor.r, 0.03);
    currentAmbientColor.g = lerp(currentAmbientColor.g, targetColor.g, 0.03);
    currentAmbientColor.b = lerp(currentAmbientColor.b, targetColor.b, 0.03);

    const rStr = Math.round(currentAmbientColor.r);
    const gStr = Math.round(currentAmbientColor.g);
    const bStr = Math.round(currentAmbientColor.b);
    
    // Verifica si el cambio de color es suficientemente grande para justificar re-renderizar los sprites Offscreen
    // Renderizar demasiados canas offscreen da bajones de FPS
    const colorRep = `rgb(${rStr}, ${gStr}, ${bStr})`;
    if (colorRep !== lastRenderedColorStr) {
        // Reducir la frecuencia de actualización para rendimiento a costa de una sutil compresión de color
        // Solo actualizamos el set de sprites si cambia visiblemente la matriz RGB
        // Por la forma en que redondeamos, se actualizará cada que el int RGB cambie.
        preRenderGlowSprites(rStr, gStr, bStr);
    }

    // --- TRANSICIÓN DE MODOS (Diamante vs Cheurón) ---
    modeTimer++;
    // Cambiar de modo aproximadamente cada 15 segundos (15s * ~60fps = 900 frames)
    // O cuando hay un "drop" inmenso y ha pasado un rato prudente (400 frames mínimo)
    if (modeTimer > 900 || (normalizedEnergy > 0.85 && modeTimer > 400)) {
        mode = mode === 'diamond' ? 'chevron' : 'diamond';
        modeTimer = 0;
    }

    // Actualizar y dibujar rejilla
    const ctxGlobalAlphaCache = ctx.globalAlpha; // Restaurar después

    for (let i = 0; i < docs.length; i++) {
        docs[i].update(dataArray, normalizedEnergy, mode);
        docs[i].draw(ctx, glowSprites);
    }

    ctx.globalAlpha = ctxGlobalAlphaCache; // Reset
}
