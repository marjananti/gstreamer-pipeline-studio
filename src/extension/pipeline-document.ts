import * as vscode from 'vscode';
import { GStreamerService, PipelineState, DebugMessage } from './gstreamer-service';
import { ElementCatalog } from './element-catalog';
import { PipelineDiagnostics } from './diagnostics';

export interface PipelineDocument {
    version: string;
    name: string;
    nodes: PipelineNode[];
    edges: PipelineEdge[];
}

export interface PipelineNode {
    id: string;
    type: string;
    position: { x: number; y: number };
    properties: Record<string, unknown>;
}

export interface PipelineEdge {
    id: string;
    source: string;
    sourceHandle: string;
    target: string;
    targetHandle: string;
}

export class PipelineEditorProvider implements vscode.CustomTextEditorProvider {
    private m_context: vscode.ExtensionContext;
    private m_service: GStreamerService;
    private m_catalog: ElementCatalog;
    private m_diagnostics: PipelineDiagnostics;
    private m_activeWebview: vscode.WebviewPanel | undefined;
    private m_debugOutputChannel: vscode.OutputChannel;
    private m_currentDocument: vscode.TextDocument | undefined;

    constructor(
        context: vscode.ExtensionContext,
        service: GStreamerService,
        catalog: ElementCatalog,
        diagnostics: PipelineDiagnostics
    ) {
        this.m_context = context;
        this.m_service = service;
        this.m_catalog = catalog;
        this.m_diagnostics = diagnostics;
        this.m_debugOutputChannel = vscode.window.createOutputChannel('GStreamer Debug');

        this.m_service.onStateChange((state) => {
            this.sendToWebview('stateChange', state);
        });

        this.m_service.onFrame((frame) => {
            console.log(`Received frame from backend: ${frame.length} bytes`);
            this.sendToWebview('frame', frame);
        });

        this.m_service.onDebugMessage((message) => {
            this.handleDebugMessage(message);
        });

        this.m_service.onError((error) => {
            this.sendToWebview('error', error);
            vscode.window.showErrorMessage(`GStreamer error: ${error.message}`);
        });
    }

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        this.m_currentDocument = document;
        this.m_activeWebview = webviewPanel;

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.m_context.extensionUri, 'dist'),
                vscode.Uri.joinPath(this.m_context.extensionUri, 'media')
            ]
        };

        webviewPanel.webview.html = this.getWebviewContent(webviewPanel.webview);

        webviewPanel.webview.onDidReceiveMessage(
            async (message) => {
                await this.handleWebviewMessage(message, document);
            },
            undefined,
            this.m_context.subscriptions
        );

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
            // Only handle changes to the actual .gstpipe file
            if (e.document.uri.toString() === document.uri.toString() &&
                e.document.uri.scheme === 'file' &&
                e.document.uri.fsPath.endsWith('.gstpipe')) {
                this.updateWebview(e.document);
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
            if (this.m_activeWebview === webviewPanel) {
                this.m_activeWebview = undefined;
            }
        });

        this.updateWebview(document);
    }

    private getWebviewContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.m_context.extensionUri, 'dist', 'webview.js')
        );

        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
    <title>GStreamer Pipeline Editor</title>
    <style>
        html, body, #root {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private async handleWebviewMessage(
        message: { type: string; payload?: unknown },
        document: vscode.TextDocument
    ): Promise<void> {
        switch (message.type) {
            case 'ready':
                this.updateWebview(document);
                await this.sendElementCatalog();
                break;

            case 'update':
                await this.updateDocument(document, message.payload as PipelineDocument);
                break;

            case 'run':
                await this.runPipeline();
                break;

            case 'stop':
                await this.stopPipeline();
                break;

            case 'pause':
                await this.pausePipeline();
                break;

            case 'resume':
                await this.resumePipeline();
                break;

            case 'validate':
                await this.validatePipeline();
                break;

            case 'getElementDetails':
                await this.sendElementDetails(message.payload as string);
                break;

            case 'export':
                const exportPayload = message.payload as { format: string };
                await this.exportPipeline(exportPayload?.format || 'gst-launch');
                break;

            case 'exportGstLaunch':
                await this.exportPipeline('gst-launch');
                break;

            case 'getMetrics':
                await this.sendMetrics();
                break;
        }
    }

    private async sendMetrics(): Promise<void> {
        try {
            const metrics = await this.m_service.getMetrics();
            this.sendToWebview('metrics', metrics);
        } catch (error) {
            console.error('Failed to get metrics:', error);
        }
    }

    private async updateDocument(document: vscode.TextDocument, data: PipelineDocument): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            JSON.stringify(data, null, 2)
        );
        await vscode.workspace.applyEdit(edit);
    }

    private updateWebview(document: vscode.TextDocument): void {
        // Verify this is a valid .gstpipe file
        if (!document.uri.fsPath.endsWith('.gstpipe')) {
            console.warn(`updateWebview called with non-.gstpipe file: ${document.uri.fsPath}`);
            return;
        }

        const text = document.getText().trim();
        
        // Handle empty documents
        if (!text) {
            console.log('Pipeline document is empty, sending default');
            const defaultDoc: PipelineDocument = {
                version: '1.0',
                name: 'New Pipeline',
                nodes: [],
                edges: []
            };
            this.sendToWebview('document', defaultDoc);
            return;
        }

        // Quick sanity check - valid JSON should start with { or [
        if (!text.startsWith('{') && !text.startsWith('[')) {
            console.error(`Document content does not look like JSON. First 50 chars: "${text.substring(0, 50)}"`);
            const defaultDoc: PipelineDocument = {
                version: '1.0',
                name: 'New Pipeline',
                nodes: [],
                edges: []
            };
            this.sendToWebview('document', defaultDoc);
            return;
        }
        
        try {
            const data = JSON.parse(text) as PipelineDocument;
            this.sendToWebview('document', data);
        } catch (error) {
            console.error('Failed to parse pipeline document:', error);
            console.error(`Document URI: ${document.uri.toString()}`);
            console.error(`Document first 100 chars: "${text.substring(0, 100)}"`);
            // Send a default document on parse error
            const defaultDoc: PipelineDocument = {
                version: '1.0',
                name: 'New Pipeline',
                nodes: [],
                edges: []
            };
            this.sendToWebview('document', defaultDoc);
        }
    }

    private async sendElementCatalog(): Promise<void> {
        const elements = this.m_catalog.getAllElements();
        const categories = this.m_catalog.getCategories();
        
        this.sendToWebview('catalog', {
            elements,
            categories,
            elementsByCategory: Object.fromEntries(
                categories.map(cat => [cat, this.m_catalog.getElementsByCategory(cat)])
            )
        });
    }

    private async sendElementDetails(elementName: string): Promise<void> {
        const element = await this.m_catalog.getElement(elementName);
        if (element) {
            this.sendToWebview('elementDetails', element);
        }
    }

    private sendToWebview(type: string, payload: unknown): void {
        if (this.m_activeWebview) {
            this.m_activeWebview.webview.postMessage({ type, payload });
        }
    }

    async runPipeline(): Promise<void> {
        const gstLaunchString = await this.exportToGstLaunch();
        if (gstLaunchString) {
            try {
                await this.m_service.runPipeline(gstLaunchString);
                this.sendToWebview('stateChange', { state: 'PLAYING', pending: 'VOID_PENDING' });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                // Send error to webview debug panel
                this.sendToWebview('error', {
                    message: `Failed to run pipeline: ${message}`,
                    element: 'pipeline'
                });
                vscode.window.showErrorMessage(`Failed to run pipeline: ${message}`);
            }
        }
    }

    async stopPipeline(): Promise<void> {
        try {
            await this.m_service.stopPipeline();
            this.sendToWebview('stateChange', { state: 'NULL', pending: 'VOID_PENDING' });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.sendToWebview('error', {
                message: `Failed to stop pipeline: ${message}`,
                element: 'pipeline'
            });
            vscode.window.showErrorMessage(`Failed to stop pipeline: ${message}`);
        }
    }

    async pausePipeline(): Promise<void> {
        try {
            await this.m_service.pausePipeline();
            this.sendToWebview('stateChange', { state: 'PAUSED', pending: 'VOID_PENDING' });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.sendToWebview('error', {
                message: `Failed to pause pipeline: ${message}`,
                element: 'pipeline'
            });
            vscode.window.showErrorMessage(`Failed to pause pipeline: ${message}`);
        }
    }

    async resumePipeline(): Promise<void> {
        try {
            await this.m_service.resumePipeline();
            this.sendToWebview('stateChange', { state: 'PLAYING', pending: 'VOID_PENDING' });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.sendToWebview('error', {
                message: `Failed to resume pipeline: ${message}`,
                element: 'pipeline'
            });
            vscode.window.showErrorMessage(`Failed to resume pipeline: ${message}`);
        }
    }

    async exportPipeline(format: string): Promise<void> {
        if (!this.m_currentDocument) {
            return;
        }

        try {
            const data = JSON.parse(this.m_currentDocument.getText()) as PipelineDocument;
            let content: string;
            let language: string;
            let filename: string;

            switch (format) {
                case 'c':
                    content = this.pipelineToCCode(data);
                    language = 'c';
                    filename = 'pipeline.c';
                    break;
                case 'python':
                    content = this.pipelineToPythonCode(data);
                    language = 'python';
                    filename = 'pipeline.py';
                    break;
                case 'gst-launch':
                default:
                    content = `gst-launch-1.0 ${this.pipelineToGstLaunch(data)}`;
                    language = 'shellscript';
                    filename = 'pipeline.sh';
                    break;
            }

            const doc = await vscode.workspace.openTextDocument({
                content,
                language
            });
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to export pipeline: ${message}`);
        }
    }

    async validatePipeline(): Promise<void> {
        if (!this.m_currentDocument) {
            return;
        }

        try {
            const data = JSON.parse(this.m_currentDocument.getText()) as PipelineDocument;
            const gstLaunchString = this.pipelineToGstLaunch(data);
            const result = await this.m_service.validatePipeline(gstLaunchString);
            
            this.m_diagnostics.updateDiagnostics(this.m_currentDocument, result);
            this.sendToWebview('validationResult', result);

            if (result.valid) {
                vscode.window.showInformationMessage('Pipeline is valid');
            } else {
                vscode.window.showWarningMessage(`Pipeline has ${result.errors.length} error(s)`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Validation failed: ${message}`);
        }
    }

    async exportToGstLaunch(): Promise<string | undefined> {
        if (!this.m_currentDocument) {
            return undefined;
        }

        try {
            const data = JSON.parse(this.m_currentDocument.getText()) as PipelineDocument;
            return this.pipelineToGstLaunch(data);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to export pipeline: ${message}`);
            return undefined;
        }
    }

    private pipelineToGstLaunch(pipeline: PipelineDocument): string {
        const elements = new Map<string, { type: string; properties: Record<string, unknown>; name: string }>();
        
        for (const node of pipeline.nodes) {
            elements.set(node.id, {
                type: node.type,
                properties: node.properties,
                name: `element_${node.id.replace(/-/g, '_')}`
            });
        }

        const connections = new Map<string, string[]>();
        for (const edge of pipeline.edges) {
            if (!connections.has(edge.source)) {
                connections.set(edge.source, []);
            }
            connections.get(edge.source)!.push(edge.target);
        }

        const parts: string[] = [];
        const visited = new Set<string>();

        const processElement = (nodeId: string): void => {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);

            const element = elements.get(nodeId);
            if (!element) return;

            let elementStr = element.type;
            
            const props = Object.entries(element.properties)
                .filter(([_, value]) => value !== undefined && value !== null && value !== '')
                .map(([key, value]) => `${key}=${this.formatPropertyValue(value)}`)
                .join(' ');
            
            if (props) {
                elementStr += ` ${props}`;
            }

            elementStr += ` name=${element.name}`;
            parts.push(elementStr);

            const targets = connections.get(nodeId) || [];
            for (const targetId of targets) {
                parts.push('!');
                processElement(targetId);
            }
        };

        const sources = new Set(pipeline.nodes.map(n => n.id));
        for (const edge of pipeline.edges) {
            sources.delete(edge.target);
        }

        for (const sourceId of sources) {
            processElement(sourceId);
        }

        return parts.join(' ');
    }

    private formatPropertyValue(value: unknown): string {
        if (typeof value === 'string') {
            if (value.includes(' ') || value.includes('!')) {
                return `"${value}"`;
            }
            return value;
        }
        return String(value);
    }

    private pipelineToCCode(pipeline: PipelineDocument): string {
        if (pipeline.nodes.length === 0) {
            return '/* Empty pipeline */';
        }

        const lines: string[] = [
            '/* GStreamer Pipeline - Generated by GStreamer Pipeline Studio */',
            '#include <gst/gst.h>',
            '#include <stdio.h>',
            '',
            'int main(int argc, char *argv[]) {',
            '    GstElement *pipeline;',
        ];

        for (const node of pipeline.nodes) {
            const varName = this.sanitizeVarName(node.id);
            lines.push(`    GstElement *${varName};`);
        }
        lines.push('    GstBus *bus;');
        lines.push('    GstMessage *msg;');
        lines.push('');
        lines.push('    /* Initialize GStreamer */');
        lines.push('    gst_init(&argc, &argv);');
        lines.push('');
        lines.push('    /* Create pipeline */');
        lines.push('    pipeline = gst_pipeline_new("pipeline");');
        lines.push('');
        lines.push('    /* Create elements */');

        for (const node of pipeline.nodes) {
            const varName = this.sanitizeVarName(node.id);
            lines.push(`    ${varName} = gst_element_factory_make("${node.type}", "${varName}");`);
            lines.push(`    if (!${varName}) {`);
            lines.push(`        g_printerr("Failed to create ${node.type} element\\n");`);
            lines.push('        return -1;');
            lines.push('    }');
        }

        lines.push('');
        lines.push('    /* Set element properties */');
        
        for (const node of pipeline.nodes) {
            const varName = this.sanitizeVarName(node.id);
            for (const [key, value] of Object.entries(node.properties)) {
                if (value !== undefined && value !== null && value !== '') {
                    const propValue = this.formatCPropertyValue(value);
                    lines.push(`    g_object_set(G_OBJECT(${varName}), "${key}", ${propValue}, NULL);`);
                }
            }
        }

        lines.push('');
        lines.push('    /* Add elements to pipeline */');
        lines.push(`    gst_bin_add_many(GST_BIN(pipeline),`);
        const elementVars = pipeline.nodes.map(n => `        ${this.sanitizeVarName(n.id)}`);
        lines.push(elementVars.join(',\n') + ',');
        lines.push('        NULL);');

        lines.push('');
        lines.push('    /* Link elements */');
        
        for (const edge of pipeline.edges) {
            const srcVar = this.sanitizeVarName(edge.source);
            const tgtVar = this.sanitizeVarName(edge.target);
            lines.push(`    if (!gst_element_link(${srcVar}, ${tgtVar})) {`);
            lines.push(`        g_printerr("Failed to link ${srcVar} to ${tgtVar}\\n");`);
            lines.push('        gst_object_unref(pipeline);');
            lines.push('        return -1;');
            lines.push('    }');
        }

        lines.push('');
        lines.push('    /* Start playing */');
        lines.push('    gst_element_set_state(pipeline, GST_STATE_PLAYING);');
        lines.push('');
        lines.push('    /* Wait until error or EOS */');
        lines.push('    bus = gst_element_get_bus(pipeline);');
        lines.push('    msg = gst_bus_timed_pop_filtered(bus, GST_CLOCK_TIME_NONE,');
        lines.push('        GST_MESSAGE_ERROR | GST_MESSAGE_EOS);');
        lines.push('');
        lines.push('    /* Parse message */');
        lines.push('    if (msg != NULL) {');
        lines.push('        GError *err;');
        lines.push('        gchar *debug_info;');
        lines.push('        switch (GST_MESSAGE_TYPE(msg)) {');
        lines.push('            case GST_MESSAGE_ERROR:');
        lines.push('                gst_message_parse_error(msg, &err, &debug_info);');
        lines.push('                g_printerr("Error: %s\\n", err->message);');
        lines.push('                g_error_free(err);');
        lines.push('                g_free(debug_info);');
        lines.push('                break;');
        lines.push('            case GST_MESSAGE_EOS:');
        lines.push('                g_print("End-Of-Stream reached.\\n");');
        lines.push('                break;');
        lines.push('            default:');
        lines.push('                break;');
        lines.push('        }');
        lines.push('        gst_message_unref(msg);');
        lines.push('    }');
        lines.push('');
        lines.push('    /* Cleanup */');
        lines.push('    gst_object_unref(bus);');
        lines.push('    gst_element_set_state(pipeline, GST_STATE_NULL);');
        lines.push('    gst_object_unref(pipeline);');
        lines.push('');
        lines.push('    return 0;');
        lines.push('}');

        return lines.join('\n');
    }

    private pipelineToPythonCode(pipeline: PipelineDocument): string {
        if (pipeline.nodes.length === 0) {
            return '# Empty pipeline';
        }

        const lines: string[] = [
            '#!/usr/bin/env python3',
            '"""GStreamer Pipeline - Generated by GStreamer Pipeline Studio"""',
            '',
            'import gi',
            'gi.require_version("Gst", "1.0")',
            'from gi.repository import Gst, GLib',
            '',
            '',
            'def main():',
            '    # Initialize GStreamer',
            '    Gst.init(None)',
            '',
            '    # Create pipeline',
            '    pipeline = Gst.Pipeline.new("pipeline")',
            '',
            '    # Create elements',
        ];

        for (const node of pipeline.nodes) {
            const varName = this.sanitizeVarName(node.id);
            lines.push(`    ${varName} = Gst.ElementFactory.make("${node.type}", "${varName}")`);
            lines.push(`    if not ${varName}:`);
            lines.push(`        print(f"Failed to create ${node.type} element")`);
            lines.push('        return -1');
        }

        lines.push('');
        lines.push('    # Set element properties');
        
        for (const node of pipeline.nodes) {
            const varName = this.sanitizeVarName(node.id);
            for (const [key, value] of Object.entries(node.properties)) {
                if (value !== undefined && value !== null && value !== '') {
                    const propValue = this.formatPythonPropertyValue(value);
                    lines.push(`    ${varName}.set_property("${key}", ${propValue})`);
                }
            }
        }

        lines.push('');
        lines.push('    # Add elements to pipeline');
        for (const node of pipeline.nodes) {
            const varName = this.sanitizeVarName(node.id);
            lines.push(`    pipeline.add(${varName})`);
        }

        lines.push('');
        lines.push('    # Link elements');
        
        for (const edge of pipeline.edges) {
            const srcVar = this.sanitizeVarName(edge.source);
            const tgtVar = this.sanitizeVarName(edge.target);
            lines.push(`    if not ${srcVar}.link(${tgtVar}):`);
            lines.push(`        print(f"Failed to link ${srcVar} to ${tgtVar}")`);
            lines.push('        return -1');
        }

        lines.push('');
        lines.push('    # Start playing');
        lines.push('    ret = pipeline.set_state(Gst.State.PLAYING)');
        lines.push('    if ret == Gst.StateChangeReturn.FAILURE:');
        lines.push('        print("Failed to set pipeline to PLAYING")');
        lines.push('        return -1');
        lines.push('');
        lines.push('    # Wait for EOS or error');
        lines.push('    bus = pipeline.get_bus()');
        lines.push('    msg = bus.timed_pop_filtered(');
        lines.push('        Gst.CLOCK_TIME_NONE,');
        lines.push('        Gst.MessageType.ERROR | Gst.MessageType.EOS');
        lines.push('    )');
        lines.push('');
        lines.push('    # Parse message');
        lines.push('    if msg:');
        lines.push('        if msg.type == Gst.MessageType.ERROR:');
        lines.push('            err, debug = msg.parse_error()');
        lines.push('            print(f"Error: {err.message}")');
        lines.push('            if debug:');
        lines.push('                print(f"Debug: {debug}")');
        lines.push('        elif msg.type == Gst.MessageType.EOS:');
        lines.push('            print("End-Of-Stream reached")');
        lines.push('');
        lines.push('    # Cleanup');
        lines.push('    pipeline.set_state(Gst.State.NULL)');
        lines.push('');
        lines.push('    return 0');
        lines.push('');
        lines.push('');
        lines.push('if __name__ == "__main__":');
        lines.push('    exit(main())');

        return lines.join('\n');
    }

    private sanitizeVarName(id: string): string {
        return id.replace(/-/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    }

    private formatCPropertyValue(value: unknown): string {
        if (typeof value === 'string') {
            return `"${(value as string).replace(/"/g, '\\"')}"`;
        }
        if (typeof value === 'boolean') {
            return value ? 'TRUE' : 'FALSE';
        }
        if (typeof value === 'number') {
            return String(value);
        }
        return `"${String(value)}"`;
    }

    private formatPythonPropertyValue(value: unknown): string {
        if (typeof value === 'string') {
            return `"${(value as string).replace(/"/g, '\\"')}"`;
        }
        if (typeof value === 'boolean') {
            return value ? 'True' : 'False';
        }
        if (typeof value === 'number') {
            return String(value);
        }
        return `"${String(value)}"`;
    }

    private handleDebugMessage(message: DebugMessage): void {
        const levelNames = ['ERROR', 'WARN', 'FIXME', 'INFO', 'DEBUG', 'LOG', 'TRACE'];
        const levelName = levelNames[message.level] || 'UNKNOWN';
        
        this.m_debugOutputChannel.appendLine(
            `[${levelName}] ${message.category} ${message.element}: ${message.message}`
        );
        
        this.sendToWebview('debug', message);
    }

    showDebugLog(): void {
        this.m_debugOutputChannel.show();
    }
}

