import React, { useMemo } from 'react';
import { usePipelineStore } from '../hooks/usePipelineState';
import { GstProperty } from '../types/gstreamer';

export const PropertyPanel: React.FC = () => {
    const selectedNodeId = usePipelineStore((state) => state.selectedNodeId);
    const document = usePipelineStore((state) => state.document);
    const elementDetails = usePipelineStore((state) => state.selectedElementDetails);
    const updateNodeProperty = usePipelineStore((state) => state.updateNodeProperty);

    const selectedNode = useMemo(() => {
        if (!document || !selectedNodeId) return null;
        return document.nodes.find((n) => n.id === selectedNodeId);
    }, [document, selectedNodeId]);

    if (!selectedNode) {
        return (
            <div className="property-panel">
                <div className="property-panel-header">Properties</div>
                <div className="property-panel-content">
                    <div className="no-selection">Select an element to view properties</div>
                </div>
            </div>
        );
    }

    const handlePropertyChange = (name: string, value: string | number | boolean) => {
        if (selectedNodeId) {
            updateNodeProperty(selectedNodeId, name, value);
        }
    };

    const renderPropertyInput = (prop: GstProperty) => {
        const currentValue = selectedNode.properties[prop.name] ?? prop.defaultValue;

        if (prop.enumValues && prop.enumValues.length > 0) {
            return (
                <select
                    className="property-select"
                    value={String(currentValue)}
                    onChange={(e) => handlePropertyChange(prop.name, e.target.value)}
                    disabled={!prop.writable}
                >
                    {prop.enumValues.map((ev) => (
                        <option key={ev.value} value={ev.name}>
                            {ev.name}
                        </option>
                    ))}
                </select>
            );
        }

        switch (prop.type) {
            case 'gboolean':
                return (
                    <select
                        className="property-select"
                        value={String(currentValue)}
                        onChange={(e) => handlePropertyChange(prop.name, e.target.value === 'true')}
                        disabled={!prop.writable}
                    >
                        <option value="true">true</option>
                        <option value="false">false</option>
                    </select>
                );

            case 'gint':
            case 'guint':
            case 'gint64':
            case 'guint64':
            case 'gfloat':
            case 'gdouble':
                return (
                    <input
                        type="number"
                        className="property-input"
                        value={String(currentValue)}
                        min={prop.min}
                        max={prop.max}
                        onChange={(e) => handlePropertyChange(prop.name, parseFloat(e.target.value))}
                        disabled={!prop.writable}
                    />
                );

            default:
                return (
                    <input
                        type="text"
                        className="property-input"
                        value={String(currentValue)}
                        onChange={(e) => handlePropertyChange(prop.name, e.target.value)}
                        disabled={!prop.writable}
                    />
                );
        }
    };

    const commonProperties = elementDetails?.properties.filter((p) => 
        ['name', 'parent'].includes(p.name)
    ) || [];

    const elementProperties = elementDetails?.properties.filter((p) => 
        !['name', 'parent'].includes(p.name) && p.writable
    ) || [];

    return (
        <div className="property-panel">
            <div className="property-panel-header">{selectedNode.type}</div>
            <div className="property-panel-content">
                {elementDetails ? (
                    <>
                        <div className="property-group">
                            <div className="property-group-title">Element Info</div>
                            <div className="property-row">
                                <label className="property-label">Type</label>
                                <input
                                    type="text"
                                    className="property-input"
                                    value={selectedNode.type}
                                    disabled
                                />
                            </div>
                            {elementDetails.description && (
                                <div className="property-row">
                                    <label className="property-label">Description</label>
                                    <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
                                        {elementDetails.description}
                                    </div>
                                </div>
                            )}
                        </div>

                        {commonProperties.length > 0 && (
                            <div className="property-group">
                                <div className="property-group-title">Common</div>
                                {commonProperties.map((prop) => (
                                    <div key={prop.name} className="property-row">
                                        <label className="property-label" title={prop.description}>
                                            {prop.name}
                                        </label>
                                        {renderPropertyInput(prop)}
                                    </div>
                                ))}
                            </div>
                        )}

                        {elementProperties.length > 0 && (
                            <div className="property-group">
                                <div className="property-group-title">Properties</div>
                                {elementProperties.map((prop) => (
                                    <div key={prop.name} className="property-row">
                                        <label className="property-label" title={prop.description}>
                                            {prop.name}
                                        </label>
                                        {renderPropertyInput(prop)}
                                    </div>
                                ))}
                            </div>
                        )}

                        {elementDetails.padTemplates.length > 0 && (
                            <div className="property-group">
                                <div className="property-group-title">Pads</div>
                                {elementDetails.padTemplates.map((pad) => (
                                    <div key={pad.name} className="property-row">
                                        <label className="property-label">
                                            {pad.direction === 'src' ? '→' : '←'} {pad.name}
                                        </label>
                                        <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                                            {pad.presence} | {pad.caps.substring(0, 30)}...
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="no-selection">Loading element details...</div>
                )}
            </div>
        </div>
    );
};


