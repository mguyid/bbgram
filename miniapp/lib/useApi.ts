"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

// Last good response per path, so revisiting a tab renders instantly while it refreshes.
const cache = new Map<string, unknown>();

type Result<T> = { key: string; data?: T; error?: ApiError };

export function useApi<T>(path: string | null) {
  const [n, setN] = useState(0);
  const key = `${path}#${n}`;
  const [res, setRes] = useState<Result<T>>({ key: "" });

  useEffect(() => {
    if (!path) return;
    let alive = true;
    api.get<T>(path).then(
      (data) => {
        cache.set(path, data);
        if (alive) setRes({ key, data });
      },
      (error: ApiError) => alive && setRes({ key, error }),
    );
    return () => {
      alive = false;
    };
  }, [path, key]);

  const fresh = res.key === key;
  const samePath = res.key.split("#")[0] === String(path);
  const data = (samePath ? res.data : undefined) ?? (path ? (cache.get(path) as T | undefined) : undefined);
  const reload = useCallback(() => setN((x) => x + 1), []);
  const mutate = useCallback(
    (d: T) => {
      if (path) cache.set(path, d);
      setRes({ key, data: d });
    },
    [path, key],
  );
  return { data, error: fresh ? res.error : undefined, loading: !fresh, reload, mutate };
}
