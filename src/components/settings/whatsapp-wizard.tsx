"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Connection = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
};

type WebhookInfo = {
  url: string;
  verifyToken: string;
  isHttps: boolean;
  signatureLayer: boolean;
};

type EsConfig = {
  appId: string;
  configId: string;
  graphVersion: string;
  mock: boolean;
  /** Coexistence visible: requiere Tech Provider aprobado (flag de instancia). */
  coexistence: boolean;
};

type FbLoginResponse = { authResponse?: { code?: string } | null };

declare global {
  interface Window {
    FB?: {
      init: (opts: Record<string, unknown>) => void;
      login: (
        cb: (res: FbLoginResponse) => void,
        opts: Record<string, unknown>
      ) => void;
    };
  }
}

export function WhatsappWizard() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [esConfig, setEsConfig] = useState<EsConfig | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    const [c, w] = await Promise.all([
      fetch("/api/settings/whatsapp").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/settings/webhook").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (c) {
      setConnection(c.connection);
      setEsConfig(c.embeddedSignup ?? null);
    }
    if (w) setWebhook(w);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-[#ecd4d2] bg-[#faf1f0] p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-[#a2504c]">
              El token de WhatsApp expiró o fue revocado.
            </p>
            <p className="text-[#a2504c]/80">
              Los envíos están pausados. Pega un token nuevo abajo y prueba la
              conexión para reconectar.
            </p>
          </div>
        </div>
      )}

      {connection && connection.status === "connected" && (
        <div className="flex items-center gap-3 rounded-lg border border-[#d8e8dd] bg-[#eff7f1] p-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-[#3f6b52]">
              Número conectado: {connection.displayPhoneNumber ?? connection.phoneNumberId}
            </p>
            <p className="text-[#3f6b52]/80">
              {connection.verifiedName ? `${connection.verifiedName} · ` : ""}
              token …{connection.tokenLast4}
            </p>
          </div>
          <Badge variant="success">Conectado</Badge>
        </div>
      )}

      {esConfig && (
        <EmbeddedSignupCard
          config={esConfig}
          existing={connection}
          onConnected={() => void refetch()}
        />
      )}

      <ConnectForm
        existing={connection}
        secondary={Boolean(esConfig)}
        onSaved={() => void refetch()}
      />

      {webhook && <WebhookCard webhook={webhook} />}
    </div>
  );
}

/**
 * Embedded Signup: el negocio autoriza en un popup de Meta y el backend cierra
 * el flujo. El browser nunca ve el token — solo el `code` de un solo uso.
 */
function EmbeddedSignupCard({
  config,
  existing,
  onConnected,
}: {
  config: EsConfig;
  existing: Connection | null;
  onConnected: () => void;
}) {
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El evento `message` de Meta y el callback de FB.login llegan en orden no
  // garantizado: se guardan los ids en un ref para no depender de cuál gane.
  // phoneNumberId puede quedar en null: con coexistence Meta manda solo la
  // WABA y el servidor descubre el número.
  const assets = useRef<{
    wabaId: string;
    phoneNumberId: string | null;
  } | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
      try {
        const data = JSON.parse(String(event.data)) as {
          type?: string;
          event?: string;
          data?: { waba_id?: string; phone_number_id?: string };
        };
        if (data.type !== "WA_EMBEDDED_SIGNUP") return;
        // Solo los eventos de cierre traen los assets definitivos: "FINISH"
        // en el flujo estándar y "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" en
        // coexistence. Los intermedios y CANCEL no deben pisar nada.
        if (!data.event?.startsWith("FINISH")) return;
        if (data.data?.waba_id) {
          assets.current = {
            wabaId: data.data.waba_id,
            phoneNumberId: data.data.phone_number_id ?? null,
          };
        }
      } catch {
        // mensajes no-JSON de facebook.com: irrelevantes para este flujo
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (config.mock) return; // en self-test no se carga el SDK real
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.onload = () => {
      window.FB?.init({
        appId: config.appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: config.graphVersion,
      });
      setSdkReady(true);
    };
    script.onerror = () =>
      setError("No se pudo cargar el SDK de Meta. Revisa tu conexión o si un bloqueador lo está frenando.");
    document.body.appendChild(script);
  }, [config]);

  async function finish(code: string) {
    if (!assets.current) {
      setBusy(false);
      setError(
        "Meta no informó qué número se conectó. Volvé a ejecutar la conexión y completá todos los pasos del popup."
      );
      return;
    }
    const res = await fetch("/api/settings/whatsapp/embedded-signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        wabaId: assets.current.wabaId,
        // Omitido (no null) cuando Meta no lo informó: el schema lo espera
        // ausente y el servidor descubre el número desde la WABA.
        ...(assets.current.phoneNumberId
          ? { phoneNumberId: assets.current.phoneNumberId }
          : {}),
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo completar la conexión");
      return;
    }
    assets.current = null;
    onConnected();
  }

  /**
   * `coexistence` cambia el flujo del popup: el negocio conecta el número que
   * YA usa en la app de WhatsApp Business y el celular sigue funcionando.
   * `sessionInfoVersion: "3"` es el session logging que Meta exige para este
   * modo; el valor `coexistence` de featureType quedó obsoleto.
   */
  function launch(coexistence: boolean) {
    setError(null);
    setBusy(true);
    assets.current = null;
    window.FB?.login(
      (res) => {
        const code = res.authResponse?.code;
        if (!code) {
          setBusy(false);
          setError("Cancelaste la conexión o Meta no devolvió el código.");
          return;
        }
        void finish(code);
      },
      {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: coexistence
          ? {
              setup: {},
              featureType: "whatsapp_business_app_onboarding",
              sessionInfoVersion: "3",
            }
          : { setup: {}, sessionInfoVersion: "3" },
      }
    );
  }

  /** Self-test: simula el retorno del popup sin cargar el SDK de Meta. */
  function simulate(coexistence: boolean) {
    setError(null);
    setBusy(true);
    assets.current = {
      wabaId: "waba_mock_1",
      phoneNumberId: coexistence ? null : "pn_mock_1",
    };
    void finish("mock-code-1");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {existing ? "Reconectar con Meta" : "Conectar WhatsApp con Meta"}
        </CardTitle>
        <CardDescription>
          Autorizás en una ventana de Meta y listo: no hay que copiar tokens ni
          IDs a mano. El token se intercambia en el servidor y se guarda cifrado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Coexistence detrás de flag: hasta tener Tech Provider aprobado el
            popup falla al final, y un botón que termina en error lee como
            "app incompleta" ante el revisor de Meta. */}
        {config.coexistence && (
          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">
              Ya uso este número en el celular
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              El número sigue funcionando en la app de WhatsApp Business y
              además entra al CRM. Requiere la app en versión 2.24.17 o
              superior. No quedan disponibles los grupos, las llamadas ni el
              catálogo.
            </p>
            <Button
              className="mt-3"
              disabled={(!sdkReady && !config.mock) || busy}
              onClick={() => (config.mock ? simulate(true) : launch(true))}
            >
              {busy ? "Conectando…" : "Conectar sin perder el celular"}
            </Button>
          </div>
        )}

        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium">Es un número nuevo, solo para el CRM</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ojo: si el número ya está en uso en la app del celular, esta opción
            lo deja fuera de servicio ahí. Elegila solo para un número que no
            usás desde el teléfono.
          </p>
          <Button
            className="mt-3"
            variant="outline"
            disabled={(!sdkReady && !config.mock) || busy}
            onClick={() => (config.mock ? simulate(false) : launch(false))}
          >
            {busy
              ? "Conectando…"
              : sdkReady || config.mock
                ? existing
                  ? "Reconectar con Meta"
                  : "Conectar con Meta"
                : "Cargando Meta…"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectForm({
  existing,
  secondary,
  onSaved,
}: {
  existing: Connection | null;
  secondary?: boolean;
  onSaved: () => void;
}) {
  const [wabaId, setWabaId] = useState(existing?.wabaId ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState(
    existing?.phoneNumberId ?? ""
  );
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<
    | { ok: true; display: string }
    | { ok: false; message: string }
    | null
  >(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canTest = wabaId.trim() && phoneNumberId.trim() && token.trim();

  async function test() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/settings/whatsapp/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumberId, token }),
    }).catch(() => null);
    setTesting(false);
    if (!res) {
      setTestResult({ ok: false, message: "Sin conexión con el servidor" });
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      displayPhoneNumber?: string;
      error?: { message?: string };
    } | null;
    if (res.ok && data?.displayPhoneNumber) {
      setTestResult({ ok: true, display: data.displayPhoneNumber });
    } else {
      setTestResult({
        ok: false,
        message: data?.error?.message ?? "La validación falló",
      });
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const res = await fetch("/api/settings/whatsapp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wabaId, phoneNumberId, token }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setSaveError(data?.error?.message ?? "No se pudo guardar la conexión");
      return;
    }
    setToken("");
    setTestResult(null);
    onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {secondary
            ? "Conexión manual (avanzado)"
            : existing
              ? "Reconectar / actualizar el número"
              : "Conectar tu número de WhatsApp"}
        </CardTitle>
        <CardDescription>
          {secondary
            ? "Alternativa si preferís pegar las credenciales vos mismo o si el popup de Meta falla. "
            : ""}
          Pega las credenciales de WhatsApp Cloud API. El token se valida
          contra Meta ANTES de guardarse y se almacena cifrado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-md border bg-background/40 p-4 text-sm">
          <p className="font-medium">¿Cuándo usar esta opción?</p>
          <p className="text-muted-foreground">
            Lo normal es conectar con el botón de arriba. Esta vía es para dos
            casos: que el popup de Meta no abra (bloqueador de ventanas
            emergentes o navegador embebido), o que ya tengas un{" "}
            <span className="text-foreground">token de usuario del sistema</span>{" "}
            generado en tu propia app de Meta y prefieras usarlo.
          </p>
          <p className="text-muted-foreground">
            Necesitás el WABA ID y el Phone Number ID de tu cuenta de WhatsApp
            Business, que están en{" "}
            <span className="text-foreground">business.facebook.com</span> →
            WhatsApp Manager.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="waba-id">WABA ID</Label>
            <Input
              id="waba-id"
              placeholder="ID de la cuenta de WhatsApp Business"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone-number-id">Phone Number ID</Label>
            <Input
              id="phone-number-id"
              placeholder="ID del número de teléfono"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="token">Token de acceso</Label>
          <Input
            id="token"
            type="password"
            placeholder={existing ? `Guardado (…${existing.tokenLast4}) — pega uno nuevo para cambiarlo` : "EAAG…"}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTestResult(null);
            }}
          />
        </div>

        {testResult && (
          <p
            className={`text-sm ${testResult.ok ? "text-success" : "text-destructive"}`}
          >
            {testResult.ok
              ? `✓ Token válido para ${testResult.display}. Ya puedes guardar.`
              : testResult.message}
          </p>
        )}
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}

        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!canTest || testing}
            onClick={() => void test()}
          >
            {testing ? "Probando…" : "Probar conexión"}
          </Button>
          <Button
            disabled={!testResult?.ok || saving}
            onClick={() => void save()}
          >
            {saving ? "Guardando…" : "Guardar conexión"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WebhookCard({ webhook }: { webhook: WebhookInfo }) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, which: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook de WhatsApp</CardTitle>
        <CardDescription>
          Pega estos valores en el panel de Meta (modo directo) o úsalos en el
          override de tu backend de agencia (a nivel WABA).{" "}
          <strong className="text-foreground">
            Guarda la conexión ANTES de configurar el webhook:
          </strong>{" "}
          la verificación (handshake) funciona sin guardar, pero los mensajes
          solo se reciben si la conexión está guardada — se enrutan por tu
          Phone Number ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!webhook.isHttps && (
          <p className="flex items-start gap-2 rounded-md border border-[#ece2cf] bg-[#faf7f0] p-3 text-xs text-[#8a6d3b]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            La URL configurada no es https: Meta exige https para los webhooks.
            Ajusta APP_BASE_URL con tu dominio público.
          </p>
        )}
        <div className="space-y-1.5">
          <Label>URL del webhook (callback URL)</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-3 py-2 text-xs">
              {webhook.url}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar URL"
              onClick={() => copy(webhook.url, "url")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "url" && (
              <span className="text-xs text-primary">Copiada ✓</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            La URL contiene el token secreto en la ruta: trátala como una
            contraseña.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Verify token</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-3 py-2 text-xs">
              {webhook.verifyToken}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar verify token"
              onClick={() => copy(webhook.verifyToken, "vt")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "vt" && (
              <span className="text-xs text-primary">Copiado ✓</span>
            )}
          </div>
        </div>
        {webhook.signatureLayer ? (
          <p className="flex items-center gap-2 text-xs text-success">
            <ShieldCheck className="h-4 w-4" /> Verificación de firma activa
            (META_APP_SECRET configurado): cada evento se valida con
            x-hub-signature-256.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" /> Sin App Secret
            configurado: el webhook queda protegido por la URL secreta (normal
            en modo agencia). Para la capa extra de firma, agrega
            META_APP_SECRET a la instancia.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
