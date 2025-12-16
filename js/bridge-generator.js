import { zipSync, strToU8 } from 'fflate';

/**
 * Generates the ZIP file containing the Node.js Bridge Server
 */
export function generateBridgeZip() {
    // 1. package.json
    const packageJson = {
        "name": "native-gpu-bridge",
        "version": "1.0.0",
        "description": "Bridge between native GPU context and browser",
        "main": "server.js",
        "type": "module",
        "scripts": {
            "start": "node server.js"
        },
        "dependencies": {
            "ws": "^8.16.0",
            "three": "^0.160.0",
            "gl": "^6.0.2",
            "jpeg-js": "^0.4.4"
        }
    };

    // 2. server.js
    const serverJs = `
import { WebSocketServer } from 'ws';
import gl from 'gl';
import * as THREE from 'three';
import jpeg from 'jpeg-js';

// Configuration
const PORT = 8080;
const WIDTH = 640;
const HEIGHT = 480;
const FPS = 30;

// Setup Headless WebGL
const glContext = gl(WIDTH, HEIGHT, { preserveDrawingBuffer: true });
if (!glContext) {
    console.error("Failed to create WebGL context. Make sure you have system dependencies for 'headless-gl'.");
    process.exit(1);
}

// Setup THREE.js
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, WIDTH / HEIGHT, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ context: glContext });
renderer.setSize(WIDTH, HEIGHT);

// Create some 3D content
const geometry = new THREE.TorusKnotGeometry(10, 3, 100, 16);
const material = new THREE.MeshNormalMaterial();
const torus = new THREE.Mesh(geometry, material);
scene.add(torus);

camera.position.z = 30;

// WebSocket Server
const wss = new WebSocketServer({ port: PORT });

console.log(\`Native GPU Bridge running on ws://localhost:\${PORT}\`);
console.log(\`Rendering at \${WIDTH}x\${HEIGHT}\`);

let clients = new Set();
let inputState = { mouseX: 0, mouseY: 0 };

wss.on('connection', (ws) => {
    console.log('Client connected');
    clients.add(ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'input') {
                inputState = data;
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        clients.delete(ws);
    });
});

// Rendering Loop
setInterval(() => {
    if (clients.size === 0) return; // Don't render if no one is watching

    // Update Logic
    torus.rotation.x += 0.01;
    torus.rotation.y += 0.02;
    
    // Interactive influence
    torus.rotation.x += inputState.mouseY * 0.05;
    torus.rotation.y += inputState.mouseX * 0.05;

    // Reset input influence decay
    inputState.mouseX *= 0.9;
    inputState.mouseY *= 0.9;

    // Render
    renderer.render(scene, camera);

    // Read Pixels
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    glContext.readPixels(0, 0, WIDTH, HEIGHT, glContext.RGBA, glContext.UNSIGNED_BYTE, pixels);

    // Encode to JPEG (Optimization: sending raw pixels over WS is heavy)
    // We flip Y because WebGL reads upside down relative to images
    const rawData = {
        data: pixels,
        width: WIDTH,
        height: HEIGHT
    };
    
    // Manual flip before encoding if needed, or handle in client. 
    // Usually easier to handle in client, but let's try to send a valid image buffer.
    // NOTE: jpeg-js expects RGBA buffer.
    
    // Flip Y manually for correct image
    const flippedPixels = new Uint8Array(WIDTH * HEIGHT * 4);
    for(let y=0; y<HEIGHT; y++) {
        for(let x=0; x<WIDTH; x++) {
            const srcIdx = (y * WIDTH + x) * 4;
            const dstIdx = ((HEIGHT - 1 - y) * WIDTH + x) * 4;
            flippedPixels[dstIdx] = pixels[srcIdx];
            flippedPixels[dstIdx+1] = pixels[srcIdx+1];
            flippedPixels[dstIdx+2] = pixels[srcIdx+2];
            flippedPixels[dstIdx+3] = 255; // Alpha
        }
    }

    const jpegData = jpeg.encode({ data: flippedPixels, width: WIDTH, height: HEIGHT }, 70); // Quality 70

    // Send to clients
    for (const client of clients) {
        if (client.readyState === 1) {
            client.send(jpegData.data);
        }
    }
}, 1000 / FPS);
    `;

    // 3. README.md
    const readme = `
# Native GPU Bridge Server

This Node.js application renders a 3D scene using headless WebGL (utilizing your system's GPU or software rasterizer) and streams it to the web client.

## Setup

1. Install Node.js (v16+ recommended).
2. Install dependencies:
   \`npm install\`
   
   *Note: \`gl\` (headless-gl) requires system dependencies on some platforms (like Python, build-essential, or X11 on Linux).*

## Run

1. Start the server:
   \`npm start\`

2. Go to the web client and connect to \`ws://localhost:8080\`.

## Troubleshooting

- If \`npm install\` fails on the \`gl\` package, check the [headless-gl documentation](https://github.com/stackgl/headless-gl#system-dependencies) for your OS requirements.
    `;

    // Create Zip
    const zipData = zipSync({
        'package.json': strToU8(JSON.stringify(packageJson, null, 2)),
        'server.js': strToU8(serverJs),
        'README.md': strToU8(readme)
    });

    return zipData;
}