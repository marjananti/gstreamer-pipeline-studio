import React from 'react';
import { EdgeProps, getBezierPath, EdgeLabelRenderer } from 'reactflow';
import { usePipelineStore } from '../hooks/usePipelineState';

interface PadEdgeData {
    caps?: string;
    bufferCount?: number;
    animated?: boolean;
}

const PadEdge: React.FC<EdgeProps<PadEdgeData>> = ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
    data
}) => {
    const pipelineState = usePipelineStore((state) => state.pipelineState);
    const bufferStats = usePipelineStore((state) => state.bufferStats);

    const isPlaying = pipelineState.state === 'PLAYING';
    const bufferCount = bufferStats.get(id) ?? data?.bufferCount;

    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition
    });

    // Animated style when playing
    const edgeStyle = {
        ...style,
        stroke: isPlaying ? 'var(--gst-pad-src)' : style.stroke,
        strokeWidth: isPlaying ? 2 : (style.strokeWidth ?? 1),
    };

    return (
        <>
            <path
                id={id}
                style={edgeStyle}
                className={`react-flow__edge-path ${isPlaying ? 'animated' : ''}`}
                d={edgePath}
                markerEnd={markerEnd}
            />
            {/* Show caps on hover */}
            {data?.caps && (
                <path
                    d={edgePath}
                    fill="none"
                    strokeWidth={20}
                    stroke="transparent"
                    className="react-flow__edge-interaction"
                >
                    <title>{data.caps}</title>
                </path>
            )}
            {/* Buffer count badge */}
            {bufferCount !== undefined && bufferCount > 0 && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: 'absolute',
                            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                            fontSize: 10,
                            pointerEvents: 'all',
                            background: isPlaying ? 'var(--gst-state-playing)' : 'var(--vscode-badge-background)',
                            color: isPlaying ? 'white' : 'var(--vscode-badge-foreground)',
                            padding: '2px 6px',
                            borderRadius: 10,
                            fontWeight: 500,
                            boxShadow: isPlaying ? '0 0 4px var(--gst-state-playing)' : 'none'
                        }}
                        className="nodrag nopan edge-buffer-badge"
                    >
                        {bufferCount > 1000 ? `${(bufferCount / 1000).toFixed(1)}k` : bufferCount}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
};

export default PadEdge;


