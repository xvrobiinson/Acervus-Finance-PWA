// Shows a receipt and prints it (the print dialog also saves a PDF), or
// downloads it as an HTML file.

import { useEffect, useMemo, useRef, useState } from "react";
import type { LateFeeRecord, LoanRecord, PaymentRecord } from "../../shared/domain/records";
import { useT } from "../lib/i18n";
import { useBooks } from "../state/app";
import { Button, Sheet } from "../ui/kit";
import { loanReceiptHtml, paymentReceiptHtml, type ReceiptContext } from "./receipt";

/** The logo as a data: URL, so it is inside the receipt (prints offline once loaded). */
function useLogo(url: string | null | undefined): string | null {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return setData(null);
    let alive = true;
    fetch(url)
      .then((r) => r.blob())
      .then(
        (b) =>
          new Promise<string>((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.readAsDataURL(b);
          }),
      )
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [url]);
  return data;
}

export function ReceiptSheet({ kind, id, onClose }: { kind: "payment" | "loan"; id: string; onClose: () => void }) {
  const t = useT();
  const { snapshot, fmt } = useBooks();
  const logo = useLogo(snapshot.settings?.logoUrl);
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => {
    const s = snapshot.settings;
    if (!s) return null;
    const c: ReceiptContext = { t, fmt, settings: s, businessName: snapshot.business.name, logo };
    const loanId = kind === "loan" ? id : snapshot.payments.find((p) => p._id === id)?.loanId;
    const loan = snapshot.loans.find((l) => l._id === loanId);
    const client = loan && snapshot.clients.find((x) => x._id === loan.clientId);
    if (!loan || !client) return null;
    return kind === "loan"
      ? loanReceiptHtml(c, { loan: loan as unknown as LoanRecord, client })
      : paymentReceiptHtml(c, {
          loan: loan as unknown as LoanRecord,
          client,
          payments: snapshot.payments as unknown as PaymentRecord[],
          lateFees: snapshot.lateFees as unknown as LateFeeRecord[],
          paymentId: id,
        });
  }, [snapshot, kind, id, t, fmt, logo]);
  const fit = () => {
    // Scale the Letter page to the screen; printing uses the real size.
    const doc = frame.current?.contentDocument;
    if (doc) doc.documentElement.style.setProperty("--fit", String(Math.min(1, (frame.current!.clientWidth - 8) / 816)));
  };
  const download = () => {
    if (!html) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `${kind === "loan" ? "loan" : "receipt"}-${id.slice(-6)}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  return (
    <Sheet
      wide
      title={kind === "loan" ? t("Loan receipt", "Recibo del préstamo") : t("Payment receipt", "Recibo de pago")}
      onClose={onClose}
      footer={
        <>
          <Button icon="download" onClick={download} disabled={!html}>
            {t("Download", "Descargar")}
          </Button>
          <Button variant="primary" icon="printer" disabled={!html} onClick={() => frame.current?.contentWindow?.print()}>
            {t("Print / PDF", "Imprimir / PDF")}
          </Button>
        </>
      }
    >
      {html ? (
        <>
          <iframe ref={frame} className="receipt-frame" title={t("Receipt", "Recibo")} srcDoc={html} onLoad={fit} />
          <p className="micro muted">
            {t(
              "To save a PDF, choose Print and then “Save as PDF” (on iPhone: Share › Save to Files). Letter paper.",
              "Para guardar un PDF, elige Imprimir y luego “Guardar como PDF” (en iPhone: Compartir › Guardar en Archivos). Papel carta.",
            )}
          </p>
        </>
      ) : (
        <p>{t("Loading…", "Cargando…")}</p>
      )}
    </Sheet>
  );
}
