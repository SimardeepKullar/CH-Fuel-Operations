// The Industry design system's blueprint registration marks. They are hidden
// by default (`--corner-display: none` in App.css) — flip that token to
// `block` to turn the wireframe crosshairs on across the whole app.
export default function Corners() {
  return (
    <>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
    </>
  );
}
