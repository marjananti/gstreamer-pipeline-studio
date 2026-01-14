import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface GstElement {
    name: string;
    longName: string;
    description: string;
    klass: string;
    author: string;
    padTemplates: GstPadTemplate[];
    properties: GstProperty[];
}

export interface GstPadTemplate {
    name: string;
    direction: 'src' | 'sink';
    presence: 'always' | 'sometimes' | 'request';
    caps: string;
}

export interface GstProperty {
    name: string;
    type: string;
    description: string;
    defaultValue: string;
    readable: boolean;
    writable: boolean;
    enumValues?: { name: string; value: number }[];
    min?: number;
    max?: number;
}

export interface PipelineState {
    state: 'NULL' | 'READY' | 'PAUSED' | 'PLAYING';
    pending: 'NULL' | 'READY' | 'PAUSED' | 'PLAYING' | 'VOID_PENDING';
}

export interface DebugMessage {
    timestamp: number;
    level: number;
    category: string;
    element: string;
    message: string;
}

export interface PipelineMetrics {
    latency: number;
    fps: number;
    bufferCount: number;
    droppedBuffers: number;
    memoryUsage: number;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export interface ValidationError {
    elementId: string;
    message: string;
    type: 'element_not_found' | 'pad_incompatible' | 'property_invalid' | 'connection_missing';
}

export interface ValidationWarning {
    elementId: string;
    message: string;
    type: 'deprecated' | 'performance' | 'suggestion';
}

interface JsonRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params: Record<string, unknown>;
    id: number;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
    id: number;
}

export class GStreamerService extends EventEmitter {
    private m_context: vscode.ExtensionContext;
    private m_process: ChildProcess | null = null;
    private m_requestId = 0;
    private m_pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }> = new Map();
    private m_buffer = '';
    private m_outputChannel: vscode.OutputChannel;

    constructor(context: vscode.ExtensionContext) {
        super();
        this.m_context = context;
        this.m_outputChannel = vscode.window.createOutputChannel('GStreamer Service');
    }

    async start(): Promise<void> {
        const config = vscode.workspace.getConfiguration('gstreamer');
        const pythonPath = config.get<string>('pythonPath', 'python3');
        const backendPath = path.join(this.m_context.extensionPath, 'src', 'backend', 'main.py');

        this.m_outputChannel.appendLine(`[info] Starting GStreamer backend...`);
        this.m_outputChannel.appendLine(`[info] Python: ${pythonPath}`);
        this.m_outputChannel.appendLine(`[info] Backend: ${backendPath}`);

        this.m_process = spawn(pythonPath, [backendPath], {
            env: {
                ...process.env,
                GST_DEBUG: config.get<string>('debugLevel', '2'),
                PYTHONUNBUFFERED: '1'
            },
            cwd: path.dirname(backendPath)
        });

        let startupError = '';

        this.m_process.stdout?.on('data', (data: Buffer) => {
            this.handleData(data.toString());
        });

        this.m_process.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            this.m_outputChannel.appendLine(`[stderr] ${text}`);
            startupError += text;
            this.handleDebugOutput(text);
        });

        this.m_process.on('error', (error) => {
            this.m_outputChannel.appendLine(`[error] Process error: ${error.message}`);
            this.m_outputChannel.show();
        });

        this.m_process.on('exit', (code) => {
            this.m_outputChannel.appendLine(`[info] Process exited with code ${code}`);
            this.m_process = null;
        });

        await this.waitForReady(startupError);
    }

    private async waitForReady(_startupErrorRef: string): Promise<void> {
        return new Promise((resolve, reject) => {
            let earlyExit = false;

            const exitHandler = (code: number | null) => {
                earlyExit = true;
                this.m_outputChannel.show();
                reject(new Error(
                    `Backend exited with code ${code}. Check 'GStreamer Service' output for details.`
                ));
            };

            this.m_process?.once('exit', exitHandler);

            const timeout = setTimeout(() => {
                this.m_process?.removeListener('exit', exitHandler);
                this.m_outputChannel.show();
                reject(new Error(
                    'GStreamer backend startup timeout. Check Python and GStreamer installation.'
                ));
            }, 10000);

            const checkReady = async () => {
                if (earlyExit) return;
                
                try {
                    await this.sendRequest('ping', {});
                    clearTimeout(timeout);
                    this.m_process?.removeListener('exit', exitHandler);
                    this.m_outputChannel.appendLine('[info] Backend started successfully');
                    resolve();
                } catch {
                    if (!earlyExit) {
                        setTimeout(checkReady, 200);
                    }
                }
            };

            setTimeout(checkReady, 300);
        });
    }

    stop(): void {
        if (this.m_process) {
            this.m_process.kill();
            this.m_process = null;
        }
    }

    private handleData(data: string): void {
        this.m_buffer += data;
        const lines = this.m_buffer.split('\n');
        this.m_buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const response = JSON.parse(line) as JsonRpcResponse;
                    this.handleResponse(response);
                } catch (e) {
                    this.m_outputChannel.appendLine(`[warn] Failed to parse response: ${line}`);
                }
            }
        }
    }

    private handleResponse(response: JsonRpcResponse): void {
        if ('id' in response && response.id !== null) {
            const pending = this.m_pendingRequests.get(response.id);
            if (pending) {
                this.m_pendingRequests.delete(response.id);
                if (response.error) {
                    pending.reject(new Error(response.error.message));
                } else {
                    pending.resolve(response.result);
                }
            }
        } else if ('method' in response) {
            const notification = response as unknown as { method: string; params: unknown };
            if (notification.method === 'frame') {
                const frameData = notification.params as string;
                this.m_outputChannel.appendLine(`[frame] Received frame (${frameData.length} bytes)`);
            }
            this.emit(notification.method, notification.params);
        }
    }

    private handleDebugOutput(data: string): void {
        const lines = data.split('\n');
        for (const line of lines) {
            const match = line.match(/^(\d+:\d+:\d+\.\d+)\s+(\d+)\s+(\w+)\s+(\S+)\s+(.+)$/);
            if (match) {
                const debugMessage: DebugMessage = {
                    timestamp: Date.now(),
                    level: parseInt(match[2], 10),
                    category: match[3],
                    element: match[4],
                    message: match[5]
                };
                this.emit('debug', debugMessage);
            }
        }
    }

    private async sendRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
        if (!this.m_process) {
            throw new Error('GStreamer backend not running');
        }

        const id = ++this.m_requestId;
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            method,
            params,
            id
        };

        return new Promise<T>((resolve, reject) => {
            this.m_pendingRequests.set(id, {
                resolve: resolve as (value: unknown) => void,
                reject
            });

            const data = JSON.stringify(request) + '\n';
            this.m_process!.stdin?.write(data);

            setTimeout(() => {
                if (this.m_pendingRequests.has(id)) {
                    this.m_pendingRequests.delete(id);
                    reject(new Error(`Request timeout: ${method}`));
                }
            }, 30000);
        });
    }

    async inspectElement(elementName: string): Promise<GstElement> {
        return this.sendRequest<GstElement>('inspect', { element: elementName });
    }

    async listElements(): Promise<string[]> {
        return this.sendRequest<string[]>('listElements', {});
    }

    async runPipeline(pipelineDescription: string): Promise<void> {
        return this.sendRequest('run', { pipeline: pipelineDescription });
    }

    async stopPipeline(): Promise<void> {
        return this.sendRequest('stop', {});
    }

    async pausePipeline(): Promise<void> {
        return this.sendRequest('pause', {});
    }

    async resumePipeline(): Promise<void> {
        return this.sendRequest('resume', {});
    }

    async getPipelineState(): Promise<PipelineState> {
        return this.sendRequest<PipelineState>('getState', {});
    }

    async validatePipeline(pipelineDescription: string): Promise<ValidationResult> {
        return this.sendRequest<ValidationResult>('validate', { pipeline: pipelineDescription });
    }

    async getMetrics(): Promise<PipelineMetrics> {
        return this.sendRequest<PipelineMetrics>('getMetrics', {});
    }

    onFrame(callback: (frame: string) => void): void {
        this.on('frame', callback);
    }

    onStateChange(callback: (state: PipelineState) => void): void {
        this.on('stateChange', callback);
    }

    onDebugMessage(callback: (message: DebugMessage) => void): void {
        this.on('debug', callback);
    }

    onError(callback: (error: { message: string; element?: string }) => void): void {
        this.on('error', callback);
    }

    showOutput(): void {
        this.m_outputChannel.show();
    }
}

