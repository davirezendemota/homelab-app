// SVGs inline — os mesmos da v2 (DashboardLive.tsx e lucide-react na versão usada).

const stroke18 = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;

export const PLAY = `<svg ${stroke18}><polygon points="6 4 20 12 6 20 6 4"/></svg>`;
export const STOP = `<svg ${stroke18}><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`;
export const RESTART = `<svg ${stroke18}><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`;
export const TRASH = `<svg ${stroke18}><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
export const STAR = `<svg ${stroke18}><path d="m12 3.5 2.7 5.5 6 .9-4.4 4.2 1 5.9L12 17.2 6.7 20l1-5.9L3.4 9.9l6-.9z"/></svg>`;
export const HIDE = `<svg ${stroke18}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
export const LOGS = `<svg ${stroke18}><path d="M8 6h8M8 10h8M8 14h5"/><rect x="4" y="3" width="16" height="18" rx="2"/></svg>`;
export const CHEVRON_DOWN = `<svg ${stroke18}><path d="m6 9 6 6 6-6"/></svg>`;
export const CHEVRON_UP = `<svg ${stroke18}><path d="m18 15-6-6-6 6"/></svg>`;
export const EXPAND = `<svg ${stroke18}><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="M9 21H3v-6"/><path d="m3 21 7-7"/></svg>`;
export const COPY = `<svg ${stroke18}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
export const CHECK_STROKE = `<svg ${stroke18}><path d="M20 6 9 17l-5-5"/></svg>`;

function lucide(name: string, cls: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-${name} ${cls}" aria-hidden="true">${body}</svg>`;
}

export const MAXIMIZE = lucide("maximize-2", "fullscreen-enter-icon size-4", `<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>`);
export const MINIMIZE = lucide("minimize-2", "fullscreen-exit-icon hidden size-4", `<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>`);
export const SETTINGS = lucide("settings", "size-4", `<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>`);
export const PLUS = lucide("plus", "size-4", `<path d="M5 12h14"/><path d="M12 5v14"/>`);
export const ELLIPSIS = lucide("ellipsis", "size-4", `<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>`);
export const SEARCH = lucide("search", "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground", `<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>`);
export const LAYOUT_PANEL_LEFT = lucide("layout-panel-left", "size-4", `<rect width="7" height="18" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/>`);
export const EYE_OFF = lucide("eye-off", "size-4", `<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>`);
export const CHECK = lucide("check", "", `<path d="M20 6 9 17l-5-5"/>`);
export const SELECT_CHEVRON = lucide("chevron-down", "pointer-events-none size-4 text-muted-foreground", `<path d="m6 9 6 6 6-6"/>`);
export const X = lucide("x", "", `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`);

export const GITHUB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.09.28-2.26 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>`;
