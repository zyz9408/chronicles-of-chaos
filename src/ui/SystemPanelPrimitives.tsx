import React from 'react';

function joinClassNames(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(' ');
}

export interface SystemModalHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  closeLabel?: string;
}

export function SystemModalHeader({
  title,
  subtitle,
  onClose,
  closeLabel = '关闭',
}: SystemModalHeaderProps): React.ReactElement {
  return (
    <div className="system-modal-head ui-modal-header">
      <div>
        <span>{title}</span>
        {subtitle !== undefined && <small>{subtitle}</small>}
      </div>
      <button type="button" className="system-modal-close ui-panel-close" onClick={onClose}>
        {closeLabel}
      </button>
    </div>
  );
}

export interface SystemModalFrameProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  ariaLabel: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  backdropClassName?: string;
  workspace?: boolean;
  testId?: string;
}

export function SystemModalFrame({
  title,
  subtitle,
  ariaLabel,
  onClose,
  children,
  className,
  backdropClassName,
  workspace = false,
  testId,
}: SystemModalFrameProps): React.ReactElement {
  return (
    <div
      className={joinClassNames('system-modal-backdrop', backdropClassName)}
      role="presentation"
      onClick={onClose}
    >
      <section
        className={joinClassNames(
          'system-modal',
          'ui-system-modal',
          workspace && 'ui-system-workspace',
          className,
        )}
        data-testid={testId}
        role="dialog"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
      >
        <SystemModalHeader title={title} subtitle={subtitle} onClose={onClose} />
        {children}
      </section>
    </div>
  );
}

export interface PanelListDetailLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PanelListDetailLayout({
  children,
  className,
  ...props
}: PanelListDetailLayoutProps): React.ReactElement {
  return (
    <div className={joinClassNames('strategic-archive-layout', 'ui-list-detail', className)} {...props}>
      {children}
    </div>
  );
}

export interface PanelMetricRow {
  key?: React.Key;
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}

export interface PanelMetricGridProps extends React.HTMLAttributes<HTMLDivElement> {
  rows: readonly PanelMetricRow[];
}

export function PanelMetricGrid({ rows, className, ...props }: PanelMetricGridProps): React.ReactElement {
  return (
    <div className={joinClassNames('strategic-metric-grid', 'ui-metric-grid', className)} {...props}>
      {rows.map((row, index) => (
        <div key={row.key ?? index} className={row.className}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

export interface PanelTextProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode;
}

export function PanelNotice({ children, className, ...props }: PanelTextProps): React.ReactElement {
  return (
    <p className={joinClassNames('ui-panel-note', className)} {...props}>
      {children}
    </p>
  );
}

export function PanelEmptyState({ children, className, ...props }: PanelTextProps): React.ReactElement {
  return (
    <p className={joinClassNames('muted', 'ui-panel-empty', className)} {...props}>
      {children}
    </p>
  );
}
