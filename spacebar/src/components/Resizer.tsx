export function Resizer({ dir, onDrag }: { dir: "x" | "y"; onDrag: (dx: number, dy: number) => void }) {
  const down = (e: React.MouseEvent) => {
    e.preventDefault();
    let x = e.clientX, y = e.clientY;
    const move = (ev: MouseEvent) => { onDrag(ev.clientX - x, ev.clientY - y); x = ev.clientX; y = ev.clientY; };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.classList.remove("resizing", "resizing-y"); };
    document.body.classList.add(dir === "x" ? "resizing" : "resizing-y");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return <div className={`resizer resizer-${dir}`} onMouseDown={down} />;
}
