# Audio Visualizer Pulse 🎶✨

Un visualizador musical de audio reactivo en tiempo real diseñado para navegadores web, ejecutado completamente del lado del cliente utilizando JavaScript Puro (Vanilla JS), HTML5 `<canvas>` y la **Web Audio API**.

Inspirado en el **Ambient Mode (Modo Ambiente)** de pantallas modernas Oled y Smart TVs, este proyecto transforma el audio global del sistema operativo o el navegador en una pieza de arte generativo de altísimo contraste.

## ✨ Características Principales

1. **Captura Directa del Sistema:** Olvídate del ruido del micrófono. Utiliza la `Screen Capture API (getDisplayMedia)` para canalizar el audio en calidad digital prístina directamente desde la tarjeta de sonido o la pestaña del navegador deseada (por ejemplo, YouTube o Spotify).
2. **Rejilla Geométrica (Ambient Grid):** Reacciona de forma ordenada mediante una matriz de cientos de puntos perfectamente separados que "respiran" orgánicamente.
3. **Optimización con Sprites (OffscreenCanvas):** Al dibujar miles de resplandores (*Glow*) a 60 FPS el procesador puede derretirse; se utiliza una serie de texturas pre-renderizadas (`drawImage` en lugar de `shadowBlur`) delegando la inmensa carga a la aceleración de la tarjeta gráfica (GPU).
4. **Cinemática Fluida con Interpolación (Lerp):** El movimiento no es errático ni parpadeante. Cada cálculo implementa matemática LERP (*Linear Interpolation*) garantizando que las formas orgánicas sigan un objetivo acústico elegante.
5. **Color Dinámico RMS:** Calcula la energía Root Mean Square global en tiempo real para transicionar el ambiente fluidamente a través de una Paleta Dinámica. (Azules tranquilos para silencio; rosas, magentas y blancos/oros cegadores para los **Drops** y la saturación de bajos).
6. **Alternancia de Patrones (Algoritmos Matemáticos):**
    *   **Modo Diamante:** Lee la *Distancia Manhattan* desde el núcleo de la pantalla provocando expansiones romboides de 45° que dominan en presencias fuertes de bajos (Kicks).
    *   **Modo Cheurón (V):** Lee proyeciones de ondas verticales en base a las columnas iteradas, creando un efecto de arrastre ondular en "letra V".

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
