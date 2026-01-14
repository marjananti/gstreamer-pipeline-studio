import React, { useState, useRef, useEffect } from 'react';
import { usePipelineStore } from '../hooks/usePipelineState';
import { 
    runPipeline, 
    stopPipeline, 
    pausePipeline, 
    resumePipeline,
    validatePipeline, 
    exportCode 
} from '../hooks/useGStreamerService';
import { ExportFormat } from '../types/gstreamer';

export const Toolbar: React.FC = () => {
    const pipelineState = usePipelineStore((state) => state.pipelineState);
    const document = usePipelineStore((state) => state.document);
    const selectedNodeId = usePipelineStore((state) => state.selectedNodeId);
    const removeNode = usePipelineStore((state) => state.removeNode);
    const undo = usePipelineStore((state) => state.undo);
    const redo = usePipelineStore((state) => state.redo);
    const canUndo = usePipelineStore((state) => state.canUndo);
    const canRedo = usePipelineStore((state) => state.canRedo);

    const [showExportMenu, setShowExportMenu] = useState(false);
    const exportMenuRef = useRef<HTMLDivElement>(null);

    const isPlaying = pipelineState.state === 'PLAYING';
    const isPaused = pipelineState.state === 'PAUSED';
    const isRunning = isPlaying || isPaused;
    const hasNodes = document && document.nodes.length > 0;
    const hasSelection = selectedNodeId !== null;

    // Close export menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
                setShowExportMenu(false);
            }
        };
        window.addEventListener('mousedown', handleClickOutside);
        return () => window.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleRun = () => {
        runPipeline();
    };

    const handleStop = () => {
        stopPipeline();
    };

    const handlePause = () => {
        pausePipeline();
    };

    const handleResume = () => {
        resumePipeline();
    };

    const handleValidate = () => {
        validatePipeline();
    };

    const handleExport = (format: ExportFormat) => {
        exportCode(format);
        setShowExportMenu(false);
    };

    const handleDelete = () => {
        if (selectedNodeId) {
            removeNode(selectedNodeId);
        }
    };

    const getStateLabel = () => {
        switch (pipelineState.state) {
            case 'NULL':
                return 'Stopped';
            case 'READY':
                return 'Ready';
            case 'PAUSED':
                return 'Paused';
            case 'PLAYING':
                return 'Playing';
            default:
                return 'Unknown';
        }
    };

    return (
        <div className="toolbar">
            {/* Undo/Redo */}
            <button
                className="toolbar-button"
                onClick={undo}
                disabled={!canUndo()}
                title="Undo (Ctrl+Z)"
            >
                ↶
            </button>
            <button
                className="toolbar-button"
                onClick={redo}
                disabled={!canRedo()}
                title="Redo (Ctrl+Y)"
            >
                ↷
            </button>

            <div className="toolbar-separator" />

            {/* Pipeline Controls */}
            {!isRunning ? (
                <button
                    className="toolbar-button primary"
                    onClick={handleRun}
                    disabled={!hasNodes}
                    title="Run Pipeline (Ctrl+Enter)"
                >
                    ▶ Run
                </button>
            ) : isPlaying ? (
                <button
                    className="toolbar-button"
                    onClick={handlePause}
                    title="Pause Pipeline"
                >
                    ⏸ Pause
                </button>
            ) : (
                <button
                    className="toolbar-button primary"
                    onClick={handleResume}
                    title="Resume Pipeline"
                >
                    ▶ Resume
                </button>
            )}

            <button
                className="toolbar-button danger"
                onClick={handleStop}
                disabled={!isRunning}
                title="Stop Pipeline"
            >
                ■ Stop
            </button>

            <div className="toolbar-separator" />

            <button
                className="toolbar-button"
                onClick={handleValidate}
                disabled={!hasNodes}
                title="Validate Pipeline"
            >
                ✓ Validate
            </button>

            {/* Export Dropdown */}
            <div className="toolbar-dropdown" ref={exportMenuRef}>
                <button
                    className="toolbar-button"
                    onClick={() => setShowExportMenu(!showExportMenu)}
                    disabled={!hasNodes}
                    title="Export Pipeline"
                >
                    ↗ Export ▾
                </button>
                {showExportMenu && (
                    <div className="toolbar-dropdown-menu">
                        <button onClick={() => handleExport('gst-launch')}>
                            gst-launch command
                        </button>
                        <button onClick={() => handleExport('python')}>
                            Python code
                        </button>
                        <button onClick={() => handleExport('c')}>
                            C code
                        </button>
                    </div>
                )}
            </div>

            <div className="toolbar-separator" />

            <button
                className="toolbar-button danger"
                onClick={handleDelete}
                disabled={!hasSelection}
                title="Delete selected element (Del)"
            >
                🗑 Delete
            </button>

            <div className="pipeline-state">
                <div className={`state-indicator ${pipelineState.state.toLowerCase()}`} />
                <span>{getStateLabel()}</span>
            </div>
        </div>
    );
};

