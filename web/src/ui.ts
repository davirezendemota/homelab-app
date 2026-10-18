// Classes finais (já resolvidas pelo tailwind-merge) que os componentes shadcn/base-ui
// geravam na v2. Copiadas do DOM renderizado para manter o visual idêntico.

const BTN_CORE =
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center bg-clip-padding font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0";

export const BTN_GHOST_ICON_SM = `${BTN_CORE} border border-transparent text-sm [&_svg:not([class*='size-'])]:size-4 hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50 size-7 rounded-[min(var(--radius-md),12px)]`;

export const BTN_DEFAULT = `${BTN_CORE} rounded-lg border border-transparent text-sm [&_svg:not([class*='size-'])]:size-4 bg-primary text-primary-foreground hover:bg-primary/80 h-8 gap-1.5 px-2.5`;

export const BTN_OUTLINE = `${BTN_CORE} rounded-lg border text-sm [&_svg:not([class*='size-'])]:size-4 border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 h-8 gap-1.5 px-2.5`;

const SM = "h-7 gap-1 px-2.5 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5";

export const BTN_SORT = `${BTN_CORE} border border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 ${SM} sort-btn rounded-full`;
export const BTN_SORT_ACTIVE = `${BTN_CORE} border border-transparent bg-primary text-primary-foreground hover:bg-primary/80 ${SM} sort-btn rounded-full active`;

export const TOGGLE_HIDDEN =
  "group/toggle inline-flex cursor-pointer items-center justify-center gap-1 font-medium whitespace-nowrap transition-all outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:bg-muted data-[state=on]:bg-muted [&_svg]:pointer-events-none [&_svg]:shrink-0 border border-input bg-transparent hover:bg-muted min-w-7 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5 hidden-show-toggle size-9 rounded-full p-0";

export const INPUT =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

export const LABEL =
  "flex items-center gap-2 text-sm leading-none font-medium select-none";

export const CHECKBOX =
  "peer relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-input transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary";
export const CHECKBOX_INDICATOR = "grid place-content-center text-current transition-none [&>svg]:size-3.5";

export const BADGE_OUTLINE =
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3! border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground";

export const PROJECT_CARD =
  "group/card flex flex-col overflow-hidden rounded-xl bg-card text-sm text-card-foreground ring-foreground/10 [--card-spacing:--spacing(4)] project-card max-w-[280px] min-w-0 w-full gap-0 border border-border py-0 shadow-none ring-0";
export const PROJECT_CARD_HEAD =
  "group/card-header @container/card-header grid auto-rows-min rounded-t-xl [.border-b]:pb-(--card-spacing) project-card-head flex-row items-center gap-2 space-y-0 border-b px-4 py-3";

export const MENU_CONTENT =
  "z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95";
export const MENU_ITEM =
  "group/dropdown-menu-item relative flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive";

export const DIALOG_OVERLAY =
  "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0";
export const DIALOG_CONTENT =
  "fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 flex max-h-[min(82vh,760px)] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl";
export const DIALOG_HEADER = "flex flex-col gap-2 border-b px-6 py-4";
export const DIALOG_TITLE = "font-heading text-base leading-none font-medium";
export const DIALOG_DESCRIPTION =
  "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground";
export const DIALOG_FOOTER =
  "flex flex-col-reverse rounded-b-xl border-t p-4 sm:justify-end project-editor-footer shrink-0 !m-0 gap-3 bg-card sm:flex-row";
export const DIALOG_CLOSE = `${BTN_GHOST_ICON_SM} absolute top-2 right-2`;

export const SELECT_TRIGGER =
  "flex cursor-pointer items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-0 pr-8 pl-2.5 leading-none text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-8 dark:bg-input/30 dark:hover:bg-input/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 w-full";

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
