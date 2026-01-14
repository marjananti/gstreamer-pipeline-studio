#!/usr/bin/env python3
"""
GStreamer Backend Service for VSCode Extension.

This service provides a JSON-RPC interface for GStreamer operations
including element inspection, pipeline execution, and frame streaming.
"""

import sys
import os
import json
import threading
import signal
from typing import Any, Optional

# Add the backend directory to Python path for imports
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib

from element_inspector import ElementInspector
from pipeline_runner import PipelineRunner
from frame_streamer import FrameStreamer
from debug_tracer import DebugTracer
from profiler import PipelineProfiler


class GStreamerService:
    """Main service class handling JSON-RPC requests."""

    def __init__(self):
        Gst.init(None)
        
        self.m_inspector = ElementInspector()
        self.m_runner: Optional[PipelineRunner] = None
        self.m_frame_streamer: Optional[FrameStreamer] = None
        self.m_tracer = DebugTracer()
        self.m_profiler: Optional[PipelineProfiler] = None
        
        self.m_main_loop = GLib.MainLoop()
        self.m_running = True
        
        self.m_methods = {
            'ping': self._handle_ping,
            'listElements': self._handle_list_elements,
            'inspect': self._handle_inspect,
            'run': self._handle_run,
            'stop': self._handle_stop,
            'pause': self._handle_pause,
            'resume': self._handle_resume,
            'getState': self._handle_get_state,
            'validate': self._handle_validate,
            'getMetrics': self._handle_get_metrics,
        }

    def _handle_ping(self, params: dict) -> dict:
        """Health check endpoint."""
        return {'status': 'ok', 'version': '1.0.0'}

    def _handle_list_elements(self, params: dict) -> list:
        """List all available GStreamer elements."""
        return self.m_inspector.list_elements()

    def _handle_inspect(self, params: dict) -> dict:
        """Inspect a specific GStreamer element."""
        element_name = params.get('element', '')
        return self.m_inspector.inspect_element(element_name)

    def _handle_run(self, params: dict) -> dict:
        """Run a GStreamer pipeline."""
        import sys
        pipeline_desc = params.get('pipeline', '')
        
        sys.stderr.write(f"[GstBackend] Running pipeline: {pipeline_desc}\n")
        sys.stderr.flush()
        
        # Stop any existing pipeline
        if self.m_runner:
            sys.stderr.write("[GstBackend] Stopping previous pipeline\n")
            sys.stderr.flush()
            self.m_runner.stop()
            self.m_runner = None
            self.m_frame_streamer = None
            self.m_profiler = None
        
        try:
            self.m_runner = PipelineRunner(
                pipeline_desc,
                on_state_change=self._send_state_change,
                on_error=self._send_error
            )
            
            # Start pipeline FIRST
            self.m_runner.start()
            sys.stderr.write("[GstBackend] Pipeline started\n")
            sys.stderr.flush()
            
            # Then set up frame streaming (optional - may fail)
            try:
                self.m_frame_streamer = FrameStreamer(
                    self.m_runner,
                    on_frame=self._send_frame
                )
                sys.stderr.write("[GstBackend] Frame streamer initialized\n")
                sys.stderr.flush()
            except Exception as e:
                sys.stderr.write(f"[GstBackend] Frame streaming not available: {e}\n")
                sys.stderr.flush()
            
            # Set up profiler (optional)
            try:
                self.m_profiler = PipelineProfiler(self.m_runner)
            except Exception as e:
                sys.stderr.write(f"[GstBackend] Profiler not available: {e}\n")
                sys.stderr.flush()
            
            return {'status': 'started'}
            
        except Exception as e:
            sys.stderr.write(f"[GstBackend] Failed to start pipeline: {e}\n")
            sys.stderr.flush()
            self.m_runner = None
            raise

    def _handle_stop(self, params: dict) -> dict:
        """Stop the running pipeline."""
        import sys
        sys.stderr.write("[GstBackend] Stop requested\n")
        sys.stderr.flush()
        
        if self.m_profiler:
            try:
                self.m_profiler.stop()
            except Exception:
                pass
            self.m_profiler = None
            
        if self.m_runner:
            try:
                self.m_runner.stop()
            except Exception as e:
                sys.stderr.write(f"[GstBackend] Error stopping pipeline: {e}\n")
                sys.stderr.flush()
            self.m_runner = None
            
        self.m_frame_streamer = None
        
        # Send state change notification
        self._send_state_change({'state': 'NULL', 'pending': 'VOID_PENDING'})
        
        sys.stderr.write("[GstBackend] Pipeline stopped\n")
        sys.stderr.flush()
        
        return {'status': 'stopped'}

    def _handle_pause(self, params: dict) -> dict:
        """Pause the running pipeline."""
        import sys
        sys.stderr.write("[GstBackend] Pause requested\n")
        sys.stderr.flush()
        
        if not self.m_runner:
            return {'status': 'error', 'message': 'No pipeline running'}
        
        try:
            self.m_runner.pause()
            self._send_state_change({'state': 'PAUSED', 'pending': 'VOID_PENDING'})
            sys.stderr.write("[GstBackend] Pipeline paused\n")
            sys.stderr.flush()
            return {'status': 'paused'}
        except Exception as e:
            sys.stderr.write(f"[GstBackend] Error pausing pipeline: {e}\n")
            sys.stderr.flush()
            raise

    def _handle_resume(self, params: dict) -> dict:
        """Resume a paused pipeline."""
        import sys
        sys.stderr.write("[GstBackend] Resume requested\n")
        sys.stderr.flush()
        
        if not self.m_runner:
            return {'status': 'error', 'message': 'No pipeline running'}
        
        try:
            self.m_runner.resume()
            self._send_state_change({'state': 'PLAYING', 'pending': 'VOID_PENDING'})
            sys.stderr.write("[GstBackend] Pipeline resumed\n")
            sys.stderr.flush()
            return {'status': 'playing'}
        except Exception as e:
            sys.stderr.write(f"[GstBackend] Error resuming pipeline: {e}\n")
            sys.stderr.flush()
            raise

    def _handle_get_state(self, params: dict) -> dict:
        """Get current pipeline state."""
        if not self.m_runner:
            return {'state': 'NULL', 'pending': 'VOID_PENDING'}
        return self.m_runner.get_state()

    def _handle_validate(self, params: dict) -> dict:
        """Validate a pipeline description."""
        pipeline_desc = params.get('pipeline', '')
        return self.m_inspector.validate_pipeline(pipeline_desc)

    def _handle_get_metrics(self, params: dict) -> dict:
        """Get pipeline performance metrics."""
        if not self.m_profiler:
            return {
                'latency': 0,
                'fps': 0,
                'bufferCount': 0,
                'droppedBuffers': 0,
                'memoryUsage': 0
            }
        return self.m_profiler.get_metrics()

    def _send_notification(self, method: str, params: Any):
        """Send a JSON-RPC notification to the extension."""
        notification = {
            'jsonrpc': '2.0',
            'method': method,
            'params': params
        }
        self._write_response(notification)

    def _send_state_change(self, state: dict):
        """Send state change notification."""
        self._send_notification('stateChange', state)

    def _send_error(self, error: dict):
        """Send error notification."""
        self._send_notification('error', error)

    def _send_frame(self, frame_data: str):
        """Send video frame notification."""
        import sys
        sys.stderr.write(f"[GstBackend] Sending frame ({len(frame_data)} bytes)\n")
        sys.stderr.flush()
        self._send_notification('frame', frame_data)

    def _write_response(self, response: dict):
        """Write JSON response to stdout."""
        line = json.dumps(response) + '\n'
        sys.stdout.write(line)
        sys.stdout.flush()

    def handle_request(self, request: dict) -> dict:
        """Handle a JSON-RPC request."""
        method = request.get('method', '')
        params = request.get('params', {})
        request_id = request.get('id')

        handler = self.m_methods.get(method)
        if not handler:
            return {
                'jsonrpc': '2.0',
                'error': {
                    'code': -32601,
                    'message': f'Method not found: {method}'
                },
                'id': request_id
            }

        try:
            result = handler(params)
            return {
                'jsonrpc': '2.0',
                'result': result,
                'id': request_id
            }
        except Exception as e:
            return {
                'jsonrpc': '2.0',
                'error': {
                    'code': -32000,
                    'message': str(e)
                },
                'id': request_id
            }

    def run(self):
        """Main service loop."""
        glib_thread = threading.Thread(target=self._run_main_loop, daemon=True)
        glib_thread.start()

        while self.m_running:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                
                line = line.strip()
                if not line:
                    continue

                request = json.loads(line)
                response = self.handle_request(request)
                self._write_response(response)

            except json.JSONDecodeError as e:
                error_response = {
                    'jsonrpc': '2.0',
                    'error': {
                        'code': -32700,
                        'message': f'Parse error: {str(e)}'
                    },
                    'id': None
                }
                self._write_response(error_response)
            except KeyboardInterrupt:
                break
            except Exception as e:
                sys.stderr.write(f'Error: {str(e)}\n')
                sys.stderr.flush()

        self.shutdown()

    def _run_main_loop(self):
        """Run GLib main loop in a separate thread."""
        self.m_main_loop.run()

    def shutdown(self):
        """Clean shutdown of the service."""
        self.m_running = False
        
        if self.m_runner:
            self.m_runner.stop()
        
        if self.m_main_loop.is_running():
            self.m_main_loop.quit()


def main():
    """Entry point."""
    service = GStreamerService()
    
    def signal_handler(sig, frame):
        service.shutdown()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    service.run()


if __name__ == '__main__':
    main()

