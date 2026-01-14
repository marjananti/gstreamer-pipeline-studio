import React, { useState, useMemo } from 'react';
import { usePipelineStore } from '../hooks/usePipelineState';

export const ElementPalette: React.FC = () => {
    const catalog = usePipelineStore((state) => state.catalog);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['Sources', 'Sinks']));

    const filteredElements = useMemo(() => {
        if (!catalog) return {};
        
        if (!searchQuery.trim()) {
            return catalog.elementsByCategory;
        }

        const query = searchQuery.toLowerCase();
        const filtered: Record<string, typeof catalog.elements> = {};

        for (const [category, elements] of Object.entries(catalog.elementsByCategory)) {
            const matchingElements = elements.filter(
                (el) =>
                    el.name.toLowerCase().includes(query) ||
                    el.longName.toLowerCase().includes(query) ||
                    el.description.toLowerCase().includes(query)
            );
            if (matchingElements.length > 0) {
                filtered[category] = matchingElements;
            }
        }

        return filtered;
    }, [catalog, searchQuery]);

    const toggleCategory = (category: string) => {
        setExpandedCategories((prev) => {
            const next = new Set(prev);
            if (next.has(category)) {
                next.delete(category);
            } else {
                next.add(category);
            }
            return next;
        });
    };

    const onDragStart = (event: React.DragEvent, elementName: string) => {
        event.dataTransfer.setData('application/gstreamer-element', elementName);
        event.dataTransfer.effectAllowed = 'copy';
    };

    if (!catalog) {
        return (
            <div className="element-palette">
                <div className="palette-header">
                    <input
                        type="text"
                        className="palette-search"
                        placeholder="Loading elements..."
                        disabled
                    />
                </div>
                <div className="palette-content">
                    <div className="no-selection">Loading element catalog...</div>
                </div>
            </div>
        );
    }

    const categories = Object.keys(filteredElements).sort();

    return (
        <div className="element-palette">
            <div className="palette-header">
                <input
                    type="text"
                    className="palette-search"
                    placeholder="Search elements..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
            <div className="palette-content">
                {categories.length === 0 ? (
                    <div className="no-selection">No elements found</div>
                ) : (
                    categories.map((category) => (
                        <div key={category} className="palette-category">
                            <div
                                className="category-header"
                                onClick={() => toggleCategory(category)}
                            >
                                <span>{expandedCategories.has(category) ? '▼' : '▶'}</span>
                                <span style={{ marginLeft: 6 }}>{category}</span>
                                <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
                                    {filteredElements[category].length}
                                </span>
                            </div>
                            {expandedCategories.has(category) && (
                                <div className="category-items">
                                    {filteredElements[category].map((element) => (
                                        <div
                                            key={element.name}
                                            className="palette-element"
                                            draggable
                                            onDragStart={(e) => onDragStart(e, element.name)}
                                            title={element.description || element.longName}
                                        >
                                            {element.name}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};


