import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GStreamerService, GstElement } from './gstreamer-service';

export interface CatalogEntry {
    name: string;
    longName: string;
    description: string;
    klass: string;
    category: string;
    element?: GstElement;
}

interface StaticCatalog {
    version: string;
    gstreamerVersion: string;
    elements: CatalogEntry[];
}

export class ElementCatalog {
    private m_context: vscode.ExtensionContext;
    private m_service: GStreamerService;
    private m_elements: Map<string, CatalogEntry> = new Map();
    private m_categories: Map<string, CatalogEntry[]> = new Map();
    private m_initialized = false;

    constructor(context: vscode.ExtensionContext, service: GStreamerService) {
        this.m_context = context;
        this.m_service = service;
    }

    async initialize(): Promise<void> {
        if (this.m_initialized) {
            return;
        }

        await this.loadStaticCatalog();
        await this.discoverElements();
        this.m_initialized = true;
    }

    private async loadStaticCatalog(): Promise<void> {
        const staticCatalogPath = path.join(
            this.m_context.extensionPath,
            'src',
            'data',
            'element-catalog.json'
        );

        try {
            const content = fs.readFileSync(staticCatalogPath, 'utf-8');
            const catalog: StaticCatalog = JSON.parse(content);
            
            for (const entry of catalog.elements) {
                this.m_elements.set(entry.name, entry);
                this.addToCategory(entry);
            }
        } catch (error) {
            console.warn('Failed to load static catalog:', error);
        }
    }

    private async discoverElements(): Promise<void> {
        try {
            const elementNames = await this.m_service.listElements();
            
            for (const name of elementNames) {
                if (!this.m_elements.has(name)) {
                    const entry: CatalogEntry = {
                        name,
                        longName: name,
                        description: '',
                        klass: '',
                        category: 'Other'
                    };
                    this.m_elements.set(name, entry);
                    this.addToCategory(entry);
                }
            }

            await this.saveCacheToStorage();
        } catch (error) {
            console.warn('Failed to discover elements at runtime:', error);
        }
    }

    private addToCategory(entry: CatalogEntry): void {
        const category = this.categorizeElement(entry.klass || entry.category);
        entry.category = category;
        
        if (!this.m_categories.has(category)) {
            this.m_categories.set(category, []);
        }
        this.m_categories.get(category)!.push(entry);
    }

    private categorizeElement(klass: string): string {
        const klassLower = klass.toLowerCase();
        
        if (klassLower.includes('source')) return 'Sources';
        if (klassLower.includes('sink')) return 'Sinks';
        if (klassLower.includes('encoder') || klassLower.includes('enc')) return 'Encoders';
        if (klassLower.includes('decoder') || klassLower.includes('dec')) return 'Decoders';
        if (klassLower.includes('filter')) return 'Filters';
        if (klassLower.includes('muxer') || klassLower.includes('mux')) return 'Muxers';
        if (klassLower.includes('demuxer') || klassLower.includes('demux')) return 'Demuxers';
        if (klassLower.includes('parser')) return 'Parsers';
        if (klassLower.includes('converter') || klassLower.includes('convert')) return 'Converters';
        if (klassLower.includes('effect')) return 'Effects';
        if (klassLower.includes('bin') || klassLower.includes('pipeline')) return 'Bins';
        
        return 'Other';
    }

    private async saveCacheToStorage(): Promise<void> {
        const cachePath = path.join(this.m_context.globalStorageUri.fsPath, 'element-cache.json');
        
        try {
            await vscode.workspace.fs.createDirectory(this.m_context.globalStorageUri);
            
            const cacheData = {
                version: '1.0',
                timestamp: Date.now(),
                elements: Array.from(this.m_elements.values())
            };
            
            fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
        } catch (error) {
            console.warn('Failed to save element cache:', error);
        }
    }

    async refresh(): Promise<void> {
        this.m_elements.clear();
        this.m_categories.clear();
        this.m_initialized = false;
        await this.initialize();
    }

    async getElement(name: string): Promise<GstElement | undefined> {
        const entry = this.m_elements.get(name);
        if (!entry) {
            return undefined;
        }

        if (!entry.element) {
            try {
                entry.element = await this.m_service.inspectElement(name);
            } catch (error) {
                console.warn(`Failed to inspect element ${name}:`, error);
            }
        }

        return entry.element;
    }

    getAllElements(): CatalogEntry[] {
        return Array.from(this.m_elements.values());
    }

    getCategories(): string[] {
        return Array.from(this.m_categories.keys()).sort();
    }

    getElementsByCategory(category: string): CatalogEntry[] {
        return this.m_categories.get(category) || [];
    }

    search(query: string): CatalogEntry[] {
        const queryLower = query.toLowerCase();
        const results: CatalogEntry[] = [];

        for (const entry of this.m_elements.values()) {
            if (
                entry.name.toLowerCase().includes(queryLower) ||
                entry.longName.toLowerCase().includes(queryLower) ||
                entry.description.toLowerCase().includes(queryLower)
            ) {
                results.push(entry);
            }
        }

        return results.sort((a, b) => {
            const aStartsWith = a.name.toLowerCase().startsWith(queryLower);
            const bStartsWith = b.name.toLowerCase().startsWith(queryLower);
            if (aStartsWith && !bStartsWith) return -1;
            if (!aStartsWith && bStartsWith) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    hasElement(name: string): boolean {
        return this.m_elements.has(name);
    }
}


