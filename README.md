# Audio Visualizer Pulse 🎶✨

Un visualizador musical de audio reactivo en tiempo real diseñado para navegadores web, ejecutado completamente del lado del cliente utilizando JavaScript Puro (Vanilla JS), HTML5 `<canvas>` y la **Web Audio API**.

Inspirado en el **Ambient Mode (Modo Ambiente)** de pantallas modernas Oled y Smart TVs, este proyecto transforma el audio global del sistema operativo o el navegador en una pieza de arte generativo de altísimo contraste.

## ✨ Características Principales (Versión Final)

1. **Captura en Vivo sin Micrófono:** Utiliza la `Screen Capture API` para canalizar audio de altísima fidelidad digital directamente de tu tarjeta madre, ignorando ruidos ambientales o micrófonos pobres.
2. **Topología Esférica 3D Interactiva:** Atrás quedó el 2D. El visualizador renderiza cientos de estrellas pre-calculadas componiendo una hermosa y profunda esfera holográfica. ¡Usa el **ratón o táctil** para rotarla orgánicamente en tiempo real!
3. **Optimización Extrema de Sprites:** Los destellos hiper-brillantes están pre-renderizados en un *OffscreenCanvas* de múltiples planos, inyectando 60 FPS sin derretir el procesador.
4. **Gradiente Termodinámico RGB:** Contiene un bucle hipnótico que mezcla fluidamente a través de **12 fases de color HSL** cada 3 segundos usando composición `lighter` sin cálculos excesivos sobre la marcha.
5. **Algoritmo de Físicas Acústicas Profesionales:**
    *   **Elastic Newtoniana:** Cada punto de la galaxia cuenta con cálculo de masa, inercia, velocidad y resistencia elástica, resultando en oscilaciones suaves ("Motion Damping") tras un estallido sonoro.
    *   **Beat Detection Inteligente:** Lee constantemente los últimos 2 segundos de `RMS` de bajos para disparar drops matemáticamente perfectos, no al azar.
6. **Triple Modo Galáctico:**
    *   **Diamante:** Expansión romboide clásica.
    *   **Cheurón (V):** Ondulaciones en zig-zag que atraviesan los hemisferios.
    *   **Gravity Implosion (Agujero Negro):** Un evento especial que aplasta toda la galaxia 3D hacia un núcleo invisible por microsegundos durante caídas rítmicas estridentes.
7. **Red Neural Térmica (Autónoma):** Si el análisis central detecta **energía vocal o cánticos mantenidos**, el ecosistema 3D tejerá automáticamente haces de luz sólidos conectando todas las estrellas parpadeantes.

## 🚀 Cómo usar el Visualizador

1. Clona este repositorio o abre el archivo `index.html` en tu navegador moderno preferido.
2. Una vez que cargue la interfaz negra pura, presiona click en **"Capturar Audio del Sistema"**.
3. El navegador te solicitará permisos.
    *   Selecciona "Pestaña de Chrome/Edge" (o la fuente de tu preferencia).
    *   **⚠️ IMPORTANTE**: Asegúrate de tener marcada la pequeña casilla en la parte inferior de la ventana emergente llamada **Compartir audio** antes de confirmar.
4. Reproduce algo de música épica, electrónica, o *hardstyle* en la pestaña seleccionada que elegiste compartir.
5. ¡Disfruta el Arte Generativo!

## 🛠️ Tecnologías

*   **HTML5 & CSS3 Vanilla**
*   **JavaScript ECMAScript 6+** (Orientado a Objetos - Entidad `Dot`)
*   **Web Audio API** (`AudioContext`, `createAnalyser`)
*   **Offscreen / In-Memory Canvas rendering**

---
*Este proyecto final fue moldeado cuidando estrictamente la estética visual elegante, el alto contraste OLED y el rendimiento ultra optimizado del procesador.*
