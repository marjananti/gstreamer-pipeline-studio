import * as assert from 'assert';
import * as vscode from 'vscode';

suite('GStreamer Pipeline Studio Extension Test Suite', () => {
    vscode.window.showInformationMessage('Starting GStreamer extension tests');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('gstreamer-studio.gstreamer-pipeline-studio'));
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        
        assert.ok(commands.includes('gstreamer.openPipelineEditor'));
        assert.ok(commands.includes('gstreamer.runPipeline'));
        assert.ok(commands.includes('gstreamer.stopPipeline'));
        assert.ok(commands.includes('gstreamer.validatePipeline'));
        assert.ok(commands.includes('gstreamer.exportToGstLaunch'));
        assert.ok(commands.includes('gstreamer.showDebugLog'));
        assert.ok(commands.includes('gstreamer.refreshElementCatalog'));
    });

    test('Custom editor should be registered for .gstpipe files', () => {
        const config = vscode.workspace.getConfiguration('workbench');
        const editorAssociations = config.get('editorAssociations') as Record<string, string>;
        
        assert.ok(
            editorAssociations === undefined || 
            editorAssociations['*.gstpipe'] === undefined ||
            editorAssociations['*.gstpipe'] === 'gstreamer.pipelineEditor'
        );
    });
});

suite('Pipeline Serialization Tests', () => {
    test('Empty pipeline should serialize to empty string', () => {
        const pipeline = {
            version: '1.0',
            name: 'Test',
            nodes: [],
            edges: []
        };
        
        assert.strictEqual(serializePipeline(pipeline), '');
    });

    test('Single element pipeline should serialize correctly', () => {
        const pipeline = {
            version: '1.0',
            name: 'Test',
            nodes: [
                {
                    id: 'node-1',
                    type: 'videotestsrc',
                    position: { x: 0, y: 0 },
                    properties: { pattern: 'ball' }
                }
            ],
            edges: []
        };
        
        const result = serializePipeline(pipeline);
        assert.ok(result.includes('videotestsrc'));
        assert.ok(result.includes('pattern=ball'));
    });

    test('Connected elements should serialize with ! separator', () => {
        const pipeline = {
            version: '1.0',
            name: 'Test',
            nodes: [
                {
                    id: 'node-1',
                    type: 'videotestsrc',
                    position: { x: 0, y: 0 },
                    properties: {}
                },
                {
                    id: 'node-2',
                    type: 'autovideosink',
                    position: { x: 100, y: 0 },
                    properties: {}
                }
            ],
            edges: [
                {
                    id: 'edge-1',
                    source: 'node-1',
                    sourceHandle: 'src',
                    target: 'node-2',
                    targetHandle: 'sink'
                }
            ]
        };
        
        const result = serializePipeline(pipeline);
        assert.ok(result.includes('!'));
        assert.ok(result.includes('videotestsrc'));
        assert.ok(result.includes('autovideosink'));
    });
});

function serializePipeline(pipeline: {
    version: string;
    name: string;
    nodes: Array<{
        id: string;
        type: string;
        position: { x: number; y: number };
        properties: Record<string, unknown>;
    }>;
    edges: Array<{
        id: string;
        source: string;
        sourceHandle: string;
        target: string;
        targetHandle: string;
    }>;
}): string {
    if (pipeline.nodes.length === 0) {
        return '';
    }

    const elements = new Map<string, { type: string; properties: Record<string, unknown>; name: string }>();
    for (const node of pipeline.nodes) {
        elements.set(node.id, {
            type: node.type,
            properties: node.properties,
            name: `element_${node.id.replace(/-/g, '_')}`
        });
    }

    const connections = new Map<string, string[]>();
    for (const edge of pipeline.edges) {
        if (!connections.has(edge.source)) {
            connections.set(edge.source, []);
        }
        connections.get(edge.source)!.push(edge.target);
    }

    const parts: string[] = [];
    const visited = new Set<string>();

    const processElement = (nodeId: string): void => {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);

        const element = elements.get(nodeId);
        if (!element) return;

        let elementStr = element.type;
        
        const props = Object.entries(element.properties)
            .filter(([_, value]) => value !== undefined && value !== null && value !== '')
            .map(([key, value]) => `${key}=${value}`)
            .join(' ');

        if (props) {
            elementStr += ` ${props}`;
        }

        elementStr += ` name=${element.name}`;
        parts.push(elementStr);

        const targets = connections.get(nodeId) || [];
        for (const targetId of targets) {
            parts.push('!');
            processElement(targetId);
        }
    };

    const sources = new Set(pipeline.nodes.map((n) => n.id));
    for (const edge of pipeline.edges) {
        sources.delete(edge.target);
    }

    for (const sourceId of sources) {
        processElement(sourceId);
    }

    return parts.join(' ');
}


