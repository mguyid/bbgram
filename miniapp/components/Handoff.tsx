"use client";

import { ExternalLink, Send } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { haptic, inTelegram, openLink } from "@/lib/telegram";
import { Button, useToast } from "./ui";
import { ic } from "./Common";

/** "Open in browser" fallback for wallet steps (plan §3.7). Hidden when already in a browser. */
export function HandoffActions() {
  const toast = useToast();
  const [busy, setBusy] = useState<"open" | "send" | null>(null);
  if (!inTelegram()) return null;

  const open = async () => {
    setBusy("open");
    try {
      const { url } = await api.post<{ url: string }>("/api/handoff");
      openLink(url);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };
  const send = async () => {
    setBusy("send");
    try {
      await api.post("/api/handoff/send");
      haptic.success();
      toast("Link sent to your Telegram chat.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack-8">
      <p className="t-caption muted" style={{ margin: 0, textAlign: "center" }}>
        Wallet not opening? Continue in your browser.
      </p>
      <Button variant="secondary" block loading={busy === "open"} disabled={!!busy} onClick={open}>
        <ExternalLink {...ic} /> Open in browser
      </Button>
      <Button variant="ghost" block loading={busy === "send"} disabled={!!busy} onClick={send}>
        <Send {...ic} /> Send link to chat
      </Button>
    </div>
  );
}
