import React from 'react';
import { usePipelineStore } from '../hooks/usePipelineState';
import { DebugPanel } from './DebugPanel';
import { MediaPreview } from './MediaPreview';
import { MetricsPanel } from './MetricsPanel';

export const BottomPanel: React.FC = () => {
    const activeTab = usePipelineStore((state) => state.activeBottomTab);
    const setActiveTab = usePipelineStore((state) => state.setActiveBottomTab);

    return (
        <div className="bottom-panel">
            <div className="bottom-panel-tabs">
                <button
                    className={`bottom-panel-tab ${activeTab === 'debug' ? 'active' : ''}`}
                    onClick={() => setActiveTab('debug')}
                >
                    Debug Log
                </button>
                <button
                    className={`bottom-panel-tab ${activeTab === 'preview' ? 'active' : ''}`}
                    onClick={() => setActiveTab('preview')}
                >
                    Preview
                </button>
                <button
                    className={`bottom-panel-tab ${activeTab === 'metrics' ? 'active' : ''}`}
                    onClick={() => setActiveTab('metrics')}
                >
                    Metrics
                </button>
            </div>
            <div className="bottom-panel-content">
                {activeTab === 'debug' && <DebugPanel />}
                {activeTab === 'preview' && <MediaPreview />}
                {activeTab === 'metrics' && <MetricsPanel />}
            </div>
        </div>
    );
};


