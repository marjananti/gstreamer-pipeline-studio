"""
GStreamer Debug Tracer Module.

Captures and parses GST_DEBUG output for display in the VSCode extension.
"""

import re
import sys
import threading
from typing import Callable, Optional, List, Dict, Any
from dataclasses import dataclass
from enum import IntEnum

import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst


class DebugLevel(IntEnum):
    """GStreamer debug levels."""
    NONE = 0
    ERROR = 1
    WARNING = 2
    FIXME = 3
    INFO = 4
    DEBUG = 5
    LOG = 6
    TRACE = 7


@dataclass
class DebugMessage:
    """Represents a parsed GStreamer debug message."""
    timestamp: float
    level: int
    category: str
    element: str
    message: str


class DebugTracer:
    """Traces and parses GStreamer debug output."""

    DEBUG_PATTERN = re.compile(
        r'^(\d+:\d+:\d+\.\d+)\s+'
        r'(\d+)\s+'
        r'(\S+)\s+'
        r'(\S+)\s+'
        r'(.+)$'
    )

    def __init__(self, on_message: Optional[Callable[[Dict[str, Any]], None]] = None):
        self.m_on_message = on_message
        self.m_messages: List[DebugMessage] = []
        self.m_max_messages = 1000
        self.m_enabled = False

    def enable(self):
        """Enable debug tracing."""
        self.m_enabled = True
        Gst.debug_set_active(True)

    def disable(self):
        """Disable debug tracing."""
        self.m_enabled = False
        Gst.debug_set_active(False)

    def set_level(self, level: int):
        """Set the debug level."""
        Gst.debug_set_default_threshold(Gst.DebugLevel(level))

    def set_category_level(self, category: str, level: int):
        """Set debug level for a specific category."""
        Gst.debug_set_threshold_for_name(category, Gst.DebugLevel(level))

    def parse_line(self, line: str) -> Optional[DebugMessage]:
        """Parse a GST_DEBUG output line."""
        match = self.DEBUG_PATTERN.match(line.strip())
        if not match:
            return None

        timestamp_str, level_str, category, element, message = match.groups()
        
        try:
            parts = timestamp_str.split(':')
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = float(parts[2])
            timestamp = hours * 3600 + minutes * 60 + seconds
        except (ValueError, IndexError):
            timestamp = 0.0

        try:
            level = int(level_str)
        except ValueError:
            level = 0

        return DebugMessage(
            timestamp=timestamp,
            level=level,
            category=category,
            element=element,
            message=message
        )

    def add_message(self, message: DebugMessage):
        """Add a debug message to the buffer."""
        self.m_messages.append(message)
        
        if len(self.m_messages) > self.m_max_messages:
            self.m_messages = self.m_messages[-self.m_max_messages:]
        
        if self.m_on_message:
            self.m_on_message({
                'timestamp': message.timestamp,
                'level': message.level,
                'category': message.category,
                'element': message.element,
                'message': message.message
            })

    def get_messages(
        self,
        level: Optional[int] = None,
        category: Optional[str] = None,
        element: Optional[str] = None
    ) -> List[DebugMessage]:
        """Get filtered debug messages."""
        result = self.m_messages
        
        if level is not None:
            result = [m for m in result if m.level <= level]
        
        if category:
            result = [m for m in result if category.lower() in m.category.lower()]
        
        if element:
            result = [m for m in result if element.lower() in m.element.lower()]
        
        return result

    def clear(self):
        """Clear all stored messages."""
        self.m_messages.clear()

    def get_level_name(self, level: int) -> str:
        """Get the name for a debug level."""
        names = {
            0: 'NONE',
            1: 'ERROR',
            2: 'WARNING',
            3: 'FIXME',
            4: 'INFO',
            5: 'DEBUG',
            6: 'LOG',
            7: 'TRACE'
        }
        return names.get(level, 'UNKNOWN')


class StderrCapture:
    """Captures stderr output for parsing GStreamer debug messages."""

    def __init__(self, tracer: DebugTracer):
        self.m_tracer = tracer
        self.m_original_stderr = None
        self.m_capture_thread: Optional[threading.Thread] = None
        self.m_running = False

    def start(self):
        """Start capturing stderr."""
        import os
        import io
        
        self.m_running = True
        
        read_fd, write_fd = os.pipe()
        
        self.m_original_stderr = os.dup(sys.stderr.fileno())
        os.dup2(write_fd, sys.stderr.fileno())
        os.close(write_fd)
        
        self.m_capture_thread = threading.Thread(
            target=self._capture_loop,
            args=(read_fd,),
            daemon=True
        )
        self.m_capture_thread.start()

    def stop(self):
        """Stop capturing stderr."""
        import os
        
        self.m_running = False
        
        if self.m_original_stderr is not None:
            os.dup2(self.m_original_stderr, sys.stderr.fileno())
            os.close(self.m_original_stderr)
            self.m_original_stderr = None

    def _capture_loop(self, read_fd: int):
        """Read from the captured stderr pipe."""
        import os
        
        buffer = ''
        
        while self.m_running:
            try:
                data = os.read(read_fd, 4096)
                if not data:
                    break
                
                buffer += data.decode('utf-8', errors='replace')
                
                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    message = self.m_tracer.parse_line(line)
                    if message:
                        self.m_tracer.add_message(message)
                    
                    if self.m_original_stderr:
                        import os
                        os.write(self.m_original_stderr, (line + '\n').encode())
                        
            except OSError:
                break
        
        os.close(read_fd)


