import { zipSync, strToU8 } from 'fflate';

/**
 * Generates the ZIP file containing the Node.js Bridge Server
 */
export function generateBridgeZip() {
    // 1. package.json
    // Switched to Puppeteer to avoid native compilation (gyp/gl) issues
    const packageJson = {
        "name": "gpu-bridge",
        "version": "2.0.0",
        "description": "Puppeteer-based GPU Bridge",
        "main": "server.js",
        "type": "module",
        "scripts": {
            "start": "node server.js"
        },
        "dependencies": {
            "ws": "^8.16.0",
            "puppeteer": "^22.0.0"
        }
    };

    // 2. server.js
    // Uses Chrome Headless (Puppeteer) for robust WebGL support without compiling native modules
    const serverJs = `
import { WebSocketServer } from 'ws';
import puppeteer from 'puppeteer';

// Configuration
const PORT = 8080;
const WIDTH = 640;
const HEIGHT = 480;

(async () => {
    console.log('Starting GPU Bridge (Powered by Puppeteer)...');

    // 1. Launch Headless Browser with GPU enabled
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--use-gl=angle',       // Better cross-platform support
            '--ignore-gpu-blocklist',
            '--hide-scrollbars',
            '--mute-audio'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT });

    console.log('Initializing 3D Scene...');

    // 2. Inject the 3D Engine and Scene
    // We run Three.js inside the browser context to leverage the actual GPU
    const htmlContent = \`
    <!DOCTYPE html>
    <html>
        <head>
            <style>body { margin: 0; overflow: hidden; background: #000; }</style>
            <!-- Load Three.js from CDN -->
            <script type="importmap">
                { "imports": { "three": "https://unpkg.com/three@0.160.0/build/three.module.js" } }
            </script>
        </head>
        <body>
            <script type="module">
                import * as THREE from 'three';

                // --- 3D Scene Setup ---
                const scene = new THREE.Scene();
                const camera = new THREE.PerspectiveCamera(75, \${WIDTH} / \${HEIGHT}, 0.1, 1000);
                const renderer = new THREE.WebGLRenderer({ antialias: true });
                renderer.setSize(\${WIDTH}, \${HEIGHT});
                document.body.appendChild(renderer.domElement);

                // Create Object
                const geometry = new THREE.TorusKnotGeometry(10, 3, 100, 16);
                const material = new THREE.MeshNormalMaterial();
                const torus = new THREE.Mesh(geometry, material);
                scene.add(torus);
                
                camera.position.z = 30;

                // Input State (updated by Node.js via evaluate)
                window.bridgeState = { mouseX: 0, mouseY: 0 };

                // Render Loop
                function animate() {
                    requestAnimationFrame(animate);
                    
                    // Auto Rotation
                    torus.rotation.x += 0.01;
                    torus.rotation.y += 0.02;

                    // User Interaction
                    torus.rotation.x += window.bridgeState.mouseY * 0.05;
                    torus.rotation.y += window.bridgeState.mouseX * 0.05;

                    // Decay interaction
                    window.bridgeState.mouseX *= 0.9;
                    window.bridgeState.mouseY *= 0.9;

                    renderer.render(scene, camera);
                }
                animate();
            </script>
        </body>
    </html>
    \`;

    await page.setContent(htmlContent);

    // 3. Setup WebSocket Server for Clients
    const wss = new WebSocketServer({ port: PORT });
    console.log(\`Bridge ready on ws://localhost:\${PORT}\`);

    // 4. Setup Screencasting via CDP (Chrome DevTools Protocol)
    // This captures the rendered frames efficiently
    const client = await page.target().createCDPSession();
    await client.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 80,
        maxWidth: WIDTH,
        maxHeight: HEIGHT,
        everyNthFrame: 1
    });

    client.on('Page.screencastFrame', async (frameObj) => {
        const { data, sessionId } = frameObj;
        
        // Acknowledge frame to keep stream flowing
        await client.send('Page.screencastFrameAck', { sessionId });

        // 'data' is base64, convert to buffer for efficient WS transfer
        const buffer = Buffer.from(data, 'base64');

        // Broadcast to all connected web clients
        for (const ws of wss.clients) {
            if (ws.readyState === 1) {
                ws.send(buffer);
            }
        }
    });

    // 5. Handle Input from Clients
    wss.on('connection', (ws) => {
        console.log('Client connected');
        
        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'input') {
                    // Inject input into the browser context
                    // We use catch() to suppress errors if the page is busy/closed
                    await page.evaluate((x, y) => {
                        if(window.bridgeState) {
                            window.bridgeState.mouseX = x;
                            window.bridgeState.mouseY = y;
                        }
                    }, data.mouseX, data.mouseY).catch(() => {});
                }
            } catch (e) {}
        });
    });

    // Cleanup on exit
    process.on('SIGINT', async () => {
        await browser.close();
        process.exit();
    });

})();
    `;

    // 3. README.md
    const readme = `
# GPU Bridge (Puppeteer Edition)

This bridge application uses a headless Chrome instance to render 3D graphics. This approach bypasses complex native compilation issues often found with 'headless-gl' and ensures better compatibility with modern GPU drivers.

## Prerequisites

- Node.js v16 or higher

## Setup

1. Install dependencies:
   \`npm install\`
   
   *Note: This will download a local version of Chromium (~150MB) to ensure a matching rendering engine.*

## Usage

1. Start the server:
   \`npm start\`

2. Open the web client in your browser and connect to:
   \`ws://localhost:8080\`
    `;

    // Create Zip
    const zipData = zipSync({
        'package.json': strToU8(JSON.stringify(packageJson, null, 2)),
        'server.js': strToU8(serverJs),
        'README.md': strToU8(readme)
    });

    return zipData;
}