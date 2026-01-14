# Changelog

All notable changes to the GStreamer Pipeline Studio extension will be documented in this file.

## [0.1.0] - 2024-01-14

### Added
- Visual drag-and-drop pipeline builder using React Flow
- Element palette with searchable catalog of GStreamer elements
- Property editor with type-aware input controls
- Embedded video preview via JPEG frame streaming
- Pipeline validation with VSCode diagnostics integration
- Debug log panel with GST_DEBUG parsing and filtering
- Performance profiling with FPS, latency, and buffer metrics
- Export to gst-launch command, Python code, and C code
- Undo/Redo support for all pipeline modifications
- Pause/Resume pipeline controls
- Buffer flow visualization on edges during playback
- Keyboard shortcuts for common operations

### Keyboard Shortcuts
- `Ctrl+Z` - Undo
- `Ctrl+Y` / `Ctrl+Shift+Z` - Redo
- `Ctrl+Enter` - Run pipeline
- `Ctrl+.` - Stop pipeline
- `Ctrl+Shift+V` - Validate pipeline
- `Delete` / `Backspace` - Delete selected element

