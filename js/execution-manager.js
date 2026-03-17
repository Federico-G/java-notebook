// execution-manager.js — Manages the execution iframe and captures stdout/stderr

export class ExecutionManager {
    constructor() {
        this.iframe = null;
        this.ready = false;
        this.pendingResolve = null;
        this.stdout = [];
        this.stderr = [];
        this.onOutput = null;
        this.timeout = null;

        window.addEventListener('message', (event) => {
            if (this.iframe && event.source === this.iframe.contentWindow) {
                this.handleMessage(event.data);
            }
        });
    }

    createIframe() {
        if (this.iframe) {
            this.iframe.remove();
        }
        this.ready = false;
        const iframe = document.createElement('iframe');
        iframe.src = 'frames/run-frame.html';
        iframe.sandbox = 'allow-scripts allow-same-origin';
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        this.iframe = iframe;
    }

    handleMessage(msg) {
        switch (msg.command) {
            case 'ready':
                this.ready = true;
                break;
            case 'stdout':
                this.stdout.push(msg.line);
                if (this.onOutput) this.onOutput('stdout', msg.line);
                break;
            case 'stderr':
                this.stderr.push(msg.line);
                if (this.onOutput) this.onOutput('stderr', msg.line);
                break;
        }

        // Handle status messages from frame.js
        if (msg.status === 'complete') {
            this.finish();
        } else if (msg.status === 'failed') {
            this.finish({ error: msg.errorMessage || 'Execution failed' });
        }
    }

    finish(extra = {}) {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
        if (this.pendingResolve) {
            const resolve = this.pendingResolve;
            this.pendingResolve = null;
            resolve({
                stdout: this.stdout,
                stderr: this.stderr,
                ...extra
            });
        }
    }

    async waitForReady(timeoutMs = 5000) {
        if (this.ready) return;
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                if (this.ready) {
                    resolve();
                } else if (Date.now() - start > timeoutMs) {
                    reject(new Error('Iframe ready timeout'));
                } else {
                    setTimeout(check, 50);
                }
            };
            check();
        });
    }

    async execute(code, onOutput, timeoutMs = 10000) {
        this.stdout = [];
        this.stderr = [];
        this.onOutput = onOutput || null;

        // Recreate iframe for clean state
        this.createIframe();
        await this.waitForReady();

        return new Promise((resolve) => {
            this.pendingResolve = resolve;

            this.timeout = setTimeout(() => {
                this.timeout = null;
                this.iframe.remove();
                this.iframe = null;
                this.ready = false;
                const res = this.pendingResolve;
                this.pendingResolve = null;
                if (res) {
                    res({
                        stdout: this.stdout,
                        stderr: this.stderr,
                        error: 'Execution timed out (10s)'
                    });
                }
            }, timeoutMs);

            this.iframe.contentWindow.postMessage({ code: code }, '*');
        });
    }
}
