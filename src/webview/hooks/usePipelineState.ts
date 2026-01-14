import { create, StateCreator } from 'zustand';
import { 
    PipelineDocument, 
    PipelineNode, 
    PipelineEdge, 
    ElementCatalog,
    GstElement,
    PipelineState,
    DebugMessage,
    ValidationResult,
    PipelineError,
    BufferStats
} from '../types/gstreamer';
import { updateDocument } from './useGStreamerService';

interface HistoryEntry {
    document: PipelineDocument;
}

interface PipelineStore {
    document: PipelineDocument | null;
    catalog: ElementCatalog | null;
    pipelineState: PipelineState;
    selectedNodeId: string | null;
    selectedElementDetails: GstElement | null;
    debugMessages: DebugMessage[];
    pipelineErrors: PipelineError[];
    validationResult: ValidationResult | null;
    currentFrame: string | null;
    activeBottomTab: 'debug' | 'preview' | 'metrics';
    bufferStats: Map<string, number>;
    
    // Undo/Redo history
    history: HistoryEntry[];
    historyIndex: number;
    
    setDocument: (doc: PipelineDocument, addToHistory?: boolean) => void;
    setCatalog: (catalog: ElementCatalog) => void;
    setPipelineState: (state: PipelineState) => void;
    setSelectedNodeId: (id: string | null) => void;
    setElementDetails: (element: GstElement) => void;
    addDebugMessage: (message: DebugMessage) => void;
    addPipelineError: (error: PipelineError) => void;
    clearDebugMessages: () => void;
    clearPipelineErrors: () => void;
    setValidationResult: (result: ValidationResult) => void;
    setCurrentFrame: (frame: string) => void;
    setActiveBottomTab: (tab: 'debug' | 'preview' | 'metrics') => void;
    updateBufferStats: (edgeId: string, count: number) => void;
    clearBufferStats: () => void;
    
    // Undo/Redo actions
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    
    addNode: (node: PipelineNode) => void;
    updateNode: (id: string, updates: Partial<PipelineNode>) => void;
    removeNode: (id: string) => void;
    addEdge: (edge: PipelineEdge) => void;
    removeEdge: (id: string) => void;
    updateNodeProperty: (nodeId: string, property: string, value: unknown) => void;
}

const MAX_HISTORY_SIZE = 50;

export const usePipelineStore = create<PipelineStore>((set, get) => ({
    document: null,
    catalog: null,
    pipelineState: { state: 'NULL', pending: 'VOID_PENDING' },
    selectedNodeId: null,
    selectedElementDetails: null,
    debugMessages: [],
    pipelineErrors: [],
    validationResult: null,
    currentFrame: null,
    activeBottomTab: 'debug',
    bufferStats: new Map(),
    history: [],
    historyIndex: -1,

    setDocument: (doc, addToHistory = false) => {
        if (addToHistory) {
            const { history, historyIndex } = get();
            // Remove any future history when making a new change
            const newHistory = history.slice(0, historyIndex + 1);
            newHistory.push({ document: doc });
            // Limit history size
            if (newHistory.length > MAX_HISTORY_SIZE) {
                newHistory.shift();
            }
            set({ 
                document: doc, 
                history: newHistory, 
                historyIndex: newHistory.length - 1 
            });
        } else {
            set({ document: doc });
        }
    },
    
    setCatalog: (catalog) => set({ catalog }),
    
    setPipelineState: (state) => set({ pipelineState: state }),
    
    setSelectedNodeId: (id) => set({ selectedNodeId: id }),
    
    setElementDetails: (element) => set({ selectedElementDetails: element }),
    
    addDebugMessage: (message) => set((state) => ({
        debugMessages: [...state.debugMessages.slice(-499), message]
    })),

    addPipelineError: (error) => set((state) => ({
        pipelineErrors: [...state.pipelineErrors.slice(-99), error],
        activeBottomTab: 'debug' // Auto-switch to debug tab on error
    })),
    
    clearDebugMessages: () => set({ debugMessages: [] }),

    clearPipelineErrors: () => set({ pipelineErrors: [] }),
    
    setValidationResult: (result) => set({ validationResult: result }),
    
    setCurrentFrame: (frame) => set({ currentFrame: frame }),
    
    setActiveBottomTab: (tab) => set({ activeBottomTab: tab }),

    updateBufferStats: (edgeId, count) => set((state) => {
        const newStats = new Map(state.bufferStats);
        newStats.set(edgeId, count);
        return { bufferStats: newStats };
    }),

    clearBufferStats: () => set({ bufferStats: new Map() }),

    // Undo/Redo implementations
    undo: () => {
        const { history, historyIndex } = get();
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            const entry = history[newIndex];
            set({ document: entry.document, historyIndex: newIndex });
            updateDocument(entry.document);
        }
    },

    redo: () => {
        const { history, historyIndex } = get();
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            const entry = history[newIndex];
            set({ document: entry.document, historyIndex: newIndex });
            updateDocument(entry.document);
        }
    },

    canUndo: () => get().historyIndex > 0,
    canRedo: () => get().historyIndex < get().history.length - 1,

    addNode: (node) => {
        let doc = get().document;
        
        // Create default document if none exists
        if (!doc) {
            doc = {
                version: '1.0',
                name: 'New Pipeline',
                nodes: [],
                edges: []
            };
        }
        
        const newDoc = {
            ...doc,
            nodes: [...doc.nodes, node]
        };
        
        // Add to history
        const { history, historyIndex } = get();
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push({ document: newDoc });
        if (newHistory.length > MAX_HISTORY_SIZE) {
            newHistory.shift();
        }
        
        set({ 
            document: newDoc,
            history: newHistory,
            historyIndex: newHistory.length - 1
        });
        
        // Sync to VSCode
        updateDocument(newDoc);
    },

    updateNode: (id, updates) => {
        const doc = get().document;
        if (doc) {
            const newDoc = {
                ...doc,
                nodes: doc.nodes.map((node) =>
                    node.id === id ? { ...node, ...updates } : node
                )
            };
            
            // Add to history
            const { history, historyIndex } = get();
            const newHistory = history.slice(0, historyIndex + 1);
            newHistory.push({ document: newDoc });
            if (newHistory.length > MAX_HISTORY_SIZE) {
                newHistory.shift();
            }
            
            set({ 
                document: newDoc,
                history: newHistory,
                historyIndex: newHistory.length - 1
            });
            updateDocument(newDoc);
        }
    },

    removeNode: (id) => {
        const doc = get().document;
        if (doc) {
            const newDoc = {
                ...doc,
                nodes: doc.nodes.filter((node) => node.id !== id),
                edges: doc.edges.filter(
                    (edge) => edge.source !== id && edge.target !== id
                )
            };
            
            // Add to history
            const { history, historyIndex } = get();
            const newHistory = history.slice(0, historyIndex + 1);
            newHistory.push({ document: newDoc });
            if (newHistory.length > MAX_HISTORY_SIZE) {
                newHistory.shift();
            }
            
            set({
                document: newDoc,
                selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
                history: newHistory,
                historyIndex: newHistory.length - 1
            });
            updateDocument(newDoc);
        }
    },

    addEdge: (edge) => {
        const doc = get().document;
        if (doc) {
            const newDoc = {
                ...doc,
                edges: [...doc.edges, edge]
            };
            
            // Add to history
            const { history, historyIndex } = get();
            const newHistory = history.slice(0, historyIndex + 1);
            newHistory.push({ document: newDoc });
            if (newHistory.length > MAX_HISTORY_SIZE) {
                newHistory.shift();
            }
            
            set({ 
                document: newDoc,
                history: newHistory,
                historyIndex: newHistory.length - 1
            });
            updateDocument(newDoc);
        }
    },

    removeEdge: (id) => {
        const doc = get().document;
        if (doc) {
            const newDoc = {
                ...doc,
                edges: doc.edges.filter((edge) => edge.id !== id)
            };
            
            // Add to history
            const { history, historyIndex } = get();
            const newHistory = history.slice(0, historyIndex + 1);
            newHistory.push({ document: newDoc });
            if (newHistory.length > MAX_HISTORY_SIZE) {
                newHistory.shift();
            }
            
            set({ 
                document: newDoc,
                history: newHistory,
                historyIndex: newHistory.length - 1
            });
            updateDocument(newDoc);
        }
    },

    updateNodeProperty: (nodeId, property, value) => {
        const doc = get().document;
        if (doc) {
            const newDoc = {
                ...doc,
                nodes: doc.nodes.map((node) =>
                    node.id === nodeId
                        ? {
                            ...node,
                            properties: {
                                ...node.properties,
                                [property]: value
                            }
                        }
                        : node
                )
            };
            
            // Add to history
            const { history, historyIndex } = get();
            const newHistory = history.slice(0, historyIndex + 1);
            newHistory.push({ document: newDoc });
            if (newHistory.length > MAX_HISTORY_SIZE) {
                newHistory.shift();
            }
            
            set({ 
                document: newDoc,
                history: newHistory,
                historyIndex: newHistory.length - 1
            });
            updateDocument(newDoc);
        }
    }
}));

