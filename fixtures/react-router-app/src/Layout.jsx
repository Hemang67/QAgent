import { Link, Navigate, Outlet } from 'react-router-dom';
import { ROUTES } from './routes';

export default function Layout() {
  if (!localStorage.getItem('token')) return <Navigate to={ROUTES.login} replace />;
  return (
    <div>
      <nav>
        <Link to={ROUTES.dashboard}>Dashboard</Link> <Link to={ROUTES.orders}>Orders</Link> <Link to={ROUTES.search}>Search</Link>{' '}
        <Link to="/settings/profile">Profile</Link> <Link to={ROUTES.logout}>Log out</Link>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
