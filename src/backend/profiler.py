"""
GStreamer Pipeline Profiler Module.

Collects performance metrics from running GStreamer pipelines.
"""

import time
import threading
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field

import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib

from pipeline_runner import PipelineRunner


@dataclass
class MetricsSnapshot:
    """A snapshot of pipeline metrics at a point in time."""
    timestamp: float
    latency: float
    fps: float
    buffer_count: int
    dropped_buffers: int
    memory_usage: int


@dataclass
class ElementMetrics:
    """Metrics for a single pipeline element."""
    name: str
    processing_time: float
    buffer_count: int
    queue_level: int


class PipelineProfiler:
    """Profiles GStreamer pipeline performance."""

    def __init__(self, runner: PipelineRunner, sample_interval: float = 1.0):
        self.m_runner = runner
        self.m_sample_interval = sample_interval
        self.m_running = False
        self.m_thread: Optional[threading.Thread] = None
        
        self.m_buffer_count = 0
        self.m_dropped_buffers = 0
        self.m_frame_times: List[float] = []
        self.m_last_sample_time = time.time()
        self.m_current_fps = 0.0
        self.m_current_latency = 0.0
        self.m_probe_attached = False
        
        try:
            self._setup_probes()
            self._start_sampling()
        except Exception as e:
            import sys
            sys.stderr.write(f"[Profiler] Setup failed: {e}\n")
            sys.stderr.flush()

    def _setup_probes(self):
        """Set up buffer probes on pipeline elements."""
        import sys
        
        pipeline = self.m_runner.get_pipeline()
        if not pipeline:
            sys.stderr.write("[Profiler] No pipeline available\n")
            sys.stderr.flush()
            return

        try:
            # Find a single sink element to count FPS accurately
            # We only want ONE probe to avoid counting each frame multiple times
            sink_element = None
            iterator = pipeline.iterate_sinks()
            while True:
                result, element = iterator.next()
                if result != Gst.IteratorResult.OK:
                    break
                sink_element = element
                break  # Use ONLY the first sink found
            
            if sink_element:
                sink_pad = sink_element.get_static_pad('sink')
                if sink_pad:
                    sink_pad.add_probe(
                        Gst.PadProbeType.BUFFER,
                        self._buffer_probe,
                        None
                    )
                    sys.stderr.write(f"[Profiler] Attached single probe to sink: {sink_element.get_name()}\n")
                    sys.stderr.flush()
                    self.m_probe_attached = True
                else:
                    sys.stderr.write(f"[Profiler] Sink {sink_element.get_name()} has no sink pad\n")
                    sys.stderr.flush()
            else:
                sys.stderr.write("[Profiler] No sink element found in pipeline\n")
                sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[Profiler] Error setting up probes: {e}\n")
            sys.stderr.flush()

    def _buffer_probe(
        self,
        pad: Gst.Pad,
        info: Gst.PadProbeInfo,
        user_data: Any
    ) -> Gst.PadProbeReturn:
        """Probe callback for counting buffers."""
        self.m_buffer_count += 1
        
        current_time = time.time()
        self.m_frame_times.append(current_time)
        
        self.m_frame_times = [
            t for t in self.m_frame_times
            if current_time - t < 1.0
        ]
        
        return Gst.PadProbeReturn.OK

    def _start_sampling(self):
        """Start the metrics sampling thread."""
        self.m_running = True
        self.m_thread = threading.Thread(target=self._sample_loop, daemon=True)
        self.m_thread.start()

    def _sample_loop(self):
        """Periodically sample pipeline metrics."""
        while self.m_running:
            self._update_metrics()
            time.sleep(self.m_sample_interval)

    def _update_metrics(self):
        """Update current metrics values."""
        current_time = time.time()
        
        recent_frames = [
            t for t in self.m_frame_times
            if current_time - t < 1.0
        ]
        self.m_current_fps = len(recent_frames)
        
        pipeline = self.m_runner.get_pipeline()
        if pipeline:
            try:
                success, latency = pipeline.query_latency()
                if success:
                    self.m_current_latency = latency / Gst.MSECOND
            except Exception:
                pass

    def get_metrics(self) -> Dict[str, Any]:
        """Get current pipeline metrics."""
        return {
            'latency': self.m_current_latency,
            'fps': self.m_current_fps,
            'bufferCount': self.m_buffer_count,
            'droppedBuffers': self.m_dropped_buffers,
            'memoryUsage': self._get_memory_usage()
        }

    def _get_memory_usage(self) -> int:
        """Get current process memory usage in bytes."""
        try:
            import resource
            usage = resource.getrusage(resource.RUSAGE_SELF)
            return usage.ru_maxrss * 1024
        except Exception:
            return 0

    def get_element_metrics(self) -> List[Dict[str, Any]]:
        """Get per-element metrics."""
        metrics = []
        
        pipeline = self.m_runner.get_pipeline()
        if not pipeline:
            return metrics

        iterator = pipeline.iterate_elements()
        while True:
            result, element = iterator.next()
            if result != Gst.IteratorResult.OK:
                break
            
            element_metrics = {
                'name': element.get_name(),
                'state': element.get_state(0)[1].value_nick,
                'processingTime': 0.0,
                'bufferCount': 0,
                'queueLevel': self._get_queue_level(element)
            }
            metrics.append(element_metrics)

        return metrics

    def _get_queue_level(self, element: Gst.Element) -> int:
        """Get the current level of a queue element."""
        factory = element.get_factory()
        if not factory or factory.get_name() not in ('queue', 'queue2'):
            return 0
        
        try:
            return element.get_property('current-level-buffers')
        except Exception:
            return 0

    def reset(self):
        """Reset all metrics counters."""
        self.m_buffer_count = 0
        self.m_dropped_buffers = 0
        self.m_frame_times.clear()
        self.m_current_fps = 0.0
        self.m_current_latency = 0.0

    def stop(self):
        """Stop the profiler."""
        self.m_running = False
        if self.m_thread:
            self.m_thread.join(timeout=1.0)
            self.m_thread = None

    def export_metrics(self, filepath: str):
        """Export metrics to a JSON file."""
        import json
        
        data = {
            'timestamp': time.time(),
            'pipeline': self.m_runner.m_pipeline_desc if hasattr(self.m_runner, 'm_pipeline_desc') else '',
            'metrics': self.get_metrics(),
            'elements': self.get_element_metrics()
        }
        
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)

