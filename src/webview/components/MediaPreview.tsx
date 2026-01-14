import React, { useRef, useState, useEffect } from 'react';
import { useMediaStream } from '../hooks/useMediaStream';
import { usePipelineStore } from '../hooks/usePipelineState';

export const MediaPreview: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { hasFrame } = useMediaStream(canvasRef);
    const pipelineState = usePipelineStore((state) => state.pipelineState);
    const [waitingTime, setWaitingTime] = useState(0);

    const isRunning = pipelineState.state === 'PLAYING' || pipelineState.state === 'PAUSED';

    // Track how long we've been waiting for frames
    useEffect(() => {
        if (isRunning && !hasFrame) {
            const interval = setInterval(() => {
                setWaitingTime((t) => t + 1);
            }, 1000);
            return () => clearInterval(interval);
        } else {
            setWaitingTime(0);
        }
    }, [isRunning, hasFrame]);

    const getMessage = () => {
        if (!isRunning) {
            return 'Run a pipeline with video output to see preview here.';
        }
        if (waitingTime < 3) {
            return 'Starting video capture...';
        }
        if (waitingTime < 10) {
            return 'Waiting for video frames... (video also displays in external window)';
        }
        return 'Preview may not be available for this pipeline. Check external window.';
    };

    return (
        <div className="media-preview">
            {/* Always render canvas so the ref is available when frames arrive */}
            <canvas 
                ref={canvasRef} 
                style={{ display: hasFrame ? 'block' : 'none' }}
            />
            {!hasFrame && (
                <div className="media-preview-placeholder">
                    {getMessage()}
                    {isRunning && waitingTime >= 1 && waitingTime < 10 && (
                        <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
                            ⏳ {waitingTime}s
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

