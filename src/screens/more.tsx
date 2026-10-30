// The phone's "More" tab: the sections that don't fit the tab bar.

import { useT } from "../lib/i18n";
import { roleLabel } from "../lib/labels";
import { useBooks } from "../state/app";
import { Icon, type IconName } from "../ui/icons";
import { Card, Pill, Row } from "../ui/kit";

export function MoreScreen() {
  const t = useT();
  const { ops, user, role, snapshot, can } = useBooks();
  const pending = ops.filter((o) => o.status !== "synced").length;
  const items: [string, IconName, string, number?][] = [
    ...(can("manage") ? [["/reports", "chart", t("Reports", "Reportes")] as [string, IconName, string]] : []),
    ["/history", "history", t("History", "Historial")],
    ["/sync", "sync", t("Sync", "Sincronización"), pending],
    ["/settings", "settings", t("Settings", "Ajustes")],
  ];
  return (
    <div>
      <div className="topbar">
        <h1>{t("More", "Más")}</h1>
      </div>
      <Card>
        <ul className="list">
          {items.map(([to, icon, label, n]) => (
            <Row key={to} to={to} lead={<span className="avatar"><Icon name={icon} width={18} height={18} /></span>} title={label} trail={n ? <Pill tone="warn">{n}</Pill> : <Icon name="chevron" width={18} height={18} />} />
          ))}
        </ul>
      </Card>
      <p className="micro muted" style={{ marginTop: 12 }}>
        {user?.email} · {snapshot.business.name} · {role ? roleLabel(t, role) : ""}
      </p>
    </div>
  );
}
