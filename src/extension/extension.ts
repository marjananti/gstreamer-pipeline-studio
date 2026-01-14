import * as vscode from 'vscode';
import { GStreamerService } from './gstreamer-service';
import { ElementCatalog } from './element-catalog';
import { PipelineEditorProvider } from './pipeline-document';
import { PipelineDiagnostics } from './diagnostics';

let gstreamerService: GStreamerService;
let elementCatalog: ElementCatalog;
let diagnostics: PipelineDiagnostics;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('GStreamer Pipeline Studio is activating...');

    gstreamerService = new GStreamerService(context);
    elementCatalog = new ElementCatalog(context, gstreamerService);
    diagnostics = new PipelineDiagnostics();

    try {
        await gstreamerService.start();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Failed to start GStreamer backend:', message);
        vscode.window.showWarningMessage(
            `GStreamer backend failed to start: ${message}. ` +
            'Pipeline execution will be unavailable. ' +
            'Ensure Python 3 with GStreamer bindings is installed.'
        );
    }

    try {
        await elementCatalog.initialize();
    } catch (error) {
        console.error('Failed to initialize element catalog:', error);
    }

    const editorProvider = new PipelineEditorProvider(
        context,
        gstreamerService,
        elementCatalog,
        diagnostics
    );

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            'gstreamer.pipelineEditor',
            editorProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                },
                supportsMultipleEditorsPerDocument: false
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gstreamer.openPipelineEditor', async () => {
            const doc = await vscode.workspace.openTextDocument({
                language: 'gstpipe',
                content: JSON.stringify({
                    version: '1.0',
                    name: 'New Pipeline',
                    nodes: [],
                    edges: []
                }, null, 2)
            });
            await vscode.commands.executeCommand('vscode.openWith', doc.uri, 'gstreamer.pipelineEditor');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gstreamer.runPipeline', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await editorProvider.runPipeline();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gstreamer.stopPipeline', async () => {
            await editorProvider.stopPipeline();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gstreamer.validatePipeline', async () => {
            await editorProvider.validatePipeline();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gstreamer.exportToGstLaunch', async () => {
            const gstLaunchString = await editorProvider.exportToGstLaunch();
            if (gstLaunchString) {
                const doc = await vscode.workspace.openTextDocument({
                    content: `gst-launch-1.0 ${gstLaunchString}`,
                    language: 'shellscript'
                });
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gstreamer.showDebugLog', () => {
            editorProvider.showDebugLog();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gstreamer.refreshElementCatalog', async () => {
            await elementCatalog.refresh();
            vscode.window.showInformationMessage('GStreamer element catalog refreshed');
        })
    );

    context.subscriptions.push(diagnostics);

    console.log('GStreamer Pipeline Studio activated successfully');
}

export function deactivate(): void {
    if (gstreamerService) {
        gstreamerService.stop();
    }
    console.log('GStreamer Pipeline Studio deactivated');
}

