import Link from 'next/link';
import './globals.css';

export const metadata = { title: 'Fixture: Next.js' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/dashboard">Dashboard</Link> <Link href="/about">About</Link> <Link href="/legacy">Legacy</Link>{' '}
          <Link href="/logout">Log out</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
