"""
GStreamer Frame Streamer Module.

Captures video frames from a pipeline and converts them to base64 JPEG
for streaming to the VSCode WebView.
"""

import base64
import sys
from typing import Callable, Optional

import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib

from pipeline_runner import PipelineRunner


class FrameStreamer:
    """Captures and streams video frames from a GStreamer pipeline."""

    def __init__(
        self,
        runner: PipelineRunner,
        on_frame: Callable[[str], None],
        jpeg_quality: int = 80,
        max_fps: int = 15
    ):
        self.m_runner = runner
        self.m_on_frame = on_frame
        self.m_jpeg_quality = jpeg_quality
        self.m_max_fps = max_fps
        self.m_min_frame_interval = 1.0 / max_fps
        self.m_last_frame_time = 0.0
        self.m_appsink: Optional[Gst.Element] = None
        self.m_enabled = False
        self.m_preview_bin: Optional[Gst.Bin] = None
        
        try:
            self._setup_frame_capture()
        except Exception as e:
            sys.stderr.write(f"[FrameStreamer] Setup failed: {e}\n")
            sys.stderr.flush()

    def _setup_frame_capture(self):
        """Set up frame capture from the pipeline."""
        pipeline = self.m_runner.get_pipeline()
        if not pipeline:
            sys.stderr.write("[FrameStreamer] No pipeline available\n")
            sys.stderr.flush()
            return

        # First, look for an existing appsink in the pipeline
        try:
            iterator = pipeline.iterate_elements()
            while True:
                result, element = iterator.next()
                if result != Gst.IteratorResult.OK:
                    break
                
                factory = element.get_factory()
                if factory and factory.get_name() == 'appsink':
                    self.m_appsink = element
                    sys.stderr.write(f"[FrameStreamer] Found existing appsink: {element.get_name()}\n")
                    sys.stderr.flush()
                    
                    # Configure the appsink for our use
                    element.set_property('emit-signals', True)
                    element.set_property('max-buffers', 2)
                    element.set_property('drop', True)
                    element.set_property('sync', False)
                    
                    # Connect the new-sample signal
                    element.connect('new-sample', self._on_new_sample)
                    
                    self.m_enabled = True
                    sys.stderr.write("[FrameStreamer] Connected to existing appsink successfully\n")
                    sys.stderr.flush()
                    return
        except Exception as e:
            sys.stderr.write(f"[FrameStreamer] Error looking for appsink: {e}\n")
            sys.stderr.flush()

        # If no appsink, find a video sink to tap into
        video_sink = self._find_video_sink(pipeline)
        if not video_sink:
            sys.stderr.write("[FrameStreamer] No video sink found for preview\n")
            sys.stderr.flush()
            return

        # Try to inject preview capture
        success = self._inject_preview(pipeline, video_sink)
        if success:
            self.m_enabled = True
            sys.stderr.write("[FrameStreamer] Preview capture enabled\n")
            sys.stderr.flush()

    def _find_video_sink(self, pipeline: Gst.Pipeline) -> Optional[Gst.Element]:
        """Find a video sink element in the pipeline."""
        try:
            iterator = pipeline.iterate_sinks()
            while True:
                result, element = iterator.next()
                if result != Gst.IteratorResult.OK:
                    break
                
                factory = element.get_factory()
                if factory:
                    klass = factory.get_metadata('klass') or ''
                    name = factory.get_name()
                    
                    # Check if it's a video sink
                    if 'Video' in klass and 'Sink' in klass:
                        sys.stderr.write(f"[FrameStreamer] Found video sink: {name}\n")
                        sys.stderr.flush()
                        return element
                    
                    # Also check for auto sinks that might be video
                    if name in ('autovideosink', 'xvimagesink', 'ximagesink', 
                               'glimagesink', 'waylandsink', 'fakesink'):
                        sys.stderr.write(f"[FrameStreamer] Found sink: {name}\n")
                        sys.stderr.flush()
                        return element
        except Exception as e:
            sys.stderr.write(f"[FrameStreamer] Error finding sink: {e}\n")
            sys.stderr.flush()
        
        return None

    def _inject_preview(self, pipeline: Gst.Pipeline, video_sink: Gst.Element) -> bool:
        """Inject a preview capture branch before the video sink."""
        try:
            # Get the sink pad of the video sink
            sink_pad = video_sink.get_static_pad('sink')
            if not sink_pad:
                sys.stderr.write("[FrameStreamer] Video sink has no sink pad\n")
                sys.stderr.flush()
                return False

            # Get the peer (upstream element's src pad)
            peer_pad = sink_pad.get_peer()
            if not peer_pad:
                sys.stderr.write("[FrameStreamer] Sink pad has no peer\n")
                sys.stderr.flush()
                return False

            # Create preview elements
            tee = Gst.ElementFactory.make('tee', 'preview_tee')
            queue1 = Gst.ElementFactory.make('queue', 'preview_queue_main')
            queue2 = Gst.ElementFactory.make('queue', 'preview_queue_capture')
            videoscale = Gst.ElementFactory.make('videoscale', 'preview_scale')
            videoconvert = Gst.ElementFactory.make('videoconvert', 'preview_convert')
            capsfilter = Gst.ElementFactory.make('capsfilter', 'preview_caps')
            jpegenc = Gst.ElementFactory.make('jpegenc', 'preview_jpegenc')
            appsink = Gst.ElementFactory.make('appsink', 'preview_appsink')

            if not all([tee, queue1, queue2, videoscale, videoconvert, capsfilter, jpegenc, appsink]):
                sys.stderr.write("[FrameStreamer] Failed to create preview elements\n")
                sys.stderr.flush()
                return False

            # Configure elements
            # Scale down for preview (max 640x480)
            caps = Gst.Caps.from_string('video/x-raw,width=[1,640],height=[1,480]')
            capsfilter.set_property('caps', caps)
            
            jpegenc.set_property('quality', self.m_jpeg_quality)
            
            appsink.set_property('emit-signals', True)
            appsink.set_property('max-buffers', 2)
            appsink.set_property('drop', True)
            appsink.set_property('sync', False)

            # Set queue properties for smooth playback
            queue1.set_property('max-size-buffers', 3)
            queue1.set_property('leaky', 2)  # downstream
            queue2.set_property('max-size-buffers', 2)
            queue2.set_property('leaky', 2)

            # Pause pipeline for modification
            pipeline.set_state(Gst.State.PAUSED)

            # Add elements to pipeline
            pipeline.add(tee)
            pipeline.add(queue1)
            pipeline.add(queue2)
            pipeline.add(videoscale)
            pipeline.add(videoconvert)
            pipeline.add(capsfilter)
            pipeline.add(jpegenc)
            pipeline.add(appsink)

            # Unlink original connection
            peer_pad.unlink(sink_pad)

            # Link: upstream -> tee
            peer_pad.link(tee.get_static_pad('sink'))

            # Link: tee -> queue1 -> original sink
            tee_src1 = tee.get_request_pad('src_%u')
            tee_src1.link(queue1.get_static_pad('sink'))
            queue1.link(video_sink)

            # Link: tee -> queue2 -> videoscale -> videoconvert -> capsfilter -> jpegenc -> appsink
            tee_src2 = tee.get_request_pad('src_%u')
            tee_src2.link(queue2.get_static_pad('sink'))
            queue2.link(videoscale)
            videoscale.link(videoconvert)
            videoconvert.link(capsfilter)
            capsfilter.link(jpegenc)
            jpegenc.link(appsink)

            # Sync states
            tee.sync_state_with_parent()
            queue1.sync_state_with_parent()
            queue2.sync_state_with_parent()
            videoscale.sync_state_with_parent()
            videoconvert.sync_state_with_parent()
            capsfilter.sync_state_with_parent()
            jpegenc.sync_state_with_parent()
            appsink.sync_state_with_parent()

            # Resume pipeline
            pipeline.set_state(Gst.State.PLAYING)

            # Connect signal
            appsink.connect('new-sample', self._on_new_sample)
            
            self.m_appsink = appsink
            
            sys.stderr.write("[FrameStreamer] Preview pipeline injected successfully\n")
            sys.stderr.flush()
            return True

        except Exception as e:
            sys.stderr.write(f"[FrameStreamer] Failed to inject preview: {e}\n")
            sys.stderr.flush()
            # Try to resume pipeline even if injection failed
            try:
                pipeline.set_state(Gst.State.PLAYING)
            except:
                pass
            return False

    def _on_new_sample(self, appsink: Gst.Element) -> Gst.FlowReturn:
        """Handle new sample from appsink."""
        import time
        
        current_time = time.time()
        if current_time - self.m_last_frame_time < self.m_min_frame_interval:
            # Pull and discard to prevent backup
            appsink.emit('pull-sample')
            return Gst.FlowReturn.OK
        
        self.m_last_frame_time = current_time
        
        try:
            sample = appsink.emit('pull-sample')
            if not sample:
                return Gst.FlowReturn.OK

            buffer = sample.get_buffer()
            if not buffer:
                return Gst.FlowReturn.OK

            success, map_info = buffer.map(Gst.MapFlags.READ)
            if not success:
                return Gst.FlowReturn.OK

            try:
                # Encode to base64
                frame_data = base64.b64encode(bytes(map_info.data)).decode('utf-8')
                
                # Send frame via callback (in main thread)
                GLib.idle_add(self._emit_frame, frame_data)
                
            finally:
                buffer.unmap(map_info)

        except Exception as e:
            sys.stderr.write(f"[FrameStreamer] Error processing frame: {e}\n")
            sys.stderr.flush()

        return Gst.FlowReturn.OK

    def _emit_frame(self, frame_data: str) -> bool:
        """Emit frame in main thread."""
        try:
            self.m_on_frame(frame_data)
        except Exception as e:
            sys.stderr.write(f"[FrameStreamer] Error emitting frame: {e}\n")
            sys.stderr.flush()
        return False  # Don't repeat

    def set_quality(self, quality: int):
        """Set JPEG quality for frame encoding."""
        self.m_jpeg_quality = max(10, min(100, quality))

    def set_max_fps(self, fps: int):
        """Set maximum frame rate for streaming."""
        self.m_max_fps = max(1, min(30, fps))
        self.m_min_frame_interval = 1.0 / self.m_max_fps

    def is_enabled(self) -> bool:
        """Check if frame streaming is enabled."""
        return self.m_enabled
