// Throws while rendering: React Router shows its error screen
export default function Crash() {
  const items = undefined;
  return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
}
