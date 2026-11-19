/* eslint-disable jsx-a11y/alt-text */
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

export type TemplateName = "classic" | "modern" | "navy";

export interface PdfParty {
  label: string;
  name: string;
  lines: string[];
}
export interface PdfItem {
  no: number;
  description: string;
  qty: string;
  unit?: string | null;
  price?: string;
  tax?: string;
  amount?: string;
  note?: string;
}
export interface PdfDocumentData {
  template: TemplateName;
  title: string;
  number: string;
  watermark?: string | null;
  company: { name: string; lines: string[]; logo?: string | null };
  party: PdfParty;
  secondParty?: PdfParty | null;
  meta: Array<{ label: string; value: string }>;
  columns: { no: string; description: string; qty: string; price?: string; tax?: string; amount?: string };
  items: PdfItem[];
  totals?: Array<{ label: string; value: string; strong?: boolean }>;
  amountInWords?: string | null;
  highlight?: { label: string; value: string } | null;
  sections?: Array<{ title: string; body: string }>;
  signatures?: string[];
  footer: string;
  pageLabel: (page: number, total: number) => string;
}

const THEMES: Record<TemplateName, { ink: string; accent: string; head: string; headText: string; soft: string; font: string; bold: string; band: boolean }> = {
  classic: { ink: "#202832", accent: "#202832", head: "#202832", headText: "#FFFFFF", soft: "#F2F1EE", font: "Times-Roman", bold: "Times-Bold", band: false },
  modern: { ink: "#202832", accent: "#B77945", head: "#F6EBE1", headText: "#5A3A1F", soft: "#FAF8F4", font: "Helvetica", bold: "Helvetica-Bold", band: false },
  navy: { ink: "#202832", accent: "#17324D", head: "#17324D", headText: "#FAF8F4", soft: "#EEF2F6", font: "Helvetica", bold: "Helvetica-Bold", band: true },
};

export function BusinessDocument({ d }: { d: PdfDocumentData }) {
  const th = THEMES[d.template] ?? THEMES.modern;
  const showPrice = Boolean(d.columns.price);
  const s = StyleSheet.create({
    page: { paddingTop: th.band ? 0 : 40, paddingBottom: 56, paddingHorizontal: 40, fontFamily: th.font, fontSize: 9.5, color: th.ink, lineHeight: 1.35 },
    band: { backgroundColor: th.head, marginHorizontal: -40, paddingHorizontal: 40, paddingTop: 32, paddingBottom: 20, marginBottom: 18 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: th.band ? 0 : 18 },
    companyBox: { flexDirection: "row", gap: 10, maxWidth: "62%" },
    logo: { width: 54, height: 54, objectFit: "contain" },
    companyName: { fontFamily: th.bold, fontSize: 13, lineHeight: 1.3, marginBottom: 2, color: th.band ? th.headText : th.ink },
    companyLine: { color: th.band ? "#D6DEE7" : "#5F6873", fontSize: 8.5 },
    titleBox: { alignItems: "flex-end" },
    title: { fontFamily: th.bold, fontSize: 18, lineHeight: 1.25, letterSpacing: 1.5, color: th.band ? "#E3B88F" : th.accent },
    number: { fontFamily: th.bold, fontSize: 10.5, lineHeight: 1.3, marginTop: 4, color: th.band ? th.headText : th.ink },
    partyRow: { flexDirection: "row", gap: 14, marginBottom: 14 },
    partyBox: { flex: 1, backgroundColor: th.soft, borderRadius: 4, padding: 10 },
    label: { fontFamily: th.bold, fontSize: 7.5, letterSpacing: 0.8, color: "#5F6873", marginBottom: 3 },
    partyName: { fontFamily: th.bold, fontSize: 10.5 },
    metaBox: { width: 190, padding: 10 },
    metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
    metaLabel: { color: "#5F6873" },
    metaValue: { fontFamily: th.bold, textAlign: "right", maxWidth: 110 },
    thead: { flexDirection: "row", backgroundColor: th.head, color: th.headText, paddingVertical: 6, paddingHorizontal: 6, fontFamily: th.bold, fontSize: 8.5 },
    row: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: "#DDD7CB" },
    cNo: { width: 22 },
    cDesc: { flex: 1, paddingRight: 6 },
    cQty: { width: showPrice ? 54 : 80, textAlign: "right" },
    cPrice: { width: 70, textAlign: "right" },
    cTax: { width: 40, textAlign: "right" },
    cAmt: { width: 78, textAlign: "right" },
    itemNote: { fontSize: 8, color: "#5F6873" },
    bottom: { flexDirection: "row", gap: 18, marginTop: 12 },
    bottomLeft: { flex: 1 },
    totals: { width: 220 },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
    grand: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1.2, borderTopColor: th.ink, marginTop: 4, paddingTop: 5 },
    grandText: { fontFamily: th.bold, fontSize: 12, lineHeight: 1.3 },
    words: { fontSize: 8, color: "#5F6873", textAlign: "right", marginTop: 3 },
    highlight: { marginTop: 10, padding: 10, backgroundColor: th.soft, borderLeftWidth: 3, borderLeftColor: th.accent, flexDirection: "row", justifyContent: "space-between" },
    section: { marginTop: 10 },
    sectionBody: { fontSize: 8.8 },
    sigRow: { flexDirection: "row", gap: 40, marginTop: 34 },
    sig: { flex: 1, borderTopWidth: 0.8, borderTopColor: th.ink, paddingTop: 4, fontSize: 8.5 },
    footer: { position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#7A838C" },
    watermark: { position: "absolute", top: 330, left: 0, right: 0, textAlign: "center", fontSize: 90, fontFamily: th.bold, color: "#D64545", opacity: 0.12, transform: "rotate(-30deg)" },
  });

  const headerInner = (
    <View style={s.header}>
      <View style={s.companyBox}>
        {d.company.logo ? <Image src={d.company.logo} style={s.logo} /> : null}
        <View>
          <Text style={s.companyName}>{d.company.name}</Text>
          {d.company.lines.map((l, i) => (
            <Text key={i} style={s.companyLine}>
              {l}
            </Text>
          ))}
        </View>
      </View>
      <View style={s.titleBox}>
        <Text style={s.title}>{d.title}</Text>
        <Text style={s.number}>{d.number}</Text>
      </View>
    </View>
  );

  const party = (p: PdfParty) => (
    <View style={s.partyBox}>
      <Text style={s.label}>{p.label.toUpperCase()}</Text>
      <Text style={s.partyName}>{p.name}</Text>
      {p.lines.map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
    </View>
  );

  return (
    <Document title={`${d.title} ${d.number}`} author={d.company.name} creator="BukuTigaLima" producer="BukuTigaLima">
      <Page size="A4" style={s.page} wrap>
        {d.watermark ? (
          <Text style={s.watermark} fixed>
            {d.watermark}
          </Text>
        ) : null}
        {th.band ? <View style={s.band}>{headerInner}</View> : headerInner}

        <View style={s.partyRow}>
          {party(d.party)}
          {d.secondParty ? party(d.secondParty) : null}
          <View style={s.metaBox}>
            {d.meta.map((m) => (
              <View key={m.label} style={s.metaRow}>
                <Text style={s.metaLabel}>{m.label}</Text>
                <Text style={s.metaValue}>{m.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {d.items.length > 0 && (
          <View>
            <View style={s.thead} fixed>
              <Text style={s.cNo}>{d.columns.no}</Text>
              <Text style={s.cDesc}>{d.columns.description}</Text>
              <Text style={s.cQty}>{d.columns.qty}</Text>
              {showPrice && <Text style={s.cPrice}>{d.columns.price}</Text>}
              {d.columns.tax && <Text style={s.cTax}>{d.columns.tax}</Text>}
              {d.columns.amount && <Text style={s.cAmt}>{d.columns.amount}</Text>}
            </View>
            {d.items.map((it) => (
              <View key={it.no} style={s.row} wrap={false}>
                <Text style={s.cNo}>{it.no}</Text>
                <View style={s.cDesc}>
                  <Text>{it.description}</Text>
                  {it.note ? <Text style={s.itemNote}>{it.note}</Text> : null}
                </View>
                <Text style={s.cQty}>
                  {it.qty}
                  {it.unit ? ` ${it.unit}` : ""}
                </Text>
                {showPrice && <Text style={s.cPrice}>{it.price}</Text>}
                {d.columns.tax && <Text style={s.cTax}>{it.tax}</Text>}
                {d.columns.amount && <Text style={s.cAmt}>{it.amount}</Text>}
              </View>
            ))}
          </View>
        )}

        <View style={s.bottom} wrap={false}>
          <View style={s.bottomLeft}>
            {(d.sections ?? []).map((sec) => (
              <View key={sec.title} style={s.section}>
                <Text style={s.label}>{sec.title.toUpperCase()}</Text>
                <Text style={s.sectionBody}>{sec.body}</Text>
              </View>
            ))}
          </View>
          {d.totals && d.totals.length > 0 && (
            <View style={s.totals}>
              {d.totals.map((t) =>
                t.strong ? (
                  <View key={t.label} style={s.grand}>
                    <Text style={s.grandText}>{t.label}</Text>
                    <Text style={s.grandText}>{t.value}</Text>
                  </View>
                ) : (
                  <View key={t.label} style={s.totalRow}>
                    <Text style={s.metaLabel}>{t.label}</Text>
                    <Text>{t.value}</Text>
                  </View>
                ),
              )}
              {d.amountInWords ? <Text style={s.words}>{d.amountInWords}</Text> : null}
            </View>
          )}
        </View>

        {d.highlight ? (
          <View style={s.highlight} wrap={false}>
            <Text style={s.grandText}>{d.highlight.label}</Text>
            <Text style={s.grandText}>{d.highlight.value}</Text>
          </View>
        ) : null}
        {d.highlight && d.amountInWords && !d.totals?.length ? <Text style={[s.words, { textAlign: "left" }]}>{d.amountInWords}</Text> : null}

        {d.signatures && d.signatures.length > 0 && (
          <View style={s.sigRow} wrap={false}>
            {d.signatures.map((sig) => (
              <Text key={sig} style={s.sig}>
                {sig}
              </Text>
            ))}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>{d.footer}</Text>
          <Text render={({ pageNumber, totalPages }) => d.pageLabel(pageNumber, totalPages)} />
        </View>
      </Page>
    </Document>
  );
}
