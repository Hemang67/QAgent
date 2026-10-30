// A fixed-width panel: fine on a desktop, scrolls sideways on a phone (Responsive must fail it)
export default function Wide() {
  return (
    <section>
      <h1>Wide</h1>
      <div style={{ width: 1200, padding: 8, border: '1px solid #ccc' }}>A 1200px wide panel</div>
    </section>
  );
}
