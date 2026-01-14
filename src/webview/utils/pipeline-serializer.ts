import { PipelineDocument, PipelineNode, PipelineEdge } from '../types/gstreamer';

export function pipelineToGstLaunch(pipeline: PipelineDocument): string {
    const elements = new Map<string, { 
        type: string; 
        properties: Record<string, unknown>; 
        name: string 
    }>();

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
            .map(([key, value]) => `${key}=${formatPropertyValue(value)}`)
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

function formatPropertyValue(value: unknown): string {
    if (typeof value === 'string') {
        if (value.includes(' ') || value.includes('!') || value.includes('"')) {
            return `"${value.replace(/"/g, '\\"')}"`;
        }
        return value;
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return String(value);
}

export function gstLaunchToPipeline(gstLaunch: string): PipelineDocument {
    const pipeline: PipelineDocument = {
        version: '1.0',
        name: 'Imported Pipeline',
        nodes: [],
        edges: []
    };

    const elements = gstLaunch.split('!').map((s) => s.trim()).filter(Boolean);
    let lastNodeId: string | null = null;
    let xPos = 100;

    for (const elementStr of elements) {
        const parts = elementStr.split(/\s+/);
        const type = parts[0];
        const properties: Record<string, unknown> = {};

        for (let i = 1; i < parts.length; i++) {
            const match = parts[i].match(/^(\w+)=(.+)$/);
            if (match) {
                const [, key, value] = match;
                properties[key] = parsePropertyValue(value);
            }
        }

        const nodeId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const node: PipelineNode = {
            id: nodeId,
            type,
            position: { x: xPos, y: 200 },
            properties
        };
        pipeline.nodes.push(node);

        if (lastNodeId) {
            const edge: PipelineEdge = {
                id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                source: lastNodeId,
                sourceHandle: 'src',
                target: nodeId,
                targetHandle: 'sink'
            };
            pipeline.edges.push(edge);
        }

        lastNodeId = nodeId;
        xPos += 200;
    }

    return pipeline;
}

function parsePropertyValue(value: string): unknown {
    if (value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1);
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^-?\d+$/.test(value)) return parseInt(value, 10);
    if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
    return value;
}

export function validatePipelineStructure(pipeline: PipelineDocument): string[] {
    const errors: string[] = [];

    const nodeIds = new Set(pipeline.nodes.map((n) => n.id));
    
    for (const edge of pipeline.edges) {
        if (!nodeIds.has(edge.source)) {
            errors.push(`Edge ${edge.id} references non-existent source node ${edge.source}`);
        }
        if (!nodeIds.has(edge.target)) {
            errors.push(`Edge ${edge.id} references non-existent target node ${edge.target}`);
        }
    }

    const idCounts = new Map<string, number>();
    for (const node of pipeline.nodes) {
        idCounts.set(node.id, (idCounts.get(node.id) || 0) + 1);
    }
    for (const [id, count] of idCounts) {
        if (count > 1) {
            errors.push(`Duplicate node ID: ${id}`);
        }
    }

    return errors;
}

export type ExportLanguage = 'c' | 'python';

export function pipelineToCCode(pipeline: PipelineDocument): string {
    if (pipeline.nodes.length === 0) {
        return '// Empty pipeline';
    }

    const lines: string[] = [
        '/* GStreamer Pipeline - Generated by GStreamer Pipeline Studio */',
        '#include <gst/gst.h>',
        '#include <stdio.h>',
        '',
        'int main(int argc, char *argv[]) {',
        '    GstElement *pipeline;',
    ];

    // Declare element variables
    for (const node of pipeline.nodes) {
        const varName = sanitizeVarName(node.id);
        lines.push(`    GstElement *${varName};`);
    }
    lines.push('    GstBus *bus;');
    lines.push('    GstMessage *msg;');
    lines.push('');
    lines.push('    /* Initialize GStreamer */');
    lines.push('    gst_init(&argc, &argv);');
    lines.push('');
    lines.push('    /* Create pipeline */');
    lines.push('    pipeline = gst_pipeline_new("pipeline");');
    lines.push('');
    lines.push('    /* Create elements */');

    // Create elements
    for (const node of pipeline.nodes) {
        const varName = sanitizeVarName(node.id);
        lines.push(`    ${varName} = gst_element_factory_make("${node.type}", "${varName}");`);
        lines.push(`    if (!${varName}) {`);
        lines.push(`        g_printerr("Failed to create ${node.type} element\\n");`);
        lines.push('        return -1;');
        lines.push('    }');
    }

    lines.push('');
    lines.push('    /* Set element properties */');
    
    // Set properties
    for (const node of pipeline.nodes) {
        const varName = sanitizeVarName(node.id);
        for (const [key, value] of Object.entries(node.properties)) {
            if (value !== undefined && value !== null && value !== '') {
                const propValue = formatCPropertyValue(value);
                lines.push(`    g_object_set(G_OBJECT(${varName}), "${key}", ${propValue}, NULL);`);
            }
        }
    }

    lines.push('');
    lines.push('    /* Add elements to pipeline */');
    lines.push(`    gst_bin_add_many(GST_BIN(pipeline),`);
    const elementVars = pipeline.nodes.map(n => `        ${sanitizeVarName(n.id)}`);
    lines.push(elementVars.join(',\n') + ',');
    lines.push('        NULL);');

    lines.push('');
    lines.push('    /* Link elements */');
    
    // Link elements based on edges
    for (const edge of pipeline.edges) {
        const srcVar = sanitizeVarName(edge.source);
        const tgtVar = sanitizeVarName(edge.target);
        lines.push(`    if (!gst_element_link(${srcVar}, ${tgtVar})) {`);
        lines.push(`        g_printerr("Failed to link ${srcVar} to ${tgtVar}\\n");`);
        lines.push('        gst_object_unref(pipeline);');
        lines.push('        return -1;');
        lines.push('    }');
    }

    lines.push('');
    lines.push('    /* Start playing */');
    lines.push('    gst_element_set_state(pipeline, GST_STATE_PLAYING);');
    lines.push('');
    lines.push('    /* Wait until error or EOS */');
    lines.push('    bus = gst_element_get_bus(pipeline);');
    lines.push('    msg = gst_bus_timed_pop_filtered(bus, GST_CLOCK_TIME_NONE,');
    lines.push('        GST_MESSAGE_ERROR | GST_MESSAGE_EOS);');
    lines.push('');
    lines.push('    /* Parse message */');
    lines.push('    if (msg != NULL) {');
    lines.push('        GError *err;');
    lines.push('        gchar *debug_info;');
    lines.push('        switch (GST_MESSAGE_TYPE(msg)) {');
    lines.push('            case GST_MESSAGE_ERROR:');
    lines.push('                gst_message_parse_error(msg, &err, &debug_info);');
    lines.push('                g_printerr("Error: %s\\n", err->message);');
    lines.push('                g_error_free(err);');
    lines.push('                g_free(debug_info);');
    lines.push('                break;');
    lines.push('            case GST_MESSAGE_EOS:');
    lines.push('                g_print("End-Of-Stream reached.\\n");');
    lines.push('                break;');
    lines.push('            default:');
    lines.push('                break;');
    lines.push('        }');
    lines.push('        gst_message_unref(msg);');
    lines.push('    }');
    lines.push('');
    lines.push('    /* Cleanup */');
    lines.push('    gst_object_unref(bus);');
    lines.push('    gst_element_set_state(pipeline, GST_STATE_NULL);');
    lines.push('    gst_object_unref(pipeline);');
    lines.push('');
    lines.push('    return 0;');
    lines.push('}');

    return lines.join('\n');
}

export function pipelineToPythonCode(pipeline: PipelineDocument): string {
    if (pipeline.nodes.length === 0) {
        return '# Empty pipeline';
    }

    const lines: string[] = [
        '#!/usr/bin/env python3',
        '"""GStreamer Pipeline - Generated by GStreamer Pipeline Studio"""',
        '',
        'import gi',
        'gi.require_version("Gst", "1.0")',
        'from gi.repository import Gst, GLib',
        '',
        '',
        'def main():',
        '    # Initialize GStreamer',
        '    Gst.init(None)',
        '',
        '    # Create pipeline',
        '    pipeline = Gst.Pipeline.new("pipeline")',
        '',
        '    # Create elements',
    ];

    // Create elements
    for (const node of pipeline.nodes) {
        const varName = sanitizePythonVarName(node.id);
        lines.push(`    ${varName} = Gst.ElementFactory.make("${node.type}", "${varName}")`);
        lines.push(`    if not ${varName}:`);
        lines.push(`        print(f"Failed to create ${node.type} element")`);
        lines.push('        return -1');
    }

    lines.push('');
    lines.push('    # Set element properties');
    
    // Set properties
    for (const node of pipeline.nodes) {
        const varName = sanitizePythonVarName(node.id);
        for (const [key, value] of Object.entries(node.properties)) {
            if (value !== undefined && value !== null && value !== '') {
                const propValue = formatPythonPropertyValue(value);
                lines.push(`    ${varName}.set_property("${key}", ${propValue})`);
            }
        }
    }

    lines.push('');
    lines.push('    # Add elements to pipeline');
    for (const node of pipeline.nodes) {
        const varName = sanitizePythonVarName(node.id);
        lines.push(`    pipeline.add(${varName})`);
    }

    lines.push('');
    lines.push('    # Link elements');
    
    // Link elements based on edges
    for (const edge of pipeline.edges) {
        const srcVar = sanitizePythonVarName(edge.source);
        const tgtVar = sanitizePythonVarName(edge.target);
        lines.push(`    if not ${srcVar}.link(${tgtVar}):`);
        lines.push(`        print(f"Failed to link ${srcVar} to ${tgtVar}")`);
        lines.push('        return -1');
    }

    lines.push('');
    lines.push('    # Start playing');
    lines.push('    ret = pipeline.set_state(Gst.State.PLAYING)');
    lines.push('    if ret == Gst.StateChangeReturn.FAILURE:');
    lines.push('        print("Failed to set pipeline to PLAYING")');
    lines.push('        return -1');
    lines.push('');
    lines.push('    # Wait for EOS or error');
    lines.push('    bus = pipeline.get_bus()');
    lines.push('    msg = bus.timed_pop_filtered(');
    lines.push('        Gst.CLOCK_TIME_NONE,');
    lines.push('        Gst.MessageType.ERROR | Gst.MessageType.EOS');
    lines.push('    )');
    lines.push('');
    lines.push('    # Parse message');
    lines.push('    if msg:');
    lines.push('        if msg.type == Gst.MessageType.ERROR:');
    lines.push('            err, debug = msg.parse_error()');
    lines.push('            print(f"Error: {err.message}")');
    lines.push('            if debug:');
    lines.push('                print(f"Debug: {debug}")');
    lines.push('        elif msg.type == Gst.MessageType.EOS:');
    lines.push('            print("End-Of-Stream reached")');
    lines.push('');
    lines.push('    # Cleanup');
    lines.push('    pipeline.set_state(Gst.State.NULL)');
    lines.push('');
    lines.push('    return 0');
    lines.push('');
    lines.push('');
    lines.push('if __name__ == "__main__":');
    lines.push('    exit(main())');

    return lines.join('\n');
}

function sanitizeVarName(id: string): string {
    return id.replace(/-/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
}

function sanitizePythonVarName(id: string): string {
    return id.replace(/-/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
}

function formatCPropertyValue(value: unknown): string {
    if (typeof value === 'string') {
        return `"${value.replace(/"/g, '\\"')}"`;
    }
    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE';
    }
    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            return String(value);
        }
        return `${value}`;
    }
    return `"${String(value)}"`;
}

function formatPythonPropertyValue(value: unknown): string {
    if (typeof value === 'string') {
        return `"${value.replace(/"/g, '\\"')}"`;
    }
    if (typeof value === 'boolean') {
        return value ? 'True' : 'False';
    }
    if (typeof value === 'number') {
        return String(value);
    }
    return `"${String(value)}"`;
}


