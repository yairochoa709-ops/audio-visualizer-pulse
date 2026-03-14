const startBtn = document.getElementById('start-btn');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

let audioContext;
let analyser;
let source;
let dataArray;
let animationId;

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
        
        // Tonos magenta fucsia y morado profundo para las bandas
        const hue = 280 + Math.random() * 40; // 280-320 (Morado a Magenta/Fucsia)
        const lightness = 40 + Math.random() * 30;
        this.color = `hsl(${hue}, 100%, ${lightness}%)`;
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

    draw(ctx, centerX, centerY, currentDistance, zScale, isCoreExploding) {
        const px = centerX + Math.cos(this.angle) * currentDistance * zScale;
        const py = centerY + Math.sin(this.angle) * currentDistance * zScale;
        
        // Tamaño simulado por perspectiva 3D
        const size = (this.isCore ? 3 : 1.5) * zScale;

        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.1, size), 0, Math.PI * 2);

        if (this.isCore) {
            // Centro Cyan que pulsa intensamente
            ctx.fillStyle = isCoreExploding ? '#fff' : '#00ffff'; 
            ctx.shadowBlur = 15 * zScale;
            ctx.shadowColor = '#00ffff';
        } else {
            // Bandas de vórtice
            ctx.fillStyle = this.color;
            ctx.shadowBlur = 5 * zScale;
            ctx.shadowColor = this.color;
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

    // Dibujar núcleo central principal (fondo glow detrás de partículas)
    const coreRadius = 30 + (bassAvg * 0.8);
    ctx.beginPath();
    ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 255, 255, ${0.1 + (bassAvg / 500)})`;
    ctx.shadowBlur = 50 + bassAvg;
    ctx.shadowColor = '#00ffff';
    ctx.fill();
    ctx.shadowBlur = 0;

    // Actualizar y dibujar todas las partículas
    particles.forEach(p => {
        const { currentDistance } = p.update(midsAvg, trebleAvg, bassAvg, bassShockwave);
        
        // Simular Proyección 3D (z -> zScale)
        // Partículas con z cerca de 0 están "cerca", z alrededor de 1000 están "lejos"
        const zScale = 200 / (200 + p.z);
        
        p.draw(ctx, centerX, centerY, currentDistance, zScale, isCoreExploding);
    });
}
