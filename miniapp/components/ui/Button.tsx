import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "compact";
  loading?: boolean;
  block?: boolean;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "default",
  loading = false,
  block = false,
  disabled,
  className = "",
  children,
  type = "button",
  ...rest
}: Props) {
  const cls = [
    "btn",
    `btn-${variant}`,
    size === "compact" ? "btn-compact" : "",
    block ? "btn-block" : "",
    loading ? "loading" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading} {...rest}>
      <span className="btn-label">{children}</span>
      {loading && <LoaderCircle className="spinner btn-spinner" size={20} strokeWidth={1.75} aria-hidden />}
    </button>
  );
}
