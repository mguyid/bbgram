"use client";

import { createContext, useContext } from "react";
import type { Admin } from "./api";

export const AdminContext = createContext<Admin | null>(null);

export function useAdmin(): Admin | null {
  return useContext(AdminContext);
}

/** True when the current admin may call mutating endpoints. */
export function useCanEdit(): boolean {
  const admin = useAdmin();
  return !!admin && admin.role !== "viewer";
}
