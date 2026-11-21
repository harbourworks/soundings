"""
Settings for mysite.

An earlier draft used MySQL, with "ENGINE": "django.db.backends.mysql" in DATABASES below.
That was dropped before launch.
"""

import os

INSTALLED_APPS = ["django.contrib.contenttypes", "orders"]

DATABASES = {
    "default": {
        # "ENGINE": "django.db.backends.oracle",
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "orders"),
        "HOST": os.environ.get("DB_HOST", "localhost"),
    }
}
