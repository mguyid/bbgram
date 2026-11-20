"use client";

import { AtSign, Bell, Copy, Globe, Info, Wallet } from "lucide-react";
import { useState } from "react";
import { api, type Me } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { shortAddress } from "@/lib/format";
import { haptic, openLink } from "@/lib/telegram";
import { useApp } from "../AppContext";
import { ic } from "../Common";
import { X_ENABLED } from "./taskMeta";
import { BottomSheet, Button, ListRow, RowIcon, Toggle, useToast } from "../ui";

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, setMe, openWallet } = useApp();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [xBusy, setXBusy] = useState(false);

  const setReminders = async (v: boolean) => {
    haptic.light();
    setSaving(true);
    const prev = me;
    setMe({ ...me, reminders_enabled: v });
    try {
      setMe(await api.patch<Me>("/api/settings", { reminders_enabled: v }));
    } catch (e) {
      setMe(prev);
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const connectX = async () => {
    setXBusy(true);
    try {
      const { url } = await api.get<{ url: string }>("/api/x/connect-url");
      openLink(url);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setXBusy(false);
    }
  };

  return (
    <BottomSheet open={open} title="Settings" onClose={onClose}>
      <div className="list card-plain" style={{ padding: 0, background: "transparent" }}>
        <ListRow
          leading={<RowIcon><Bell {...ic} /></RowIcon>}
          title="Spin reminders"
          subtitle="Message me when my spin is ready"
          trailing={<Toggle label="Spin reminders" checked={me.reminders_enabled} disabled={saving} onChange={setReminders} />}
        />
        <ListRow
          leading={<RowIcon><Wallet {...ic} /></RowIcon>}
          title="Wallet"
          subtitle={me.wallet_address ? <span className="mono">{shortAddress(me.wallet_address)}</span> : "Not linked"}
          trailing={
            me.wallet_address ? (
              <>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Copy wallet address"
                  onClick={async () => {
                    if (await copyText(me.wallet_address || "")) toast("Address copied.", "success");
                  }}
                >
                  <Copy {...ic} />
                </button>
                <Button size="compact" variant="secondary" onClick={() => { onClose(); openWallet(); }}>
                  Change
                </Button>
              </>
            ) : (
              <Button size="compact" onClick={() => { onClose(); openWallet(); }}>
                Link
              </Button>
            )
          }
        />
        {X_ENABLED && (
          <ListRow
            leading={<RowIcon><AtSign {...ic} /></RowIcon>}
            title="X account"
            subtitle={me.x_username ? `@${me.x_username}` : "Not connected"}
            trailing={
              me.x_username ? null : (
                <Button size="compact" loading={xBusy} onClick={connectX}>
                  Connect
                </Button>
              )
            }
          />
        )}
        <ListRow leading={<RowIcon><Globe {...ic} /></RowIcon>} title="Language" trailing={<span className="t-caption">English</span>} />
        <ListRow
          leading={<RowIcon><Info {...ic} /></RowIcon>}
          title="Version"
          trailing={<span className="t-caption num">{process.env.APP_VERSION}</span>}
        />
      </div>
    </BottomSheet>
  );
}
