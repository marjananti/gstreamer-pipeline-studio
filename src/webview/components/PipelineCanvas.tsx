import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    Node,
    Connection,
    useNodesState,
    useEdgesState,
    OnConnect,
    OnNodesChange,
    OnEdgesChange,
    ReactFlowInstance,
    NodeDragHandler,
    useKeyPress
} from 'reactflow';
import ElementNode from './ElementNode';
import PadEdge from './PadEdge';
import { usePipelineStore } from '../hooks/usePipelineState';
import { getElementDetails } from '../hooks/useGStreamerService';
import { PipelineNode, PipelineEdge } from '../types/gstreamer';

const nodeTypes = {
    gstElement: ElementNode
};

const edgeTypes = {
    default: PadEdge
};

export const PipelineCanvas: React.FC = () => {
    const document = usePipelineStore((state) => state.document);
    const catalog = usePipelineStore((state) => state.catalog);
    const setSelectedNodeId = usePipelineStore((state) => state.setSelectedNodeId);
    const addNodeToStore = usePipelineStore((state) => state.addNode);
    const addEdgeToStore = usePipelineStore((state) => state.addEdge);
    const updateNode = usePipelineStore((state) => state.updateNode);
    const removeNodeFromStore = usePipelineStore((state) => state.removeNode);
    const removeEdgeFromStore = usePipelineStore((state) => state.removeEdge);
    
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

    // Handle delete key press
    const deletePressed = useKeyPress(['Delete', 'Backspace']);
    const selectedNodeId = usePipelineStore((state) => state.selectedNodeId);

    useEffect(() => {
        if (deletePressed && selectedNodeId) {
            removeNodeFromStore(selectedNodeId);
        }
    }, [deletePressed, selectedNodeId, removeNodeFromStore]);

    // Convert document nodes to React Flow nodes
    const flowNodes = useMemo(() => {
        if (!document) return [];
        return document.nodes.map((node) => ({
            id: node.id,
            type: 'gstElement',
            position: node.position,
            selectable: true,
            deletable: true,
            data: {
                type: node.type,
                properties: node.properties,
                category: catalog?.elements.find((e) => e.name === node.type)?.category
            }
        }));
    }, [document, catalog]);

    // Convert document edges to React Flow edges
    const flowEdges = useMemo(() => {
        if (!document) return [];
        return document.edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle
        }));
    }, [document]);

    const [nodes, setNodes, onNodesChangeInternal] = useNodesState(flowNodes);
    const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(flowEdges);

    // Sync from document to local state when document changes
    useEffect(() => {
        setNodes(flowNodes);
    }, [flowNodes, setNodes]);

    useEffect(() => {
        setEdges(flowEdges);
    }, [flowEdges, setEdges]);

    // Handle node changes including deletions
    const handleNodesChange: OnNodesChange = useCallback(
        (changes) => {
            // Handle deletions by syncing to store
            for (const change of changes) {
                if (change.type === 'remove') {
                    removeNodeFromStore(change.id);
                }
            }
            // Let React Flow handle the visual update
            onNodesChangeInternal(changes);
        },
        [onNodesChangeInternal, removeNodeFromStore]
    );

    // Handle edge changes including deletions
    const handleEdgesChange: OnEdgesChange = useCallback(
        (changes) => {
            // Handle deletions by syncing to store
            for (const change of changes) {
                if (change.type === 'remove') {
                    removeEdgeFromStore(change.id);
                }
            }
            // Let React Flow handle the visual update
            onEdgesChangeInternal(changes);
        },
        [onEdgesChangeInternal, removeEdgeFromStore]
    );

    // Only sync position changes when drag ends (not during drag)
    const handleNodeDragStop: NodeDragHandler = useCallback(
        (_event, node) => {
            updateNode(node.id, { position: node.position });
        },
        [updateNode]
    );

    // Handle new connections
    const handleConnect: OnConnect = useCallback(
        (connection: Connection) => {
            if (!connection.source || !connection.target) return;
            
            const newEdge: PipelineEdge = {
                id: `edge-${Date.now()}`,
                source: connection.source,
                target: connection.target,
                sourceHandle: connection.sourceHandle || 'src',
                targetHandle: connection.targetHandle || 'sink'
            };
            
            addEdgeToStore(newEdge);
        },
        [addEdgeToStore]
    );

    const handleNodeClick = useCallback(
        (_event: React.MouseEvent, node: Node) => {
            setSelectedNodeId(node.id);
            getElementDetails(node.data.type);
        },
        [setSelectedNodeId]
    );

    const handlePaneClick = useCallback(() => {
        setSelectedNodeId(null);
    }, [setSelectedNodeId]);

    const handleDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }, []);

    const onInit = useCallback((instance: ReactFlowInstance) => {
        reactFlowInstance.current = instance;
    }, []);

    const handleDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const elementName = event.dataTransfer.getData('application/gstreamer-element');
            if (!elementName) return;

            let position = { x: 100, y: 100 };

            // Convert to flow coordinates
            if (reactFlowInstance.current) {
                position = reactFlowInstance.current.screenToFlowPosition({
                    x: event.clientX,
                    y: event.clientY
                });
            } else {
                const wrapperBounds = reactFlowWrapper.current?.getBoundingClientRect();
                if (wrapperBounds) {
                    position = {
                        x: event.clientX - wrapperBounds.left,
                        y: event.clientY - wrapperBounds.top
                    };
                }
            }

            const newNode: PipelineNode = {
                id: `node-${Date.now()}`,
                type: elementName,
                position,
                properties: {}
            };

            addNodeToStore(newNode);
        },
        [addNodeToStore]
    );

    return (
        <div
            ref={reactFlowWrapper}
            className="react-flow-container"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onNodeDragStop={handleNodeDragStop}
                onConnect={handleConnect}
                onNodeClick={handleNodeClick}
                onPaneClick={handlePaneClick}
                onInit={onInit}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                deleteKeyCode={['Backspace', 'Delete']}
                fitView
                snapToGrid
                snapGrid={[15, 15]}
                defaultEdgeOptions={{
                    type: 'default',
                    animated: false
                }}
            >
                <Background gap={15} size={1} />
                <Controls />
                <MiniMap
                    nodeStrokeWidth={3}
                    zoomable
                    pannable
                />
            </ReactFlow>
        </div>
    );
};
