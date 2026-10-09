"use client";

import { useCallback, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Selector de planillas de Google (034).
 *
 * Con `drive.file`, Vocero solo puede abrir las planillas que la persona
 * ELIGE acá: el selector de Google es el que le da el permiso a la app sobre
 * ese archivo. El token del selector lo pide el NAVEGADOR directo a Google
 * (Google Identity Services) con la cuenta conectada como sugerencia: ningún
 * token guardado por Vocero sale del servidor.
 *
 * Con mocks, un diálogo que lista las planillas del google-mock y simula el
 * permiso que daría el selector real.
 */

type PickerConfig =
  | { mode: "google"; clientId: string; apiKey: string; appId: string; loginHint: string | null }
  | { mode: "mock" }
  | { mode: "unavailable" };

export type PickedSpreadsheet = { id: string; name: string };

/* ---- tipos mínimos de las librerías de Google (cargadas por <script>) ---- */
type TokenResponse = { access_token?: string; error?: string };
type GoogleGlobal = {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string;
        scope: string;
        hint?: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type?: string }) => void;
      }) => { requestAccessToken: (o?: { prompt?: string }) => void };
    };
  };
  picker: {
    PickerBuilder: new () => PickerBuilder;
    ViewId: { SPREADSHEETS: string };
    Action: { PICKED: string; CANCEL: string };
    Feature: { NAV_HIDDEN: string };
  };
};
type PickerBuilder = {
  addView: (v: string) => PickerBuilder;
  setOAuthToken: (t: string) => PickerBuilder;
  setDeveloperKey: (k: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setLocale: (l: string) => PickerBuilder;
  enableFeature: (f: string) => PickerBuilder;
  setCallback: (cb: (d: { action: string; docs?: { id: string; name: string }[] }) => void) => PickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
};
type Gapi = { load: (lib: string, cb: () => void) => void };

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}

async function pickWithGoogle(cfg: Extract<PickerConfig, { mode: "google" }>): Promise<PickedSpreadsheet | null> {
  await Promise.all([
    loadScript("https://accounts.google.com/gsi/client"),
    loadScript("https://apis.google.com/js/api.js"),
  ]);
  const w = window as unknown as { google?: GoogleGlobal; gapi?: Gapi };
  if (!w.gapi || !w.google?.accounts) throw new Error("Las librerías de Google no cargaron");
  await new Promise<void>((resolve) => w.gapi!.load("picker", () => resolve()));

  const token = await new Promise<string>((resolve, reject) => {
    const client = w.google!.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      hint: cfg.loginHint ?? undefined,
      callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error ?? "sin token"))),
      error_callback: (e) => reject(new Error(e.type ?? "cancelado")),
    });
    client.requestAccessToken({ prompt: "" });
  });

  const google = (window as unknown as { google: GoogleGlobal }).google;
  return new Promise<PickedSpreadsheet | null>((resolve) => {
    const picker = new google.picker.PickerBuilder()
      .addView(google.picker.ViewId.SPREADSHEETS)
      .setOAuthToken(token)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setLocale("es")
      .enableFeature(google.picker.Feature.NAV_HIDDEN)
      .setCallback((d) => {
        if (d.action === google.picker.Action.PICKED && d.docs?.[0]) {
          resolve({ id: d.docs[0].id, name: d.docs[0].name });
        } else if (d.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

/**
 * `pick()` abre el selector y resuelve con la planilla elegida (o null si
 * se canceló). `dialog` es el diálogo del modo mock: hay que renderizarlo.
 */
export function useSpreadsheetPicker(onError: (m: string) => void) {
  const [mockFiles, setMockFiles] = useState<PickedSpreadsheet[] | null>(null);
  const resolver = useRef<((v: PickedSpreadsheet | null) => void) | null>(null);

  const pick = useCallback(async (): Promise<PickedSpreadsheet | null> => {
    const res = await fetch("/api/integrations/google-sheets/picker").catch(() => null);
    if (!res?.ok) {
      onError("No se pudo abrir el selector de Google.");
      return null;
    }
    const cfg = (await res.json()) as PickerConfig;
    if (cfg.mode === "unavailable") {
      onError(
        "El selector de Google no está habilitado en esta instancia (falta la API key del selector). Podés crear una planilla nueva desde acá."
      );
      return null;
    }
    if (cfg.mode === "google") {
      try {
        return await pickWithGoogle(cfg);
      } catch {
        onError("No se pudo abrir el selector de Google. Revisá que el navegador no bloquee la ventana emergente.");
        return null;
      }
    }
    const state = await fetch("/api/dev/google-mock/state").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const files = ((state?.spreadsheets ?? []) as { id: string; title: string }[]).map((s) => ({
      id: s.id,
      name: s.title,
    }));
    setMockFiles(files);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, [onError]);

  const close = (v: PickedSpreadsheet | null) => {
    setMockFiles(null);
    resolver.current?.(v);
    resolver.current = null;
  };

  const dialog = (
    <Dialog
      open={mockFiles !== null}
      onClose={() => close(null)}
      title="Elegí una planilla (selector simulado)"
      description="Entorno de pruebas: simula el selector de Google."
      testId="mock-picker"
    >
      <div className="space-y-2">
        {(mockFiles ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">No hay planillas en el google-mock.</p>
        )}
        {(mockFiles ?? []).map((f) => (
          <Button
            key={f.id}
            variant="outline"
            className="w-full justify-start"
            data-testid={`mock-pick-${f.id}`}
            onClick={async () => {
              await fetch("/api/dev/google-mock/state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ grantSheet: f.id }),
              }).catch(() => null);
              close(f);
            }}
          >
            {f.name}
          </Button>
        ))}
      </div>
    </Dialog>
  );

  return { pick, dialog };
}
