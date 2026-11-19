import type { HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
};

export function Card({ title, action, flush, className = "", children, ...rest }: Props) {
  return (
    <div className={`card ${flush ? "card-flush" : ""} ${className}`} {...rest}>
      {(title || action) && (
        <div className="card-header" style={flush ? { padding: "16px 16px 0" } : undefined}>
          {typeof title === "string" ? <h2 className="t-h2">{title}</h2> : title}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
