export interface PipelineDocument {
    version: string;
    name: string;
    nodes: PipelineNode[];
    edges: PipelineEdge[];
}

export interface PipelineNode {
    id: string;
    type: string;
    position: { x: number; y: number };
    properties: Record<string, unknown>;
}

export interface PipelineEdge {
    id: string;
    source: string;
    sourceHandle: string;
    target: string;
    targetHandle: string;
}

export interface CatalogEntry {
    name: string;
    longName: string;
    description: string;
    klass: string;
    category: string;
}

export interface ElementCatalog {
    elements: CatalogEntry[];
    categories: string[];
    elementsByCategory: Record<string, CatalogEntry[]>;
}

export interface GstElement {
    name: string;
    longName: string;
    description: string;
    klass: string;
    author: string;
    padTemplates: GstPadTemplate[];
    properties: GstProperty[];
}

export interface GstPadTemplate {
    name: string;
    direction: 'src' | 'sink';
    presence: 'always' | 'sometimes' | 'request';
    caps: string;
}

export interface GstProperty {
    name: string;
    type: string;
    description: string;
    defaultValue: string;
    readable: boolean;
    writable: boolean;
    enumValues?: { name: string; value: number }[];
    min?: number;
    max?: number;
}

export interface PipelineState {
    state: 'NULL' | 'READY' | 'PAUSED' | 'PLAYING';
    pending: 'NULL' | 'READY' | 'PAUSED' | 'PLAYING' | 'VOID_PENDING';
}

export interface DebugMessage {
    timestamp: number;
    level: number;
    category: string;
    element: string;
    message: string;
}

export interface PipelineMetrics {
    latency: number;
    fps: number;
    bufferCount: number;
    droppedBuffers: number;
    memoryUsage: number;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export interface ValidationError {
    elementId: string;
    message: string;
    type: 'element_not_found' | 'pad_incompatible' | 'property_invalid' | 'connection_missing';
}

export interface ValidationWarning {
    elementId: string;
    message: string;
    type: 'deprecated' | 'performance' | 'suggestion';
}

export interface VSCodeApi {
    postMessage(message: { type: string; payload?: unknown }): void;
    getState(): unknown;
    setState(state: unknown): void;
}

export interface PipelineError {
    timestamp: number;
    message: string;
    element?: string;
    debug?: string;
}

export interface BufferStats {
    edgeId: string;
    count: number;
}

export type ExportFormat = 'gst-launch' | 'c' | 'python';


