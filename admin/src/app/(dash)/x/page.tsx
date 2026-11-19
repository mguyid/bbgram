"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { api, itemsOf, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import { ConfirmButton, DateCell, EmptyRow, ErrorBox, Loading, PageHeader, UserCell as User } from "@/components/ui";

type Post = {
  id: number;
  user_id: number;
  username?: string | null;
  x_username?: string | null;
  url: string;
  status: "active" | "revoked";
  created_at: string;
};

type Bio = {
  user_id: number;
  username?: string | null;
  x_username?: string | null;
  bio_marked?: boolean;
  marked_at?: string | null;
};

function UserCell({ id, username }: { id: number; username?: string | null }) {
  return <User id={id} username={username} />;
}

function Posts() {
  const canEdit = useCanEdit();
  const [status, setStatus] = useState("active");
  const { data, error, loading, reload } = useGet<unknown>(`/x/posts${status ? `?status=${status}` : ""}`);
  const posts = itemsOf<Post>(data);

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <label className="field inline">
          <span className="muted">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140 }}>
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
            <option value="">All</option>
          </select>
        </label>
      </div>
      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>X account</th>
              <th>Post</th>
              <th>Status</th>
              <th>Submitted</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id}>
                <td>
                  <UserCell id={p.user_id} username={p.username} />
                </td>
                <td>{p.x_username ? `@${p.x_username}` : "—"}</td>
                <td className="wrap" style={{ maxWidth: 380 }}>
                  <a href={p.url} target="_blank" rel="noreferrer noopener" className="row" style={{ gap: 4, display: "inline-flex" }}>
                    {p.url.replace(/^https?:\/\/(www\.)?/, "")} <ExternalLink size={12} />
                  </a>
                </td>
                <td>
                  <span className={`badge ${p.status === "active" ? "green" : "red"}`}>{p.status === "active" ? "Active" : "Revoked"}</span>
                </td>
                <td>
                  <DateCell value={p.created_at} />
                </td>
                {canEdit && (
                  <td className="actions-cell">
                    {p.status === "active" && (
                      <ConfirmButton
                        label="Revoke"
                        className="btn danger small"
                        title="Revoke this post?"
                        message="Daily post points stop for this URL."
                        confirmLabel="Revoke"
                        onConfirm={async () => {
                          await api(`/x/posts/${p.id}/revoke`, { method: "POST" });
                          reload();
                        }}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
            {data !== undefined && !posts.length && <EmptyRow cols={6} title="No posts" text="Submitted X posts appear here." />}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Bios() {
  const canEdit = useCanEdit();
  const { data, error, loading, reload } = useGet<unknown>("/x/bios");
  const bios = itemsOf<Bio>(data);

  return (
    <>
      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>X account</th>
              <th>Marked</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {bios.map((b) => (
              <tr key={b.user_id}>
                <td>
                  <UserCell id={b.user_id} username={b.username} />
                </td>
                <td>
                  {b.x_username ? (
                    <a href={`https://x.com/${b.x_username}`} target="_blank" rel="noreferrer noopener">
                      @{b.x_username} <ExternalLink size={12} />
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <DateCell value={b.marked_at} />
                </td>
                {canEdit && (
                  <td className="actions-cell">
                    <ConfirmButton
                      label="Revoke"
                      className="btn danger small"
                      title="Revoke bio mark?"
                      message="Daily bio points stop for this user."
                      confirmLabel="Revoke"
                      onConfirm={async () => {
                        await api(`/x/bios/${b.user_id}/revoke`, { method: "POST" });
                        reload();
                      }}
                    />
                  </td>
                )}
              </tr>
            ))}
            {data !== undefined && !bios.length && (
              <EmptyRow cols={4} title="No bio marks yet" text="Users who add Baby Grand to their X bio appear here." />
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function XReviewPage() {
  const [tab, setTab] = useState<"posts" | "bios">("posts");
  return (
    <>
      <PageHeader title="X review" description="Posts and bio marks that earn daily X points. Revoke anything that breaks the rules." />
      <div className="tabs">
        <button type="button" className={`tab${tab === "posts" ? " active" : ""}`} onClick={() => setTab("posts")}>
          Posts
        </button>
        <button type="button" className={`tab${tab === "bios" ? " active" : ""}`} onClick={() => setTab("bios")}>
          Bios
        </button>
      </div>
      {tab === "posts" ? <Posts /> : <Bios />}
    </>
  );
}
