from django.urls import path, re_path
from . import views
urlpatterns = [
    path('', views.home, name='home'),
    path('orders/', views.order_list),
    path('orders/<int:pk>/', views.order_detail),
    re_path(r'^legacy/$', views.legacy),
    re_path(r'^archive/(?P<year>[0-9]{4})/$', views.archive),
]
