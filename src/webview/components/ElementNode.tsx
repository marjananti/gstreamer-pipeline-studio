import React, { memo, useMemo, useEffect } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { usePipelineStore } from '../hooks/usePipelineState';
import { GstPadTemplate } from '../types/gstreamer';
import { getElementDetails } from '../hooks/useGStreamerService';

interface ElementNodeData {
    type: string;
    properties: Record<string, unknown>;
    category?: string;
    padTemplates?: GstPadTemplate[];
    hasError?: boolean;
}

// Default pad templates for elements without detailed info
const getDefaultPads = (elementType: string): { sinks: GstPadTemplate[], srcs: GstPadTemplate[] } => {
    // Elements that typically have no sink pad (sources)
    const sourceElements = ['videotestsrc', 'audiotestsrc', 'filesrc', 'v4l2src', 'pulsesrc', 
                           'alsasrc', 'appsrc', 'uridecodebin', 'uridecodebin3'];
    // Elements that typically have no src pad (sinks)
    const sinkElements = ['autovideosink', 'autoaudiosink', 'filesink', 'fakesink', 
                         'xvimagesink', 'ximagesink', 'glimagesink', 'waylandsink',
                         'pulsesink', 'alsasink', 'appsink'];

    const isSrcOnly = sourceElements.includes(elementType);
    const isSinkOnly = sinkElements.includes(elementType);

    return {
        sinks: isSrcOnly ? [] : [{ name: 'sink', direction: 'sink' as const, presence: 'always' as const, caps: 'ANY' }],
        srcs: isSinkOnly ? [] : [{ name: 'src', direction: 'src' as const, presence: 'always' as const, caps: 'ANY' }]
    };
};

const ElementNode: React.FC<NodeProps<ElementNodeData>> = ({ id, data, selected }) => {
    const pipelineState = usePipelineStore((state) => state.pipelineState);
    const validationResult = usePipelineStore((state) => state.validationResult);
    const selectedElementDetails = usePipelineStore((state) => state.selectedElementDetails);

    // Fetch element details when selected to get pad templates
    useEffect(() => {
        if (selected && data.type) {
            getElementDetails(data.type);
        }
    }, [selected, data.type]);

    const hasError = useMemo(() => {
        if (!validationResult) return false;
        return validationResult.errors.some((e) => e.elementId === id);
    }, [validationResult, id]);

    // Use pad templates from selectedElementDetails if this node is selected and we have them
    const padTemplates = useMemo(() => {
        if (data.padTemplates && data.padTemplates.length > 0) {
            return data.padTemplates;
        }
        if (selected && selectedElementDetails?.name === data.type && selectedElementDetails.padTemplates) {
            return selectedElementDetails.padTemplates;
        }
        return null;
    }, [data.padTemplates, selected, selectedElementDetails, data.type]);

    const { sinkPads, srcPads } = useMemo(() => {
        if (padTemplates && padTemplates.length > 0) {
            return {
                sinkPads: padTemplates.filter((p) => p.direction === 'sink'),
                srcPads: padTemplates.filter((p) => p.direction === 'src')
            };
        }
        const defaults = getDefaultPads(data.type);
        return {
            sinkPads: defaults.sinks,
            srcPads: defaults.srcs
        };
    }, [padTemplates, data.type]);

    const stateClass = pipelineState.state.toLowerCase();

    return (
        <div className={`react-flow__node-gstElement ${selected ? 'selected' : ''}`}>
            {hasError && <div className="error-badge">!</div>}
            
            <div className="element-node-header">
                <span className="element-node-title">{data.type}</span>
                <div className={`element-node-state state-indicator ${stateClass}`} />
            </div>
            
            <div className="element-node-content">
                {data.category && (
                    <div className="element-node-category">{data.category}</div>
                )}
                
                <div className="element-node-pads">
                    {sinkPads.map((pad, index) => (
                        <div key={`sink-${pad.name}`} className="pad-row">
                            <Handle
                                type="target"
                                position={Position.Left}
                                id={pad.name}
                                style={{ top: `${30 + index * 20}%` }}
                                title={pad.caps !== 'ANY' ? `${pad.name}: ${pad.caps.substring(0, 50)}...` : pad.name}
                            />
                            <span className="pad-label sink-pad">{pad.name}</span>
                            {pad.presence === 'request' && <span className="pad-presence">?</span>}
                        </div>
                    ))}
                    
                    {srcPads.map((pad, index) => (
                        <div key={`src-${pad.name}`} className="pad-row" style={{ justifyContent: 'flex-end' }}>
                            {pad.presence === 'request' && <span className="pad-presence">?</span>}
                            <span className="pad-label src-pad">{pad.name}</span>
                            <Handle
                                type="source"
                                position={Position.Right}
                                id={pad.name}
                                style={{ top: `${30 + index * 20}%` }}
                                title={pad.caps !== 'ANY' ? `${pad.name}: ${pad.caps.substring(0, 50)}...` : pad.name}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default memo(ElementNode);


