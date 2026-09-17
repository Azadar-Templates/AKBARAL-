/**
 * Destination descriptions must never be payment instruments.
 *
 * The mission holds only a provider reference (e.g. a payout-provider account id)
 * or a MASKED description of where money may be sent. Full card numbers, IBANs,
 * long digit runs and credential material are refused outright — not masked and
 * stored — because the platform must never be in a position to move money from
 * raw instrument credentials. Pure and dependency-free, so both the treasury
 * (writes) and the verification flow (evidence) can apply the same rule.
 */
function luhnValid(digits: string): boolean {
  if (!/^[0-9]{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function ibanValid(value: string): boolean {
  const compact = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const rearranged = `${compact.slice(4)}${compact.slice(0, 4)}`;
  const converted = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  // mod-97 over a long numeric string, computed digit by digit.
  let remainder = 0;
  for (const character of converted) {
    remainder = (remainder * 10 + Number(character)) % 97;
  }
  return remainder === 1;
}

export function looksLikeInstrumentCredential(value: string): { unsafe: boolean; reason?: string } {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^0-9]/g, '');

  // A real card number: card-length digit run with a valid Luhn checksum.
  if (luhnValid(digits) && digits.length >= 13) {
    return { unsafe: true, reason: 'that looks like a full card number (it passes the card checksum)' };
  }
  // A real IBAN: country + check digits with a valid mod-97 checksum.
  if (ibanValid(trimmed)) {
    return { unsafe: true, reason: 'that looks like a full IBAN (it passes the IBAN checksum)' };
  }
  // Explicitly marked as a card/bank instrument description without masking.
  if (/(card|account|iban|routing|swift)\s*(number|no\.?|#)?\s*[:=]?\s*[0-9]{8,}/i.test(trimmed) && !trimmed.includes('*')) {
    return { unsafe: true, reason: 'instrument numbers must be masked (for example ****4821)' };
  }
  // Credential material is never a destination description.
  if (/(private[_-]?key|api[_-]?key|secret|passphrase|seed phrase)/i.test(trimmed)) {
    return { unsafe: true, reason: 'credential material is not a destination description' };
  }
  return { unsafe: false };
}

/** Human-readable summary of the rule, reused by docs and API error messages. */
export const DESTINATION_SAFETY_RULE =
  'payout destinations are described by a provider reference or a masked description (for example ****4821); card numbers, IBANs, long digit runs and credential material are refused';
