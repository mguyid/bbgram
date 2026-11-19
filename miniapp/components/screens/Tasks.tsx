"use client";

import { Check, ClipboardPaste, Copy } from "lucide-react";
import { useState } from "react";
import { api, type Task, type XState } from "@/lib/api";
import { copyText, readText } from "@/lib/clipboard";
import { date, points } from "@/lib/format";
import { haptic, openLink, openTelegramLink } from "@/lib/telegram";
import { useApi } from "@/lib/useApi";
import { useApp } from "../AppContext";
import { ErrorCard, ic, Screen, ScreenHeader } from "../Common";
import { BottomSheet, Button, Card, Chip, EmptyState, ListRow, RowIcon, Skeleton, useToast } from "../ui";
import { TASK_ACTION, TASK_ICON } from "./taskMeta";

const X_POST_RE = /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/;

export function Tasks() {
  const { go, openWallet, refreshMe } = useApp();
  const toast = useToast();
  const tasks = useApi<{ tasks: Task[] }>("/api/tasks");
  const x = useApi<XState>("/api/x");
  const [sheet, setSheet] = useState<"post" | "bio" | null>(null);
  const [busy, setBusy] = useState<Task["key"] | null>(null);
  const [joinOpened, setJoinOpened] = useState(false);

  const run = async (t: Task) => {
    haptic.light();
    switch (t.key) {
      case "spin":
        return go("home");
      case "wallet":
        return openWallet();
      case "x_post":
        return setSheet("post");
      case "x_bio":
        return setSheet("bio");
      case "x_connect":
        setBusy(t.key);
        try {
          const { url } = await api.get<{ url: string }>("/api/x/connect-url");
          openLink(url);
        } catch (e) {
          toast((e as Error).message, "error");
        } finally {
          setBusy(null);
        }
        return;
      case "join_channel":
        if (t.url && !joinOpened) {
          openTelegramLink(t.url);
          setJoinOpened(true);
          return;
        }
        setBusy(t.key);
        try {
          const r = await api.post<{ state: Task["state"] }>("/api/tasks/join_channel");
          if (r.state === "done") {
            haptic.success();
            toast("Channel joined. Points added.", "success");
            refreshMe();
          } else {
            toast("We could not find you in the channel yet. Join and check again.", "error");
          }
          tasks.reload();
        } catch (e) {
          haptic.error();
          toast((e as Error).message, "error");
        } finally {
          setBusy(null);
        }
    }
  };

  const actionLabel = (t: Task) =>
    t.key === "join_channel" && (!t.url || joinOpened) ? "Check" : TASK_ACTION[t.key];

  const renderSection = (title: string, list: Task[]) => {
    if (list.length === 0) return null;
    const sorted = [...list].sort((a, b) => Number(a.state === "done") - Number(b.state === "done"));
    return (
      <>
        <h2 className="t-micro section-title">{title}</h2>
        <Card flush>
          <div className="list">
            {sorted.map((t) => (
              <ListRow
                key={t.key}
                dim={t.state === "done"}
                leading={<RowIcon>{TASK_ICON[t.key]}</RowIcon>}
                title={t.title}
                subtitle={<Chip tone="accent">+{points(t.reward)}</Chip>}
                onClick={t.key === "x_post" && t.state !== "todo" ? () => setSheet("post") : undefined}
                trailing={
                  t.state === "done" ? (
                    <span className="hrow c-success t-caption">
                      <Check {...ic} /> Done
                    </span>
                  ) : t.state === "pending" ? (
                    <span className="hrow c-warning t-caption">
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--warning)" }} aria-hidden />
                      Pending
                    </span>
                  ) : (
                    <Button size="compact" loading={busy === t.key} onClick={() => run(t)}>
                      {actionLabel(t)}
                    </Button>
                  )
                }
              />
            ))}
          </div>
        </Card>
      </>
    );
  };

  return (
    <Screen>
      <ScreenHeader title="Tasks" />
      {!tasks.data ? (
        tasks.error ? (
          <ErrorCard message={tasks.error.message} onRetry={tasks.reload} />
        ) : (
          <>
            <Skeleton height={14} width={60} />
            <Skeleton height={170} />
            <Skeleton height={14} width={80} />
            <Skeleton height={170} />
          </>
        )
      ) : tasks.data.tasks.length === 0 ? (
        <Card>
          <EmptyState text="No tasks right now. Check back later." />
        </Card>
      ) : (
        <>
          {renderSection("Daily", tasks.data.tasks.filter((t) => t.section === "daily"))}
          {renderSection("One-time", tasks.data.tasks.filter((t) => t.section === "one_time"))}
        </>
      )}
      <PostSheet
        open={sheet === "post"}
        x={x.data}
        onClose={() => setSheet(null)}
        onAdded={() => {
          x.reload();
          tasks.reload();
          refreshMe();
        }}
      />
      <BioSheet
        open={sheet === "bio"}
        marked={!!x.data?.bio_marked}
        onClose={() => setSheet(null)}
        onMarked={() => {
          x.reload();
          tasks.reload();
        }}
      />
    </Screen>
  );
}

function PostSheet({
  open,
  x,
  onClose,
  onAdded,
}: {
  open: boolean;
  x?: XState;
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const v = url.trim();
    if (!X_POST_RE.test(v)) {
      setError("Paste the link to your post on X, like x.com/name/status/123.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.post("/api/x/post", { url: v });
      haptic.success();
      toast("Post added. Daily points start today.", "success");
      setUrl("");
      onAdded();
      onClose();
    } catch (e) {
      haptic.error();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      title="Add your X post"
      onClose={onClose}
      footer={
        <Button block loading={busy} onClick={submit} disabled={!url.trim()}>
          Add post
        </Button>
      }
    >
      <p className="t-caption muted" style={{ margin: 0 }}>
        Post about Baby Grand with your referral link, then paste the post link here. You earn points every day
        while the post stays up.
      </p>
      <div className="input-wrap">
        <input
          className="input"
          type="url"
          inputMode="url"
          placeholder="https://x.com/you/status/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Post link"
          aria-invalid={!!error}
        />
        <Button
          variant="secondary"
          aria-label="Paste"
          onClick={async () => {
            const t = await readText();
            if (t) setUrl(t.trim());
            else toast("Could not read the clipboard. Paste manually.", "error");
          }}
        >
          <ClipboardPaste {...ic} />
        </Button>
      </div>
      {error && <span className="field-error">{error}</span>}
      {x && x.posts.length > 0 && (
        <div className="stack-8">
          <span className="t-micro muted">Your posts</span>
          <div className="list card-plain" style={{ padding: 0 }}>
            {x.posts.map((p) => (
              <ListRow
                key={p.id}
                title={p.url.replace(/^https?:\/\/(www\.)?/, "")}
                subtitle={date(p.created_at)}
                trailing={
                  <Chip tone={p.status === "active" ? "success" : "danger"}>
                    {p.status === "active" ? "Active" : "Revoked"}
                  </Chip>
                }
              />
            ))}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function BioSheet({
  open,
  marked,
  onClose,
  onMarked,
}: {
  open: boolean;
  marked: boolean;
  onClose: () => void;
  onMarked: () => void;
}) {
  const { me } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const mark = async () => {
    setBusy(true);
    try {
      await api.post("/api/x/bio", { marked: true });
      haptic.success();
      toast("Marked as added. Daily points start today.", "success");
      onMarked();
      onClose();
    } catch (e) {
      haptic.error();
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      title="Add Baby Grand to your X bio"
      onClose={onClose}
      footer={
        marked ? (
          <span className="hrow c-success t-strong" style={{ justifyContent: "center", minHeight: 44 }}>
            <Check {...ic} /> Marked as added
          </span>
        ) : (
          <Button block loading={busy} onClick={mark}>
            Mark as added
          </Button>
        )
      }
    >
      <p className="t-caption muted" style={{ margin: 0 }}>
        Add Baby Grand and your referral link to your X bio. You earn points every day while it stays there. Bios
        are reviewed by the team.
      </p>
      <div className="input-wrap">
        <input className="input mono" readOnly value={me.referral_link} aria-label="Referral link" />
        <Button
          variant="secondary"
          aria-label="Copy link"
          onClick={async () => {
            if (await copyText(me.referral_link)) {
              haptic.light();
              toast("Link copied.", "success");
            }
          }}
        >
          <Copy {...ic} />
        </Button>
      </div>
    </BottomSheet>
  );
}
