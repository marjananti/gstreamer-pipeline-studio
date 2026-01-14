"""
GStreamer Element Inspector Module.

Provides functionality to discover and inspect GStreamer elements,
their properties, and pad templates.
"""

from typing import List, Dict, Any, Optional

import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GObject


class ElementInspector:
    """Inspects GStreamer elements and their properties."""

    def __init__(self):
        self.m_registry = Gst.Registry.get()

    def list_elements(self) -> List[str]:
        """List all available GStreamer element factory names."""
        elements = []
        
        plugins = self.m_registry.get_plugin_list()
        for plugin in plugins:
            features = self.m_registry.get_feature_list_by_plugin(plugin.get_name())
            for feature in features:
                if isinstance(feature, Gst.ElementFactory):
                    elements.append(feature.get_name())
        
        return sorted(set(elements))

    def inspect_element(self, element_name: str) -> Dict[str, Any]:
        """Inspect a specific element and return its details."""
        factory = Gst.ElementFactory.find(element_name)
        if not factory:
            raise ValueError(f"Element not found: {element_name}")

        element = factory.create(None)
        if not element:
            raise ValueError(f"Could not create element: {element_name}")

        return {
            'name': factory.get_name(),
            'longName': factory.get_metadata('long-name') or factory.get_name(),
            'description': factory.get_metadata('description') or '',
            'klass': factory.get_metadata('klass') or '',
            'author': factory.get_metadata('author') or '',
            'padTemplates': self._get_pad_templates(factory),
            'properties': self._get_properties(element)
        }

    def _get_pad_templates(self, factory: Gst.ElementFactory) -> List[Dict[str, Any]]:
        """Get pad templates for an element factory."""
        templates = []
        
        for template in factory.get_static_pad_templates():
            direction = 'src' if template.direction == Gst.PadDirection.SRC else 'sink'
            
            presence_map = {
                Gst.PadPresence.ALWAYS: 'always',
                Gst.PadPresence.SOMETIMES: 'sometimes',
                Gst.PadPresence.REQUEST: 'request'
            }
            presence = presence_map.get(template.presence, 'always')
            
            caps_str = template.get_caps().to_string() if template.get_caps() else 'ANY'
            
            templates.append({
                'name': template.name_template,
                'direction': direction,
                'presence': presence,
                'caps': caps_str
            })
        
        return templates

    def _get_properties(self, element: Gst.Element) -> List[Dict[str, Any]]:
        """Get properties for an element instance."""
        properties = []
        
        for prop in GObject.list_properties(type(element)):
            if prop.name in ('name', 'parent'):
                continue
            
            prop_info = {
                'name': prop.name,
                'type': self._get_type_name(prop.value_type),
                'description': prop.blurb or '',
                'defaultValue': self._get_default_value(prop),
                'readable': bool(prop.flags & GObject.ParamFlags.READABLE),
                'writable': bool(prop.flags & GObject.ParamFlags.WRITABLE)
            }
            
            if prop.value_type.is_a(GObject.TYPE_ENUM):
                prop_info['enumValues'] = self._get_enum_values(prop.value_type)
            
            if hasattr(prop, 'minimum') and hasattr(prop, 'maximum'):
                prop_info['min'] = prop.minimum
                prop_info['max'] = prop.maximum
            
            properties.append(prop_info)
        
        return properties

    def _get_type_name(self, value_type: GObject.GType) -> str:
        """Get a simple type name for a GType."""
        type_name = value_type.name
        
        type_map = {
            'gchararray': 'gchararray',
            'gboolean': 'gboolean',
            'gint': 'gint',
            'guint': 'guint',
            'gint64': 'gint64',
            'guint64': 'guint64',
            'gfloat': 'gfloat',
            'gdouble': 'gdouble',
        }
        
        return type_map.get(type_name, type_name)

    def _get_default_value(self, prop: GObject.ParamSpec) -> str:
        """Get the default value for a property."""
        try:
            if hasattr(prop, 'default_value'):
                return str(prop.default_value)
        except Exception:
            pass
        return ''

    def _get_enum_values(self, value_type: GObject.GType) -> List[Dict[str, Any]]:
        """Get enum values for an enum type."""
        enum_values = []
        
        try:
            enum_class = value_type.pytype
            if hasattr(enum_class, '__enum_values__'):
                for value in enum_class.__enum_values__.values():
                    enum_values.append({
                        'name': value.value_nick,
                        'value': int(value)
                    })
        except Exception:
            pass
        
        return enum_values

    def validate_pipeline(self, pipeline_desc: str) -> Dict[str, Any]:
        """Validate a pipeline description."""
        errors = []
        warnings = []

        try:
            pipeline = Gst.parse_launch(pipeline_desc)
            
            ret = pipeline.set_state(Gst.State.READY)
            if ret == Gst.StateChangeReturn.FAILURE:
                errors.append({
                    'elementId': '',
                    'message': 'Pipeline failed to reach READY state',
                    'type': 'connection_missing'
                })
            
            pipeline.set_state(Gst.State.NULL)
            
        except GObject.GError as e:
            errors.append({
                'elementId': '',
                'message': str(e),
                'type': 'element_not_found'
            })

        return {
            'valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings
        }


