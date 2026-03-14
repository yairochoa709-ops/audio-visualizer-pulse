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
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

    analyser.fftSize = 256;
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

    // Calcular la intensidad de las frecuencias bajas (kicks)
    // El índice 0 al 10 en un fftSize de 256 suele cubrir los graves
    let bassAvg = 0;
    for (let i = 0; i < 10; i++) {
        bassAvg += dataArray[i];
    }
    bassAvg = bassAvg / 10;
    
    // Radio base + aumento reactivo al bajo para que "pulse"
    const radius = 80 + (bassAvg * 1.5);

    // Dibujar el círculo principal pulsante
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = `hsl(180, 100%, ${50 + (bassAvg / 255) * 50}%)`; // Cyan brillante reactivo
    ctx.lineWidth = 5 + (bassAvg / 30);
    ctx.shadowBlur = 20 + (bassAvg / 10);
    ctx.shadowColor = ctx.strokeStyle;
    ctx.stroke();

    // Dibujar círculos concéntricos secundarios
    for (let i = 1; i <= 3; i++) {
        const offsetRadius = radius + (i * 60) + (bassAvg * 0.5);
        ctx.beginPath();
        ctx.arc(centerX, centerY, offsetRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = `hsla(300, 100%, 60%, ${0.5 - (i * 0.1) + (bassAvg / 500)})`; // Magenta
        ctx.lineWidth = 2 + (bassAvg / 100);
        ctx.shadowBlur = 15;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.stroke();
    }
}
