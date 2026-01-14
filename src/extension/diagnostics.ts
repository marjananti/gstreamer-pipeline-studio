import * as vscode from 'vscode';
import { ValidationResult, ValidationError, ValidationWarning } from './gstreamer-service';

export class PipelineDiagnostics implements vscode.Disposable {
    private m_diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.m_diagnosticCollection = vscode.languages.createDiagnosticCollection('gstreamer');
    }

    updateDiagnostics(document: vscode.TextDocument, result: ValidationResult): void {
        const diagnostics: vscode.Diagnostic[] = [];

        for (const error of result.errors) {
            const diagnostic = this.createDiagnostic(
                document,
                error,
                vscode.DiagnosticSeverity.Error
            );
            if (diagnostic) {
                diagnostics.push(diagnostic);
            }
        }

        for (const warning of result.warnings) {
            const diagnostic = this.createWarningDiagnostic(
                document,
                warning,
                vscode.DiagnosticSeverity.Warning
            );
            if (diagnostic) {
                diagnostics.push(diagnostic);
            }
        }

        this.m_diagnosticCollection.set(document.uri, diagnostics);
    }

    private createDiagnostic(
        document: vscode.TextDocument,
        error: ValidationError,
        severity: vscode.DiagnosticSeverity
    ): vscode.Diagnostic | undefined {
        const range = this.findElementRange(document, error.elementId);
        if (!range) {
            return new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 1),
                error.message,
                severity
            );
        }

        const diagnostic = new vscode.Diagnostic(range, error.message, severity);
        diagnostic.code = error.type;
        diagnostic.source = 'GStreamer';
        
        return diagnostic;
    }

    private createWarningDiagnostic(
        document: vscode.TextDocument,
        warning: ValidationWarning,
        severity: vscode.DiagnosticSeverity
    ): vscode.Diagnostic | undefined {
        const range = this.findElementRange(document, warning.elementId);
        if (!range) {
            return new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 1),
                warning.message,
                severity
            );
        }

        const diagnostic = new vscode.Diagnostic(range, warning.message, severity);
        diagnostic.code = warning.type;
        diagnostic.source = 'GStreamer';
        
        return diagnostic;
    }

    private findElementRange(document: vscode.TextDocument, elementId: string): vscode.Range | undefined {
        const text = document.getText();
        const escapedId = elementId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`"id"\\s*:\\s*"${escapedId}"`, 'g');
        const match = regex.exec(text);
        
        if (match) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            return new vscode.Range(startPos, endPos);
        }

        return undefined;
    }

    clearDiagnostics(document: vscode.TextDocument): void {
        this.m_diagnosticCollection.delete(document.uri);
    }

    dispose(): void {
        this.m_diagnosticCollection.dispose();
    }
}


