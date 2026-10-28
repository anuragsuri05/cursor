import { useStore } from "../lib/store";
import { Icon } from "./small";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind ?? ""}`}>
          <Icon name={t.kind === "error" ? "error" : "info"} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
