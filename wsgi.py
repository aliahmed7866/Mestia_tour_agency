"""WSGI entry point for PythonAnywhere and other managed WSGI servers.

The hosting platform supplies the request scheme. Do not add ProxyFix or trust
arbitrary forwarded headers here. Configure HTTPS in the hosting dashboard.
"""
from mestia import create_app

application = create_app()
