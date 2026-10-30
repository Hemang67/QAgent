import { Link } from 'react-router-dom';

// A link to a page that does not exist and a missing image (Broken links must fail it)
export default function Links() {
  return (
    <section>
      <h1>Links</h1>
      <p>
        <Link to="/dashboard">Dashboard</Link> <Link to="/no-such-page">Old report</Link>
      </p>
      <img src="/missing-logo.png" alt="Company logo" width="40" height="40" />
    </section>
  );
}
