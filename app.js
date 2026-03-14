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

// --- Configuración del Sistema de Partículas ---
const particles = [];
const NUM_PARTICLES = 3000;
let bassShockwave = 0; // Ondas de choque
let lastBass = 0; // Para detectar "golpes" de bajo

class Particle {
    constructor(isCore = false) {
        this.isCore = isCore;
        this.reset();
        // Distribuir partículas inicialmente
        this.angle = Math.random() * Math.PI * 2;
        this.distance = isCore ? Math.random() * 50 : 50 + Math.random() * 500;
        this.z = Math.random() * 1000; // Profundidad simulada
    }

    reset() {
        this.angle = Math.random() * Math.PI * 2;
        // El núcleo está en el centro, las bandas se distribuyen hacia afuera
        this.distance = this.isCore ? Math.random() * 40 : 80 + Math.random() * (canvas.width / 1.5);
        this.baseDistance = this.distance;
        this.speed = (Math.random() * 0.02) + 0.005;
        this.z = 1000; // Manda la partícula "lejos" para el efecto túnel
        
        // Variación de oscuridad para dar profundidad al vórtice
        this.darkenOffset = 20 + Math.random() * 50; 
    }

    update(midsAvg, trebleAvg, bassAvg, shockwave) {
        // Velocidad de rotación base + alteración por Mids (Voces/Melodías)
        this.angle += (this.speed * (1 + (midsAvg / 100)));

        // Acercar partículas hacia la cámara (efecto túnel)
        this.z -= (5 + (trebleAvg / 10)); 
        if (this.z <= 0) this.reset();

        // Expansión y ondas de choque (Bass)
        let currentDistance = this.baseDistance;
        
        if (!this.isCore) {
            // Ondulación/vibración basada en altos y medios
            const vibration = Math.sin(this.angle * 10) * (trebleAvg / 5);
            
            // Reemplazo a bandas concéntricas afectadas por la onda de choque
            // Si la partícula está cerca del radio de la onda, empujarla hacia afuera
            const shockwaveEffect = Math.max(0, 100 - Math.abs(currentDistance - shockwave)) / 100;
            const push = shockwaveEffect * (bassAvg * 1.5);
            
            currentDistance += vibration + push;
        }

        return { currentDistance };
    }

    draw(ctx, centerX, centerY, currentDistance, zScale, isCoreExploding, ambientColorStr, ambientColor) {
        const px = centerX + Math.cos(this.angle) * currentDistance * zScale;
        const py = centerY + Math.sin(this.angle) * currentDistance * zScale;
        
        // Tamaño simulado por perspectiva 3D
        const size = (this.isCore ? 3 : 1.5) * zScale;

        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.1, size), 0, Math.PI * 2);

        if (this.isCore) {
            // Centro que pulsa intensamente
            ctx.fillStyle = isCoreExploding ? '#fff' : ambientColorStr; 
            ctx.shadowBlur = 15 * zScale;
            ctx.shadowColor = ambientColorStr;
        } else {
            // Bandas de vórtice basadas en el color ambiente actual
            const pr = Math.max(0, ambientColor.r - this.darkenOffset);
            const pg = Math.max(0, ambientColor.g - this.darkenOffset);
            const pb = Math.max(0, ambientColor.b - this.darkenOffset);
            const pColorStr = `rgb(${pr}, ${pg}, ${pb})`;

            ctx.fillStyle = pColorStr;
            ctx.shadowBlur = 5 * zScale;
            ctx.shadowColor = pColorStr;
        }
        
        ctx.fill();
        ctx.shadowBlur = 0; // Reset
    }
}

// Inicializar partículas (Core + Bandas)
function initParticles() {
    particles.length = 0;
    // 5% de partículas para el núcleo central vibrante
    for (let i = 0; i < NUM_PARTICLES; i++) {
        particles.push(new Particle(i < NUM_PARTICLES * 0.05));
    }
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (particles.length === 0) initParticles();
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // Ajuste inicial

startBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            } 
        });
        startBtn.style.display = 'none'; // Ocultar botón al iniciar
        setupAudio(stream);
    } catch (err) {
        console.error('Error al acceder al micrófono:', err);
        alert('No se pudo acceder al micrófono. Por favor, asegúrate de otorgar los permisos necesarios.');
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

    // Efecto de estela de luz (Motion blur fluido)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'; // El .2 controla qué tanto dura la estela
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Calcular la intensidad por rangos de frecuencia (Segmentación)
    // Con fftSize = 2048, cada índice (bin) abarca aprox ~21.5 Hz
    
    // Bajos (Bass): Índices 0 a 10 (aprox. 0 - 215 Hz)
    let bassAvg = 0;
    for (let i = 0; i <= 10; i++) {
        bassAvg += dataArray[i];
    }
    bassAvg = bassAvg / 11;

    // Medios (Mids): Índices 11 a 50 (aprox. 236 - 1075 Hz)
    let midsAvg = 0;
    for (let i = 11; i <= 50; i++) {
        midsAvg += dataArray[i];
    }
    midsAvg = midsAvg / 40;

    // Agudos (Treble): Índices 51 a 250 (aprox. 1096 - 5375 Hz)
    // No iteramos hasta el final para optimizar rendimiento ya que rara vez hay información útil muy arriba
    let trebleAvg = 0;
    for (let i = 51; i <= 250; i++) {
        trebleAvg += dataArray[i];
    }
    trebleAvg = trebleAvg / 200;
    
    // --- SISTEMA DE PARTÍCULAS / VÓRTICE 3D ---
    
    // Detectar golpe fuerte de bajo (Kick)
    if (bassAvg > 180 && bassAvg - lastBass > 20) {
        bassShockwave = 50; // Iniciar onda expansiva cerca del núcleo
    }
    lastBass = bassAvg;

    // Expandir onda de choque
    if (bassShockwave > 0) {
        bassShockwave += 10 + (bassAvg / 10); // Expande hacia afuera
        if (bassShockwave > canvas.width) bassShockwave = 0; // Reset cuando sale de vista
    }

    const isCoreExploding = bassAvg > 200;

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
    // Suavizamos el cambio de color (0.05 de interpolación lineal por frame)
    currentAmbientColor.r = lerp(currentAmbientColor.r, targetColor.r, 0.05);
    currentAmbientColor.g = lerp(currentAmbientColor.g, targetColor.g, 0.05);
    currentAmbientColor.b = lerp(currentAmbientColor.b, targetColor.b, 0.05);

    const rStr = Math.round(currentAmbientColor.r);
    const gStr = Math.round(currentAmbientColor.g);
    const bStr = Math.round(currentAmbientColor.b);
    const ambientColorStr = `rgb(${rStr}, ${gStr}, ${bStr})`;

    // Dibujar núcleo central principal (fondo glow detrás de partículas)
    const coreRadius = 30 + (bassAvg * 0.8);
    ctx.beginPath();
    ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rStr}, ${gStr}, ${bStr}, ${0.1 + (bassAvg / 500)})`;
    ctx.shadowBlur = 50 + bassAvg;
    ctx.shadowColor = ambientColorStr;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Actualizar y dibujar todas las partículas
    particles.forEach(p => {
        const { currentDistance } = p.update(midsAvg, trebleAvg, bassAvg, bassShockwave);
        
        // Simular Proyección 3D (z -> zScale)
        // Partículas con z cerca de 0 están "cerca", z alrededor de 1000 están "lejos"
        const zScale = 200 / (200 + p.z);
        
        p.draw(ctx, centerX, centerY, currentDistance, zScale, isCoreExploding, ambientColorStr, currentAmbientColor);
    });
}
