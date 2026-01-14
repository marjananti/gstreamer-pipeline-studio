import React, { useEffect, useCallback } from 'react';
import { ReactFlowProvider } from 'reactflow';
import { usePipelineStore } from './hooks/usePipelineState';
import { useVSCodeApi, runPipeline, stopPipeline, validatePipeline } from './hooks/useGStreamerService';
import { ElementPalette } from './components/ElementPalette';
import { PipelineCanvas } from './components/PipelineCanvas';
import { PropertyPanel } from './components/PropertyPanel';
import { Toolbar } from './components/Toolbar';
import { BottomPanel } from './components/BottomPanel';
import 'reactflow/dist/style.css';

const App: React.FC = () => {
    const vscode = useVSCodeApi();
    const { 
        setDocument, 
        setCatalog, 
        setPipelineState,
        addDebugMessage,
        addPipelineError,
        setValidationResult,
        selectedNodeId,
        clearPipelineErrors,
        clearBufferStats,
        updateBufferStats,
        undo,
        redo
    } = usePipelineStore();

    const handleMessage = useCallback((event: MessageEvent) => {
        const message = event.data;
        switch (message.type) {
            case 'document':
                setDocument(message.payload);
                break;
            case 'catalog':
                setCatalog(message.payload);
                break;
            case 'stateChange':
                setPipelineState(message.payload);
                // Clear errors and buffer stats when pipeline stops
                if (message.payload.state === 'NULL') {
                    clearBufferStats();
                }
                break;
            case 'debug':
                addDebugMessage(message.payload);
                break;
            case 'error':
                addPipelineError({
                    timestamp: Date.now(),
                    message: message.payload.message,
                    element: message.payload.element,
                    debug: message.payload.debug
                });
                break;
            case 'validationResult':
                setValidationResult(message.payload);
                break;
            case 'frame':
                usePipelineStore.getState().setCurrentFrame(message.payload);
                break;
            case 'elementDetails':
                usePipelineStore.getState().setElementDetails(message.payload);
                break;
            case 'bufferStats':
                if (message.payload?.edgeId && message.payload?.count !== undefined) {
                    updateBufferStats(message.payload.edgeId, message.payload.count);
                }
                break;
            case 'metrics':
                // Metrics are handled in MetricsPanel
                break;
        }
    }, [setDocument, setCatalog, setPipelineState, addDebugMessage, addPipelineError, setValidationResult, clearBufferStats, updateBufferStats]);

    // Handle keyboard shortcuts
    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

        // Undo: Ctrl+Z
        if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
            event.preventDefault();
            undo();
            return;
        }

        // Redo: Ctrl+Y or Ctrl+Shift+Z
        if ((event.ctrlKey && event.key === 'y') || (event.ctrlKey && event.shiftKey && event.key === 'z')) {
            event.preventDefault();
            redo();
            return;
        }

        // Skip other shortcuts if focused on input
        if (isInputFocused) return;

        // Run: Ctrl+Enter
        if (event.ctrlKey && event.key === 'Enter') {
            event.preventDefault();
            const state = usePipelineStore.getState();
            if (state.pipelineState.state === 'NULL' || state.pipelineState.state === 'READY') {
                runPipeline();
            }
            return;
        }

        // Stop: Ctrl+.
        if (event.ctrlKey && event.key === '.') {
            event.preventDefault();
            stopPipeline();
            return;
        }

        // Validate: Ctrl+Shift+V
        if (event.ctrlKey && event.shiftKey && event.key === 'V') {
            event.preventDefault();
            validatePipeline();
            return;
        }
    }, [undo, redo]);

    useEffect(() => {
        window.addEventListener('message', handleMessage);
        window.addEventListener('keydown', handleKeyDown);
        vscode.postMessage({ type: 'ready' });
        
        return () => {
            window.removeEventListener('message', handleMessage);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [handleMessage, handleKeyDown, vscode]);

    return (
        <ReactFlowProvider>
            <div className="pipeline-editor">
                <ElementPalette />
                <div className="canvas-container">
                    <Toolbar />
                    <PipelineCanvas />
                    <BottomPanel />
                </div>
                {selectedNodeId && <PropertyPanel />}
            </div>
        </ReactFlowProvider>
    );
};

export default App;


