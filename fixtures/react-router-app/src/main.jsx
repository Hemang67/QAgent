import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter, Navigate } from 'react-router-dom';
import { ROUTES } from './routes';
import './index.css';
import Layout from './Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Customer from './pages/Customer';
import Search from './pages/Search';
import Audit from './pages/Audit';
import Profile from './pages/Profile';
import Logout from './pages/Logout';
import Wide from './pages/Wide';
import Links from './pages/Links';
import Slow from './pages/Slow';
import Colors from './pages/Colors';
import Sec from './pages/Sec';
import Guestbook from './pages/Guestbook';

// Lazy pages exercise the adapter's dynamic-import resolution
const Reports = React.lazy(() => import('./pages/Reports'));
const Crash = React.lazy(() => import('./pages/Crash'));
const Stuck = React.lazy(() => import('./pages/Stuck'));
const Hang = React.lazy(() => import('./pages/Hang'));

const router = createBrowserRouter([
  { path: ROUTES.login, element: <Login /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to={ROUTES.dashboard} replace /> },
      { path: ROUTES.dashboard, element: <Dashboard /> },
      { path: ROUTES.orders, element: <Orders /> },
      { path: `${ROUTES.orders}/:orderId`, element: <OrderDetail /> },
      { path: ROUTES.customer, element: <Customer /> },
      { path: ROUTES.reports, element: <Reports /> },
      { path: ROUTES.crash, element: <Crash /> },
      { path: ROUTES.stuck, element: <Stuck /> },
      { path: ROUTES.hang, element: <Hang /> },
      { path: ROUTES.search, element: <Search /> },
      { path: ROUTES.audit, element: <Audit /> },
      // No permission: sends the user home
      { path: ROUTES.admin, element: <Navigate to={ROUTES.dashboard} replace /> },
      {
        path: 'settings',
        children: [{ path: 'profile', element: <Profile /> }],
      },
      { path: ROUTES.logout, element: <Logout /> },
      { path: ROUTES.wide, element: <Wide /> },
      { path: ROUTES.links, element: <Links /> },
      { path: ROUTES.slow, element: <Slow /> },
      { path: ROUTES.colors, element: <Colors /> },
      { path: ROUTES.sec, element: <Sec /> },
      { path: ROUTES.guestbook, element: <Guestbook /> },
    ],
  },
  { path: '*', element: <h1>Not found</h1> },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.Suspense fallback={<div className="spinner">Loading…</div>}>
    <RouterProvider router={router} />
  </React.Suspense>,
);
