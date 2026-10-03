// One account per real person: lowercase, trim, drop +tag, and for Gmail drop dots.
export function normaliseEmail(raw) {
  const s = String(raw).trim().toLowerCase();
  const at = s.lastIndexOf('@');
  if (at < 1 || at === s.length - 1) return null;
  let local = s.slice(0, at);
  let domain = s.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replaceAll('.', '');
    domain = 'gmail.com';
  }
  if (!local) return null;
  return `${local}@${domain}`;
}

export const emailDomain = (normalised) => normalised.slice(normalised.lastIndexOf('@') + 1);
