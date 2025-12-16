export class BridgeClient {
    constructor(canvas, logCallback, statusCallback) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.log = logCallback;
        this.updateStatus = statusCallback;

        this.ws = null;
        this.isConnected = false;

        this.frameCount = 0;
        this.lastTime = performance.now();
        this.fps = 0;

        // Input state to send to server
        this.inputState = {
            mouseX: 0,
            mouseY: 0
        };

        this.setupInputListeners();
    }

    setupInputListeners() {
        // Track mouse movement to send to server
        const handleMove = (x, y) => {
            if (!this.isConnected) return;
            const rect = this.canvas.getBoundingClientRect();
            // Normalize -1 to 1
            const nx = ((x - rect.left) / rect.width) * 2 - 1;
            const ny = -(((y - rect.top) / rect.height) * 2 - 1);

            this.sendInput(nx, ny);
        };

        this.canvas.addEventListener('mousemove', (e) => {
            handleMove(e.clientX, e.clientY);
        });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault(); // Prevent scrolling
            if(e.touches.length > 0) {
                handleMove(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: false });
    }

    sendInput(x, y) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Rate limit could be added here
            this.ws.send(JSON.stringify({
                type: 'input',
                mouseX: x,
                mouseY: y
            }));
        }
    }

    connect(url) {
        if (this.ws) {
            this.ws.close();
        }

        this.log(`Connecting to ${url}...`);
        this.updateStatus('connecting');

        try {
            this.ws = new WebSocket(url);
            this.ws.binaryType = 'arraybuffer';
        } catch (e) {
            this.log(`Invalid URL: ${e.message}`, 'error');
            this.updateStatus('disconnected');
            return;
        }

        this.ws.onopen = () => {
            this.log('Bridge Connected!', 'success');
            this.isConnected = true;
            this.updateStatus('connected');
        };

        this.ws.onclose = () => {
            this.log('Bridge Disconnected', 'error');
            this.isConnected = false;
            this.updateStatus('disconnected');
        };

        this.ws.onerror = (e) => {
            this.log('Connection Error', 'error');
        };

        this.ws.onmessage = async (event) => {
            if (event.data instanceof ArrayBuffer) {
                this.renderFrame(event.data);
                this.updateMetrics(event.data.byteLength);
            }
        };
    }

    async renderFrame(arrayBuffer) {
        // Create a blob from the buffer (assuming JPEG from server)
        const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
        const bitmap = await createImageBitmap(blob);

        // Draw to canvas
        this.canvas.width = bitmap.width;
        this.canvas.height = bitmap.height;
        this.ctx.drawImage(bitmap, 0, 0);

        bitmap.close(); // release memory
    }

    updateMetrics(byteLength) {
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastTime >= 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastTime = now;

            // Dispatch event for UI
            window.dispatchEvent(new CustomEvent('bridge-metrics', {
                detail: { 
                    fps: this.fps,
                    bytes: byteLength
                }
            }));
        }
    }
}