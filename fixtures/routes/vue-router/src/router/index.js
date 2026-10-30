import { createRouter, createWebHistory } from 'vue-router';
import Home from '../views/Home.vue';
export const PATHS = { orders: '/orders' };
export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: PATHS.orders, component: () => import('../views/Orders.vue'), children: [{ path: ':id', component: () => import('../views/OrderDetail.vue') }] },
    { path: '/settings', component: () => import('../views/Settings.vue'), children: [{ path: '', component: () => import('../views/SettingsHome.vue') }, { path: 'profile', component: () => import('../views/Profile.vue') }] },
    { path: '/old', redirect: '/orders' },
    { path: '/:pathMatch(.*)*', component: () => import('../views/NotFound.vue') },
  ],
});
