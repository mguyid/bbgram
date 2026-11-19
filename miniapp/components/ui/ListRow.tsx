import type { ReactNode } from "react";

type Props = {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  dim?: boolean;
};

export function ListRow({ leading, title, subtitle, trailing, onClick, dim }: Props) {
  const content = (
    <>
      {leading}
      <div className="row-text">
        <span className="t-strong ellipsis">{title}</span>
        {subtitle && <span className="t-caption muted ellipsis">{subtitle}</span>}
      </div>
      {trailing && <div className="row-trailing">{trailing}</div>}
    </>
  );
  const cls = `row ${dim ? "dim" : ""}`;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

export function RowIcon({ children }: { children: ReactNode }) {
  return <div className="row-icon">{children}</div>;
}
