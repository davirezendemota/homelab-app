// Dropdown ancorado num botão — substitui o DropdownMenu do base-ui com o mesmo markup/classe.
import { MENU_CONTENT } from "./ui";

type OpenMenu = { id: string; trigger: HTMLElement; root: HTMLElement; content: HTMLElement; onClose: () => void };

let current: OpenMenu | null = null;

export function openMenuId(): string | null {
  return current?.id ?? null;
}

function position(m: OpenMenu, sideOffset: number) {
  const r = m.trigger.getBoundingClientRect();
  m.root.style.setProperty("--anchor-width", `${r.width}px`);
  const width = m.content.offsetWidth;
  const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
  m.root.style.left = `${left}px`;
  m.root.style.top = `${r.bottom + sideOffset}px`;
}

export function openMenu(opts: {
  id: string;
  trigger: HTMLElement;
  html: string;
  className?: string;
  sideOffset?: number;
  onClose: () => void;
}): HTMLElement {
  closeMenu();
  const root = document.createElement("div");
  root.className = "isolate z-50 outline-none";
  root.style.position = "fixed";
  root.style.top = "0";
  root.style.left = "0";
  root.innerHTML = `<div role="menu" tabindex="-1" data-slot="dropdown-menu-content" data-open data-side="bottom" data-align="end" class="${MENU_CONTENT}${opts.className ? " " + opts.className : ""}">${opts.html}</div>`;
  document.body.appendChild(root);
  const content = root.firstElementChild as HTMLElement;
  current = { id: opts.id, trigger: opts.trigger, root, content, onClose: opts.onClose };
  position(current, opts.sideOffset ?? 4);
  return content;
}

export function setMenuHtml(id: string, html: string) {
  if (current?.id === id) current.content.innerHTML = html;
}

export function closeMenu(): boolean {
  if (!current) return false;
  const m = current;
  current = null;
  m.root.remove();
  m.onClose();
  return true;
}

document.addEventListener(
  "pointerdown",
  (e) => {
    if (!current) return;
    const t = e.target as Node;
    if (current.root.contains(t) || current.trigger.contains(t)) return;
    closeMenu();
  },
  true,
);
window.addEventListener("resize", () => closeMenu());
window.addEventListener(
  "scroll",
  (e) => {
    if (current && !current.root.contains(e.target as Node)) closeMenu();
  },
  true,
);
