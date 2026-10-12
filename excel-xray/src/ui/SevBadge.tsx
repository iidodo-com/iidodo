import { CERTAINTY_LABEL, SEVERITY_LABEL, type Certainty, type Severity } from '../core/types';

export function SevBadge({ sev }: { sev: Severity }) {
  return <span className={`badge sev-${sev}`} title={`重要度: ${SEVERITY_LABEL[sev]}`}>{SEVERITY_LABEL[sev]}</span>;
}

const CERT_SHORT: Record<Certainty, string> = { confirmed: '事実', likely: '可能性大', candidate: '要確認の候補' };
export function CertBadge({ c }: { c: Certainty }) {
  return <span className={`cert cert-${c}`} title={CERTAINTY_LABEL[c]}>{CERT_SHORT[c]}</span>;
}
