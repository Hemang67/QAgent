// A loader that never goes away
export default function Stuck() {
  return (
    <section>
      <h1>Stuck</h1>
      <div className="spinner" />
    </section>
  );
}
