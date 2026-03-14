const startBtn = document.getElementById('start-btn');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

let audioContext;
let analyser;
let source;
let dataArray;
let animationId;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
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

    // Efecto de rastro (trail) en lugar de limpiar completamente el canvas
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
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
    
    // --- DIBUJADO BASADO EN FRECUENCIAS ---

    // BASS: Radio base + aumento reactivo al bajo (Pulso principal)
    const radius = 80 + (bassAvg * 1.5);

    // MIDS: Lo usamos para rotación del canvas
    // Guardamos el estado actual del canvas antes de rotar
    ctx.save();
    ctx.translate(centerX, centerY);
    // Rotación sutil basada en los medios
    const rotation = (midsAvg / 255) * Math.PI; 
    ctx.rotate(rotation);
    // Como rotamos sobre el centro, dibujaremos en (0,0) relativo
    
    // Dibujar el círculo principal pulsante (reactivo al Bass)
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = `hsl(180, 100%, ${50 + (bassAvg / 255) * 50}%)`; // Cyan brillante reactivo
    ctx.lineWidth = 5 + (bassAvg / 30);
    ctx.shadowBlur = 20 + (bassAvg / 10);
    ctx.shadowColor = ctx.strokeStyle;
    ctx.stroke();

    // Dibujar círculos concéntricos secundarios (combinando Bass y rotación de Mids)
    for (let i = 1; i <= 3; i++) {
        const offsetRadius = radius + (i * 60) + (bassAvg * 0.5);
        ctx.beginPath();
        // Agregamos rotación extra o forma pseudo-elíptica basada en los medios
        ctx.arc(0, 0, offsetRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = `hsla(300, 100%, 60%, ${0.5 - (i * 0.1) + (bassAvg / 500)})`; // Magenta
        ctx.lineWidth = 2 + (bassAvg / 100);
        ctx.shadowBlur = 15;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.stroke();
    }
    
    // Restaurar transformación (deshacer rotación y traslación) para otros elementos
    ctx.restore();

    // TREBLE: Destellos o partículas pequeñas en posiciones aleatorias de la circunferencia
    if (trebleAvg > 50) { // Umbral para que no haya destellos siempre
        const numParticles = Math.floor(trebleAvg / 10);
        for(let i = 0; i < numParticles; i++) {
            const angle = Math.random() * Math.PI * 2;
            const particleDirDist = radius + 100 + (Math.random() * 150); // Mínimo fuera del centro
            
            const px = centerX + Math.cos(angle) * particleDirDist;
            const py = centerY + Math.sin(angle) * particleDirDist;

            ctx.beginPath();
            ctx.arc(px, py, 1 + (Math.random() * 3), 0, 2 * Math.PI);
            ctx.fillStyle = `rgba(255, 255, 255, ${trebleAvg / 255})`;
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'white';
            ctx.fill();
        }
    }
}
