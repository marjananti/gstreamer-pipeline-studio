import React, { useRef, useEffect, useState } from 'react';
import { usePipelineStore } from '../hooks/usePipelineState';
import { PipelineError, DebugMessage } from '../types/gstreamer';

const levelNames: Record<number, string> = {
    0: 'ERROR',
    1: 'WARN',
    2: 'FIXME',
    3: 'INFO',
    4: 'DEBUG',
    5: 'LOG',
    6: 'TRACE'
};

const levelClasses: Record<number, string> = {
    0: 'error',
    1: 'warn',
    2: 'warn',
    3: 'info',
    4: 'debug',
    5: 'debug',
    6: 'debug'
};

type LogEntry = 
    | { type: 'debug'; data: DebugMessage; timestamp: number }
    | { type: 'error'; data: PipelineError; timestamp: number };

export const DebugPanel: React.FC = () => {
    const debugMessages = usePipelineStore((state) => state.debugMessages);
    const pipelineErrors = usePipelineStore((state) => state.pipelineErrors);
    const clearDebugMessages = usePipelineStore((state) => state.clearDebugMessages);
    const clearPipelineErrors = usePipelineStore((state) => state.clearPipelineErrors);
    const logEndRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [filter, setFilter] = useState('');
    const [levelFilter, setLevelFilter] = useState<number | null>(null);
    const [showErrors, setShowErrors] = useState(true);

    // Combine and sort debug messages and errors by timestamp
    const allEntries: LogEntry[] = [
        ...debugMessages.map((msg): LogEntry => ({ 
            type: 'debug', 
            data: msg, 
            timestamp: msg.timestamp 
        })),
        ...pipelineErrors.map((err): LogEntry => ({ 
            type: 'error', 
            data: err, 
            timestamp: err.timestamp 
        }))
    ].sort((a, b) => a.timestamp - b.timestamp);

    useEffect(() => {
        if (autoScroll && logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [debugMessages, pipelineErrors, autoScroll]);

    const filteredEntries = allEntries.filter((entry) => {
        if (entry.type === 'error') {
            if (!showErrors) return false;
            if (filter) {
                const filterLower = filter.toLowerCase();
                const err = entry.data as PipelineError;
                return (
                    err.message.toLowerCase().includes(filterLower) ||
                    (err.element?.toLowerCase().includes(filterLower) ?? false)
                );
            }
            return true;
        }

        const msg = entry.data as DebugMessage;
        if (levelFilter !== null && msg.level > levelFilter) {
            return false;
        }
        if (filter) {
            const filterLower = filter.toLowerCase();
            return (
                msg.category.toLowerCase().includes(filterLower) ||
                msg.element.toLowerCase().includes(filterLower) ||
                msg.message.toLowerCase().includes(filterLower)
            );
        }
        return true;
    });

    const handleClearAll = () => {
        clearDebugMessages();
        clearPipelineErrors();
    };

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
    };

    const renderEntry = (entry: LogEntry, index: number) => {
        if (entry.type === 'error') {
            const err = entry.data as PipelineError;
            return (
                <div key={`error-${index}`} className="debug-entry error-entry">
                    <span className="debug-time">{formatTime(err.timestamp)}</span>
                    <span className="debug-level error">ERROR</span>
                    <span className="debug-element">{err.element || 'pipeline'}</span>
                    <span className="debug-message error-message">{err.message}</span>
                    {err.debug && (
                        <div className="error-debug-info">{err.debug}</div>
                    )}
                </div>
            );
        }

        const msg = entry.data as DebugMessage;
        return (
            <div key={`debug-${index}`} className="debug-entry">
                <span className="debug-time">{formatTime(msg.timestamp)}</span>
                <span className={`debug-level ${levelClasses[msg.level] || 'debug'}`}>
                    {levelNames[msg.level] || 'UNKNOWN'}
                </span>
                <span className="debug-category">{msg.category}</span>
                <span className="debug-element">{msg.element}</span>
                <span className="debug-message">{msg.message}</span>
            </div>
        );
    };

    const errorCount = pipelineErrors.length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                    type="text"
                    className="property-input"
                    placeholder="Filter logs..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    style={{ flex: 1, maxWidth: 200 }}
                />
                <select
                    className="property-select"
                    value={levelFilter ?? ''}
                    onChange={(e) => setLevelFilter(e.target.value ? parseInt(e.target.value) : null)}
                    style={{ width: 100 }}
                >
                    <option value="">All Levels</option>
                    <option value="0">ERROR</option>
                    <option value="1">WARN</option>
                    <option value="3">INFO</option>
                    <option value="4">DEBUG</option>
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <input
                        type="checkbox"
                        checked={showErrors}
                        onChange={(e) => setShowErrors(e.target.checked)}
                    />
                    Show Errors
                    {errorCount > 0 && (
                        <span className="error-badge-inline">{errorCount}</span>
                    )}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <input
                        type="checkbox"
                        checked={autoScroll}
                        onChange={(e) => setAutoScroll(e.target.checked)}
                    />
                    Auto-scroll
                </label>
                <button
                    className="toolbar-button"
                    onClick={handleClearAll}
                    style={{ padding: '4px 8px' }}
                >
                    Clear
                </button>
            </div>
            <div className="debug-log" style={{ flex: 1, overflow: 'auto' }}>
                {filteredEntries.length === 0 ? (
                    <div className="no-selection">
                        {allEntries.length === 0
                            ? 'No messages yet. Run a pipeline to see logs and errors.'
                            : 'No messages match the current filter.'}
                    </div>
                ) : (
                    filteredEntries.map((entry, index) => renderEntry(entry, index))
                )}
                <div ref={logEndRef} />
            </div>
        </div>
    );
};


