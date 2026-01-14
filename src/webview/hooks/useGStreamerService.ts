import { useMemo } from 'react';
import { VSCodeApi, ExportFormat } from '../types/gstreamer';

declare function acquireVsCodeApi(): VSCodeApi;

let vscodeApi: VSCodeApi | null = null;

export function useVSCodeApi(): VSCodeApi {
    return useMemo(() => {
        if (!vscodeApi) {
            vscodeApi = acquireVsCodeApi();
        }
        return vscodeApi;
    }, []);
}

export function getVSCodeApi(): VSCodeApi {
    if (!vscodeApi) {
        vscodeApi = acquireVsCodeApi();
    }
    return vscodeApi;
}

export function postMessage(type: string, payload?: unknown): void {
    getVSCodeApi().postMessage({ type, payload });
}

export function runPipeline(): void {
    postMessage('run');
}

export function stopPipeline(): void {
    postMessage('stop');
}

export function pausePipeline(): void {
    postMessage('pause');
}

export function resumePipeline(): void {
    postMessage('resume');
}

export function validatePipeline(): void {
    postMessage('validate');
}

export function updateDocument(document: unknown): void {
    postMessage('update', document);
}

export function getElementDetails(elementName: string): void {
    postMessage('getElementDetails', elementName);
}

export function exportGstLaunch(): void {
    postMessage('export', { format: 'gst-launch' });
}

export function exportCode(format: ExportFormat): void {
    postMessage('export', { format });
}


