"""
GStreamer Pipeline Runner Module.

Handles creation, execution, and lifecycle management of GStreamer pipelines.
"""

from typing import Callable, Optional, Dict, Any

import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib


class PipelineRunner:
    """Manages GStreamer pipeline execution."""

    def __init__(
        self,
        pipeline_desc: str,
        on_state_change: Optional[Callable[[Dict[str, str]], None]] = None,
        on_error: Optional[Callable[[Dict[str, str]], None]] = None
    ):
        self.m_pipeline_desc = pipeline_desc
        self.m_on_state_change = on_state_change
        self.m_on_error = on_error
        self.m_pipeline: Optional[Gst.Pipeline] = None
        self.m_bus: Optional[Gst.Bus] = None

    def start(self):
        """Parse and start the pipeline."""
        try:
            self.m_pipeline = Gst.parse_launch(self.m_pipeline_desc)
            
            if not isinstance(self.m_pipeline, Gst.Pipeline):
                bin_element = self.m_pipeline
                self.m_pipeline = Gst.Pipeline.new('pipeline')
                self.m_pipeline.add(bin_element)
            
            self.m_bus = self.m_pipeline.get_bus()
            self.m_bus.add_signal_watch()
            self.m_bus.connect('message::state-changed', self._on_state_changed)
            self.m_bus.connect('message::error', self._on_error)
            self.m_bus.connect('message::eos', self._on_eos)
            self.m_bus.connect('message::warning', self._on_warning)
            
            ret = self.m_pipeline.set_state(Gst.State.PLAYING)
            if ret == Gst.StateChangeReturn.FAILURE:
                raise RuntimeError("Failed to start pipeline")
                
        except Exception as e:
            if self.m_on_error:
                self.m_on_error({'message': str(e)})
            raise

    def stop(self):
        """Stop the pipeline and clean up."""
        if self.m_pipeline:
            self.m_pipeline.set_state(Gst.State.NULL)
            
            if self.m_bus:
                self.m_bus.remove_signal_watch()
                self.m_bus = None
            
            self.m_pipeline = None
            
            if self.m_on_state_change:
                self.m_on_state_change({
                    'state': 'NULL',
                    'pending': 'VOID_PENDING'
                })

    def pause(self):
        """Pause the pipeline."""
        if self.m_pipeline:
            self.m_pipeline.set_state(Gst.State.PAUSED)

    def resume(self):
        """Resume a paused pipeline."""
        if self.m_pipeline:
            self.m_pipeline.set_state(Gst.State.PLAYING)

    def get_state(self) -> Dict[str, str]:
        """Get current pipeline state."""
        if not self.m_pipeline:
            return {'state': 'NULL', 'pending': 'VOID_PENDING'}
        
        success, state, pending = self.m_pipeline.get_state(Gst.CLOCK_TIME_NONE)
        
        state_map = {
            Gst.State.NULL: 'NULL',
            Gst.State.READY: 'READY',
            Gst.State.PAUSED: 'PAUSED',
            Gst.State.PLAYING: 'PLAYING'
        }
        
        pending_map = {
            Gst.State.VOID_PENDING: 'VOID_PENDING',
            Gst.State.NULL: 'NULL',
            Gst.State.READY: 'READY',
            Gst.State.PAUSED: 'PAUSED',
            Gst.State.PLAYING: 'PLAYING'
        }
        
        return {
            'state': state_map.get(state, 'NULL'),
            'pending': pending_map.get(pending, 'VOID_PENDING')
        }

    def get_pipeline(self) -> Optional[Gst.Pipeline]:
        """Get the underlying GStreamer pipeline."""
        return self.m_pipeline

    def get_element_by_name(self, name: str) -> Optional[Gst.Element]:
        """Get an element by name from the pipeline."""
        if self.m_pipeline:
            return self.m_pipeline.get_by_name(name)
        return None

    def _on_state_changed(self, bus: Gst.Bus, message: Gst.Message):
        """Handle state change messages."""
        if message.src != self.m_pipeline:
            return
        
        old_state, new_state, pending = message.parse_state_changed()
        
        state_map = {
            Gst.State.NULL: 'NULL',
            Gst.State.READY: 'READY',
            Gst.State.PAUSED: 'PAUSED',
            Gst.State.PLAYING: 'PLAYING'
        }
        
        pending_map = {
            Gst.State.VOID_PENDING: 'VOID_PENDING',
            Gst.State.NULL: 'NULL',
            Gst.State.READY: 'READY',
            Gst.State.PAUSED: 'PAUSED',
            Gst.State.PLAYING: 'PLAYING'
        }
        
        if self.m_on_state_change:
            self.m_on_state_change({
                'state': state_map.get(new_state, 'NULL'),
                'pending': pending_map.get(pending, 'VOID_PENDING')
            })

    def _on_error(self, bus: Gst.Bus, message: Gst.Message):
        """Handle error messages."""
        err, debug = message.parse_error()
        
        element_name = ''
        if message.src:
            element_name = message.src.get_name()
        
        if self.m_on_error:
            self.m_on_error({
                'message': str(err),
                'element': element_name,
                'debug': debug
            })

    def _on_eos(self, bus: Gst.Bus, message: Gst.Message):
        """Handle end-of-stream messages."""
        self.stop()

    def _on_warning(self, bus: Gst.Bus, message: Gst.Message):
        """Handle warning messages."""
        warn, debug = message.parse_warning()
        import sys
        sys.stderr.write(f"Warning: {warn} ({debug})\n")
        sys.stderr.flush()


