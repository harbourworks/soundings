from django.db import models


class Order(models.Model):
    email = models.EmailField()
    total = models.DecimalField(max_digits=8, decimal_places=2)
