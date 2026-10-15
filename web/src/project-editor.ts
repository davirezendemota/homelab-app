// Diálogo de criar/editar projeto — porta de ProjectEditorModal (DashboardProjects.tsx, v2).
import * as I from "./icons";
import * as UI from "./ui";
import { esc } from "./ui";
import { checkbox, environmentLabel } from "./render";
import type { Project, ProjectEnvironment } from "./types";

const ENVIRONMENTS: ProjectEnvironment[] = ["dev", "homolog", "producao"];

let root: HTMLElement | null = null;

export function isEditorOpen() {
  return root !== null;
}

export function closeEditor() {
  root?.remove();
  root = null;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? "HTTP " + res.status;
  } catch {
    return "HTTP " + res.status;
  }
}

export function openEditor(opts: {
  project: Project | null;
  allContainerNames: string[];
  onSaved: (p: Project) => void;
}) {
  closeEditor();
  const { project, allContainerNames } = opts;
  const selected = new Set(project?.containers ?? []);
  let filter = "";
  let saving = false;

  root = document.createElement("div");
  root.setAttribute("data-slot", "dialog-portal");
  root.innerHTML = `<div data-slot="dialog-overlay" data-open class="${UI.DIALOG_OVERLAY}"></div>`
    + `<div role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" data-slot="dialog-content" data-open class="${UI.DIALOG_CONTENT}">`
    + `<div data-slot="dialog-header" class="${UI.DIALOG_HEADER}"><h2 id="project-dialog-title" data-slot="dialog-title" class="${UI.DIALOG_TITLE}">${project ? "Editar projeto" : "Novo projeto"}</h2>`
    + `<p data-slot="dialog-description" class="${UI.DIALOG_DESCRIPTION}">Projeto</p></div>`
    + `<form class="project-editor-form flex min-h-0 flex-1 flex-col" novalidate><div class="modal-body project-editor-body overflow-y-auto">`
    + `<div class="project-editor-error" data-error hidden></div>`
    + `<div class="project-field"><label data-slot="label" class="${UI.LABEL}" for="project-name">Nome</label>`
    + `<input id="project-name" data-slot="input" class="${UI.INPUT}" placeholder="Ex.: Produção, Lab, Mídia…" required value="${esc(project?.name ?? "")}"></div>`
    + `<div class="project-field"><label data-slot="label" class="${UI.LABEL}" for="project-access-url">Link de acesso</label>`
    + `<input id="project-access-url" data-slot="input" class="${UI.INPUT}" placeholder="https://…" type="url" inputmode="url" autocomplete="url" value="${esc(project?.accessUrl ?? "")}"></div>`
    + `<div class="project-field"><label data-slot="label" class="${UI.LABEL}" for="project-environment">Ambiente</label>`
    + `<div class="relative"><select id="project-environment" data-slot="select-trigger" class="${UI.SELECT_TRIGGER} appearance-none">`
    + ENVIRONMENTS.map((env) => `<option value="${env}"${(project?.environment ?? "dev") === env ? " selected" : ""}>${environmentLabel(env)}</option>`).join("")
    + `</select><span class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">${I.SELECT_CHEVRON}</span></div></div>`
    + `<div class="project-field project-field-containers"><label data-slot="label" class="${UI.LABEL}">Containers</label>`
    + `<div class="search-wrap project-picker-search relative">${I.SEARCH}<input data-filter data-slot="input" class="${UI.INPUT} pl-9" placeholder="Filtrar containers…" type="search"></div>`
    + `<div class="project-picker-list" data-picker></div></div></div>`
    + `<div data-slot="dialog-footer" class="${UI.DIALOG_FOOTER}">`
    + `<button type="button" data-slot="button" data-cancel class="${UI.BTN_OUTLINE}">Cancelar</button>`
    + `<button type="submit" data-slot="button" data-submit class="${UI.BTN_DEFAULT}">Salvar</button></div></form>`
    + `<button type="button" data-slot="dialog-close" data-cancel class="${UI.DIALOG_CLOSE}">${I.X}<span class="sr-only">Close</span></button></div>`;
  document.body.appendChild(root);

  const q = <T extends Element>(sel: string) => root!.querySelector(sel) as T;
  const nameInput = q<HTMLInputElement>("#project-name");
  const urlInput = q<HTMLInputElement>("#project-access-url");
  const envSelect = q<HTMLSelectElement>("#project-environment");
  const picker = q<HTMLElement>("[data-picker]");
  const submit = q<HTMLButtonElement>("[data-submit]");
  const cancel = root.querySelectorAll<HTMLButtonElement>("[data-cancel]")[0]!;
  const errorBox = q<HTMLElement>("[data-error]");

  const renderPicker = () => {
    const f = filter.trim().toLowerCase();
    const names = allContainerNames.filter((n) => !f || n.toLowerCase().includes(f));
    picker.innerHTML = names.length === 0
      ? `<p class="project-picker-empty">Nenhum container.</p>`
      : names.map((n) => `<label class="settings-option project-picker-item flex cursor-pointer" data-pick="${esc(n)}">${checkbox(`pick-${esc(n)}`, selected.has(n))}<span class="settings-option-text"><span class="settings-option-label">${esc(n)}</span></span></label>`).join("");
  };
  const syncSubmit = () => {
    submit.disabled = saving || !nameInput.value.trim();
    cancel.disabled = saving;
    submit.textContent = saving ? "Salvando…" : "Salvar";
  };

  renderPicker();
  syncSubmit();
  nameInput.focus();

  nameInput.addEventListener("input", syncSubmit);
  q<HTMLInputElement>("[data-filter]").addEventListener("input", (e) => {
    filter = (e.target as HTMLInputElement).value;
    renderPicker();
  });
  picker.addEventListener("click", (e) => {
    const item = (e.target as Element).closest<HTMLElement>("[data-pick]");
    if (!item) return;
    e.preventDefault();
    const n = item.dataset.pick!;
    if (selected.has(n)) selected.delete(n);
    else selected.add(n);
    renderPicker();
  });
  root.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", closeEditor));
  q<HTMLElement>('[data-slot="dialog-overlay"]').addEventListener("click", closeEditor);

  q<HTMLFormElement>("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!nameInput.value.trim()) return;
    saving = true;
    syncSubmit();
    errorBox.hidden = true;
    const name = nameInput.value;
    const accessUrl = urlInput.value;
    const environment = envSelect.value;
    const containers = allContainerNames.filter((n) => selected.has(n));
    try {
      let id = project?.id;
      if (!id) {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, environment }),
        });
        if (!res.ok) throw new Error(await readError(res));
        id = ((await res.json()) as Project).id;
      }
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, accessUrl, environment, containers }),
      });
      if (!res.ok) throw new Error(await readError(res));
      opts.onSaved((await res.json()) as Project);
      closeEditor();
    } catch (err) {
      errorBox.textContent = err instanceof Error ? err.message : String(err);
      errorBox.hidden = false;
      saving = false;
      syncSubmit();
    }
  });
}
