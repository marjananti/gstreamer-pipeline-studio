import React, { useEffect, useState, useRef } from 'react';
import { usePipelineStore } from '../hooks/usePipelineState';
import { PipelineMetrics } from '../types/gstreamer';
import { postMessage } from '../hooks/useGStreamerService';

export const MetricsPanel: React.FC = () => {
    const pipelineState = usePipelineStore((state) => state.pipelineState);
    const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
    const hasEverRun = useRef(false);

    useEffect(() => {
        if (pipelineState.state === 'PLAYING') {
            hasEverRun.current = true;
            
            // Fetch immediately when starting
            postMessage('getMetrics');
            
            const interval = setInterval(() => {
                postMessage('getMetrics');
            }, 1000);

            return () => clearInterval(interval);
        }
    }, [pipelineState.state]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data.type === 'metrics') {
                setMetrics(event.data.payload);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Show placeholder only if we've never run a pipeline
    if (!metrics && !hasEverRun.current) {
        return (
            <div className="metrics-panel">
                <div className="no-selection">
                    Run a pipeline to see performance metrics
                </div>
            </div>
        );
    }

    const isRunning = pipelineState.state === 'PLAYING';

    return (
        <div className="metrics-panel">
            {!isRunning && metrics && (
                <div className="metrics-status">
                    Pipeline stopped — showing last metrics
                </div>
            )}
            
            <div className="metrics-grid">
                <div className="metric-card">
                    <div className="metric-label">Frame Rate</div>
                    <div className="metric-value">
                        {metrics?.fps.toFixed(1) || '—'}
                        <span className="metric-unit">fps</span>
                    </div>
                </div>

                <div className="metric-card">
                    <div className="metric-label">Latency</div>
                    <div className="metric-value">
                        {metrics?.latency.toFixed(1) || '—'}
                        <span className="metric-unit">ms</span>
                    </div>
                </div>

                <div className="metric-card">
                    <div className="metric-label">Buffers Processed</div>
                    <div className="metric-value">
                        {metrics?.bufferCount || '—'}
                    </div>
                </div>

                <div className="metric-card">
                    <div className="metric-label">Dropped Buffers</div>
                    <div className="metric-value">
                        {metrics?.droppedBuffers || '0'}
                    </div>
                </div>

                <div className="metric-card">
                    <div className="metric-label">Memory Usage</div>
                    <div className="metric-value">
                        {metrics ? (metrics.memoryUsage / 1024 / 1024).toFixed(1) : '—'}
                        <span className="metric-unit">MB</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

